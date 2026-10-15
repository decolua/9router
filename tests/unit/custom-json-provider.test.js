import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args), getProxyInfo: () => null }));

const originalDataDir = process.env.DATA_DIR;
let dataDir, nodes, connections, update, db;
const nodeInput = (overrides = {}) => ({
  type: "openai-compatible", apiType: "custom-json", name: "Custom API", prefix: "custom", baseUrl: "https://api.example.com/generate",
  customJson: { requestTemplate: { project_id: "{{prompt}}" }, responsePath: "data.answer", authType: "none" }, ...overrides,
});
const request = (body, method = "POST") => new Request("http://localhost/api/provider-nodes", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-custom-json-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  nodes = await import("@/app/api/provider-nodes/route.js");
  connections = await import("@/app/api/providers/route.js");
  update = await import("@/app/api/provider-nodes/[id]/route.js");
  db = await import("@/models/index.js");
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("custom JSON provider lifecycle", () => {
  it("persists templates and allows no-auth connections using the node's trusted configuration", async () => {
    const response = await nodes.POST(request(nodeInput()));
    expect(response.status).toBe(201);
    const { node } = await response.json();
    expect((await db.getProviderNodeById(node.id)).customJson.requestTemplate).toEqual({ project_id: "{{prompt}}" });
    const created = await connections.POST(request({ provider: node.id, name: "Local connection", defaultModel: "assistant" }));
    expect(created.status).toBe(201);
    const stored = (await db.getProviderConnections({ provider: node.id }))[0];
    expect(stored.providerSpecificData.customJson).toEqual(node.customJson);
    expect(stored.apiKey).toBe("");
  });
  it("rejects invalid JSON templates at both create and update without mutating the stored node", async () => {
    expect((await nodes.POST(request(nodeInput({ customJson: { requestTemplate: [] } })))).status).toBe(400);
    const { node } = await (await nodes.POST(request(nodeInput()))).json();
    const result = await update.PUT(request(nodeInput({ customJson: { responsePath: "__proto__", requestTemplate: {} } }), "PUT"), { params: Promise.resolve({ id: node.id }) });
    expect(result.status).toBe(400);
    expect((await db.getProviderNodeById(node.id)).customJson.responsePath).toBe("data.answer");
  });
  it("updates templates and endpoints on every existing connection and can switch back to chat", async () => {
    const { node } = await (await nodes.POST(request(nodeInput()))).json();
    for (const name of ["one", "two"]) expect((await connections.POST(request({ provider: node.id, name, defaultModel: "assistant" }))).status).toBe(201);
    const changed = nodeInput({ baseUrl: "https://api.example.com/v2/run", customJson: { requestTemplate: { project_id: "demo-project", question: "{{prompt}}" }, responsePath: "result", authType: "none" } });
    expect((await update.PUT(request(changed, "PUT"), { params: Promise.resolve({ id: node.id }) })).status).toBe(200);
    for (const connection of await db.getProviderConnections({ provider: node.id })) {
      expect(connection.providerSpecificData.baseUrl).toBe(changed.baseUrl);
      expect(connection.providerSpecificData.customJson.responsePath).toBe("result");
    }
    expect((await update.PUT(request({ ...changed, apiType: "chat" }, "PUT"), { params: Promise.resolve({ id: node.id }) })).status).toBe(200);
    for (const connection of await db.getProviderConnections({ provider: node.id })) {
      expect(connection.providerSpecificData.apiType).toBe("chat");
      expect(connection.providerSpecificData.customJson).toBeNull();
    }
  });
  it("does not allow client-supplied no-auth configuration to bypass a node's key requirement", async () => {
    const { node } = await (await nodes.POST(request(nodeInput({ customJson: { ...nodeInput().customJson, authType: "bearer" } })))).json();
    const response = await connections.POST(request({ provider: node.id, name: "fake no auth", providerSpecificData: { customJson: { authType: "none" } } }));
    expect(response.status).toBe(400);
  });
  it("configuration-only connection validation never invokes a business endpoint", async () => {
    const { node } = await (await nodes.POST(request(nodeInput()))).json();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const validation = await import("@/app/api/providers/validate/route.js");
    const response = await validation.POST(request({ provider: node.id, validateOnly: true }));
    expect((await response.json()).valid).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
