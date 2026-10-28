import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupTestContext(nodeData) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-compatible-provider-"));
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

  const { POST } = await import("@/app/api/providers/route.js");
  const { POST: createProviderNodeRoute } = await import("@/app/api/provider-nodes/route.js");
  const {
    createProviderNode,
    getProviderConnections,
    getProviderNodeById,
  } = await import("@/models/index.js");

  const node = nodeData ? await createProviderNode(nodeData) : null;

  return {
    node,
    POST,
    createProviderNodeRoute,
    getProviderConnections,
    getProviderNodeById,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function makeNodeRequest(data) {
  return new Request("https://9router.local/api/provider-nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

function makeRequest(provider, name = "Test Connection") {
  return new Request("https://9router.local/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      apiKey: "test-key",
      name,
      defaultModel: "test-model",
    }),
  });
}

function expectCompatibleConnection(connection, node, { apiType } = {}) {
  expect(connection.provider).toBe(node.id);
  expect(connection.authType).toBe("apikey");
  expect(connection.defaultModel).toBe("test-model");
  expect(connection.providerSpecificData).toMatchObject({
    prefix: node.prefix,
    baseUrl: node.baseUrl,
    nodeName: node.name,
  });

  if (apiType !== undefined) {
    expect(connection.providerSpecificData.apiType).toBe(apiType);
  }
}

describe("compatible provider connections API", () => {
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

  it("creates one API-key connection for an OpenAI-compatible node", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-test",
      type: "openai-compatible",
      name: "OpenAI Compatible Test Node",
      prefix: "oct",
      apiType: "chat",
      baseUrl: "https://openai-compatible.test/v1",
    });
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest(ctx.node.id));
    const body = await response.json();
    const connection = body.connection;
    const storedConnections = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(201);
    expect(storedConnections).toHaveLength(1);
    expectCompatibleConnection(connection, ctx.node, { apiType: "chat" });
    expect(storedConnections[0]).toMatchObject({
      provider: ctx.node.id,
      authType: "apikey",
      defaultModel: "test-model",
      providerSpecificData: {
        prefix: ctx.node.prefix,
        apiType: "chat",
        baseUrl: ctx.node.baseUrl,
        nodeName: ctx.node.name,
      },
    });
  });

  it("creates one API-key connection for an Anthropic-compatible node", async () => {
    const ctx = await setupTestContext({
      id: "anthropic-compatible-test",
      type: "anthropic-compatible",
      name: "Anthropic Compatible Test Node",
      prefix: "act",
      baseUrl: "https://anthropic-compatible.test/v1",
    });
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest(ctx.node.id));
    const body = await response.json();
    const connection = body.connection;
    const storedConnections = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(201);
    expect(storedConnections).toHaveLength(1);
    expectCompatibleConnection(connection, ctx.node);
    expect(storedConnections[0]).toMatchObject({
      provider: ctx.node.id,
      authType: "apikey",
      defaultModel: "test-model",
      providerSpecificData: {
        prefix: ctx.node.prefix,
        baseUrl: ctx.node.baseUrl,
        nodeName: ctx.node.name,
      },
    });
  });

  it("allows multiple connections on the same compatible node", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-multiple-test",
      type: "openai-compatible",
      name: "Multiple Connections Node",
      prefix: "mul",
      apiType: "chat",
      baseUrl: "https://multiple-connections.test/v1",
    });
    cleanup = ctx.cleanup;

    const firstResponse = await ctx.POST(makeRequest(ctx.node.id, "Key A"));
    const secondResponse = await ctx.POST(makeRequest(ctx.node.id, "Key B"));
    const storedConnections = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(storedConnections).toHaveLength(2);
    expectCompatibleConnection(storedConnections[0], ctx.node, { apiType: "chat" });
    expectCompatibleConnection(storedConnections[1], ctx.node, { apiType: "chat" });
  });

  it("creates compatible provider IDs with optional suffixes and the UUID fallback", async () => {
    const ctx = await setupTestContext();
    cleanup = ctx.cleanup;

    const chatResponse = await ctx.createProviderNodeRoute(makeNodeRequest({
      type: "openai-compatible",
      apiType: "chat",
      name: "OpenAI Chat",
      prefix: "oc",
      baseUrl: "https://openai-chat.test/v1",
      providerIdSuffix: "  Team.Proxy_1-Prod  ",
    }));
    const chatBody = await chatResponse.json();
    expect(chatResponse.status).toBe(201);
    expect(chatBody.node.id).toBe("openai-compatible-chat-Team.Proxy_1-Prod");

    const connectionResponse = await ctx.POST(makeRequest(chatBody.node.id));
    const connectionBody = await connectionResponse.json();
    expect(connectionResponse.status).toBe(201);
    expect(connectionBody.connection.provider).toBe(chatBody.node.id);
    expect(connectionBody.connection.providerSpecificData.apiType).toBe("chat");

    const responsesResponse = await ctx.createProviderNodeRoute(makeNodeRequest({
      type: "openai-compatible",
      apiType: "responses",
      name: "OpenAI Responses",
      prefix: "or",
      baseUrl: "https://openai-responses.test/v1",
      providerIdSuffix: "responses_node",
    }));
    const responsesBody = await responsesResponse.json();
    expect(responsesResponse.status).toBe(201);
    expect(responsesBody.node.id).toBe("openai-compatible-responses-responses_node");

    const anthropicResponse = await ctx.createProviderNodeRoute(makeNodeRequest({
      type: "anthropic-compatible",
      name: "Anthropic",
      prefix: "ac",
      baseUrl: "https://anthropic.test/v1",
      providerIdSuffix: "ac-prod",
    }));
    const anthropicBody = await anthropicResponse.json();
    expect(anthropicResponse.status).toBe(201);
    expect(anthropicBody.node.id).toBe("anthropic-compatible-ac-prod");

    for (const providerIdSuffix of [undefined, "", "   "]) {
      const fallbackResponse = await ctx.createProviderNodeRoute(makeNodeRequest({
        type: "openai-compatible",
        apiType: "chat",
        name: "OpenAI Fallback",
        prefix: "fallback",
        baseUrl: "https://fallback.test/v1",
        ...(providerIdSuffix === undefined ? {} : { providerIdSuffix }),
      }));
      const fallbackBody = await fallbackResponse.json();
      expect(fallbackResponse.status).toBe(201);
      expect(fallbackBody.node.id).toMatch(
        /^openai-compatible-chat-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
      );
    }
  });

  it("rejects invalid and duplicate suffixes without overwriting a node", async () => {
    const ctx = await setupTestContext();
    cleanup = ctx.cleanup;

    const original = {
      type: "openai-compatible",
      apiType: "chat",
      name: "Original",
      prefix: "original",
      baseUrl: "https://original.test/v1",
      providerIdSuffix: "shared",
    };
    const firstResponse = await ctx.createProviderNodeRoute(makeNodeRequest(original));
    expect(firstResponse.status).toBe(201);

    const invalidResponse = await ctx.createProviderNodeRoute(makeNodeRequest({
      ...original,
      providerIdSuffix: "invalid/suffix",
    }));
    expect(invalidResponse.status).toBe(400);

    const duplicateResponse = await ctx.createProviderNodeRoute(makeNodeRequest({
      ...original,
      name: "Replacement",
      prefix: "replacement",
      baseUrl: "https://replacement.test/v1",
    }));
    expect(duplicateResponse.status).toBe(409);

    const storedNode = await ctx.getProviderNodeById("openai-compatible-chat-shared");
    expect(storedNode).toMatchObject({
      name: "Original",
      prefix: "original",
      baseUrl: "https://original.test/v1",
    });
  });
});
