export type WorkItem = {
  providerId: string;
  id: string;
  title: string;
  description?: string;
  url?: string;
  status: { id: string; label: string; category: "backlog" | "active" | "blocked" | "done" | "cancelled" };
  scope: { projectId?: string; threadId?: string; query?: string };
  updatedAt?: string;
};

export type WorkItemDetail = { item: WorkItem; body?: string };

export type RunSummary = {
  providerId: string;
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  workItemId?: string;
  threadId?: string;
};

export type BobWorkItem = {
  id: string;
  identifier?: string | null;
  title: string;
  description?: string | null;
  status: string;
  projectId?: string | null;
  url?: string | null;
  updatedAt?: string | null;
};

export type BobRun = { id: string; workItemId?: string | null; status: string; threadId?: string | null };

export type BobLinearLink = {
  bobWorkItemId: string;
  linearIssueId: string;
  linearProjectId?: string;
  updatedAt: string;
};
