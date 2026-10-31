# T3 Code Bob plugin

Bob is a standalone T3 Code plugin. It owns Bob credentials, planning normalization, dispatch approval state, Bob-to-Linear links, and its own persistence.

The plugin is an MCP server (`src/mcp.ts`, stdio) described by a v2 manifest (`t3-plugin.json`) that follows the T3CODE-74 design approved on 2026-10-31. The managed-app runtime and plugin RPC were removed in T3CODE-78; T3 builds that only load v1 manifests cannot load this version.

## MCP server

It's a stdio server on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). Views are MCP Apps: `ui://` HTML resources with the `text/html;profile=mcp-app` MIME type.

- `bob_workspace` lists work items and recent runs and renders `ui://bob/workspace.html`. The view refreshes every `BOB_POLL_SECONDS`, and it can open a work item's planning review inline.
- `bob_planning_review` shows a work item's stages, run evidence and next action, and renders `ui://bob/planning-review.html`.
- `bob_planning_approve` records human approval. Only the view can call it (`_meta.ui.visibility: ["app"]`).
- `bob_planning_dispatch` dispatches through Bob once that work item is approved.
- `bob_work_item_get`, `bob_runs_list` and `bob_linear_links` are agent tools with no UI.

The plugin calls Bob's REST API (`/api/v1`, Bearer API key) directly. Bob's own `mcp-server` package is still a stub.

### Configuration

| Env var | Old setting | Notes |
|---|---|---|
| `BOB_API_URL` | `bob.api-endpoint` | required |
| `BOB_API_TOKEN` | `bob.api-token` | secret |
| `BOB_WORKSPACE_ID` | (new) | default workspace for tools |
| `LINEAR_API_URL` | `bob.linear-endpoint` | default `https://api.linear.app/graphql` |
| `LINEAR_API_TOKEN` | `bob.linear-token` | secret |
| `LINEAR_WORKSPACE` | `bob.linear-workspace` | |
| `BOB_POLL_SECONDS` | `bob.polling-seconds` | 15–3600, default 60 |
| `BOB_PLUGIN_STATE_PATH` | (new) | SQLite state, default `$XDG_STATE_HOME/t3code-bob-plugin/state.sqlite`. Every plugin process shares it; the server keeps no state in memory. |

### Run it

```sh
bun install
bun test                       # unit, MCP client, AppBridge interop and DOM view tests
bun run dev:fake-bob           # in-memory Bob API on :4319
BOB_API_URL=http://localhost:4319 BOB_WORKSPACE_ID=00000000-0000-4000-8000-000000000001 \
  bun run dev:host             # T3-style MCP Apps host on http://localhost:4320/?tool=bob_workspace
bun run inspect                # or the official MCP Inspector (Apps tab)
```

Until T3 installs v2 plugins (T3CODE-74), you can add it by hand in Settings → Tools (T3CODE-73): a stdio server named `bob`, command `bun`, args `/path/to/repo/src/mcp.ts`, and the env vars above, with the tokens marked sensitive. Today T3 renders MCP Apps inline only in Codex threads.

The `bob.workspace` panel is project-scoped. `bob.runs` is thread-scoped: it uses `threadId` from host context and follows `host-context-changed`.

See `docs/manifest-v2.md` for the manifest mapping, the server rules from the design, and the open questions.
