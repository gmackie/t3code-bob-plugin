# Draft manifest v2 for Bob (input to T3CODE-74)

`t3-plugin.json` (schemaVersion 2) is a draft. T3CODE-74 owns the manifest v2 format, and nothing in T3 parses this file yet. This note maps every v1 field (the managed-app manifest removed in T3CODE-78, last at commit 405bb5f) onto it and lists the fields the Bob port needed.

## v1 → v2 mapping

| v1 (removed) | v2 draft | Notes |
|---|---|---|
| `runtime: { kind: "managed-app", command }` | `mcpServer.transport` (stdio) | Same shape as the T3CODE-73 `McpStdioTransport` (`command`, `args`, `env: McpServerVariable[]`). |
| `contributes.panels[bob.workspace]` (project) | `contributes.panels[]` with `resourceUri` + `tool` | Renders `ui://bob/workspace.html`. If the host calls no tool, the view fetches its own data. |
| `contributes.panels[bob.runs]` (thread.sidePanel) | Same view, `surface: thread.sidePanel` | Runs and work items share one view. |
| `contributes.workflows[bob.planning-review]` (thread.main) | No manifest entry. Tool `bob_planning_review` declares `_meta.ui.resourceUri: ui://bob/planning-review.html` | In a thread, MCP Apps render inline from the tool call, so the manifest has nothing to declare. |
| `settings[*]` + `settingsPanels` | `mcpServer.transport.env[]` | Tokens are `sensitive: true` and live in the Tools secret store. Today v1 plugin secrets are dropped by `PluginSettingsStore`. |
| `capabilities.secrets.read` | Gone | Secrets arrive as env. |
| `capabilities.network.connect` | Gone | The server process makes the network calls. The view needs no `connectDomains`, because everything goes through `tools/call`. |
| `capabilities.ui.embed` | Implied by `contributes.panels` | |
| `capabilities.threads.read` / `threads.dispatch` | `t3Tools.allow` | Empty for now: Bob dispatches to Bob, not to T3 threads. Add `t3_thread_read` / `t3_thread_launch` when Bob reports runs back into threads. |
| `hooks` (project.opened, thread.created, thread.completed) | Not ported | MCP has no host-to-server event channel. See open questions. |

## Fields Bob needed

- `mcpServer.name` matches T3CODE-73 server names (`^[a-z][a-z0-9_-]*$`): `bob`.
- `mcpServer.transport.env[]` entries carry UI metadata beyond `McpServerVariable`: `title`, `placeholder`, `required`, default `value`, `field` (number bounds), and `hidden`.
- Substitution variables:
  - `${pluginDir}` is the installed plugin checkout.
  - `${pluginDataDir}` is a per-plugin writable directory. Bob keeps approval state and Linear links in SQLite there. Outside T3 it defaults to `$XDG_STATE_HOME/t3code-bob-plugin/`, never T3's userdata.
  - `${projectId}` sets panel tool arguments.
- `contributes.panels[].tool` is the tool the host calls to seed a thread-less panel, delivered as `ui/notifications/tool-result`. It is optional: the workspace view can load itself.
- `t3Tools.allow` is the allowlist for T3's `/mcp` endpoint, which replaces capability grants.

## Tool surface

| Tool | Visibility | View |
|---|---|---|
| `bob_workspace` | model + app | `ui://bob/workspace.html` |
| `bob_planning_review` | model + app | `ui://bob/planning-review.html` |
| `bob_planning_approve` | **app only** | none |
| `bob_planning_dispatch` | model + app | `ui://bob/planning-review.html`; returns the refreshed review |
| `bob_work_item_get`, `bob_runs_list`, `bob_linear_links` | model + app | none |

`bob_planning_approve` is app-only, so an agent can't approve its own dispatch. T3 already enforces `_meta.ui.visibility` in `McpAppRequests`. `bob_planning_dispatch` refuses to run until approval is recorded for that work item.
