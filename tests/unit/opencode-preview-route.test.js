import { beforeEach, describe, expect, it, vi } from "vitest";

const getOpenCodePreferences = vi.fn();

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
}));

vi.mock("@/lib/opencodeSync/generator.js", async () => {
  const actual = await vi.importActual("../../src/lib/opencodeSync/generator.js");
  return actual;
});

vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {
    opencode: {
      modelsFetcher: {
        url: "https://opencode.ai/zen/v1/models",
      },
    },
  },
}));

let GET;

describe("/api/opencode/bundle/preview", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    const mod = await import("../../src/app/api/opencode/bundle/preview/route.js");
    GET = mod.GET;
  });

  it("returns generated preview payload with sync plugin present", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "openai/gpt-4.1-free",
      excludedModels: ["anthropic/claude-3.7-sonnet-free"],
      customPlugins: ["team-plugin@latest"],
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "openai/gpt-4.1-free" },
          { id: "anthropic/claude-3.7-sonnet-free" },
          { id: "openai/gpt-4.1" },
        ],
      }),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.bundle.plugins).toContain("opencode-cliproxyapi-sync@latest");
    expect(response.body.bundle.plugins).toContain("team-plugin@latest");
    expect(response.body.preview.plugins).toContain("opencode-cliproxyapi-sync@latest");
    expect(response.body.bundle.defaultModel).toBe("openai/gpt-4.1-free");
    expect(Object.keys(response.body.bundle.models)).toEqual(["openai/gpt-4.1-free"]);
  });

  it("supports object-shaped catalogs and preserves model metadata", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "openai/gpt-4.1-free",
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          "openai/gpt-4.1-free": {
            id: "openai/gpt-4.1-free",
            name: "GPT-4.1 Free",
            provider: "openai",
            contextWindow: 128000,
            tags: ["free", "chat"],
          },
          "openai/gpt-4.1": {
            id: "openai/gpt-4.1",
            name: "GPT-4.1",
          },
        },
      }),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.bundle.models).toEqual({
      "openai/gpt-4.1-free": {
        id: "openai/gpt-4.1-free",
        name: "GPT-4.1 Free",
        provider: "openai",
        contextWindow: 128000,
        tags: ["free", "chat"],
      },
    });
  });

  it("returns 500 when the catalog fetch fails", async () => {
    getOpenCodePreferences.mockResolvedValue({ variant: "openagent" });

    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to generate OpenCode bundle preview" });
  });

  it("returns 400 when preview generation rejects an invalid default model", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "anthropic/claude-3.7-sonnet-free",
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "openai/gpt-4.1-free", name: "GPT-4.1 Free", provider: "openai" },
        ],
      }),
    });

    const response = await GET();

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Default model must be included in generated bundle models",
    });
  });
});
