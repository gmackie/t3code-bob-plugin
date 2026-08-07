import { describe, expect, it } from "bun:test";
import { reconcileBobLinearLink } from "./links.ts";

describe("Bob-owned Linear link reconciliation", () => {
  const input = { bobWorkItemId: "bob-1", linearIssueId: "lin-1", linearProjectId: "proj-1" };

  it("creates a link when Bob has no relationship yet", () => {
    expect(reconcileBobLinearLink(input, undefined, "2026-01-01T00:00:00.000Z")).toEqual({
      kind: "create",
      link: { ...input, updatedAt: "2026-01-01T00:00:00.000Z" },
    });
  });

  it("does not rewrite an unchanged relationship and identifies replacements", () => {
    const existing = { ...input, updatedAt: "2025-01-01T00:00:00.000Z" };
    expect(reconcileBobLinearLink(input, existing).kind).toBe("unchanged");
    expect(reconcileBobLinearLink({ ...input, linearIssueId: "lin-2" }, existing).kind).toBe("replace");
  });
});
