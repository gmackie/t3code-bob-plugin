import { describe, expect, it } from "bun:test";
import { BobStateStore, type SqliteExecutor } from "./state.ts";

describe("Bob-owned link state", () => {
  it("persists, lists, and removes Linear relationships through SQLite", async () => {
    const rows: Array<Record<string, string | null>> = [];
    const db: SqliteExecutor = {
      async run(sql, params) {
        if (sql.startsWith("INSERT")) {
          rows.push({
            bobWorkItemId: String(params[0]),
            linearIssueId: String(params[1]),
            linearProjectId: params[2] === null ? null : String(params[2]),
            updatedAt: String(params[3]),
          });
        }
        if (sql.startsWith("DELETE")) {
          const index = rows.findIndex((row) => row.bobWorkItemId === String(params[0]));
          if (index >= 0) rows.splice(index, 1);
        }
      },
      async get(_sql, params) {
        return rows.find((row) => row.bobWorkItemId === String(params[0])) as never;
      },
      async all() {
        return rows as never;
      },
    };
    const store = new BobStateStore(db);
    await store.initialize();
    await store.saveLinearLink({ bobWorkItemId: "bob-1", linearIssueId: "lin-1", updatedAt: "now" });
    expect(await store.getLinearLink("bob-1")).toMatchObject({ linearIssueId: "lin-1" });
    expect(await store.listLinearLinks()).toHaveLength(1);
    await store.removeLinearLink("bob-1");
    expect(await store.getLinearLink("bob-1")).toBeUndefined();
  });
});
