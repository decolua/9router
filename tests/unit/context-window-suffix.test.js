import { describe, it, expect } from "vitest";
import {
  stripContextWindowSuffix,
  parseModel,
} from "../../open-sse/services/model.js";
import { getComboModelsFromData } from "../../open-sse/services/combo.js";

describe("stripContextWindowSuffix", () => {
  it("strips [1m] / [200k] / [500k] / [100k]", () => {
    expect(stripContextWindowSuffix("my-glm52[1m]")).toBe("my-glm52");
    expect(stripContextWindowSuffix("my-glm52[500k]")).toBe("my-glm52");
    expect(stripContextWindowSuffix("my-glm52[200k]")).toBe("my-glm52");
    expect(stripContextWindowSuffix("my-glm52[100k]")).toBe("my-glm52");
    expect(stripContextWindowSuffix("my-glm52[1M]")).toBe("my-glm52");
    expect(stripContextWindowSuffix("my-glm52[500K]")).toBe("my-glm52");
  });

  it("strips from provider/model form", () => {
    expect(stripContextWindowSuffix("ollama/glm-5.2[500k]")).toBe("ollama/glm-5.2");
    expect(stripContextWindowSuffix("glm/glm-5.2[1m]")).toBe("glm/glm-5.2");
  });

  it("leaves bare names and non-context brackets alone", () => {
    expect(stripContextWindowSuffix("my-glm52")).toBe("my-glm52");
    expect(stripContextWindowSuffix("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    // non-numeric / non-unit brackets stay
    expect(stripContextWindowSuffix("model[beta]")).toBe("model[beta]");
    expect(stripContextWindowSuffix("model[v2]")).toBe("model[v2]");
  });

  it("handles null/non-string", () => {
    expect(stripContextWindowSuffix(null)).toBe(null);
    expect(stripContextWindowSuffix(undefined)).toBe(undefined);
    expect(stripContextWindowSuffix(42)).toBe(42);
  });
});

describe("parseModel strips context suffix", () => {
  it("combo alias: my-glm52[500k] → alias my-glm52", () => {
    const p = parseModel("my-glm52[500k]");
    expect(p.isAlias).toBe(true);
    expect(p.model).toBe("my-glm52");
    expect(p.provider).toBe(null);
  });

  it("provider/model: ollama/glm-5.2[1m] → provider ollama, model glm-5.2", () => {
    const p = parseModel("ollama/glm-5.2[1m]");
    expect(p.isAlias).toBe(false);
    expect(p.provider).toBe("ollama");
    expect(p.model).toBe("glm-5.2");
  });
});

describe("getComboModelsFromData strips context suffix", () => {
  const combos = [
    { name: "my-glm52", models: ["ollama/glm-5.2", "glm/glm-5.2"] },
  ];

  it("hits combo when client appends [500k]", () => {
    expect(getComboModelsFromData("my-glm52[500k]", combos)).toEqual([
      "ollama/glm-5.2",
      "glm/glm-5.2",
    ]);
  });

  it("hits combo when client appends [1m]", () => {
    expect(getComboModelsFromData("my-glm52[1m]", combos)).toEqual([
      "ollama/glm-5.2",
      "glm/glm-5.2",
    ]);
  });

  it("still hits bare name", () => {
    expect(getComboModelsFromData("my-glm52", combos)).toEqual([
      "ollama/glm-5.2",
      "glm/glm-5.2",
    ]);
  });

  it("returns null for unknown", () => {
    expect(getComboModelsFromData("nope[500k]", combos)).toBe(null);
  });
});
