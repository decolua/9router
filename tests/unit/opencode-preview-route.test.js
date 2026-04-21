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
});
