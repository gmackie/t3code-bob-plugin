import type { BobLinearLink, BobLinearLinkInput } from "./types.ts";

export type BobWorkflowState = { approved: boolean; dispatchRequested: boolean };

export type SqliteExecutor = {
  run(sql: string, params: readonly unknown[]): Promise<void>;
  get<T>(sql: string, params: readonly unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]>;
};

export class BobStateStore {
  constructor(private readonly db: SqliteExecutor) {}

  async initialize(): Promise<void> {
    await this.db.run(
      "CREATE TABLE IF NOT EXISTS bob_linear_links (bob_work_item_id TEXT PRIMARY KEY, linear_issue_id TEXT NOT NULL, linear_project_id TEXT, updated_at TEXT NOT NULL)",
      [],
    );
    await this.db.run(
      "CREATE TABLE IF NOT EXISTS bob_workflow_state (workflow_id TEXT PRIMARY KEY, approved INTEGER NOT NULL, dispatch_requested INTEGER NOT NULL, updated_at TEXT NOT NULL)",
      [],
    );
  }

  async saveLinearLink(link: BobLinearLinkInput & { updatedAt?: string }): Promise<BobLinearLink> {
    const saved: BobLinearLink = { ...link, updatedAt: link.updatedAt ?? new Date().toISOString() };
    await this.db.run(
      "INSERT INTO bob_linear_links (bob_work_item_id, linear_issue_id, linear_project_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(bob_work_item_id) DO UPDATE SET linear_issue_id=excluded.linear_issue_id, linear_project_id=excluded.linear_project_id, updated_at=excluded.updated_at",
      [saved.bobWorkItemId, saved.linearIssueId, saved.linearProjectId ?? null, saved.updatedAt],
    );
    return saved;
  }

  getLinearLink(bobWorkItemId: string): Promise<BobLinearLink | undefined> {
    return this.db.get<BobLinearLink>(
      "SELECT bob_work_item_id AS bobWorkItemId, linear_issue_id AS linearIssueId, linear_project_id AS linearProjectId, updated_at AS updatedAt FROM bob_linear_links WHERE bob_work_item_id = ?",
      [bobWorkItemId],
    );
  }

  listLinearLinks(): Promise<readonly BobLinearLink[]> {
    return this.db.all<BobLinearLink>(
      "SELECT bob_work_item_id AS bobWorkItemId, linear_issue_id AS linearIssueId, linear_project_id AS linearProjectId, updated_at AS updatedAt FROM bob_linear_links ORDER BY updated_at DESC",
      [],
    );
  }

  async removeLinearLink(bobWorkItemId: string): Promise<void> {
    await this.db.run("DELETE FROM bob_linear_links WHERE bob_work_item_id = ?", [bobWorkItemId]);
  }

  async saveWorkflowState(workflowId: string, state: BobWorkflowState): Promise<void> {
    await this.db.run(
      "INSERT INTO bob_workflow_state (workflow_id, approved, dispatch_requested, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workflow_id) DO UPDATE SET approved=excluded.approved, dispatch_requested=excluded.dispatch_requested, updated_at=excluded.updated_at",
      [workflowId, state.approved ? 1 : 0, state.dispatchRequested ? 1 : 0, new Date().toISOString()],
    );
  }

  async getWorkflowState(workflowId: string): Promise<BobWorkflowState> {
    const row = await this.db.get<{ approved: number; dispatchRequested: number }>(
      "SELECT approved, dispatch_requested AS dispatchRequested FROM bob_workflow_state WHERE workflow_id = ?",
      [workflowId],
    );
    return { approved: row?.approved === 1, dispatchRequested: row?.dispatchRequested === 1 };
  }
}

// Opens the state file for concurrent use by several plugin processes.
export function openStateDatabase<T extends { exec(sql: string): unknown }>(db: T): T {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

// Adapter for bun:sqlite, which the stdio MCP server uses for its own state file.
export function bunSqliteExecutor(db: {
  query(sql: string): { run(...params: never[]): unknown; get(...params: never[]): unknown; all(...params: never[]): unknown[] };
}): SqliteExecutor {
  return {
    async run(sql, params) {
      db.query(sql).run(...(params as never[]));
    },
    async get<T>(sql: string, params: readonly unknown[]) {
      return (db.query(sql).get(...(params as never[])) ?? undefined) as T | undefined;
    },
    async all<T>(sql: string, params: readonly unknown[]) {
      return db.query(sql).all(...(params as never[])) as T[];
    },
  };
}
