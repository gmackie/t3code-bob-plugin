import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { reconcileBobLinearLink } from "./links.ts";
import { buildPlanningWorkflow, createBobWorkSource, type BobPlanningClient } from "./planning.ts";
import type { BobStateStore } from "./state.ts";
import { VIEWS, viewHtml, type ViewName } from "./views/html.ts";
import type { PlanningData, WorkspaceData } from "./views/render.ts";

export const SERVER_INFO = { name: "bob", version: "0.2.0" } as const;

export type BobServerOptions = {
  client: BobPlanningClient;
  state: Pick<BobStateStore, "getWorkflowState" | "saveWorkflowState" | "getLinearLink" | "listLinearLinks" | "saveLinearLink" | "removeLinearLink">;
  workspaceId?: string;
  pollSeconds: number;
};

// Approval is recorded per work item in the shared state file, not in memory:
// T3 runs one copy of a stdio plugin per agent session plus one in its pool,
// so a panel's approval and an agent's dispatch may hit different processes.
export const planningWorkflowId = (workItemId: string) => `bob.planning-review:${workItemId}`;

const workItemId = z.string().min(1).describe("Bob work item id");

export function createBobMcpServer(options: BobServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Bob plans and runs agent work items. Use bob_workspace to browse work items and runs, and bob_planning_review to review one before dispatch. Dispatch requires a human to approve it in the planning review view.",
  });

  const workspace = (override?: string) => {
    const id = override ?? options.workspaceId;
    if (!id) throw new Error("No Bob workspace configured: set BOB_WORKSPACE_ID or pass workspaceId");
    return id;
  };

  async function planning(id: string): Promise<PlanningData> {
    const source = createBobWorkSource(options.client, workspace());
    const [detail, runs, state] = await Promise.all([source.get(id), source.runs(id), options.state.getWorkflowState(planningWorkflowId(id))]);
    return { workItem: detail.item, runs, workflow: buildPlanningWorkflow(detail.item, runs, state) };
  }

  for (const [name, view] of Object.entries(VIEWS) as [ViewName, (typeof VIEWS)[ViewName]][]) {
    registerAppResource(server, view.title, view.uri, { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true } } }, async () => ({
      contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(name), _meta: { ui: { prefersBorder: true } } }],
    }));
  }

  registerAppTool(
    server,
    "bob_workspace",
    {
      title: "Bob workspace",
      description: "List Bob work items and recent runs for the workspace, optionally filtered by project or title. Renders the Bob workspace view.",
      inputSchema: z.object({
        workspaceId: z.string().optional().describe("Bob workspace id; defaults to BOB_WORKSPACE_ID"),
        projectId: z.string().optional().describe("Only work items in this Bob project"),
        query: z.string().optional().describe("Case-insensitive title filter"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.workspace.uri, visibility: ["model", "app"] } },
    },
    async ({ workspaceId, projectId, query }) =>
      result(async () => {
        const source = createBobWorkSource(options.client, workspace(workspaceId));
        const [workItems, runs] = await Promise.all([source.list({ ...(projectId ? { projectId } : {}), ...(query ? { query } : {}) }), source.runs()]);
        const data: WorkspaceData = { workspaceId: workspace(workspaceId), workItems, runs, pollSeconds: options.pollSeconds, refreshedAt: new Date().toISOString() };
        const lines = workItems.map((item) => `- ${item.id} [${item.status.label}] ${item.title}`);
        return { data, text: `${workItems.length} Bob work items, ${runs.length} recent runs.\n${lines.join("\n")}` };
      }),
  );

  registerAppTool(
    server,
    "bob_planning_review",
    {
      title: "Bob planning review",
      description: "Show the planning review for a Bob work item: stages, latest run evidence and the next action. A human approves dispatch from the rendered view.",
      inputSchema: z.object({ workItemId }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.planning.uri, visibility: ["model", "app"] } },
    },
    async ({ workItemId: id }) =>
      result(async () => {
        const data = await planning(id);
        const next = data.workflow.actions?.[0]?.title ?? "none";
        return { data, text: `Planning review for "${data.workItem.title}": stage ${data.workflow.currentStage}, next action: ${next}.` };
      }),
  );

  // App-only: the agent cannot approve its own dispatch; T3 hides this tool
  // from the model and only lets the view call it.
  server.registerTool(
    "bob_planning_approve",
    {
      title: "Approve Bob dispatch",
      description: "Record human approval to dispatch a Bob work item.",
      inputSchema: z.object({ workItemId }),
      annotations: { idempotentHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ workItemId: id }) =>
      result(async () => {
        const state = await options.state.getWorkflowState(planningWorkflowId(id));
        await options.state.saveWorkflowState(planningWorkflowId(id), { ...state, approved: true });
        return { data: { workItemId: id, approved: true }, text: `Bob dispatch approved for ${id}.` };
      }),
  );

  registerAppTool(
    server,
    "bob_planning_dispatch",
    {
      title: "Dispatch Bob work item",
      description: "Dispatch an approved Bob work item to an agent. Fails unless a human approved it in the planning review.",
      inputSchema: z.object({ workItemId, agentType: z.string().optional().describe("Agent type, e.g. claude or codex; defaults to Bob's configured agent") }),
      annotations: { openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.planning.uri, visibility: ["model", "app"] } },
    },
    async ({ workItemId: id, agentType }) =>
      result(async () => {
        const state = await options.state.getWorkflowState(planningWorkflowId(id));
        if (!state.approved) throw new Error("Bob dispatch must be approved in the planning review before execution");
        const run = await createBobWorkSource(options.client, workspace()).dispatch({ workItemId: id, ...(agentType ? { agentType } : {}) });
        await options.state.saveWorkflowState(planningWorkflowId(id), { approved: true, dispatchRequested: true });
        // Returns the refreshed review so the planning view can render it.
        return { data: { ...(await planning(id)), dispatched: run }, text: `Bob session ${run.id} dispatched for ${id}.` };
      }),
  );

  server.registerTool(
    "bob_work_item_get",
    { title: "Get Bob work item", description: "Get one Bob work item.", inputSchema: z.object({ workItemId }), annotations: { readOnlyHint: true, openWorldHint: true } },
    async ({ workItemId: id }) =>
      result(async () => {
        const detail = await createBobWorkSource(options.client, workspace()).get(id);
        return { data: detail, text: JSON.stringify(detail.item, null, 2) };
      }),
  );

  server.registerTool(
    "bob_runs_list",
    {
      title: "List Bob runs",
      description: "List recent Bob runs, newest first, for the workspace or one work item.",
      inputSchema: z.object({ workItemId: workItemId.optional() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ workItemId: id }) =>
      result(async () => {
        const runs = await createBobWorkSource(options.client, workspace()).runs(id);
        return { data: { runs }, text: runs.map((run) => `- ${run.id} [${run.status}]${run.workItemId ? ` ${run.workItemId}` : ""}`).join("\n") || "No runs." };
      }),
  );

  server.registerTool(
    "bob_linear_links",
    {
      title: "Bob ↔ Linear links",
      description: "Read or change the Bob-owned links between Bob work items and Linear-compatible (Linear/Kanbanger) issues. Omit bobWorkItemId to list all links.",
      inputSchema: z.object({
        action: z.enum(["get", "list", "upsert", "remove"]),
        bobWorkItemId: z.string().optional(),
        linearIssueId: z.string().optional().describe("Required for upsert"),
        linearProjectId: z.string().optional(),
      }),
      annotations: { openWorldHint: false },
    },
    async ({ action, bobWorkItemId, linearIssueId, linearProjectId }) =>
      result(async () => {
        if (action === "list") {
          const links = await options.state.listLinearLinks();
          return { data: { links }, text: `${links.length} Bob ↔ Linear links.` };
        }
        if (!bobWorkItemId) throw new Error("bobWorkItemId is required");
        if (action === "get") {
          const link = (await options.state.getLinearLink(bobWorkItemId)) ?? null;
          return { data: { link }, text: link ? `${bobWorkItemId} → ${link.linearIssueId}` : `${bobWorkItemId} has no Linear link.` };
        }
        if (action === "remove") {
          await options.state.removeLinearLink(bobWorkItemId);
          return { data: { removed: true }, text: `Removed the Linear link for ${bobWorkItemId}.` };
        }
        if (!linearIssueId) throw new Error("linearIssueId is required for upsert");
        const input = { bobWorkItemId, linearIssueId, ...(linearProjectId ? { linearProjectId } : {}) };
        const reconciliation = reconcileBobLinearLink(input, await options.state.getLinearLink(bobWorkItemId));
        if (reconciliation.kind !== "unchanged") await options.state.saveLinearLink(reconciliation.link);
        return { data: reconciliation, text: `Linear link ${reconciliation.kind}: ${bobWorkItemId} → ${linearIssueId}` };
      }),
  );

  return server;
}

async function result(run: () => Promise<{ data: unknown; text: string }>): Promise<CallToolResult> {
  try {
    const { data, text } = await run();
    return { content: [{ type: "text", text }], structuredContent: data as Record<string, unknown> };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}
