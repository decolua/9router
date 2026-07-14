import { describe, expect, it } from "vitest";
import { getModelInfoCore } from "../../open-sse/services/model.js";

describe("model provider inference", () => {
  it("infers xai for unprefixed grok models", async () => {
    await expect(getModelInfoCore("grok-4.3", {})).resolves.toEqual({
      provider: "xai",
      model: "grok-4.3",
    });
    await expect(getModelInfoCore("grok-4.3-high", {})).resolves.toEqual({
      provider: "xai",
      model: "grok-4.3-high",
    });
    await expect(getModelInfoCore("grok-4.20-reasoning", {})).resolves.toEqual({
      provider: "xai",
      model: "grok-4.20-reasoning",
    });
  });

  it("keeps existing openai inference for gpt/o-series models", async () => {
    await expect(getModelInfoCore("gpt-5.4", {})).resolves.toEqual({
      provider: "openai",
      model: "gpt-5.4",
    });
    await expect(getModelInfoCore("o3", {})).resolves.toEqual({
      provider: "openai",
      model: "o3",
    });
  });
});
