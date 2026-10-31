#!/usr/bin/env bun
// Stdio entry point for the MCP-native Bob plugin (manifest v2 `mcpServer`).
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createBobHttpClient } from "./bobClient.ts";
import { loadConfig } from "./config.ts";
import { createBobMcpServer } from "./server.ts";
import { BobStateStore, bunSqliteExecutor, openStateDatabase } from "./state.ts";

const config = loadConfig();
mkdirSync(dirname(config.statePath), { recursive: true });
const state = new BobStateStore(bunSqliteExecutor(openStateDatabase(new Database(config.statePath, { create: true }))));
await state.initialize();

const server = createBobMcpServer({
  client: createBobHttpClient({ baseUrl: config.bobApiUrl, ...(config.bobApiToken ? { token: config.bobApiToken } : {}) }),
  state,
  ...(config.bobWorkspaceId ? { workspaceId: config.bobWorkspaceId } : {}),
  pollSeconds: config.pollSeconds,
});
await server.connect(new StdioServerTransport());
