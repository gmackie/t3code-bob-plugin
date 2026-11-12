import { describe, expect, it } from "bun:test";
import { createBobHttpClient } from "./bobClient.ts";

function recorder(responses: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const key = Object.keys(responses).find((path) => url.endsWith(path))!;
    const { status = 200, body } = responses[key]!;
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetch };
}

describe("Bob REST client", () => {
  it("calls Bob's /api/v1 routes with the bearer token", async () => {
    const { calls, fetch } = recorder({
      "/work-items/list": { body: [{ id: "w1", title: "Ship", status: "todo" }] },
      "/work-items/get": { body: { workItem: { id: "w1", title: "Ship", status: "todo" }, currentArtifacts: [], childCount: 0 } },
      "/work-items/w1/dispatch": { body: { sessionId: "s1", identifier: "BOB-1", status: "pending" } },
    });
    const client = createBobHttpClient({ baseUrl: "https://bob.example/", token: "bob_secret", fetch });
    await client.listWorkItems({ workspaceId: "ws", projectId: "p" });
    await expect(client.getWorkItem({ workItemId: "w1" })).resolves.toMatchObject({ id: "w1" });
    await expect(client.dispatchWorkItem({ workItemId: "w1", agentType: "codex" })).resolves.toEqual({ id: "s1", sessionId: "s1", workItemId: "w1", status: "pending" });
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ["POST", "https://bob.example/api/v1/work-items/list", { workspaceId: "ws", projectId: "p", limit: 100 }],
      ["POST", "https://bob.example/api/v1/work-items/get", { id: "w1" }],
      ["POST", "https://bob.example/api/v1/work-items/w1/dispatch", { agentType: "codex" }],
    ]);
    expect(calls[0]!.headers.authorization).toBe("Bearer bob_secret");
  });

  it("lists runs newest first, by workspace or work item", async () => {
    const runs = [
      { id: "old", status: "completed", createdAt: "2026-10-01T00:00:00Z" },
      { id: "new", status: "running", createdAt: "2026-10-30T00:00:00Z" },
    ];
    const { calls, fetch } = recorder({ "/runs?workspaceId=ws&limit=50": { body: runs }, "/work-items/w1/runs?limit=20": { body: runs } });
    const client = createBobHttpClient({ baseUrl: "https://bob.example", fetch });
    expect((await client.listRuns({ workspaceId: "ws" })).map((run) => run.id)).toEqual(["new", "old"]);
    await client.listRuns({ workspaceId: "ws", workItemId: "w1" });
    expect(calls[1]!.url).toBe("https://bob.example/api/v1/work-items/w1/runs?limit=20");
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it("does not send server-side query details to the panel on a service failure", async () => {
    const { fetch } = recorder({ "/runs?workspaceId=ws&limit=50": { status: 500, body: { error: "Failed query: select secret_internal_columns from agent_runs" } } });
    const client = createBobHttpClient({ baseUrl: "https://bob.example", fetch });
    await expect(client.listRuns({ workspaceId: "ws" })).rejects.toThrow("Bob is temporarily unavailable");
    try { await client.listRuns({ workspaceId: "ws" }); } catch (error) {
      expect(String(error)).not.toContain("secret_internal_columns");
    }
  });

  it("turns Bob error bodies and missing items into errors", async () => {
    const { fetch } = recorder({ "/work-items/w1/dispatch": { status: 403, body: { error: "dispatch disabled" } }, "/work-items/get": { body: null } });
    const client = createBobHttpClient({ baseUrl: "https://bob.example", fetch });
    await expect(client.dispatchWorkItem({ workItemId: "w1" })).rejects.toThrow("(403): dispatch disabled");
    await expect(client.getWorkItem({ workItemId: "nope" })).rejects.toThrow("not found");
  });
});
