import { beforeEach, describe, expect, it, vi } from "vitest";

const getOpenCodePreferences = vi.fn();
const listOpenCodeTokens = vi.fn();
const touchOpenCodeTokenLastUsedAt = vi.fn();
const load9RouterModelCatalog = vi.fn();

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/models", () => ({
  getOpenCodePreferences,
  listOpenCodeTokens,
  touchOpenCodeTokenLastUsedAt,
}));

vi.mock("@/lib/opencodeSync/modelCatalog.js", () => ({
  load9RouterModelCatalog,
}));

vi.mock("@/lib/opencodeSync/tokens.js", async () => {
  const actual = await vi.importActual("../../src/lib/opencodeSync/tokens.js");
  return actual;
});

vi.mock("@/lib/opencodeSync/generator.js", async () => {
  const actual = await vi.importActual("../../src/lib/opencodeSync/generator.js");
  return actual;
});

let GET;
let createSyncToken;

const preferences = {
  variant: "openagent",
  customTemplate: "",
  defaultModel: "gpt-4o-mini-free",
  modelSelectionMode: "include",
  includedModels: ["gpt-4o-mini-free"],
  excludedModels: [],
  customPlugins: [],
  mcpServers: {},
  envVars: {},
  advancedOverrides: {},
};

describe("/api/opencode/sync/bundle", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    ({ createSyncToken } = await import("../../src/lib/opencodeSync/tokens.js"));
    const mod = await import("../../src/app/api/opencode/sync/bundle/route.js");
    GET = mod.GET;
  });

  it("returns 401 when auth is missing", async () => {
    listOpenCodeTokens.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost/api/opencode/sync/bundle"));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when auth token is invalid", async () => {
    const { record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: "Bearer ocs_invalid" },
      })
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("returns full sync bundle when auth token is valid", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    getOpenCodePreferences.mockResolvedValue(preferences);
    load9RouterModelCatalog.mockResolvedValue({
      "gpt-4o-mini-free": { id: "gpt-4o-mini-free", name: "GPT-4o mini free" },
    });

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.version).toEqual(expect.any(String));
    expect(response.body.opencode).toEqual(expect.any(Object));
    expect(response.body.opencode.plugin).toEqual([
      "opencode-9router-sync@latest",
      "oh-my-openagent@latest",
    ]);
    expect(response.body.opencode.provider).toHaveProperty("9router");
    expect(response.body.opencode.provider["9router"]).toEqual(
      expect.objectContaining({
        npm: "@ai-sdk/openai-compatible",
        name: "9Router",
        options: {
          baseURL: expect.any(String),
          apiKey: expect.any(String),
        },
      })
    );
    expect(response.body.opencode.model).toBe("9router/gpt-4o-mini-free");
    expect(response.body.ohMyOpencode).toEqual(expect.any(Object));
    expect(response.body.ohMyOpenCodeSlim).toBeNull();
    expect(response.body.opencode).not.toHaveProperty("models");
    expect(response.body).not.toHaveProperty("bundle");
    expect(response.body).not.toHaveProperty("hash");
    expect(response.body).not.toHaveProperty("revision");
    expect(response.body).not.toHaveProperty("generatedAt");
    expect(response.body).not.toHaveProperty("schemaVersion");
    expect(touchOpenCodeTokenLastUsedAt).toHaveBeenCalledWith(record.id);
  });

  it("preserves string local MCP commands in sync bundle artifacts", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    getOpenCodePreferences.mockResolvedValue({
      ...preferences,
      mcpServers: [{ name: "docs", type: "local", command: "npx -y @modelcontextprotocol/server-filesystem" }],
    });
    load9RouterModelCatalog.mockResolvedValue({
      "gpt-4o-mini-free": { id: "gpt-4o-mini-free", name: "GPT-4o mini free" },
    });

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.opencode.mcp).toEqual({
      docs: {
        type: "local",
        command: "npx -y @modelcontextprotocol/server-filesystem",
      },
    });
  });

  it("redacts secret-like advanced overrides from sync public artifacts", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    getOpenCodePreferences.mockResolvedValue({
      ...preferences,
      advancedOverrides: {
        openagent: {
          headers: {
            authorization: "Bearer super-secret-token",
          },
        },
      },
    });
    load9RouterModelCatalog.mockResolvedValue({
      "gpt-4o-mini-free": { id: "gpt-4o-mini-free", name: "GPT-4o mini free" },
    });

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.ohMyOpencode).toMatchObject({
      headers: {
        authorization: "********",
      },
    });
  });

  it("supports object-shaped model catalogs using map keys for filtering", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    getOpenCodePreferences.mockResolvedValue(preferences);
    load9RouterModelCatalog.mockResolvedValue({
      "gpt-4o-mini-free": { id: "gpt-4o-mini-free", name: "GPT-4o mini free" },
      "gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
    });

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.opencode.provider["9router"].models).toEqual({
      "gpt-4o-mini-free": {
        name: "gpt-4o-mini-free",
        attachment: true,
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 400000,
          output: 128000,
        },
      },
    });
  });

  it("ignores name-only catalog entries when building the sync bundle", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    getOpenCodePreferences.mockResolvedValue(preferences);
    load9RouterModelCatalog.mockResolvedValue([
      { name: "gpt-4o-mini-free" },
      { id: "gpt-4o-mini-free", name: "GPT-4o mini free" },
    ]);

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.opencode.provider["9router"].models).toEqual({
      "gpt-4o-mini-free": {
        name: "gpt-4o-mini-free",
        attachment: true,
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 400000,
          output: 128000,
        },
      },
    });
    expect(Object.keys(response.body.opencode.provider["9router"].models)).toEqual(["gpt-4o-mini-free"]);
  });

  it("returns the same public version when only non-public metadata changes", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    load9RouterModelCatalog.mockResolvedValue({
      "gpt-4o-mini-free": { id: "gpt-4o-mini-free", name: "GPT-4o mini free" },
    });

    getOpenCodePreferences.mockResolvedValueOnce({
      ...preferences,
      updatedAt: "2026-04-21T10:00:00.000Z",
    });
    const first = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    getOpenCodePreferences.mockResolvedValueOnce({
      ...preferences,
      updatedAt: "2026-04-21T11:00:00.000Z",
    });
    const second = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(second.status).toBe(200);
    expect(second.body.version).toBe(first.body.version);
  });

  it("allows same model slugs across providers because provider-prefixed ids are preserved", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    getOpenCodePreferences.mockResolvedValue({
      ...preferences,
      defaultModel: null,
      includedModels: ["openai/gpt-4o-mini-free", "anthropic/gpt-4o-mini-free"],
    });
    load9RouterModelCatalog.mockResolvedValue({
      "openai/gpt-4o-mini-free": { id: "openai/gpt-4o-mini-free", name: "GPT-4o mini free (OpenAI)" },
      "anthropic/gpt-4o-mini-free": { id: "anthropic/gpt-4o-mini-free", name: "GPT-4o mini free (Anthropic)" },
    });

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.opencode.provider["9router"].models).toHaveProperty("openai/gpt-4o-mini-free");
    expect(response.body.opencode.provider["9router"].models).toHaveProperty("anthropic/gpt-4o-mini-free");
  });

  it("returns 500 when loading the 9router catalog fails", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    getOpenCodePreferences.mockResolvedValue(preferences);
    load9RouterModelCatalog.mockRejectedValue(new Error("boom"));

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to generate OpenCode sync bundle" });
    expect(touchOpenCodeTokenLastUsedAt).not.toHaveBeenCalled();
  });

  it("returns 400 for authenticated validation errors only", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    getOpenCodePreferences.mockResolvedValue({
      ...preferences,
      mcpServers: [{ name: "Remote", type: "remote", url: "ftp://example.test/mcp" }],
    });
    load9RouterModelCatalog.mockResolvedValue({
      "gpt-4o-mini-free": { id: "gpt-4o-mini-free", name: "GPT-4o mini free" },
    });

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid MCP server URL for Remote" });
    expect(touchOpenCodeTokenLastUsedAt).not.toHaveBeenCalled();
  });

  it("returns bundle even when token lastUsedAt update fails", async () => {
    const { token, record } = createSyncToken({ name: "Device", mode: "device" });
    listOpenCodeTokens.mockResolvedValue([record]);
    getOpenCodePreferences.mockResolvedValue(preferences);
    touchOpenCodeTokenLastUsedAt.mockRejectedValue(new Error("db write failed"));
    load9RouterModelCatalog.mockResolvedValue({
      "gpt-4o-mini-free": { id: "gpt-4o-mini-free", name: "GPT-4o mini free" },
    });

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.opencode.model).toBe("9router/gpt-4o-mini-free");
  });
});
