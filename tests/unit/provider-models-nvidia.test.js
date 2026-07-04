import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelsByProviderId } from "../../open-sse/config/providerModels.js";

describe("NVIDIA NIM model registration", () => {
  it("includes chat-completions models that are available from the NVIDIA NIM catalog", () => {
    const ids = (PROVIDER_MODELS.nvidia || []).map((m) => m.id);

    for (const id of [
      "deepseek-ai/deepseek-v4-flash",
      "deepseek-ai/deepseek-v4-pro",
      "minimaxai/minimax-m3",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "qwen/qwen3-next-80b-a3b-instruct",
      "qwen/qwen3.5-122b-a10b",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("keeps non-chat NVIDIA models typed as media/service models", () => {
    const models = getModelsByProviderId("nvidia");

    expect(models.find((m) => m.id === "nvidia/nv-embedqa-e5-v5")).toMatchObject({
      kind: "embedding",
    });
    expect(models.find((m) => m.id === "nvidia/parakeet-ctc-1.1b-asr")).toMatchObject({
      kind: "stt",
    });
    expect(models.find((m) => m.id === "fastpitch")).toMatchObject({
      kind: "tts",
    });
  });
});
