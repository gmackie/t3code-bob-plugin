import { toolData } from "./bridge.ts";
import type { SdlcData } from "../sdlc/model.ts";
import { renderSdlc } from "./sdlc.render.ts";
import { startView } from "./shared.client.ts";

// One view, two panels: in a thread-scoped panel (hostContext.t3.threadId) it
// shows the SDLC item running that thread; otherwise the fleet.
const bridge = startView("bob-sdlc", (context, previous) => {
  threadId = context.t3?.threadId;
  if (connected && threadId !== previous.t3?.threadId) void refresh();
});
const root = document.getElementById("app")!;
let threadId: string | undefined;
let data: SdlcData | undefined;
let connected = false;
let args: Record<string, unknown> = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function draw() {
  if (!data) return;
  root.innerHTML = renderSdlc(data);
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), data.refreshSeconds * 1000);
}

async function refresh() {
  if (document.visibilityState === "hidden") {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 5000);
    return;
  }
  try {
    data = toolData<SdlcData>(await bridge.callTool("bob_sdlc", threadId ? { threadId } : args));
  } catch (cause) {
    const message = `Refresh failed: ${cause instanceof Error ? cause.message : cause}`;
    const status = root.querySelector("header .header-meta span:last-of-type");
    if (status) status.textContent = message;
    else root.textContent = message;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 15_000);
    return;
  }
  draw();
}

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (target?.dataset.action === "refresh") void refresh();
});

bridge.onToolInput = (input) => {
  args = input;
};
bridge.onToolResult = (result) => {
  if (result.isError) {
    root.textContent = result.content?.find((part) => part.type === "text")?.text ?? "Bob SDLC failed to load.";
    return;
  }
  data = toolData<SdlcData>(result);
  // An agent's call may not carry this panel's thread; follow the panel.
  if (threadId && (data.scope !== "thread" || data.threadId !== threadId)) void refresh();
  else draw();
};
void bridge.connect().then(() => {
  connected = true;
  setTimeout(() => void (data ? undefined : refresh()), 250);
});
