// Test fixtures shared by the MCP server and view-bridge tests.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import type { BobPlanningClient } from "./planning.ts";
import { createBobMcpServer, type BobServerOptions } from "./server.ts";
import type { BobLinearLink } from "./types.ts";
import type { BobWorkflowState } from "./state.ts";

export function fakeBob(overrides: Partial<BobPlanningClient> = {}) {
  const dispatched: { workItemId: string; agentType?: string }[] = [];
  const client: BobPlanningClient = {
    listWorkItems: async () => [
      { id: "w1", title: "Ship the MCP port", status: "in progress", projectId: "p1", updatedAt: "2026-10-31T10:00:00.000Z" },
      { id: "w2", title: "Write <docs>", status: "backlog" },
    ],
    getWorkItem: async ({ workItemId }) => ({ id: workItemId, title: workItemId === "w1" ? "Ship the MCP port" : "Write <docs>", status: "backlog" }),
    listRuns: async ({ workItemId }) =>
      dispatched.length && (!workItemId || workItemId === "w1") ? [{ id: "s1", workItemId: "w1", status: "running", agentType: "claude", createdAt: "2026-10-31T11:00:00.000Z" }] : [],
    dispatchWorkItem: async (input) => {
      dispatched.push({ workItemId: input.workItemId, ...(input.agentType ? { agentType: input.agentType } : {}) });
      return { id: "s1", sessionId: "s1", workItemId: input.workItemId, status: "pending" };
    },
    ...overrides,
  };
  return { client, dispatched };
}

export function memoryState() {
  const links = new Map<string, BobLinearLink>();
  const workflows = new Map<string, BobWorkflowState>();
  return {
    getWorkflowState: async (id: string) => workflows.get(id) ?? { approved: false, dispatchRequested: false },
    saveWorkflowState: async (id: string, state: BobWorkflowState) => void workflows.set(id, state),
    getLinearLink: async (id: string) => links.get(id),
    listLinearLinks: async () => [...links.values()],
    saveLinearLink: async (link: BobLinearLink) => (links.set(link.bobWorkItemId, link), link),
    removeLinearLink: async (id: string) => void links.delete(id),
  } as never;
}

export async function connectedClient(options: { client?: BobPlanningClient; state?: BobServerOptions["state"]; workspaceId?: string | null } = {}) {
  const bob = options.client ? { client: options.client, dispatched: [] } : fakeBob();
  const server = createBobMcpServer({
    client: bob.client,
    state: options.state ?? memoryState(),
    ...(options.workspaceId === null ? {} : { workspaceId: options.workspaceId ?? "ws-1" }),
    pollSeconds: 30,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server, dispatched: bob.dispatched };
}
