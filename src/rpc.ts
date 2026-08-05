import { createBobWorkSource, type BobPlanningClient } from "./planning.ts";

type Request = { method: string; payload: Record<string, unknown> };
type Response = { ok: true; result: unknown } | { ok: false; error: string };

export function createBobRpcHandler(client: BobPlanningClient, workspaceId: string) {
  const source = createBobWorkSource(client, workspaceId);
  return async (request: Request): Promise<Response> => {
    try {
      switch (request.method) {
        case "workItems.list":
          return { ok: true, result: await source.list({ projectId: stringValue(request.payload.projectId) }) };
        case "workItems.get":
          return { ok: true, result: await source.get(requiredString(request.payload.workItemId, "workItemId")) };
        case "runs.list":
          return { ok: true, result: await source.runs(stringValue(request.payload.workItemId)) };
        case "workItems.dispatch":
          return {
            ok: true,
            result: await source.dispatch({
              workItemId: requiredString(request.payload.workItemId, "workItemId"),
              agentType: requiredString(request.payload.agentType, "agentType"),
              executionTargetId: requiredString(request.payload.executionTargetId, "executionTargetId"),
            }),
          };
        default:
          return { ok: false, error: `unsupported Bob RPC method: ${request.method}` };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Bob plugin request failed" };
    }
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(value: unknown, name: string): string {
  const result = stringValue(value);
  if (!result) throw new Error(`${name} is required`);
  return result;
}
