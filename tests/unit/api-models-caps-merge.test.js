import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getCapsOverrides: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.jsonResponse },
}));

vi.mock("@/models", () => ({
  getModelAliases: mocks.getModelAliases,
  setModelAlias: vi.fn(),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

vi.mock("@/lib/db/index.js", () => ({
  getCapsOverrides: mocks.getCapsOverrides,
}));

const { GET } = await import("../../src/app/api/models/route.js");

describe("GET /api/models — caps overrides merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getCapsOverrides.mockResolvedValue({});
  });

  it("applies overrides on top of static caps and flags the model", async () => {
    mocks.getCapsOverrides.mockResolvedValue({
      "openai|gpt-4o": { contextWindow: 999000, vision: false, imageOutput: true },
    });

    const response = await GET();
    const model = response.body.models.find((m) => m.provider === "openai" && m.model === "gpt-4o");
    expect(model).toBeTruthy();

    // Override wins (both value override and explicit false)
    expect(model.caps.contextWindow).toBe(999000);
    expect(model.caps.vision).toBe(false);
    // Override adds fields missing from static caps
    expect(model.caps.imageOutput).toBe(true);
    // Static caps kept where the override is silent
    expect(model.caps.search).toBe(true);
    expect(model.caps.maxOutput).toBe(16384);
    expect(model.capsOverridden).toBe(true);
  });

  it("keeps static caps without capsOverridden flag when no override exists", async () => {
    const response = await GET();
    const model = response.body.models.find((m) => m.provider === "openai" && m.model === "gpt-4o");
    expect(model).toBeTruthy();

    expect(model.caps.contextWindow).toBe(128000);
    expect(model.caps.vision).toBe(true);
    expect(model.capsOverridden).toBeUndefined();
  });

  it("excludes disabled models", async () => {
    mocks.getDisabledModels.mockResolvedValue({ openai: ["gpt-4o"] });

    const response = await GET();
    expect(response.body.models.some((m) => m.provider === "openai" && m.model === "gpt-4o")).toBe(false);
  });
});
