import { beforeEach, describe, expect, it, vi } from "vitest";

const getOpenCodePreferences = vi.fn();
const listOpenCodeTokens = vi.fn();

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
}));

vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {
    opencode: {
      modelsFetcher: {
        url: "https://example.test/models",
      },
    },
  },
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-4o-mini-free", name: "GPT-4o mini free" }],
        }),
      })
    );

    const response = await GET(
      new Request("http://localhost/api/opencode/sync/bundle", {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      revision: expect.any(String),
      hash: expect.any(String),
      generatedAt: expect.any(String),
      schemaVersion: 1,
      bundle: {
        variant: "openagent",
        defaultModel: "gpt-4o-mini-free",
        modelSelectionMode: "include",
        plugins: expect.any(Array),
        models: {
          "gpt-4o-mini-free": {
            id: "gpt-4o-mini-free",
            name: "GPT-4o mini free",
          },
        },
      },
    });
  });
});
