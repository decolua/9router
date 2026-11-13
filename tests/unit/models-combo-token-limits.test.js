import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

import { buildModelsList, getComboTokenLimits } from "@/app/api/v1/models/route.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue({});
});

describe("combo token limits", () => {
  it("publishes the minimum safe limits across every combo target", () => {
    const concreteModels = new Map([
      ["cx/gpt-5.6-sol", { context_length: 372000, max_completion_tokens: 128000 }],
      ["cc/claude-opus-5", { context_length: 1000000, max_completion_tokens: 128000 }],
      ["dev/anthropic/gateway/devworld--opus-5", { context_length: 200000, max_completion_tokens: 64000 }],
    ]);

    expect(getComboTokenLimits([
      "cx/gpt-5.6-sol",
      "cc/claude-opus-5",
      "dev/anthropic/gateway/devworld--opus-5",
    ], concreteModels)).toEqual({
      context_length: 200000,
      max_completion_tokens: 64000,
    });
  });

  it("uses the capability fallback for a target omitted from the visible catalog", () => {
    const resolveFallback = vi.fn(() => ({
      context_length: 200000,
      max_completion_tokens: 64000,
    }));

    expect(getComboTokenLimits([
      "dev/openai/gateway/devworld--gpt-5.6-sol-max",
    ], new Map(), resolveFallback)).toEqual({
      context_length: 200000,
      max_completion_tokens: 64000,
    });
    expect(resolveFallback).toHaveBeenCalledWith("dev/openai/gateway/devworld--gpt-5.6-sol-max");
  });

  it("omits limits when any combo target cannot be resolved safely", () => {
    expect(getComboTokenLimits([
      "cx/gpt-5.6-sol",
      "missing/model",
    ], new Map([
      ["cx/gpt-5.6-sol", { context_length: 372000, max_completion_tokens: 128000 }],
    ]))).toEqual({});
  });

  it("enriches the combo entry returned by the OpenAI models catalog", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        provider: "codex",
        isActive: true,
        providerSpecificData: {
          prefix: "cx",
          enabledModels: ["gpt-5.6-sol"],
        },
      },
      {
        provider: "anthropic-compatible",
        isActive: true,
        providerSpecificData: {
          prefix: "dev",
          enabledModels: ["anthropic/gateway/devworld--opus-5"],
        },
      },
    ]);
    mocks.getCombos.mockResolvedValue([{
      name: "deep-review",
      kind: "llm",
      models: [
        "cx/gpt-5.6-sol",
        "dev/anthropic/gateway/devworld--opus-5",
      ],
    }]);

    const catalog = await buildModelsList(["llm"]);
    expect(catalog.find((model) => model.id === "deep-review")).toEqual({
      id: "deep-review",
      object: "model",
      owned_by: "combo",
      context_length: 200000,
      max_completion_tokens: 64000,
    });
  });
});
