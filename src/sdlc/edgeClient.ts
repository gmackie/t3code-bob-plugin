// Read-only client for Bob's SDLC edge (the SdlcEdge Durable Object behind
// /api/sdlc/ws). It authenticates as a native client: `Authorization: Bearer
// <bob_ API key>` and no Origin header, which Bun's WebSocket allows (Node's
// global one cannot set headers). The key needs write permission and its user
// must be on the edge's viewer allow-list (SDLC_VIEWER_USER_IDS).
//
// Same session rules as apps/bob-tui/src/client/session.ts, minus commands:
// hello {cursor, epoch} on open, fold messages through reduce(), ask for a
// snapshot once when a delta skips a seq, reconnect with capped backoff that
// resets once the edge sends a valid message. One watched item per socket.
import {
  asAttemptMessage,
  asEdgeMessage,
  emptyView,
  helloFor,
  reconnectDelay,
  reduce,
  type CiMessage,
  type EdgeView,
  type TailFrame,
  type WatchMessage,
} from "./protocol.ts";

export type EdgeConnection = "idle" | "connecting" | "live" | "reconnecting";

export type AttemptDetail = { tail?: TailFrame; tailUnavailable?: string; ci?: CiMessage };

export interface SdlcEdgeSource {
  readonly view: EdgeView;
  readonly connection: EdgeConnection;
  readonly error: string | null;
  /** Starts the socket if needed and waits (bounded) for the first snapshot. */
  ready(timeoutMs?: number): Promise<void>;
  /** Watch one item's live tail and CI (null stops). Re-sent on every new socket. */
  watch(itemId: string | null): void;
  attempt(itemId: string): AttemptDetail;
  stop(): void;
}

export type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown; message?: string; code?: number; reason?: string }) => void): void;
};
export type OpenSocket = (url: string, headers: Record<string, string>) => SocketLike;

export type EdgeClientOptions = {
  /** Bob origin (BOB_API_URL); the socket URL is derived from it. */
  baseUrl: string;
  token: string;
  open?: OpenSocket;
  random?: () => number;
};

/** wss://<host>/api/sdlc/ws (ws:// for an http origin, for local development). */
export function edgeSocketUrl(baseUrl: string): string {
  const url = new URL("/api/sdlc/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

const bunOpen: OpenSocket = (url, headers) =>
  // Bun's WebSocket accepts { headers }; it does not add an Origin header.
  new WebSocket(url, { headers } as unknown as string[]) as unknown as SocketLike;

export function createEdgeClient(options: EdgeClientOptions): SdlcEdgeSource {
  const url = edgeSocketUrl(options.baseUrl);
  const open = options.open ?? bunOpen;
  let view = emptyView();
  let connection: EdgeConnection = "idle";
  let error: string | null = null;
  let socket: SocketLike | null = null;
  let attempt = 0;
  let stopped = false;
  let resyncRequested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watched: string | null = null;
  const details = new Map<string, AttemptDetail>();
  const waiters = new Set<() => void>();
  const settle = () => {
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const write = (message: unknown) => {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  };

  const connect = () => {
    if (stopped) return;
    connection = attempt === 0 && view.epoch === null ? "connecting" : "reconnecting";
    let current: SocketLike;
    try {
      current = open(url, { Authorization: `Bearer ${options.token}` });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      scheduleReconnect();
      return;
    }
    socket = current;
    const mine = () => socket === current;
    current.addEventListener("open", () => {
      if (!mine()) return;
      resyncRequested = view.needsResync;
      write(helloFor(view));
      if (watched) write({ type: "watch", itemId: watched } satisfies WatchMessage);
    });
    current.addEventListener("message", (event) => {
      if (!mine() || typeof event.data !== "string") return;
      let value: unknown;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      const message = asEdgeMessage(value);
      if (message) {
        attempt = 0;
        connection = "live";
        error = null;
        view = reduce(view, message);
        if (!view.needsResync) resyncRequested = false;
        else if (!resyncRequested) {
          resyncRequested = true;
          write({ type: "hello", cursor: null, epoch: null });
        }
        if (view.epoch !== null) settle();
        return;
      }
      const detail = asAttemptMessage(value);
      if (!detail) return;
      attempt = 0;
      const itemId = detail.type === "tail" ? detail.frame.itemId : detail.itemId;
      const current = details.get(itemId) ?? {};
      if (detail.type === "tail") details.set(itemId, { ...(current.ci ? { ci: current.ci } : {}), tail: detail.frame });
      else if (detail.type === "tailUnavailable") details.set(detail.itemId, { ...current, tailUnavailable: detail.reason });
      else details.set(detail.itemId, { ...current, ci: detail });
    });
    current.addEventListener("error", (event) => {
      if (mine()) error = event.message || "The SDLC edge socket failed (check BOB_API_TOKEN and the viewer allow-list).";
    });
    current.addEventListener("close", (event) => {
      if (!mine()) return;
      socket = null;
      if (event.code && event.code !== 1000 && event.code !== 1005 && !error) error = `The SDLC edge closed the socket (${event.code}${event.reason ? ` ${event.reason}` : ""}).`;
      scheduleReconnect();
    });
  };
  const scheduleReconnect = () => {
    settle();
    if (stopped) return;
    connection = "reconnecting";
    timer = setTimeout(connect, reconnectDelay(attempt++, options.random));
  };

  return {
    get view() {
      return view;
    },
    get connection() {
      return connection;
    },
    get error() {
      return error;
    },
    ready(timeoutMs = 4_000) {
      if (connection === "idle") {
        stopped = false;
        connect();
      }
      if (view.epoch !== null) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(limit);
          waiters.delete(done);
          resolve();
        };
        const limit = setTimeout(done, timeoutMs);
        waiters.add(done);
      });
    },
    watch(itemId) {
      if (itemId === watched) return;
      watched = itemId;
      write({ type: "watch", itemId } satisfies WatchMessage);
    },
    attempt: (itemId) => details.get(itemId) ?? {},
    stop() {
      stopped = true;
      clearTimeout(timer);
      const s = socket;
      socket = null;
      connection = "idle";
      s?.close();
      settle();
    },
  };
}
