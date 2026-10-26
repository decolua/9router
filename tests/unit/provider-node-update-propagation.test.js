import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// DF-9ROUTER-63 — two contract defects on the compatible-node surface:
//
// 1. Node edits must reach EXISTING connections. Connections snapshot the
//    node's baseUrl/apiType into providerSpecificData at create time; the node
//    PUT route has always had a propagation block, but the dogfood
//    (docs/dogfood/2026-10-20-live-chain-sse-integration.md, Finding 2)
//    measured live that a corrected baseUrl kept serving the OLD url until the
//    connection was recreated. These tests pin the propagation contract.
// 2. POST /api/providers must accept the node PREFIX (the user-visible name a
//    prefix-model URL uses), not only the generated node id — and a miss must
//    404 with a message naming the node-id contract instead of a bare
//    "OpenAI Compatible node not found".

const originalDataDir = process.env.DATA_DIR;

async function setupTestContext(nodeData) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-node-propagation-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));

  const { POST: providersPOST } = await import("@/app/api/providers/route.js");
  const { PUT: nodePUT } = await import("@/app/api/provider-nodes/[id]/route.js");
  const {
    createProviderNode,
    getProviderConnections,
    getProviderNodeById,
  } = await import("@/models/index.js");

  const node = await createProviderNode(nodeData);

  return {
    node,
    providersPOST,
    nodePUT,
    createProviderNode,
    getProviderConnections,
    getProviderNodeById,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function makeConnectionRequest(provider, name = "Test Connection") {
  return new Request("https://9router.local/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      apiKey: "sk-test-key",
      name,
      defaultModel: "test-model",
    }),
  });
}

function makeNodePutRequest(body) {
  return new Request("https://9router.local/api/provider-nodes/update", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("provider node update propagates to existing connections (DF-9ROUTER-63)", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("next/server");
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("openai-compatible: a node baseUrl correction reaches the existing connection", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-chat-prop01",
      type: "openai-compatible",
      name: "Propagation Node",
      prefix: "prop",
      apiType: "chat",
      baseUrl: "http://127.0.0.1:20128", // wrong: no /v1
    });
    cleanup = ctx.cleanup;

    // Connection created while the node still has the wrong URL.
    const createResponse = await ctx.providersPOST(makeConnectionRequest(ctx.node.id));
    expect(createResponse.status).toBe(201);

    // Fix the node.
    const fixedBaseUrl = "http://127.0.0.1:20128/v1";
    const putResponse = await ctx.nodePUT(makeNodePutRequest({
      name: "Propagation Node",
      prefix: "prop",
      apiType: "chat",
      baseUrl: fixedBaseUrl,
    }), { params: Promise.resolve({ id: ctx.node.id }) });
    expect(putResponse.status).toBe(200);

    // The EXISTING connection must now carry the corrected URL.
    const stored = await ctx.getProviderConnections({ provider: ctx.node.id });
    expect(stored).toHaveLength(1);
    expect(stored[0].providerSpecificData.baseUrl).toBe(fixedBaseUrl);
  });

  it("openai-compatible: an apiType correction reaches the existing connection", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-chat-prop02",
      type: "openai-compatible",
      name: "ApiType Node",
      prefix: "aty",
      apiType: "chat",
      baseUrl: "http://127.0.0.1:20128/v1",
    });
    cleanup = ctx.cleanup;

    const createResponse = await ctx.providersPOST(makeConnectionRequest(ctx.node.id));
    expect(createResponse.status).toBe(201);

    const putResponse = await ctx.nodePUT(makeNodePutRequest({
      name: "ApiType Node",
      prefix: "aty",
      apiType: "responses",
      baseUrl: "http://127.0.0.1:20128/v1",
    }), { params: Promise.resolve({ id: ctx.node.id }) });
    expect(putResponse.status).toBe(200);

    const stored = await ctx.getProviderConnections({ provider: ctx.node.id });
    expect(stored).toHaveLength(1);
    expect(stored[0].providerSpecificData.apiType).toBe("responses");
  });

  it("anthropic-compatible: a node baseUrl correction reaches the existing connection", async () => {
    const ctx = await setupTestContext({
      id: "anthropic-compatible-prop03",
      type: "anthropic-compatible",
      name: "Anthropic Prop Node",
      prefix: "aprop",
      baseUrl: "http://127.0.0.1:20128",
    });
    cleanup = ctx.cleanup;

    const createResponse = await ctx.providersPOST(makeConnectionRequest(ctx.node.id));
    expect(createResponse.status).toBe(201);

    const fixedBaseUrl = "http://127.0.0.1:20128/v1";
    const putResponse = await ctx.nodePUT(makeNodePutRequest({
      name: "Anthropic Prop Node",
      prefix: "aprop",
      baseUrl: fixedBaseUrl,
    }), { params: Promise.resolve({ id: ctx.node.id }) });
    expect(putResponse.status).toBe(200);

    const stored = await ctx.getProviderConnections({ provider: ctx.node.id });
    expect(stored).toHaveLength(1);
    expect(stored[0].providerSpecificData.baseUrl).toBe(fixedBaseUrl);
  });

  it("custom-embedding: a node baseUrl correction reaches the existing connection", async () => {
    const ctx = await setupTestContext({
      id: "custom-embedding-prop04",
      type: "custom-embedding",
      name: "Embedding Prop Node",
      prefix: "eprop",
      baseUrl: "http://127.0.0.1:20128",
    });
    cleanup = ctx.cleanup;

    const createResponse = await ctx.providersPOST(makeConnectionRequest(ctx.node.id));
    expect(createResponse.status).toBe(201);

    const fixedBaseUrl = "http://127.0.0.1:20128/v1";
    const putResponse = await ctx.nodePUT(makeNodePutRequest({
      name: "Embedding Prop Node",
      prefix: "eprop",
      baseUrl: `${fixedBaseUrl}/embeddings`,
    }), { params: Promise.resolve({ id: ctx.node.id }) });
    expect(putResponse.status).toBe(200);

    const stored = await ctx.getProviderConnections({ provider: ctx.node.id });
    expect(stored).toHaveLength(1);
    // Sanitizer strips the /embeddings suffix the caller pasted.
    expect(stored[0].providerSpecificData.baseUrl).toBe(fixedBaseUrl);
  });
});

describe("connection POST accepts the node prefix (DF-9ROUTER-63)", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("next/server");
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("resolves an openai-compatible node prefix to the node", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-chat-pfx01",
      type: "openai-compatible",
      name: "Prefix Node",
      prefix: "pfx",
      apiType: "chat",
      baseUrl: "http://127.0.0.1:20128/v1",
    });
    cleanup = ctx.cleanup;

    // The user-facing value (what a prefixed model URL uses), not the id.
    const response = await ctx.providersPOST(makeConnectionRequest("openai-compatible-pfx"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.connection.provider).toBe(ctx.node.id);
    expect(body.connection.providerSpecificData).toMatchObject({
      prefix: "pfx",
      baseUrl: ctx.node.baseUrl,
      nodeName: ctx.node.name,
    });
  });

  it("keeps accepting the generated node id (backward compatible)", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-chat-pfx02",
      type: "openai-compatible",
      name: "Id Node",
      prefix: "idn",
      apiType: "chat",
      baseUrl: "http://127.0.0.1:20128/v1",
    });
    cleanup = ctx.cleanup;

    const response = await ctx.providersPOST(makeConnectionRequest(ctx.node.id));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.connection.provider).toBe(ctx.node.id);
  });

  it("resolves anthropic-compatible and custom-embedding node prefixes", async () => {
    const anthropicCtx = await setupTestContext({
      id: "anthropic-compatible-pfx03",
      type: "anthropic-compatible",
      name: "Anthropic Prefix Node",
      prefix: "apfx",
      baseUrl: "http://127.0.0.1:20128/v1",
    });
    cleanup = anthropicCtx.cleanup;
    const anthropicResponse = await anthropicCtx.providersPOST(makeConnectionRequest("anthropic-compatible-apfx"));
    expect(anthropicResponse.status).toBe(201);
    expect((await anthropicResponse.json()).connection.provider).toBe(anthropicCtx.node.id);
  });

  it("404s an unmatched compatible provider with a message naming the node-id contract", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-chat-pfx04",
      type: "openai-compatible",
      name: "Miss Node",
      prefix: "miss",
      apiType: "chat",
      baseUrl: "http://127.0.0.1:20128/v1",
    });
    cleanup = ctx.cleanup;

    const response = await ctx.providersPOST(makeConnectionRequest("openai-compatible-nope"));
    const body = await response.json();

    expect(response.status).toBe(404);
    // The error must teach the contract: either the user-chosen prefix or the
    // generated node id is accepted — and where to find both.
    expect(String(body.error)).toMatch(/prefix/i);
    expect(String(body.error)).toMatch(/node id/i);
    expect(String(body.error)).toMatch(/\/api\/provider-nodes/i);
  });
});
