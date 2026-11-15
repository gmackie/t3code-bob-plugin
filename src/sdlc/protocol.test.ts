// Pins the vendored reducer to Bob's behavior (packages/bob/src/sdlc-view/src/model.ts).
// If Bob changes reduce(), these cases should change with it.
import { describe, expect, it } from "bun:test";

import { demoItems, demoPlan, demoSnapshot } from "./fixtures.ts";
import { asEdgeMessage, emptyView, helloFor, isOffline, reconnectDelay, reduce, type ItemSnapshot, type PlanSnapshot } from "./protocol.ts";

const item = (itemId: string, resourceVersion: number, patch: Partial<ItemSnapshot> = {}): ItemSnapshot => ({
  ...demoItems.find((i) => i.itemId === itemId)!,
  resourceVersion,
  ...patch,
});
const plan = (patch: Partial<PlanSnapshot>): PlanSnapshot => ({ ...demoPlan, ...patch });
const snapped = () => reduce(emptyView(), demoSnapshot(1_000));

describe("vendored SDLC reducer", () => {
  it("replaces everything on a snapshot and records epoch and seq", () => {
    const view = snapped();
    expect(view).toMatchObject({ epoch: "epoch-demo", seq: 12, needsResync: false, coordinatorSeenAt: 1_000 });
    expect(Object.keys(view.items).sort()).toEqual(["item-a", "item-b", "item-c", "item-d"]);
    const again = reduce(view, { type: "snapshot", epoch: "epoch-2", seq: 1, plans: [], items: [], topology: [], coordinatorSeenAt: null });
    expect(again).toMatchObject({ epoch: "epoch-2", seq: 1, items: {}, plans: {}, coordinatorSeenAt: 1_000 });
  });

  it("drops late deltas but still moves liveness forward", () => {
    const view = snapped();
    const late = reduce(view, { type: "delta", seq: 12, plans: [], items: [item("item-a", 99, { state: "failed" })], coordinatorSeenAt: 2_000 });
    expect(late.items["item-a"]?.state).toBe("running");
    expect(late.coordinatorSeenAt).toBe(2_000);
  });

  it("keeps the newest resourceVersion per resource", () => {
    const view = reduce(snapped(), { type: "delta", seq: 13, plans: [], items: [item("item-a", 6, { state: "failed" }), item("item-d", 2, { state: "ready" })], coordinatorSeenAt: null });
    expect(view.items["item-a"]?.state).toBe("running");
    expect(view.items["item-d"]?.state).toBe("ready");
    expect(view.seq).toBe(13);
  });

  it("flags a seq gap until the next snapshot", () => {
    const gapped = reduce(snapped(), { type: "delta", seq: 15, plans: [], items: [], coordinatorSeenAt: null });
    expect(gapped.needsResync).toBe(true);
    expect(helloFor(gapped)).toEqual({ type: "hello", cursor: null, epoch: null });
    expect(reduce(gapped, demoSnapshot(null)).needsResync).toBe(false);
  });

  it("evicts terminal plans with all their items", () => {
    const view = reduce(snapped(), { type: "delta", seq: 13, plans: [plan({ resourceVersion: 9, state: "completed" })], items: [item("item-a", 50)], coordinatorSeenAt: null });
    expect(view.plans).toEqual({});
    expect(view.items).toEqual({});
  });

  it("status only moves coordinatorSeenAt forward", () => {
    const view = reduce(snapped(), { type: "status", coordinatorSeenAt: 500 });
    expect(view.coordinatorSeenAt).toBe(1_000);
    expect(reduce(view, { type: "status", coordinatorSeenAt: null }).coordinatorSeenAt).toBe(1_000);
    expect(isOffline(view, 1_000 + 90_000)).toBe(false);
    expect(isOffline(view, 1_000 + 90_001)).toBe(true);
  });

  it("resumes with cursor and epoch, validates messages, and backs off 1s…30s", () => {
    expect(helloFor(emptyView())).toEqual({ type: "hello", cursor: null, epoch: null });
    expect(helloFor(snapped())).toEqual({ type: "hello", cursor: 12, epoch: "epoch-demo" });
    expect(asEdgeMessage({ type: "delta", seq: 1.5, plans: [], items: [] })).toBeNull();
    expect(asEdgeMessage({ type: "snapshot", seq: 1, plans: [], items: [], topology: [] })).toBeNull();
    expect(asEdgeMessage({ type: "tail" })).toBeNull();
    expect(reconnectDelay(0, () => 0.5)).toBe(1_000);
    expect(reconnectDelay(3, () => 0.5)).toBe(8_000);
    expect(reconnectDelay(20, () => 1)).toBe(36_000);
  });
});
