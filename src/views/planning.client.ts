import { toolData } from "./bridge.ts";
import type { PlanningData } from "./render.ts";
import { mountPlanning, startView } from "./shared.client.ts";

const bridge = startView("bob-planning-review");
const planning = mountPlanning(bridge, document.getElementById("app")!);

bridge.onToolResult = (result) => {
  if (result.isError) {
    document.getElementById("app")!.textContent = result.content?.find((part) => part.type === "text")?.text ?? "Planning review failed to load.";
    return;
  }
  planning.show(toolData<PlanningData>(result));
};
void bridge.connect();
