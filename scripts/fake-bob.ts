#!/usr/bin/env bun
// In-memory stand-in for Bob's /api/v1 routes the plugin uses, for local
// demos and inspector sessions: `bun scripts/fake-bob.ts` (PORT, default 4319).
const workspaceId = "00000000-0000-4000-8000-000000000001";
const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const workItems = [
  { id: "wi-101", identifier: "BOB-101", title: "Port the Bob plugin to an MCP server", status: "in_progress", kind: "issue", projectId: "proj-t3", workspaceId, updatedAt: iso(12) },
  { id: "wi-102", identifier: "BOB-102", title: "Add MCP Apps views for planning review", status: "todo", kind: "task", projectId: "proj-t3", workspaceId, updatedAt: iso(45) },
  { id: "wi-103", identifier: "BOB-103", title: "Map plugin settings to Tools env vars", status: "done", kind: "task", projectId: "proj-t3", workspaceId, updatedAt: iso(180) },
  { id: "wi-104", identifier: "BOB-104", title: "Blocked: thread-less plugin panels (T3CODE-74)", status: "blocked", kind: "issue", projectId: "proj-t3", workspaceId, updatedAt: iso(600) },
];
const runs = [
  { id: "run-9", sessionId: "sess-9", workItemId: "wi-103", workspaceId, agentType: "claude", status: "completed", summary: "Env mapping merged with tests.", createdAt: iso(200) },
  { id: "run-8", sessionId: "sess-8", workItemId: "wi-101", workspaceId, agentType: "codex", status: "failed", summary: "Typecheck failed: SDK v1/v2 mismatch.", createdAt: iso(90) },
];

const json = (body: unknown, status = 200) => Response.json(body, { status });

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4319),
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    if (path === "/work-items/list") return json(workItems.filter((item) => !body.projectId || item.projectId === body.projectId));
    if (path === "/work-items/get") {
      const workItem = workItems.find((item) => item.id === body.id);
      return json(workItem ? { workItem, currentArtifacts: [], childCount: 0 } : null);
    }
    if (path === "/runs") return json(runs.filter((run) => run.workspaceId === url.searchParams.get("workspaceId")));
    const match = path.match(/^\/work-items\/([^/]+)\/(runs|dispatch)$/);
    if (match?.[2] === "runs") return json(runs.filter((run) => run.workItemId === match[1]));
    if (match?.[2] === "dispatch") {
      const id = `run-${runs.length + 10}`;
      runs.unshift({ id, sessionId: `sess-${id}`, workItemId: match[1]!, workspaceId, agentType: String(body.agentType ?? "claude"), status: "running", summary: "Dispatched from the planning review.", createdAt: new Date().toISOString() });
      return json({ sessionId: `sess-${id}`, identifier: match[1], status: "pending" });
    }
    return json({ error: `fake Bob has no route ${request.method} ${url.pathname}` }, 404);
  },
});
console.error(`fake Bob API on http://localhost:${server.port} (workspace ${workspaceId})`);
