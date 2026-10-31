# Bob manifest v2 (T3CODE-74 pilot)

`t3-plugin.json` follows the plugin design approved on T3CODE-74 on 2026-10-31. T3 doesn't parse v2 yet; that lands in P3–P6 of T3CODE-74.

## Shape

- `mcpServer` reuses `McpServerConfig` and `McpServerVariable` from Settings → Tools (`packages/contracts/src/agentTools.ts`):
  - `name`: `bob`.
  - `transport`: stdio, `bun src/mcp.ts`, with `env` as `McpServerVariable[]`.
  - `variables[]`: the titled values the user fills in. Both tokens are `sensitive`.
- `contributes.panels[]`, both rendering `ui://bob/workspace.html`:
  - `bob.workspace` (`scope: project`) is Bob planning: work items, runs, and an inline planning review.
  - `bob.runs` (`scope: thread`) uses the same view. With `threadId` in host context, it lists only that thread's Bob runs and refreshes on `host-context-changed`.
- `contributes.commands[]` open those panels.
- `t3Tools` is `[]`, because Bob never calls back into T3 (see below).

There is no `runtime`, `workflows`, `hooks`, `settings`, or capability request. The planning review needs no manifest entry: `bob_planning_review` declares `_meta.ui.resourceUri: ui://bob/planning-review.html` and renders inline wherever the host shows tool calls as MCP Apps.

## v1 → v2 mapping

The v1 manifest was removed in T3CODE-78; its last version is at commit 405bb5f.

| v1 | v2 |
|---|---|
| `runtime` (managed-app) | `mcpServer.transport` (stdio) |
| `panels[bob.workspace]` (project surface) | `panels[bob.workspace]`, `scope: project` |
| `panels[bob.runs]` (thread.sidePanel) | `panels[bob.runs]`, `scope: thread` |
| `workflows[bob.planning-review]` | Tool `bob_planning_review` with its own `ui://` view |
| `settings[*]`, `settingsPanels` | `mcpServer.transport.env` and `mcpServer.variables` |
| `capabilities.secrets.read` | `sensitive` variables |
| `capabilities.network.connect` | Dropped: the server process makes the network calls, and views go through `tools/call` |
| `capabilities.ui.embed` | Implied by `panels` |
| `capabilities.threads.read`, `threads.dispatch` | `t3Tools: []`. If Bob ever needs T3, the upper limit is `t3_thread_read` (threads.read) and `bob_coordination` (threads.dispatch). |
| `hooks` | Dropped (D4) |

## Server rules from the design

- **Visibility.** Every tool a view calls declares `_meta.ui.visibility` including `"app"`:
  - `bob_workspace`, `bob_planning_review` and `bob_planning_dispatch` are `["model", "app"]`.
  - `bob_planning_approve` is `["app"]`, so only a human in a view can approve a dispatch.
  - The agent-only tools are `bob_work_item_get`, `bob_runs_list` and `bob_linear_links`.
- **No T3 token needed.** Only the pool-owned copy gets `T3_MCP_URL` and `T3_MCP_TOKEN` (D3). Bob doesn't call T3, so its tools behave the same in every copy.
- **Stateless processes.** T3 runs one stdio copy per agent session plus one in its pool. A panel's approval (pool copy) and an agent's dispatch (session copy) can land in different processes. So the server keeps no state in memory:
  - Approvals and Linear links live in one SQLite file (WAL, `busy_timeout`) at `BOB_PLUGIN_STATE_PATH`, default `$XDG_STATE_HOME/t3code-bob-plugin/state.sqlite`.
  - Every copy opens that same file.
  - `server.test.ts` covers approving in one copy and dispatching from another.

## Open questions

1. **Shared state file.** Bob depends on every copy seeing the same `HOME`/`XDG_STATE_HOME`. Does the pool spawn plugins with the same environment as session copies? If not, Bob should move to `http` transport, or keep approval state in Bob itself.
2. **Panel seeding.** Does `mcpApps.openPanel` deliver any tool result? The workspace view fetches its own data when none arrives within 250 ms, so either answer works.
3. **Thread panels in Codex threads.** `bob.runs` matches runs by Bob's `threadId`. Is that the same id T3 puts in host context once Bob launches T3 threads?
4. **Variable metadata.** `McpServerVariable` has no placeholder, required flag, or number bounds. The server clamps `BOB_POLL_SECONDS` to 15–3600 and fails with a clear error when `BOB_API_URL` is missing.
5. **Unused Linear settings.** Nothing reads the Linear endpoint, token, or workspace yet. They are kept for parity with v1.
