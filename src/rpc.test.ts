import { describe, expect, it } from "bun:test";

import { createBobRpcHandler } from "./rpc.ts";

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
});
