import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCapabilitiesForModel: vi.fn(() => ({ contextWindow: 200000 })) }));
vi.mock("open-sse/providers/capabilities.js", () => mocks);

const { createComboCapsResolver } = await import("../../src/lib/comboCaps.js");

describe("combo compatible-provider prefixes", () => {
  beforeEach(() => mocks.getCapabilitiesForModel.mockClear());

  it("does not let a custom connection shadow a built-in provider alias", () => {
    const getCaps = createComboCapsResolver([], [{
      provider: "openai-compatible",
      providerSpecificData: { prefix: "cx" },
    }]);

    getCaps("cx/model-a");

    expect(mocks.getCapabilitiesForModel).toHaveBeenCalledWith("codex", "model-a");
  });
});
