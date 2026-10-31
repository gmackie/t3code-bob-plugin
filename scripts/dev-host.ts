#!/usr/bin/env bun
// Minimal MCP Apps host for local development, shaped like T3's McpAppFrame:
// one sandboxed srcdoc iframe (allow-scripts, opaque origin), a host-side
// JSON-RPC bridge, and app-visibility enforcement on tools/call. It spawns the
// plugin over stdio with the current env and serves http://localhost:4320.
//   bun scripts/dev-host.ts            # open /?tool=bob_workspace
// ?sandbox=0 drops the sandbox attribute (same protocol, same-origin frame) for
// browser automation that cannot click into opaque-origin frames.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client({ name: "bob-dev-host", version: "0.1.0" });
await client.connect(new StdioClientTransport({ command: "bun", args: [new URL("../src/mcp.ts", import.meta.url).pathname], env: process.env as Record<string, string> }));
const { tools } = await client.listTools();
const meta = (name: string) => tools.find((tool) => tool.name === name)?._meta as { ui?: { resourceUri?: string; visibility?: string[] } } | undefined;

const page = (tool: string, args: string, sandboxed: boolean) => `<!doctype html><html><head><meta charset="utf-8"><title>Bob dev host · ${tool}</title>
<style>body{font:13px system-ui;margin:0;background:#f6f8fa;color:#1f2328}header{padding:10px 16px;border-bottom:1px solid #d0d7de;background:#fff}code{font-size:12px}
iframe{display:block;width:min(820px,calc(100% - 32px));margin:16px auto;border:1px solid #d0d7de;border-radius:8px;background:#fff;height:300px}#log{width:min(820px,calc(100% - 32px));margin:0 auto 16px;font:11px ui-monospace,monospace;color:#57606a;white-space:pre-wrap}</style></head>
<body><header>Bob dev host · <code>${tool}</code> · ${sandboxed ? 'sandbox="allow-scripts" (opaque origin, like T3)' : "unsandboxed debug frame"}</header><iframe id="view" ${sandboxed ? 'sandbox="allow-scripts allow-forms"' : ""}></iframe><div id="log"></div>
<script type="module">
const frame = document.getElementById("view"), log = document.getElementById("log");
const note = (line) => (log.textContent = new Date().toLocaleTimeString() + "  " + line + "\\n" + log.textContent).slice(0, 4000);
const api = (path, body) => fetch(path, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
const args = ${args};
const result = await api("/api/call", { name: ${JSON.stringify(tool)}, arguments: args, host: true });
frame.srcdoc = (await api("/api/resource", { tool: ${JSON.stringify(tool)} })).html;
const send = (msg) => frame.contentWindow.postMessage({ jsonrpc: "2.0", ...msg }, "*");
addEventListener("message", async (event) => {
  if (event.source !== frame.contentWindow) return;
  const msg = event.data;
  if (msg.method === "ui/initialize") return send({ id: msg.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "bob-dev-host", version: "0.1.0" }, hostCapabilities: { serverTools: {} }, hostContext: { theme: "light" } } });
  if (msg.method === "ui/notifications/initialized") { send({ method: "ui/notifications/tool-input", params: { arguments: args } }); return send({ method: "ui/notifications/tool-result", params: result }); }
  if (msg.method === "ui/notifications/size-changed") { frame.style.height = Math.min(900, msg.params.height + 4) + "px"; return; }
  if (msg.method === "tools/call") { note("view → tools/call " + msg.params.name + " " + JSON.stringify(msg.params.arguments)); const r = await api("/api/call", msg.params); note("  ← " + (r.error ? "error: " + r.error.message : r.isError ? "isError" : "ok")); return send(r.error ? { id: msg.id, error: r.error } : { id: msg.id, result: r }); }
  if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: "Method not found: " + msg.method } });
});
</script></body></html>`;

const server = Bun.serve({
  port: Number(process.env.HOST_PORT ?? 4320),
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      const tool = url.searchParams.get("tool") ?? "bob_workspace";
      return new Response(page(tool, url.searchParams.get("args") ?? "{}", url.searchParams.get("sandbox") !== "0"), { headers: { "content-type": "text/html" } });
    }
    const body = (await request.json()) as Record<string, unknown>;
    if (url.pathname === "/api/resource") {
      const { contents } = await client.readResource({ uri: meta(String(body.tool))!.ui!.resourceUri! });
      return Response.json({ html: (contents[0] as { text: string }).text });
    }
    if (url.pathname === "/api/call") {
      const name = String(body.name);
      // The agent (host: true) may call model-visible tools; the view only app-visible ones.
      const visibility = meta(name)?.ui?.visibility ?? ["model", "app"];
      if (!visibility.includes(body.host ? "model" : "app")) return Response.json({ error: { code: -32600, message: `${name} is not callable from ${body.host ? "the model" : "the app"}` } });
      return Response.json(await client.callTool({ name, arguments: (body.arguments as Record<string, unknown>) ?? {} }));
    }
    return new Response("not found", { status: 404 });
  },
});
console.error(`Bob dev host on http://localhost:${server.port}/?tool=bob_workspace`);
