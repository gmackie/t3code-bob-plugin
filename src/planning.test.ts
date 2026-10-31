import { describe, expect, it } from "bun:test";
import { buildPlanningWorkflow, createBobWorkSource, normalizeBobWorkItem } from "./planning.ts";

describe("Bob plugin planning adapter", () => {
  it("normalizes Bob work items into provider-neutral records", () => {
    expect(normalizeBobWorkItem({ id: "w1", title: "Ship", status: "in progress", projectId: "p1" })).toEqual({
      providerId: "bob", id: "w1", title: "Ship", status: { id: "in progress", label: "in progress", category: "active" }, scope: { projectId: "p1" },
    });
  });

  it("keeps dispatch and run ownership inside Bob", async () => {
    const source = createBobWorkSource({
      listWorkItems: async () => [], getWorkItem: async () => ({ id: "w1", title: "Ship", status: "queued" }), listRuns: async () => [],
      dispatchWorkItem: async () => ({ id: "r1", workItemId: "w1", status: "running" }),
    }, "workspace-1");
    await expect(source.dispatch({ workItemId: "w1", agentType: "codex" })).resolves.toMatchObject({ providerId: "bob", id: "r1" });
  });

  it("builds a planning review workflow around a Bob work item", () => {
    const workflow = buildPlanningWorkflow(
      { providerId: "bob", id: "w1", title: "Ship", status: { id: "queued", label: "queued", category: "backlog" }, scope: {} },
      [],
    );
    expect(workflow.currentStage).toBe("review");
    expect(workflow.steps.find((step) => step.stage === "approve")?.state).toBe("pending");
    expect(workflow.actions?.[0]?.id).toBe("approve");
  });

  it("moves planning to verification after Bob dispatch", () => {
    const workflow = buildPlanningWorkflow(
      { providerId: "bob", id: "w1", title: "Ship", status: { id: "queued", label: "queued", category: "backlog" }, scope: {} },
      [{ providerId: "bob", id: "r1", status: "running", workItemId: "w1" }],
      { approved: true, dispatchRequested: true },
    );
    expect(workflow.currentStage).toBe("verify");
    expect(workflow.steps.find((step) => step.stage === "execute")?.state).toBe("completed");
  });
});
