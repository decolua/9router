import { describe, expect, it } from "vitest";
import { createComboCapsResolver } from "../../src/lib/comboCaps.js";

describe("combo custom-model context overrides", () => {
  it("applies an alias-stored override when the model uses the provider ID", () => {
    const getCaps = createComboCapsResolver([{
      providerAlias: "cx",
      id: "gpt-5.6-sol",
      type: "llm",
      caps: { contextWindow: 123456 },
    }]);

    expect(getCaps("codex/gpt-5.6-sol").contextWindow).toBe(123456);
  });

  it("uses overrides stored under a compatible-provider prefix", () => {
    const getCaps = createComboCapsResolver([{
      providerAlias: "acme",
      id: "model-a",
      type: "llm",
      caps: { contextWindow: 654321 },
    }], [{
      provider: "openai-compatible",
      providerSpecificData: { prefix: "acme" },
    }]);

    expect(getCaps("acme/model-a").contextWindow).toBe(654321);
  });

  it("resolves bare user model aliases before computing caps", () => {
    const getCaps = createComboCapsResolver(
      [{ providerAlias: "glm", id: "glm-5.3-flash", type: "llm", caps: { contextWindow: 111111 } }],
      [],
      { "my-probe-alias": "glm/glm-5.3-flash" },
    );

    expect(getCaps("my-probe-alias").contextWindow).toBe(111111);
  });

  it("normalizes registry secondary aliases like the request router", () => {
    const getCaps = createComboCapsResolver([{
      providerAlias: "kimi",
      id: "kimi-k2.5",
      type: "llm",
      caps: { contextWindow: 131072 },
    }]);

    expect(getCaps("kmc/kimi-k2.5").contextWindow).toBe(131072);
  });

  it("ignores media metadata with the same provider and model ID", () => {
    const base = createComboCapsResolver([])("cx/gpt-5.6-sol");
    const withImageMetadata = createComboCapsResolver([{
      providerAlias: "cx",
      id: "gpt-5.6-sol",
      type: "image",
      caps: { contextWindow: 1 },
    }])("cx/gpt-5.6-sol");

    expect(withImageMetadata).toEqual(base);
  });
});
