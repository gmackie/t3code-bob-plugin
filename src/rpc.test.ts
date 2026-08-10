import { describe, expect, it } from "bun:test";

import { createBobRpcHandler, createBobRpcHandlerWithState } from "./rpc.ts";

describe("Bob plugin RPC boundary", () => {
  it("keeps Bob-owned planning operations behind normalized RPC methods", async () => {
    const handler = createBobRpcHandler({
      listWorkItems: async () => [{ id: "w1", title: "Ship", status: "queued" }],
      getWorkItem: async () => ({ id: "w1", title: "Ship", status: "queued" }),
      listRuns: async () => [],
      dispatchWorkItem: async () => ({ id: "r1", workItemId: "w1", status: "running" }),
    }, "workspace-1");

    await expect(handler({ method: "workItems.list", payload: {} })).resolves.toEqual({
      ok: true,
      result: [{
        providerId: "bob",
        id: "w1",
        title: "Ship",
        status: { id: "queued", label: "queued", category: "backlog" },
        scope: {},
      }],
    });
  });

  it("approves and dispatches a Bob planning workflow through Bob", async () => {
    let dispatched = false;
    let saved = false;
    const handler = createBobRpcHandler({
      listWorkItems: async () => [{ id: "w1", title: "Ship", status: "queued" }],
      getWorkItem: async () => ({ id: "w1", title: "Ship", status: "queued" }),
      listRuns: async () => [],
      dispatchWorkItem: async (input) => { dispatched = input.agentType === "codex"; return { id: "r1", workItemId: input.workItemId, status: "running" }; },
    }, "workspace-1", undefined, { approved: false, dispatchRequested: false }, async () => { saved = true; });
    await expect(handler({ method: "workflow.get", payload: { workflowId: "bob.planning-review", workItemId: "w1" } })).resolves.toMatchObject({ ok: true, result: { currentStage: "review" } });
    await expect(handler({ method: "action.execute", payload: { actionId: "approve", workflowId: "bob.planning-review" } })).resolves.toMatchObject({ ok: true, result: { status: "accepted" } });
    await expect(handler({ method: "action.execute", payload: { actionId: "execute", workflowId: "bob.planning-review", workItemId: "w1", agentType: "codex", executionTargetId: "env-1" } })).resolves.toMatchObject({ ok: true, result: { status: "accepted" } });
    expect(dispatched).toBe(true);
    expect(saved).toBe(true);
    await expect(handler({ method: "workflow.get", payload: { workflowId: "bob.planning-review", workItemId: "w1" } })).resolves.toMatchObject({ result: { currentStage: "verify" } });
  });

  it("hydrates workflow state from Bob-owned storage before serving RPC", async () => {
    const handler = await createBobRpcHandlerWithState({
      listWorkItems: async () => [],
      getWorkItem: async () => ({ id: "w1", title: "Ship", status: "queued" }),
      listRuns: async () => [],
      dispatchWorkItem: async () => ({ id: "r1", workItemId: "w1", status: "running" }),
    }, "workspace-1", {
      getWorkflowState: async () => ({ approved: true, dispatchRequested: true }),
      saveWorkflowState: async () => undefined,
    } as never);
    await expect(handler({ method: "workflow.get", payload: { workflowId: "bob.planning-review", workItemId: "w1" } })).resolves.toMatchObject({ result: { currentStage: "verify" } });
  });
});
