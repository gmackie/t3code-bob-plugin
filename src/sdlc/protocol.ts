// Vendored from Bob (gmackie/bob). The plugin cannot depend on @bob/sdlc-view,
// so this is a minimal copy of what a read-only edge client needs:
//   packages/bob/src/sdlc-view/src/generated/contract.ts  ITEM_STATES, PLAN_STATES, MILESTONES
//   packages/bob/src/sdlc-view/src/model.ts               snapshot types, EdgeMessage, EdgeView, reduce, isOffline
//   packages/bob/src/sdlc-view/src/presentation.ts        STATE_PRESENTATION (label, attention, hint), MILESTONE_LABEL
//   packages/bob/src/sdlc-view/src/attempt.ts             PendingInput, WatchMessage, TailMessage, CiMessage
//   apps/bob-tui/src/client/edge-protocol.ts              helloFor, asEdgeMessage, reconnect backoff
// It MUST stay in sync with those files (vendored at BOB-80-sdlc-attempt,
// T3CODE-113). src/sdlc/protocol.test.ts pins the reducer's behavior; when Bob
// changes the protocol, update this file and that test together.

export const ITEM_STATES = [
  "pending",
  "ready",
  "reserved",
  "running",
  "waiting-input",
  "execution-unknown",
  "validating",
  "review",
  "deploying",
  "failed",
  "cancelling",
  "cancelled",
  "completed",
] as const;
export const PLAN_STATES = ["draft", "active", "paused", "cancelling", "cancelled", "completed"] as const;
export const MILESTONES = ["execution-succeeded", "review-ready", "merged", "production-verified"] as const;
export type ItemState = (typeof ITEM_STATES)[number];
export type PlanState = (typeof PLAN_STATES)[number];
export type Milestone = (typeof MILESTONES)[number];

// --- presentation.ts -------------------------------------------------------

export type Attention = "ok" | "needs_human" | "stalled" | "failed";
export const STATE_PRESENTATION = {
  pending: { label: "Pending", attention: "ok", hint: "dependencies unmet or plan not active" },
  ready: { label: "Ready", attention: "ok", hint: "waiting for capacity" },
  reserved: { label: "Reserved", attention: "ok", hint: "T3 admission" },
  running: { label: "Running", attention: "ok", hint: "attempt in a T3 thread" },
  "waiting-input": { label: "Waiting for input", attention: "needs_human", hint: "an agent asked a question" },
  "execution-unknown": { label: "Execution unknown", attention: "stalled", hint: "admission unconfirmed; dispatch retries after the lease" },
  validating: { label: "Validating", attention: "stalled", hint: "validation not yet automated" },
  review: { label: "Review", attention: "needs_human", hint: "PR, approve, merge" },
  deploying: { label: "Deploying", attention: "ok", hint: "deploy and promote" },
  completed: { label: "Completed", attention: "ok", hint: "completion target met" },
  failed: { label: "Failed", attention: "failed", hint: "retry starts a new attempt" },
  cancelling: { label: "Cancelling", attention: "ok", hint: "" },
  cancelled: { label: "Cancelled", attention: "ok", hint: "retry needs an active plan and a prior attempt" },
} as const satisfies Record<ItemState, { label: string; attention: Attention; hint: string }>;

export const MILESTONE_LABEL = {
  "execution-succeeded": "exec ✓",
  "review-ready": "review-ready",
  merged: "merged",
  "production-verified": "prod-verified",
} as const satisfies Record<Milestone, string>;

// --- model.ts --------------------------------------------------------------

export interface RepositoryRef { integrationId: string; repositoryId: string }
export interface ExecutionTarget { environmentId: string; projectId: string; repository: RepositoryRef }
export interface ThreadRef { environmentId: string; projectId: string; threadId: string; turnId?: string | null }
export interface IssueRef { integrationId: string; workspaceId: string; teamId: string; projectId: string; issueId: string; identifier?: string | null; url?: string | null }
export interface PlanSnapshot {
  planId: string;
  resourceVersion: number;
  state: PlanState;
  definition: {
    items: Array<{ itemId: string; issue: IssueRef; target: ExecutionTarget; completionTarget: string }>;
    dependencies: Array<{ upstreamItemId: string; downstreamItemId: string; requiredMilestone: Milestone }>;
    concurrencyLimit: number;
  };
}
export interface ItemSnapshot {
  itemId: string;
  planId: string;
  resourceVersion: number;
  state: ItemState;
  currentAttemptId?: string | null;
  execution?: { attemptId: string; target: ExecutionTarget; thread: ThreadRef } | null;
  pendingInput?: PendingInput | null;
  achievedMilestones: Milestone[];
  operationIds: string[];
  evidenceRefs: string[];
}
export interface TopologyRepo { startupId: string; startupName: string; repoSlug: string }
export interface EdgeView {
  epoch: string | null;
  seq: number;
  plans: Record<string, PlanSnapshot>;
  items: Record<string, ItemSnapshot>;
  topology: TopologyRepo[];
  coordinatorSeenAt: number | null;
  needsResync: boolean;
}
export type EdgeMessage =
  | { type: "snapshot"; epoch: string; seq: number; plans: PlanSnapshot[]; items: ItemSnapshot[]; topology: TopologyRepo[]; coordinatorSeenAt: number | null }
  | { type: "delta"; seq: number; plans: PlanSnapshot[]; items: ItemSnapshot[]; coordinatorSeenAt: number | null }
  | { type: "status"; coordinatorSeenAt: number | null };

export const emptyView = (): EdgeView => ({ epoch: null, seq: 0, plans: {}, items: {}, topology: [], coordinatorSeenAt: null, needsResync: false });
const newer = <T extends { resourceVersion: number }>(current: T | undefined, next: T) => !current || next.resourceVersion > current.resourceVersion;
const later = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
export const TERMINAL_PLAN_STATES: ReadonlySet<PlanState> = new Set<PlanState>(["completed", "cancelled"]);

/** Bob's reduce(), verbatim in behavior. See model.ts in Bob for the rules. */
export function reduce(view: EdgeView, message: EdgeMessage): EdgeView {
  if (message.type === "status") return { ...view, coordinatorSeenAt: later(view.coordinatorSeenAt, message.coordinatorSeenAt) };
  const snapshot = message.type === "snapshot";
  if (!snapshot && message.seq <= view.seq) return { ...view, coordinatorSeenAt: later(view.coordinatorSeenAt, message.coordinatorSeenAt) };
  const base = snapshot ? { ...emptyView(), epoch: message.epoch, topology: message.topology } : view;
  const plans = { ...base.plans }, items = { ...base.items };
  const evicted = new Set<string>();
  for (const p of message.plans) {
    if (TERMINAL_PLAN_STATES.has(p.state)) { evicted.add(p.planId); delete plans[p.planId]; }
    else if (newer(plans[p.planId], p)) plans[p.planId] = p;
  }
  for (const i of message.items) if (!evicted.has(i.planId) && newer(items[i.itemId], i)) items[i.itemId] = i;
  if (evicted.size) for (const [id, i] of Object.entries(items)) if (evicted.has(i.planId)) delete items[id];
  return {
    ...base,
    seq: message.seq,
    plans,
    items,
    coordinatorSeenAt: later(view.coordinatorSeenAt, message.coordinatorSeenAt),
    needsResync: snapshot ? false : view.needsResync || message.seq > view.seq + 1,
  };
}

export const OFFLINE_AFTER_MS = 90_000;
export const isOffline = (view: EdgeView, now: number) => view.coordinatorSeenAt === null || now - view.coordinatorSeenAt > OFFLINE_AFTER_MS;

// --- attempt.ts ------------------------------------------------------------

export interface PendingQuestion {
  id: string;
  header?: string;
  question: string;
  options: Array<{ label: string; value?: string; description?: string }>;
  multiSelect: boolean;
}
export interface PendingInput {
  attemptId: string;
  promptId: string;
  kind: "user_input";
  questions: PendingQuestion[];
  createdAt: string;
}
export interface TailFrame {
  itemId: string;
  attemptId: string;
  threadId: string;
  lines: string[];
  threadStatus: string;
  at: string;
}
export interface WatchMessage { type: "watch"; itemId: string | null }
export interface TailMessage { type: "tail"; frame: TailFrame }
export interface CiPhase { name: string; status: "queued" | "running" | "passed" | "failed" | "skipped" | "unknown"; url?: string }
export type CiMessage =
  | { type: "ci"; itemId: string; available: true; sha: string; summary: string; phases: CiPhase[]; at: string }
  | { type: "ci"; itemId: string; available: false; reason: string; at: string };
export interface TailUnavailableMessage { type: "tailUnavailable"; itemId: string; reason: string }
export type AttemptMessage = TailMessage | CiMessage | TailUnavailableMessage;

// --- bob-tui edge-protocol.ts ----------------------------------------------

export interface HelloMessage { type: "hello"; cursor: number | null; epoch: string | null }

/** Resume from the view's seq and epoch, or ask for a snapshot when there is no view or it needs a resync. */
export function helloFor(view: EdgeView): HelloMessage {
  if (view.epoch === null || view.needsResync) return { type: "hello", cursor: null, epoch: null };
  return { type: "hello", cursor: view.seq, epoch: view.epoch };
}

export function asEdgeMessage(value: unknown): EdgeMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Partial<EdgeMessage> & Record<string, unknown>;
  if (message.type === "status") return message as EdgeMessage;
  if (message.type !== "snapshot" && message.type !== "delta") return null;
  if (!Number.isSafeInteger(message.seq) || !Array.isArray(message.plans) || !Array.isArray(message.items)) return null;
  if (message.type === "snapshot" && (typeof message.epoch !== "string" || !Array.isArray(message.topology))) return null;
  return message as EdgeMessage;
}

export function asAttemptMessage(value: unknown): AttemptMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (message.type === "tail") {
    const frame = message.frame as Partial<TailFrame> | undefined;
    return frame && typeof frame.itemId === "string" && Array.isArray(frame.lines) ? (message as unknown as TailMessage) : null;
  }
  if (message.type === "ci" || message.type === "tailUnavailable") return typeof message.itemId === "string" ? (message as unknown as AttemptMessage) : null;
  return null;
}

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const RECONNECT_JITTER = 0.2;

/** Capped exponential backoff, 1 s … 30 s, ±20%. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 - RECONNECT_JITTER + 2 * RECONNECT_JITTER * random()));
}
