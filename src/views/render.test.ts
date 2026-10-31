import { describe, expect, it } from "bun:test";
import { buildPlanningWorkflow } from "../planning.ts";
import type { WorkItem } from "../types.ts";
import { renderPlanning, renderWorkspace } from "./render.ts";

const item: WorkItem = { providerId: "bob", id: "w1", title: "Fix <script>alert(1)</script>", status: { id: "todo", label: "todo", category: "backlog" }, scope: {} };

describe("view renderers", () => {
  it("escapes Bob content and filters work items", () => {
    const html = renderWorkspace({ workspaceId: "ws", workItems: [item, { ...item, id: "w2", title: "Other" }], runs: [], pollSeconds: 60, refreshedAt: "2026-10-31T00:00:00Z" }, "fix");
    expect(html).toContain("Fix &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('data-work-item-id="w1"');
    expect(html).not.toContain('data-work-item-id="w2"');
    expect(html).toContain("No runs yet.");
  });

  it("offers approve, then dispatch, then nothing", () => {
    const approve = renderPlanning({ workItem: item, runs: [], workflow: buildPlanningWorkflow(item, []) });
    expect(approve).toContain('data-action="approve"');
    const execute = renderPlanning({ workItem: item, runs: [], workflow: buildPlanningWorkflow(item, [], { approved: true }) }, { busy: true, error: "Bob API down" });
    expect(execute).toContain('data-action="execute" disabled');
    expect(execute).toContain('role="alert">Bob API down');
    const verify = renderPlanning({ workItem: item, runs: [], workflow: buildPlanningWorkflow(item, [{ providerId: "bob", id: "s1", status: "failed" }], { approved: true, dispatchRequested: true }) });
    expect(verify).not.toContain('class="actions"');
    expect(verify).toContain("step-failed");
  });
});
