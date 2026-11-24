import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import manifest from "../t3-plugin.json" with { type: "json" };
import { validateManifestV2 } from "./manifest.ts";

describe("v2 manifest", () => {
  it("matches the shape T3 installs", () => {
    expect(validateManifestV2(manifest)).toEqual([]);
  });

  it("requests read access to hosted Bob by default", () => {
    expect(manifest.mcpServer.transport).toEqual({
      type: "http",
      url: "https://bob.blder.bot/mcp",
      headers: [],
      auth: { type: "oauth", scopes: ["bob:read"] },
    });
    expect(manifest.t3Tools).toEqual([]);
  });
});

// Opt-in: BOB_MCP_TOKEN=<OAuth access token>, optionally BOB_MCP_URL.
const liveToken = process.env.BOB_MCP_TOKEN;
describe.skipIf(!liveToken)("manifest against hosted Bob", () => {
  it("serves every panel's view, opened by a tool the view may call", async () => {
    const client = new Client({ name: "bob-plugin-test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(process.env.BOB_MCP_URL ?? manifest.mcpServer.transport.url), {
        requestInit: { headers: { Authorization: `Bearer ${liveToken}` } },
      }),
    );
    try {
      const { resources } = await client.listResources();
      const { tools } = await client.listTools();
      for (const panel of manifest.contributes.panels) {
        expect(resources.find((r) => r.uri === panel.resourceUri)?.mimeType).toBe("text/html;profile=mcp-app");
        const opener = tools.find((t) => (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri === panel.resourceUri);
        expect((opener?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility).toContain("app");
      }
    } finally {
      await client.close();
    }
  });
});
