#!/usr/bin/env bun
// In-memory stand-in for Bob's /api/v1 routes the plugin uses, for local
// demos and inspector sessions: `bun scripts/fake-bob.ts` (PORT, default 4319).
// It also serves a fake SDLC edge at ws://…/api/sdlc/ws (any Bearer token) so
// bob_sdlc renders offline: run the plugin with BOB_API_TOKEN=bob_fake and open
//   /?tool=bob_sdlc                                   (fleet)
//   /?tool=bob_sdlc&args={"threadId":"thread-demo-running"}  (thread match; also thread-demo-waiting)
import { demoCi, demoSnapshot, demoTail } from "../src/sdlc/fixtures.ts";

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

const server = Bun.serve<{ watched: string | null }>({
  port: Number(process.env.PORT ?? 4319),
  async fetch(request, srv) {
    const url = new URL(request.url);
    if (url.pathname === "/api/sdlc/ws") {
      // Native clients send a Bearer key and no Origin, like the real edge expects.
      if (!request.headers.get("authorization")?.startsWith("Bearer ")) return new Response("missing bearer", { status: 401 });
      return srv.upgrade(request, { data: { watched: null } }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
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
  websocket: {
    open(ws) {
      ws.subscribe("sdlc");
    },
    message(ws, raw) {
      const message = JSON.parse(String(raw)) as { type: string; itemId?: string | null };
      if (message.type === "hello") {
        ws.send(JSON.stringify(demoSnapshot()));
        ws.send(JSON.stringify({ type: "status", coordinatorSeenAt: Date.now() }));
      }
      if (message.type === "watch" && message.itemId) {
        ws.data.watched = message.itemId;
        const tail = demoTail(message.itemId);
        ws.send(JSON.stringify(tail ?? { type: "tailUnavailable", itemId: message.itemId, reason: "The relay has not posted for this item recently." }));
        ws.send(JSON.stringify(demoCi(message.itemId)));
      }
    },
  },
});
// The coordinator heartbeat, so the view never shows the coordinator as offline.
setInterval(() => server.publish("sdlc", JSON.stringify({ type: "status", coordinatorSeenAt: Date.now() })), 30_000);
console.error(`fake Bob API on http://localhost:${server.port} (workspace ${workspaceId})`);
