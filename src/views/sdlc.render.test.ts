import { describe, expect, it } from "bun:test";

import { DEMO_THREADS, demoCi, demoSnapshot, demoTail } from "../sdlc/fixtures.ts";
import { fleet, itemForThread, threadItem, type EdgeStatus } from "../sdlc/model.ts";
import { emptyView, reduce } from "../sdlc/protocol.ts";
import { renderSdlc } from "./sdlc.render.ts";

const view = reduce(emptyView(), demoSnapshot(1_000));
const status: EdgeStatus = { connection: "live", offline: false, refreshedAt: "2026-11-15T10:06:00.000Z", refreshSeconds: 5 };
// Rendered times use the runner's locale and zone; pin them out of the snapshot.
const stable = (html: string) =>
  ["2026-11-15T10:06:00.000Z", "2026-11-15T10:05:00.000Z"].reduce((out, iso) => out.replaceAll(new Date(iso).toLocaleString(), `<time ${iso}>`), html);

describe("bob_sdlc view", () => {
  it("renders the thread's item with plan, state, milestones, tail and CI", () => {
    const item = threadItem(view, itemForThread(view, DEMO_THREADS.running)!, { tail: demoTail("item-a")!.frame, ci: demoCi("item-a") });
    const html = renderSdlc({ scope: "thread", threadId: DEMO_THREADS.running, item, ...status });
    expect(html).toContain("Running");
    expect(html).toContain('href="https://tasks.example/T3CODE-201"');
    expect(html).toContain('aria-label="Live tail"');
    expect(html).toContain("deploy-preview");
    expect(stable(html)).toMatchSnapshot();
  });

  it("renders pending questions read-only, escaped, with a pointer to Bob", () => {
    const item = threadItem(view, itemForThread(view, DEMO_THREADS.waiting)!, { ci: demoCi("item-b") });
    const html = renderSdlc({ scope: "thread", threadId: DEMO_THREADS.waiting, item, ...status });
    expect(html).toContain("Run the &lt;drizzle&gt; migration");
    expect(html).not.toContain("<drizzle>");
    expect(html).toContain("Answer in Bob");
    expect(html).not.toMatch(/<(input|textarea|form)\b/);
    expect(html).toContain("No ForgeGraph changeset yet.");
    expect(stable(html)).toMatchSnapshot();
  });

  it("says when no item runs the thread", () => {
    const html = renderSdlc({ scope: "thread", threadId: DEMO_THREADS.none, item: null, ...status, connection: "reconnecting", error: "The SDLC edge closed the socket (1008)." });
    expect(html).toContain("No Bob SDLC item is running this thread.");
    expect(html).toContain('role="alert">The SDLC edge closed the socket (1008).');
    expect(stable(html)).toMatchSnapshot();
  });

  it("renders the fleet", () => {
    const html = renderSdlc({ scope: "fleet", ...fleet(view), ...status, offline: true });
    expect(html).toContain("Coordinator offline");
    expect(html).toContain("T3CODE-202");
    expect(html).toContain('aria-valuenow="25"');
    expect(stable(html)).toMatchSnapshot();
  });

  it("does not link non-http issue URLs", () => {
    const item = { ...threadItem(view, view.items["item-a"]!), issue: { issueId: "x", identifier: "X-1", url: "javascript:alert(1)" } };
    expect(renderSdlc({ scope: "thread", threadId: "t", item, ...status })).not.toContain("javascript:");
  });
});
