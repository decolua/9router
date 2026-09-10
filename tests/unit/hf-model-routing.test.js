import { describe, it, expect } from "vitest";
import { parseModel } from "../../open-sse/services/model.js";
import huggingface from "../../open-sse/providers/registry/huggingface.js";

describe("HuggingFace model alias parsing", () => {
  it("resolves hf alias to huggingface provider", () => {
    expect(parseModel("hf/black-forest-labs/FLUX.1-schnell")).toMatchObject({
      provider: "huggingface",
      model: "black-forest-labs/FLUX.1-schnell",
      providerAlias: "hf",
    });
  });
});

describe("HuggingFace STT support (issue #2548)", () => {
  it("exposes an sttConfig so the STT dispatch layer recognizes the provider", () => {
    expect(huggingface.serviceKinds).toContain("stt");
    expect(huggingface.sttConfig).toBeDefined();
    expect(huggingface.sttConfig.format).toBe("huggingface-asr");
    expect(huggingface.sttConfig.baseUrl).toContain("api-inference.huggingface.co");
    expect(huggingface.sttConfig.authType).toBe("apikey");
  });

  it("advertises the two whisper STT presets", () => {
    const ids = huggingface.models.filter((m) => m.kind === "stt").map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining(["openai/whisper-large-v3", "openai/whisper-small"])
    );
  });
});
