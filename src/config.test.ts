import { describe, expect, it } from "bun:test";
import { loadConfig } from "./config.ts";

describe("env config", () => {
  it("maps the former plugin settings onto env vars", () => {
    expect(
      loadConfig({
        BOB_API_URL: "https://bob.example/",
        BOB_API_TOKEN: "bob_x",
        BOB_WORKSPACE_ID: "ws",
        LINEAR_API_URL: "https://tasks.gmac.io/graphql",
        LINEAR_API_TOKEN: "lin",
        LINEAR_WORKSPACE: "gmacko",
        BOB_POLL_SECONDS: "120",
        BOB_PLUGIN_STATE_PATH: "/tmp/bob.sqlite",
      }),
    ).toEqual({
      bobApiUrl: "https://bob.example",
      bobApiToken: "bob_x",
      bobWorkspaceId: "ws",
      linearApiUrl: "https://tasks.gmac.io/graphql",
      linearApiToken: "lin",
      linearWorkspace: "gmacko",
      pollSeconds: 120,
      statePath: "/tmp/bob.sqlite",
    });
  });

  it("applies the old setting defaults and bounds", () => {
    const config = loadConfig({ BOB_API_URL: "https://bob.example", BOB_POLL_SECONDS: "5", XDG_STATE_HOME: "/state" });
    expect(config).toMatchObject({ linearApiUrl: "https://api.linear.app/graphql", pollSeconds: 15, statePath: "/state/t3code-bob-plugin/state.sqlite" });
    expect(loadConfig({ BOB_API_URL: "x", BOB_POLL_SECONDS: "99999" }).pollSeconds).toBe(3600);
    expect(loadConfig({ BOB_API_URL: "x", BOB_POLL_SECONDS: "abc" }).pollSeconds).toBe(60);
  });

  it("requires the Bob endpoint", () => {
    expect(() => loadConfig({})).toThrow("BOB_API_URL");
  });
});
