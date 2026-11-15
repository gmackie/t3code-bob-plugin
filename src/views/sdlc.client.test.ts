import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";

import { DEMO_THREADS } from "../sdlc/fixtures.ts";
import { connectedClient } from "../testing.ts";

// Runs the real SDLC view module against a DOM, with this test acting as the
// host frame and forwarding tools/call to the Bob MCP server.
async function mount(hostContext: Record<string, unknown>, tag: string) {
  const { client } = await connectedClient();
  const win = new Window({ url: `https://${tag}.invalid/` });
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const deliver = (data: unknown) => win.dispatchEvent(new win.MessageEvent("message", { data, source: parent as never }));
  const parent = {
    async postMessage(message: { id?: number; method?: string; params?: { name: string; arguments: Record<string, unknown> } }) {
      if (message.method === "ui/initialize") deliver({ jsonrpc: "2.0", id: message.id, result: { hostContext } });
      if (message.method === "tools/call") {
        calls.push(message.params!);
        deliver({ jsonrpc: "2.0", id: message.id, result: await client.callTool({ name: message.params!.name, arguments: message.params!.arguments }) });
      }
    },
  };
  Object.defineProperty(win, "parent", { value: parent });
  win.document.body.innerHTML = `<main id="app">Loading…</main>`;
  Object.assign(globalThis, { window: win, document: win.document, ResizeObserver: class { observe() {} } });
  await import(`./sdlc.client.ts?${tag}`);
  return { win, calls, deliver, text: () => win.document.getElementById("app")!.textContent! };
}

describe("SDLC view in a DOM", () => {
  it("shows the thread's item in a thread panel and follows the active thread", async () => {
    const { win, calls, deliver, text } = await mount({ t3: { threadId: DEMO_THREADS.running } }, "thread");
    await Bun.sleep(400);
    expect(calls).toEqual([{ name: "bob_sdlc", arguments: { threadId: DEMO_THREADS.running } }]);
    expect(text()).toContain("T3CODE-201");
    expect(text()).toContain("42 pass");

    deliver({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { t3: { threadId: DEMO_THREADS.none } } });
    await Bun.sleep(50);
    expect(text()).toContain("No Bob SDLC item is running this thread.");
    await win.happyDOM.abort();
  });

  it("shows the fleet in a project panel", async () => {
    const { win, calls, text } = await mount({}, "fleet");
    await Bun.sleep(400);
    expect(calls).toEqual([{ name: "bob_sdlc", arguments: {} }]);
    expect(text()).toContain("Bob SDLC fleet");
    expect(text()).toContain("Needs attention 1");
    await win.happyDOM.abort();
  });
});
