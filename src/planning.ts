import type { BobRun, BobWorkItem, RunSummary, WorkItem, WorkItemDetail } from "./types.ts";

export type BobPlanningClient = {
  listWorkItems(input: { workspaceId: string; projectId?: string }): Promise<readonly BobWorkItem[]>;
  getWorkItem(input: { workItemId: string }): Promise<BobWorkItem>;
  listRuns(input: { workspaceId: string; workItemId?: string }): Promise<readonly BobRun[]>;
  dispatchWorkItem(input: { workItemId: string; agentType: string; executionTargetId: string }): Promise<BobRun>;
};

const statusCategory = (status: string): WorkItem["status"]["category"] => {
  const value = status.toLowerCase();
  if (value.includes("done") || value.includes("complete")) return "done";
  if (value.includes("block")) return "blocked";
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("progress") || value.includes("active") || value.includes("run")) return "active";
  return "backlog";
};

export function normalizeBobWorkItem(item: BobWorkItem): WorkItem {
  return {
    providerId: "bob",
    id: item.id,
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    ...(item.url ? { url: item.url } : {}),
    status: { id: item.status, label: item.status, category: statusCategory(item.status) },
    scope: item.projectId ? { projectId: item.projectId } : {},
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  };
}

export function normalizeBobRun(run: BobRun): RunSummary {
  const status = statusCategory(run.status);
  return {
    providerId: "bob",
    id: run.id,
    status: status === "done" ? "succeeded" : status === "cancelled" ? "cancelled" : status === "active" ? "running" : "queued",
    ...(run.workItemId ? { workItemId: run.workItemId } : {}),
    ...(run.threadId ? { threadId: run.threadId } : {}),
  };
}

export function createBobWorkSource(client: BobPlanningClient, workspaceId: string) {
  return {
    async list(scope: { projectId?: string; query?: string }): Promise<readonly WorkItem[]> {
      const items = await client.listWorkItems({ workspaceId, ...(scope.projectId ? { projectId: scope.projectId } : {}) });
      return items
        .filter((item) => !scope.query || item.title.toLowerCase().includes(scope.query.toLowerCase()))
        .map(normalizeBobWorkItem);
    },
    async get(itemId: string): Promise<WorkItemDetail> {
      return { item: normalizeBobWorkItem(await client.getWorkItem({ workItemId: itemId })) };
    },
    async runs(workItemId?: string): Promise<readonly RunSummary[]> {
      return (await client.listRuns({ workspaceId, ...(workItemId ? { workItemId } : {}) })).map(normalizeBobRun);
    },
    async dispatch(input: { workItemId: string; agentType: string; executionTargetId: string }): Promise<RunSummary> {
      return normalizeBobRun(await client.dispatchWorkItem(input));
    },
  };
}
