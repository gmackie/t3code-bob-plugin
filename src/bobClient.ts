import type { BobPlanningClient } from "./planning.ts";
import type { BobRun, BobWorkItem } from "./types.ts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class BobApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Bob's public REST API (apps/bob, /api/v1). Bob's own MCP server package is
// still a stub, so the plugin talks to the API that Bob's CLI and SDK use.
export function createBobHttpClient(options: { baseUrl: string; token?: string; fetch?: Fetch }): BobPlanningClient {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const base = `${options.baseUrl.replace(/\/+$/, "")}/api/v1`;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const message = json && typeof json === "object" && "error" in json ? String(json.error) : response.statusText;
      throw new BobApiError(response.status, `Bob API ${method} ${path} failed (${response.status}): ${message}`);
    }
    return json as T;
  }

  return {
    listWorkItems: ({ workspaceId, projectId }) =>
      call<BobWorkItem[]>("POST", "/work-items/list", { workspaceId, ...(projectId ? { projectId } : {}), limit: 100 }),
    async getWorkItem({ workItemId }) {
      const result = await call<{ workItem: BobWorkItem } | null>("POST", "/work-items/get", { id: workItemId });
      if (!result) throw new BobApiError(404, `Bob work item ${workItemId} not found`);
      return result.workItem;
    },
    async listRuns({ workspaceId, workItemId }) {
      const runs = workItemId
        ? await call<BobRun[]>("GET", `/work-items/${encodeURIComponent(workItemId)}/runs?limit=20`)
        : await call<BobRun[]>("GET", `/runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=50`);
      return [...runs].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    },
    async dispatchWorkItem({ workItemId, agentType }) {
      const session = await call<{ sessionId: string; identifier?: string; status: string }>(
        "POST",
        `/work-items/${encodeURIComponent(workItemId)}/dispatch`,
        agentType ? { agentType } : {},
      );
      return { id: session.sessionId, sessionId: session.sessionId, workItemId, status: session.status };
    },
  };
}
