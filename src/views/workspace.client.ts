import { toolData } from "./bridge.ts";
import { renderWorkspace, type WorkspaceData } from "./render.ts";
import { mountPlanning, startView } from "./shared.client.ts";

const bridge = startView("bob-workspace");
const root = document.getElementById("app")!;
let data: WorkspaceData | undefined;
let args: Record<string, unknown> = {};
let filter = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let review: ReturnType<typeof mountPlanning> | undefined;

function draw() {
  if (!data) return;
  // Keep the review pane (and its state) across list refreshes.
  const pane = root.querySelector<HTMLElement>("[data-role=review]");
  root.innerHTML = renderWorkspace(data, filter);
  if (pane) root.querySelector("[data-role=review]")!.replaceWith(pane);
  else review = mountPlanning(bridge, root.querySelector<HTMLElement>("[data-role=review]")!, data.pollSeconds);
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), data.pollSeconds * 1000);
}

async function refresh() {
  if (document.visibilityState === "hidden") {
    timer = setTimeout(() => void refresh(), 5000);
    return;
  }
  try {
    data = toolData<WorkspaceData>(await bridge.callTool("bob_workspace", args));
  } catch (cause) {
    const message = `Refresh failed: ${cause instanceof Error ? cause.message : cause}`;
    const status = root.querySelector("header .header-meta span");
    if (status) status.textContent = message;
    else root.textContent = message;
  }
  draw();
}

root.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.role !== "filter") return;
  filter = input.value;
  draw();
  const next = root.querySelector<HTMLInputElement>("[data-role=filter]")!;
  next.focus();
  next.setSelectionRange(filter.length, filter.length);
});

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (target?.dataset.action === "refresh") void refresh();
  if (target?.dataset.action === "review" && target.dataset.workItemId) void review?.load(target.dataset.workItemId);
});

bridge.onToolInput = (input) => {
  args = input;
};
bridge.onToolResult = (result) => {
  if (result.isError) {
    root.textContent = result.content?.find((part) => part.type === "text")?.text ?? "Bob workspace failed to load.";
    return;
  }
  data = toolData<WorkspaceData>(result);
  draw();
};
// In a thread the host delivers the bob_workspace result; a thread-less panel
// (T3CODE-74) may only load the resource, so fetch if nothing arrives.
void bridge.connect().then(() => setTimeout(() => void (data ? undefined : refresh()), 250));
