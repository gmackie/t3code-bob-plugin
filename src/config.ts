import { homedir } from "node:os";
import { join } from "node:path";

// The former plugin settings (bob.api-endpoint, bob.api-token, ...) map 1:1 onto
// these env vars. In the v2 manifest they are declared under mcpServer.env so
// T3's Tools registry can collect them and redact the secret ones.
export type BobConfig = {
  readonly bobApiUrl: string;
  readonly bobApiToken?: string;
  readonly bobWorkspaceId?: string;
  readonly linearApiUrl: string;
  readonly linearApiToken?: string;
  readonly linearWorkspace?: string;
  readonly pollSeconds: number;
  readonly statePath: string;
};

export const POLL_SECONDS = { default: 60, min: 15, max: 3600 } as const;

export function loadConfig(env: Record<string, string | undefined> = process.env): BobConfig {
  const bobApiUrl = env.BOB_API_URL?.trim();
  if (!bobApiUrl) throw new Error("BOB_API_URL is required (Bob API endpoint, e.g. https://bob.example)");
  return {
    bobApiUrl: bobApiUrl.replace(/\/+$/, ""),
    ...optional("bobApiToken", env.BOB_API_TOKEN),
    ...optional("bobWorkspaceId", env.BOB_WORKSPACE_ID),
    linearApiUrl: env.LINEAR_API_URL?.trim() || "https://api.linear.app/graphql",
    ...optional("linearApiToken", env.LINEAR_API_TOKEN),
    ...optional("linearWorkspace", env.LINEAR_WORKSPACE),
    pollSeconds: pollSeconds(env.BOB_POLL_SECONDS),
    statePath: env.BOB_PLUGIN_STATE_PATH?.trim() || defaultStatePath(env),
  };
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  const trimmed = value?.trim();
  return trimmed ? ({ [key]: trimmed } as Record<K, string>) : {};
}

function pollSeconds(raw: string | undefined): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return POLL_SECONDS.default;
  return Math.min(POLL_SECONDS.max, Math.max(POLL_SECONDS.min, Math.round(value)));
}

// T3 does not yet hand plugins a data directory (open question for T3CODE-74),
// so state defaults to the XDG state dir and never to T3's own userdata.
function defaultStatePath(env: Record<string, string | undefined>): string {
  const base = env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, "t3code-bob-plugin", "state.sqlite");
}
