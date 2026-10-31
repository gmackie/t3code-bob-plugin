import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";

import { connectedClient } from "../testing.ts";

// Runs the real workspace view module against a DOM, with this test acting as
// the host frame and forwarding tools/call to the Bob MCP server.
describe("workspace view in a DOM", () => {
  it("reviews, approves and dispatches a work item through host tool calls", async () => {
    const { client, dispatched } = await connectedClient();
    const win = new Window({ url: "https://view.invalid/" });
    const calls: string[] = [];
    const deliver = (data: unknown) => win.dispatchEvent(new win.MessageEvent("message", { data, source: parent as never }));
    const parent = {
      async postMessage(message: { id?: number; method?: string; params?: { name: string; arguments: Record<string, unknown> } }) {
        if (message.method === "ui/initialize") deliver({ jsonrpc: "2.0", id: message.id, result: { hostContext: { theme: "dark" } } });
        if (message.method === "tools/call") {
          calls.push(message.params!.name);
          deliver({ jsonrpc: "2.0", id: message.id, result: await client.callTool({ name: message.params!.name, arguments: message.params!.arguments }) });
        }
      },
    };
    Object.defineProperty(win, "parent", { value: parent });
    win.document.body.innerHTML = `<main id="app">Loading…</main>`;
    Object.assign(globalThis, { window: win, document: win.document, ResizeObserver: class { observe() {} } });

    await import("./workspace.client.ts");
    await Bun.sleep(5);
    deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: await client.callTool({ name: "bob_workspace", arguments: {} }) });
    const doc = win.document;
    const settle = () => Bun.sleep(30);
    await settle();
    expect(doc.documentElement.dataset.theme).toBe("dark");
    expect(doc.querySelectorAll("[data-action=review]")).toHaveLength(2);

    (doc.querySelector('[data-work-item-id="w1"]') as unknown as HTMLElement).click();
    await settle();
    expect(doc.querySelector("[data-role=review] strong")?.textContent).toBe("review");

    (doc.querySelector("[data-action=approve]") as unknown as HTMLElement).click();
    await settle();
    expect(doc.querySelector("[data-role=review] strong")?.textContent).toBe("execute");

    (doc.querySelector("[data-role=agent-type]") as unknown as HTMLInputElement).value = "codex";
    (doc.querySelector("[data-action=execute]") as unknown as HTMLElement).click();
    await settle();
    expect(doc.querySelector("[data-role=review] strong")?.textContent).toBe("verify");
    expect(dispatched).toEqual([{ workItemId: "w1", agentType: "codex" }]);
    expect(calls).toEqual(["bob_planning_review", "bob_planning_approve", "bob_planning_review", "bob_planning_dispatch", "bob_planning_review"]);
    await win.happyDOM.abort();
  });

  it("loads itself when a thread-less panel delivers no tool result", async () => {
    const { client } = await connectedClient();
    const win = new Window({ url: "https://panel.invalid/" });
    const calls: string[] = [];
    const deliver = (data: unknown) => win.dispatchEvent(new win.MessageEvent("message", { data, source: parent as never }));
    const parent = {
      async postMessage(message: { id?: number; method?: string; params?: { name: string; arguments: Record<string, unknown> } }) {
        if (message.method === "ui/initialize") deliver({ jsonrpc: "2.0", id: message.id, result: {} });
        if (message.method === "tools/call") {
          calls.push(message.params!.name);
          deliver({ jsonrpc: "2.0", id: message.id, result: await client.callTool({ name: message.params!.name, arguments: message.params!.arguments }) });
        }
      },
    };
    Object.defineProperty(win, "parent", { value: parent });
    win.document.body.innerHTML = `<main id="app">Loading…</main>`;
    Object.assign(globalThis, { window: win, document: win.document, ResizeObserver: class { observe() {} } });

    await import(`./workspace.client.ts?panel`);
    await Bun.sleep(400);
    expect(calls).toEqual(["bob_workspace"]);
    expect(win.document.querySelectorAll("[data-action=review]")).toHaveLength(2);
    await win.happyDOM.abort();
  });
});
