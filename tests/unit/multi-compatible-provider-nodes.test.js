import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-multi-provider-"));
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
  vi.doMock("@/dashboardGuard", () => ({ isLocalRequest: () => true }));

  const { POST } = await import("@/app/api/provider-nodes/route.js");
  const { PUT } = await import("@/app/api/provider-nodes/[id]/route.js");
  const { POST: validate } = await import("@/app/api/provider-nodes/validate/route.js");
  const { POST: createConnection } = await import("@/app/api/providers/route.js");
  const { getProviderConnections } = await import("@/models/index.js");
  return {
    POST,
    PUT,
    validate,
    createConnection,
    getProviderConnections,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function makeRequest(overrides = {}) {
  return new Request("https://9router.local/api/provider-nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "multi-compatible",
      name: "Multi API",
      prefix: "multi",
      openaiUrl: "https://multi.test/v1/chat/completions/",
      anthropicUrl: "https://multi.test/v1/messages/",
      supportsResponses: true,
      ...overrides,
    }),
  });
}

describe("multi-protocol compatible provider nodes", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("next/server");
    vi.doUnmock("@/dashboardGuard");
    vi.resetModules();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("creates native transports for each configured endpoint", async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest());
    const { node } = await response.json();

    expect(response.status).toBe(201);
    expect(node.type).toBe("multi-compatible");
    expect(node.id).toMatch(/^openai-compatible-multi-/);
    expect(node.apiType).toBe("chat");
    expect(node.baseUrl).toBe("https://multi.test/v1");
    expect(node.transports).toEqual([
      {
        format: "openai",
        baseUrl: "https://multi.test/v1/chat/completions",
        auth: { combined: true, header: "Authorization", scheme: "bearer" },
      },
      {
        format: "claude",
        baseUrl: "https://multi.test/v1/messages",
        auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true },
      },
      {
        format: "openai-responses",
        baseUrl: "https://multi.test/v1/responses",
        auth: { combined: true, header: "Authorization", scheme: "bearer" },
      },
    ]);
  });

  it("accepts base URLs and stores full endpoint URLs", async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest({
      openaiUrl: "https://multi.test/v1/",
      anthropicUrl: "https://multi.test/v1/",
      supportsResponses: true,
    }));
    const { node } = await response.json();

    expect(response.status).toBe(201);
    expect(node.baseUrl).toBe("https://multi.test/v1");
    expect(node.transports.map((transport) => transport.baseUrl)).toEqual([
      "https://multi.test/v1/chat/completions",
      "https://multi.test/v1/messages",
      "https://multi.test/v1/responses",
    ]);
  });

  it("omits the optional Responses transport when support is not confirmed", async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest({ supportsResponses: false }));
    const { node } = await response.json();

    expect(response.status).toBe(201);
    expect(node.transports.map((transport) => transport.format)).toEqual(["openai", "claude"]);
  });

  it("updates endpoint transports on existing connections", async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;

    const createResponse = await ctx.POST(makeRequest({ responsesUrl: "" }));
    const { node } = await createResponse.json();
    await ctx.createConnection(new Request("https://9router.local/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: node.id, apiKey: "test-key", name: "Connection" }),
    }));

    const updateResponse = await ctx.PUT(new Request(`https://9router.local/api/provider-nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Multi API",
        prefix: "multi",
        openaiUrl: "https://new.test/v1",
        anthropicUrl: "https://new.test/v1/messages",
        supportsResponses: true,
      }),
    }), { params: Promise.resolve({ id: node.id }) });
    const connections = await ctx.getProviderConnections({ provider: node.id });

    expect(updateResponse.status).toBe(200);
    expect(connections[0].providerSpecificData.transports.map((transport) => transport.baseUrl)).toEqual([
      "https://new.test/v1/chat/completions",
      "https://new.test/v1/messages",
      "https://new.test/v1/responses",
    ]);
  });

  it("validates each configured protocol endpoint", async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "chatcmpl-test" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "msg_test" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "resp_test" }), { status: 200 }));

    const response = await ctx.validate(new Request("https://9router.local/api/provider-nodes/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "multi-compatible",
        apiKey: "test-key",
        modelId: "shared-model",
        openaiUrl: "https://multi.test/v1",
        anthropicUrl: "https://multi.test/v1",
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      valid: true,
      supportsResponses: true,
      endpoints: { openai: true, claude: true, "openai-responses": true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://multi.test/v1/chat/completions",
      "https://multi.test/v1/messages",
      "https://multi.test/v1/responses",
    ]);
  });

  it("keeps the provider valid when Responses is unsupported", async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));

    const response = await ctx.validate(new Request("https://9router.local/api/provider-nodes/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "multi-compatible",
        apiKey: "test-key",
        modelId: "shared-model",
        openaiUrl: "https://multi.test/v1",
        anthropicUrl: "https://multi.test/v1",
      }),
    }));
    const body = await response.json();

    expect(body).toEqual({
      valid: true,
      supportsResponses: false,
      endpoints: { openai: true, claude: true, "openai-responses": false },
    });
  });

  it("requires Chat Completions and Messages endpoint URLs", async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;

    const missingChat = await ctx.POST(makeRequest({ openaiUrl: "" }));
    const missingMessages = await ctx.POST(makeRequest({ anthropicUrl: "" }));

    expect(missingChat.status).toBe(400);
    expect(missingMessages.status).toBe(400);
  });
});
