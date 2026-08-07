import type { BobLinearLink, BobLinearLinkInput } from "./types.ts";

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
}
