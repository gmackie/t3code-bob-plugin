import type { BobLinearLink } from "./types.ts";

export type SqliteExecutor = {
  run(sql: string, params: readonly unknown[]): Promise<void>;
  get<T>(sql: string, params: readonly unknown[]): Promise<T | undefined>;
};

export class BobStateStore {
  constructor(private readonly db: SqliteExecutor) {}

  async initialize(): Promise<void> {
    await this.db.run(
      "CREATE TABLE IF NOT EXISTS bob_linear_links (bob_work_item_id TEXT PRIMARY KEY, linear_issue_id TEXT NOT NULL, linear_project_id TEXT, updated_at TEXT NOT NULL)",
      [],
    );
  }

  async saveLinearLink(link: BobLinearLink): Promise<void> {
    await this.db.run(
      "INSERT INTO bob_linear_links (bob_work_item_id, linear_issue_id, linear_project_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(bob_work_item_id) DO UPDATE SET linear_issue_id=excluded.linear_issue_id, linear_project_id=excluded.linear_project_id, updated_at=excluded.updated_at",
      [link.bobWorkItemId, link.linearIssueId, link.linearProjectId ?? null, link.updatedAt],
    );
  }

  getLinearLink(bobWorkItemId: string): Promise<BobLinearLink | undefined> {
    return this.db.get<BobLinearLink>(
      "SELECT bob_work_item_id AS bobWorkItemId, linear_issue_id AS linearIssueId, linear_project_id AS linearProjectId, updated_at AS updatedAt FROM bob_linear_links WHERE bob_work_item_id = ?",
      [bobWorkItemId],
    );
  }
}
