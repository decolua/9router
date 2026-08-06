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
  const {
    createProviderNode,
    getProviderConnections,
  } = await import("@/models/index.js");

  const node = await createProviderNode(nodeData);

  return {
    node,
    POST,
    getProviderConnections,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
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

  it("copies client identity settings from compatible node into its connection", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-identity-test",
      type: "openai-compatible",
      name: "Identity Test Node",
      prefix: "ident",
      apiType: "chat",
      baseUrl: "https://identity.test/v1",
      clientIdentityProfile: "custom",
      clientIdentityHeaders: {
        "User-Agent": "custom/1.0",
        "X-App": "cli",
      },
    });
    cleanup = ctx.cleanup;

    expect(ctx.node.clientIdentityProfile).toBe("custom");
    expect(ctx.node.clientIdentityHeaders).toEqual({
      "User-Agent": "custom/1.0",
      "X-App": "cli",
    });

    const response = await ctx.POST(makeRequest(ctx.node.id));
    const body = await response.json();
    const storedConnections = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(201);
    expect(body.connection.providerSpecificData).toMatchObject({
      clientIdentityProfile: "custom",
      clientIdentityHeaders: {
        "User-Agent": "custom/1.0",
        "X-App": "cli",
      },
    });
    expect(storedConnections[0].providerSpecificData).toMatchObject({
      clientIdentityProfile: "custom",
      clientIdentityHeaders: {
        "User-Agent": "custom/1.0",
        "X-App": "cli",
      },
    });
  });

  it("preserves and propagates existing client identity when updating a compatible node without identity fields", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-update-identity-test",
      type: "openai-compatible",
      name: "Identity Update Test Node",
      prefix: "ident",
      apiType: "chat",
      baseUrl: "https://identity.test/v1",
      clientIdentityProfile: "custom",
      clientIdentityHeaders: {
        "User-Agent": "custom/1.0",
      },
    });
    cleanup = ctx.cleanup;
    const createResponse = await ctx.POST(makeRequest(ctx.node.id));
    expect(createResponse.status).toBe(201);

    const { PUT } = await import("@/app/api/provider-nodes/[id]/route.js");
    const response = await PUT(new Request(`https://9router.local/api/provider-nodes/${ctx.node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Renamed Identity Node",
        prefix: "ident2",
        apiType: "responses",
        baseUrl: "https://identity-updated.test/v1",
      }),
    }), {
      params: Promise.resolve({ id: ctx.node.id }),
    });
    const body = await response.json();
    const storedConnections = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(200);
    expect(body.node).toMatchObject({
      clientIdentityProfile: "custom",
      clientIdentityHeaders: {
        "User-Agent": "custom/1.0",
      },
    });
    expect(storedConnections[0].providerSpecificData).toMatchObject({
      baseUrl: "https://identity-updated.test/v1",
      clientIdentityProfile: "custom",
      clientIdentityHeaders: {
        "User-Agent": "custom/1.0",
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
});
