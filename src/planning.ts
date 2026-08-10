import type { BobRun, BobWorkItem, RunSummary, WorkItem, WorkItemDetail } from "./types.ts";

export type BobPlanningClient = {
  listWorkItems(input: { workspaceId: string; projectId?: string }): Promise<readonly BobWorkItem[]>;
  getWorkItem(input: { workItemId: string }): Promise<BobWorkItem>;
  listRuns(input: { workspaceId: string; workItemId?: string }): Promise<readonly BobRun[]>;
  dispatchWorkItem(input: { workItemId: string; agentType: string; executionTargetId: string }): Promise<BobRun>;
};

export type PlanningWorkflowModel = {
  readonly pluginId: string;
  readonly workflowId: string;
  readonly title: string;
  readonly currentStage: "inspect" | "context" | "propose" | "review" | "approve" | "execute" | "verify" | "respond";
  readonly refreshedAt: string;
  readonly steps: readonly { id: string; stage: PlanningWorkflowModel["currentStage"]; title: string; state: "pending" | "active" | "completed" | "blocked" | "failed"; detail?: string }[];
  readonly evidence?: readonly { id: string; title: string; kind: "check" | "artifact" | "diff" | "log" | "link"; status: "neutral" | "positive" | "warning" | "negative"; detail?: string }[];
  readonly actions?: readonly { id: string; title: string; tone?: "primary" | "secondary" | "destructive" }[];
};

export function buildPlanningWorkflow(item: WorkItem, runs: readonly RunSummary[], state: { readonly approved?: boolean; readonly dispatchRequested?: boolean } = {}): PlanningWorkflowModel {
  const latestRun = runs[0];
  const failed = latestRun?.status === "failed";
  const steps = [
    { id: "inspect", stage: "inspect" as const, title: "Inspect Bob work item", state: "completed" as const, detail: item.title },
    { id: "context", stage: "context" as const, title: "Collect planning and run context", state: "completed" as const, detail: `${runs.length} associated runs` },
    { id: "propose", stage: "propose" as const, title: "Propose execution target", state: "completed" as const },
    { id: "review", stage: "review" as const, title: "Review dispatch plan", state: state.approved ? "completed" as const : "active" as const },
    { id: "approve", stage: "approve" as const, title: "Approve Bob dispatch", state: state.approved ? "completed" as const : "pending" as const },
    { id: "execute", stage: "execute" as const, title: "Dispatch work item", state: state.dispatchRequested ? "completed" as const : state.approved ? "active" as const : "pending" as const },
    { id: "verify", stage: "verify" as const, title: "Verify Bob run", state: state.dispatchRequested ? latestRun?.status === "succeeded" ? "completed" as const : failed ? "failed" as const : "active" as const : "pending" as const, detail: latestRun ? `Latest run ${latestRun.id}: ${latestRun.status}` : "Waiting for dispatch" },
    { id: "respond", stage: "respond" as const, title: "Prepare work-item response", state: "pending" as const },
  ];
  return {
    pluginId: "com.t3code.bob",
    workflowId: "bob.planning-review",
    title: "Planning review",
    currentStage: state.dispatchRequested ? "verify" : state.approved ? "execute" : "review",
    refreshedAt: new Date().toISOString(),
    steps,
    evidence: [{ id: "bob-run", title: "Bob run state", kind: "check", status: failed ? "negative" : latestRun?.status === "succeeded" ? "positive" : "neutral", detail: latestRun ? `${latestRun.id} · ${latestRun.status}` : "No run dispatched yet" }],
    actions: state.dispatchRequested ? [] : state.approved ? [{ id: "execute", title: "Dispatch work item", tone: "primary" }] : [{ id: "approve", title: "Approve Bob dispatch", tone: "primary" }],
  };
}

const statusCategory = (status: string): WorkItem["status"]["category"] => {
  const value = status.toLowerCase();
  if (value.includes("done") || value.includes("complete")) return "done";
  if (value.includes("block")) return "blocked";
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("progress") || value.includes("active") || value.includes("run")) return "active";
  return "backlog";
};

export function normalizeBobWorkItem(item: BobWorkItem): WorkItem {
  return {
    providerId: "bob",
    id: item.id,
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    ...(item.url ? { url: item.url } : {}),
    status: { id: item.status, label: item.status, category: statusCategory(item.status) },
    scope: item.projectId ? { projectId: item.projectId } : {},
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  };
}

export function normalizeBobRun(run: BobRun): RunSummary {
  const status = statusCategory(run.status);
  return {
    providerId: "bob",
    id: run.id,
    status: status === "done" ? "succeeded" : status === "cancelled" ? "cancelled" : status === "active" ? "running" : "queued",
    ...(run.workItemId ? { workItemId: run.workItemId } : {}),
    ...(run.threadId ? { threadId: run.threadId } : {}),
  };
}

export function createBobWorkSource(client: BobPlanningClient, workspaceId: string) {
  return {
    async list(scope: { projectId?: string; query?: string }): Promise<readonly WorkItem[]> {
      const items = await client.listWorkItems({ workspaceId, ...(scope.projectId ? { projectId: scope.projectId } : {}) });
      return items
        .filter((item) => !scope.query || item.title.toLowerCase().includes(scope.query.toLowerCase()))
        .map(normalizeBobWorkItem);
    },
    async get(itemId: string): Promise<WorkItemDetail> {
      return { item: normalizeBobWorkItem(await client.getWorkItem({ workItemId: itemId })) };
    },
    async runs(workItemId?: string): Promise<readonly RunSummary[]> {
      return (await client.listRuns({ workspaceId, ...(workItemId ? { workItemId } : {}) })).map(normalizeBobRun);
    },
    async dispatch(input: { workItemId: string; agentType: string; executionTargetId: string }): Promise<RunSummary> {
      return normalizeBobRun(await client.dispatchWorkItem(input));
    },
  };
}
