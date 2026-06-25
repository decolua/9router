import { describe, it, expect } from "vitest";
import { parseModel } from "../../open-sse/services/model.js";

describe("HuggingFace model alias parsing", () => {
  it("resolves hf alias to huggingface provider", () => {
    expect(parseModel("hf/black-forest-labs/FLUX.1-schnell")).toMatchObject({
      provider: "huggingface",
      model: "black-forest-labs/FLUX.1-schnell",
      providerAlias: "hf",
    });
  });
});
