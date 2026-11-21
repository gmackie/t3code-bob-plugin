# T3 Code Bob plugin

Bob planning, runs and SDLC for T3 Code.

## Plugin (manifest v2)

The plugin is the manifest `t3-plugin.json` plus Bob's **hosted** MCP server, `https://bob.blder.bot/mcp`. It has no local process.

- **Auth:** OAuth (`bob:read`, `bob:write`). T3 does discovery, registration, PKCE and refresh. During consent you choose one Bob workspace; every tool is limited to it. No token is stored in the manifest.
- **Tools:** projects and work items (`bob_list_projects`, `bob_get_work_item`, `bob_update_work_item`, `bob_add_comment`, ...), runs (`bob_runs_list`), the planning review (`bob_workspace`, `bob_planning_review`, `bob_planning_dispatch`) and `bob_sdlc`.
- **Panels:**
  - `bob-workspace` (project) and `bob-runs` (thread) render `ui://bob/workspace.html`: work items, recent runs and an inline planning review.
  - `bob-sdlc` (thread) and `bob-sdlc-fleet` (project) render `ui://bob/sdlc.html`: the SDLC item running the thread, or the fleet. The view opens Bob's SDLC edge socket itself, with a single-use ticket; your Bob user must be an SDLC viewer.
- **Dispatch:** a person approves a work item in the planning review before `bob_planning_dispatch` runs it, once per approval. Dispatch also needs API execution dispatch enabled on the Bob server.

Install from Settings → Plugins → MCP plugins with this repository's directory. Upgrading from 0.2.x replaces the local stdio server and drops its stored Bob and Linear tokens. Approvals recorded by 0.2.x lived in a local file and do not carry over.

## Tests

```sh
bun install
bun test                              # manifest
BOB_MCP_TOKEN=<access token> bun test # + live check of every panel's view
```
