import { describe, expect, it } from "bun:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { connectedClient } from "./testing.ts";

type Structured<T> = { structuredContent?: T; isError?: boolean; content: { type: string; text?: string }[] };
const call = async <T = Record<string, unknown>>(client: Awaited<ReturnType<typeof connectedClient>>["client"], name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Structured<T>;

describe("Bob MCP server", () => {
  it("links UI tools to ui:// views and hides approval from the model", async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual(["bob_linear_links", "bob_planning_approve", "bob_planning_dispatch", "bob_planning_review", "bob_runs_list", "bob_work_item_get", "bob_workspace"]);
    expect(byName.get("bob_workspace")?._meta).toMatchObject({ ui: { resourceUri: "ui://bob/workspace.html" }, "ui/resourceUri": "ui://bob/workspace.html" });
    expect(byName.get("bob_planning_review")?._meta).toMatchObject({ ui: { resourceUri: "ui://bob/planning-review.html" } });
    expect(byName.get("bob_planning_approve")?._meta).toEqual({ ui: { visibility: ["app"] } });
    expect(byName.get("bob_workspace")?.annotations?.readOnlyHint).toBe(true);
  });

  it("serves each view as a self-contained MCP App resource", async () => {
    const { client } = await connectedClient();
    const { resources } = await client.listResources();
    expect(resources.map((resource) => [resource.uri, resource.mimeType])).toEqual([
      ["ui://bob/workspace.html", RESOURCE_MIME_TYPE],
      ["ui://bob/planning-review.html", RESOURCE_MIME_TYPE],
    ]);
    for (const resource of resources) {
      const { contents } = await client.readResource({ uri: resource.uri });
      const html = (contents[0] as { text: string }).text;
      expect(contents[0]?.mimeType).toBe(RESOURCE_MIME_TYPE);
      expect(html).toStartWith("<!doctype html>");
      expect(html).toContain("ui/initialize");
      // T3's sandbox CSP is default-src 'none': nothing may load from outside.
      expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
      expect(html.length).toBeLessThan(100_000);
    }
  });

  it("returns the workspace view model and a text summary for agents", async () => {
    const { client } = await connectedClient();
    const result = await call<{ workItems: { id: string }[]; runs: unknown[]; pollSeconds: number; workspaceId: string }>(client, "bob_workspace", { query: "ship" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ workspaceId: "ws-1", pollSeconds: 30, runs: [] });
    expect(result.structuredContent?.workItems.map((item) => item.id)).toEqual(["w1"]);
    expect(result.content[0]?.text).toContain("w1 [in progress] Ship the MCP port");
  });

  it("reports a missing workspace as a tool error", async () => {
    const { client } = await connectedClient({ workspaceId: null });
    const result = await call(client, "bob_workspace");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("BOB_WORKSPACE_ID");
  });

  it("requires per-work-item human approval before dispatch", async () => {
    const { client, dispatched } = await connectedClient();
    const review = await call<{ workflow: { currentStage: string; actions: { id: string }[] } }>(client, "bob_planning_review", { workItemId: "w1" });
    expect(review.structuredContent?.workflow).toMatchObject({ currentStage: "review", actions: [{ id: "approve" }] });

    const early = await call(client, "bob_planning_dispatch", { workItemId: "w1" });
    expect(early.isError).toBe(true);
    expect(dispatched).toEqual([]);

    expect((await call(client, "bob_planning_approve", { workItemId: "w1" })).isError).toBeFalsy();
    // Approval does not leak to other work items.
    expect((await call(client, "bob_planning_dispatch", { workItemId: "w2" })).isError).toBe(true);

    const done = await call<{ workflow: { currentStage: string }; dispatched: { id: string }; runs: { status: string }[] }>(client, "bob_planning_dispatch", { workItemId: "w1", agentType: "codex" });
    expect(done.isError).toBeFalsy();
    expect(dispatched).toEqual([{ workItemId: "w1", agentType: "codex" }]);
    expect(done.structuredContent).toMatchObject({ workflow: { currentStage: "verify" }, dispatched: { id: "s1" }, runs: [{ status: "running" }] });
  });

  it("keeps Bob-owned Linear links", async () => {
    const { client } = await connectedClient();
    expect((await call<{ kind: string }>(client, "bob_linear_links", { action: "upsert", bobWorkItemId: "w1", linearIssueId: "T3CODE-78" })).structuredContent?.kind).toBe("create");
    expect((await call<{ kind: string }>(client, "bob_linear_links", { action: "upsert", bobWorkItemId: "w1", linearIssueId: "T3CODE-78" })).structuredContent?.kind).toBe("unchanged");
    expect((await call<{ links: unknown[] }>(client, "bob_linear_links", { action: "list" })).structuredContent?.links).toHaveLength(1);
    await call(client, "bob_linear_links", { action: "remove", bobWorkItemId: "w1" });
    expect((await call<{ link: unknown }>(client, "bob_linear_links", { action: "get", bobWorkItemId: "w1" })).structuredContent?.link).toBeNull();
  });
});
