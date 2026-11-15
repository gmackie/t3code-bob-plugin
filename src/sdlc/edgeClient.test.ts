import { afterEach, describe, expect, it } from "bun:test";

import { createEdgeClient, edgeSocketUrl, type SdlcEdgeSource } from "./edgeClient.ts";
import { demoCi, demoSnapshot, demoTail } from "./fixtures.ts";

type Upgrade = { authorization: string | null; origin: string | null };
type Server = ReturnType<typeof Bun.serve<undefined>>;

// A local stand-in for the SdlcEdge DO: records each upgrade's headers and
// each client message, answers hello with a snapshot and watch with tail + CI.
function fakeEdge(options: { reject?: number } = {}) {
  const upgrades: Upgrade[] = [];
  const received: unknown[] = [];
  const sockets = new Set<{ close(code?: number): void }>();
  const server: Server = Bun.serve<undefined>({
    port: 0,
    fetch(request, srv) {
      if (new URL(request.url).pathname !== "/api/sdlc/ws") return new Response("not found", { status: 404 });
      upgrades.push({ authorization: request.headers.get("authorization"), origin: request.headers.get("origin") });
      if (options.reject) return new Response("no", { status: options.reject });
      return srv.upgrade(request) ? undefined : new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
      message(ws, raw) {
        const message = JSON.parse(String(raw)) as { type: string; cursor?: number | null; itemId?: string };
        received.push(message);
        if (message.type === "hello") ws.send(JSON.stringify(message.cursor === null ? demoSnapshot(1_000) : { type: "status", coordinatorSeenAt: 2_000 }));
        if (message.type === "watch" && message.itemId) {
          ws.send(JSON.stringify(demoTail(message.itemId)));
          ws.send(JSON.stringify(demoCi(message.itemId)));
        }
      },
    },
  });
  return { server, upgrades, received, dropAll: () => sockets.forEach((s) => s.close(1012)) };
}

const until = async (check: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(5);
  }
};

let client: SdlcEdgeSource | undefined;
let server: Server | undefined;
afterEach(() => {
  client?.stop();
  server?.stop(true);
});

describe("SDLC edge client", () => {
  it("derives the socket URL from BOB_API_URL", () => {
    expect(edgeSocketUrl("https://bob.blder.bot")).toBe("wss://bob.blder.bot/api/sdlc/ws");
    expect(edgeSocketUrl("http://localhost:4319/")).toBe("ws://localhost:4319/api/sdlc/ws");
  });

  it("authenticates with a Bearer key and no Origin, says hello, and folds the snapshot", async () => {
    const edge = fakeEdge();
    server = edge.server;
    client = createEdgeClient({ baseUrl: `http://localhost:${edge.server.port}`, token: "bob_test" });
    expect(client.connection).toBe("idle");
    await client.ready();
    expect(edge.upgrades).toEqual([{ authorization: "Bearer bob_test", origin: null }]);
    expect(edge.received).toEqual([{ type: "hello", cursor: null, epoch: null }]);
    expect(client.connection).toBe("live");
    expect(client.view).toMatchObject({ epoch: "epoch-demo", seq: 12 });
    expect(Object.keys(client.view.items)).toHaveLength(4);

    client.watch("item-a");
    await until(() => client!.attempt("item-a").ci !== undefined);
    expect(client.attempt("item-a").tail?.lines).toContain("  42 pass");
    expect(edge.received.at(-1)).toEqual({ type: "watch", itemId: "item-a" });
  });

  it("reconnects, resumes from its cursor and epoch, and re-sends its watch", async () => {
    const edge = fakeEdge();
    server = edge.server;
    client = createEdgeClient({ baseUrl: `http://localhost:${edge.server.port}`, token: "bob_test", random: () => 0 });
    await client.ready();
    client.watch("item-a");
    await until(() => edge.received.length === 2);
    edge.dropAll();
    await until(() => edge.upgrades.length === 2 && edge.received.length >= 4);
    expect(edge.received.slice(2, 4)).toEqual([
      { type: "hello", cursor: 12, epoch: "epoch-demo" },
      { type: "watch", itemId: "item-a" },
    ]);
    await until(() => client!.view.coordinatorSeenAt === 2_000);
    expect(client.connection).toBe("live");
  });

  it("returns from ready() with an error when the edge refuses the key", async () => {
    const edge = fakeEdge({ reject: 401 });
    server = edge.server;
    client = createEdgeClient({ baseUrl: `http://localhost:${edge.server.port}`, token: "bob_bad", random: () => 0 });
    await client.ready(2_000);
    expect(client.view.epoch).toBeNull();
    expect(client.connection).toBe("reconnecting");
    expect(client.error).toBeTruthy();
  });
});
