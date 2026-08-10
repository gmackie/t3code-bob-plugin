import { buildPlanningWorkflow, createBobWorkSource, type BobPlanningClient } from "./planning.ts";
import { BobStateStore } from "./state.ts";
import { reconcileBobLinearLink } from "./links.ts";

type Request = { method: string; payload: Record<string, unknown> };
type Response = { ok: true; result: unknown } | { ok: false; error: string };

export function createBobRpcHandler(client: BobPlanningClient, workspaceId: string, state?: BobStateStore, workflowState: { approved: boolean; dispatchRequested?: boolean } = { approved: false }, saveWorkflowState: () => Promise<void> = async () => undefined) {
  const source = createBobWorkSource(client, workspaceId);
  return async (request: Request): Promise<Response> => {
    try {
      switch (request.method) {
        case "workflow.get": {
          const workItemId = requiredString(request.payload.workItemId, "workItemId");
          const [item, runs] = await Promise.all([source.get(workItemId), source.runs(workItemId)]);
          return { ok: true, result: buildPlanningWorkflow(item.item, runs, workflowState) };
        }
        case "action.execute": {
          if (request.payload.actionId === "approve") {
            workflowState.approved = true;
            await saveWorkflowState();
            return { ok: true, result: { status: "accepted", message: "Bob dispatch approved." } };
          }
          if (request.payload.actionId === "execute") {
            if (!workflowState.approved) throw new Error("Bob dispatch must be approved before execution");
            const run = await source.dispatch({
              workItemId: requiredString(request.payload.workItemId, "workItemId"),
              agentType: requiredString(request.payload.agentType, "agentType"),
              executionTargetId: requiredString(request.payload.executionTargetId, "executionTargetId"),
            });
            workflowState.dispatchRequested = true;
            await saveWorkflowState();
            return { ok: true, result: { status: "accepted", message: `Bob run ${run.id} dispatched.` } };
          }
          return { ok: false, error: `unsupported Bob action: ${String(request.payload.actionId)}` };
        }
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
        case "links.linear.get":
          if (!state) throw new Error("Bob state store is not configured");
          return { ok: true, result: await state.getLinearLink(requiredString(request.payload.bobWorkItemId, "bobWorkItemId")) };
        case "links.linear.list":
          if (!state) throw new Error("Bob state store is not configured");
          return { ok: true, result: await state.listLinearLinks() };
        case "links.linear.upsert": {
          if (!state) throw new Error("Bob state store is not configured");
          const input = {
            bobWorkItemId: requiredString(request.payload.bobWorkItemId, "bobWorkItemId"),
            linearIssueId: requiredString(request.payload.linearIssueId, "linearIssueId"),
            ...(stringValue(request.payload.linearProjectId) ? { linearProjectId: stringValue(request.payload.linearProjectId) } : {}),
          };
          const previous = await state.getLinearLink(input.bobWorkItemId);
          const reconciliation = reconcileBobLinearLink(input, previous);
          if (reconciliation.kind !== "unchanged") await state.saveLinearLink(reconciliation.link);
          return { ok: true, result: reconciliation };
        }
        case "links.linear.remove":
          if (!state) throw new Error("Bob state store is not configured");
          await state.removeLinearLink(requiredString(request.payload.bobWorkItemId, "bobWorkItemId"));
          return { ok: true, result: { removed: true } };
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
