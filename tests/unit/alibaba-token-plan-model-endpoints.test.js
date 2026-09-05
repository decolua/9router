// Drives the real /v1/models builder so each Token Plan model lands on the
// endpoint that can actually execute it.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAlibabaTokenPlanModelCache } from "../../open-sse/services/alibabaTokenPlanModels.js";

const CONNECTION = {
  id: "c1",
  provider: "alitp-intl",
  isActive: true,
  apiKey: "sk-test",
  providerSpecificData: {},
};

const LIVE_CATALOG = [
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-flash",
  "glm-5.2",
  "deepseek-v4-pro",
  "wan2.7-image",
  "wan2.7-image-pro",
  "qwen-audio-3.0-tts-plus",
  "deepseek-v4-flash-0731",
  "qwen3.8-max",
  "qwen-audio-3.0-realtime-plus",
  "qwen3.8-flash",
];

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [CONNECTION],
  getCombos: async () => [],
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: async () => ({}),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const idsFor = async (kinds) => (await buildModelsList(kinds))
  .filter((m) => m.owned_by === "alitp-intl")
  .map((m) => m.id.replace("alitp-intl/", ""));

describe("Token Plan model endpoints", () => {
  beforeEach(() => {
    clearAlibabaTokenPlanModelCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ data: LIVE_CATALOG.map((id) => ({ id })) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
  });

  it("lists every live chat model and no media model", async () => {
    expect(await idsFor(["llm"])).toEqual([
      "qwen3.7-max",
      "qwen3.7-plus",
      "qwen3.6-flash",
      "glm-5.2",
      "deepseek-v4-pro",
      "deepseek-v4-flash-0731",
      "qwen3.8-max",
      "qwen3.8-flash",
    ]);
  });

  it("puts the image and speech models on their own endpoints", async () => {
    expect(await idsFor(["image"])).toEqual(["wan2.7-image", "wan2.7-image-pro"]);
    expect(await idsFor(["tts"])).toEqual(["qwen-audio-3.0-tts-plus"]);
  });

  it("never advertises the WebSocket-only realtime model", async () => {
    for (const kind of [["llm"], ["image"], ["tts"], ["stt"], ["imageToText"]]) {
      expect(await idsFor(kind)).not.toContain("qwen-audio-3.0-realtime-plus");
    }
  });

  it("reports multimodal capabilities and real token limits for chat models", async () => {
    const models = await buildModelsList(["llm"]);
    const max = models.find((m) => m.id === "alitp-intl/qwen3.8-max");

    expect(max.capabilities).toMatchObject({ vision: true, videoInput: true, reasoning: true, search: true });
    expect(max.context_length).toBe(1000000);
    expect(max.max_completion_tokens).toBe(131072);

    const flash = models.find((m) => m.id === "alitp-intl/qwen3.6-flash");
    expect(flash.max_completion_tokens).toBe(65536);
  });

  it("marks media models with their output modality instead of text-only", async () => {
    const [image] = await buildModelsList(["image"]);
    const [speech] = await buildModelsList(["tts"]);

    expect(image.capabilities).toMatchObject({ imageOutput: true });
    expect(speech.capabilities).toMatchObject({ audioOutput: true });
  });

  it("falls back to the static registry list when live discovery fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    clearAlibabaTokenPlanModelCache();

    expect(await idsFor(["llm"])).toContain("qwen3.8-max");
    expect(await idsFor(["image"])).toEqual(["wan2.7-image", "wan2.7-image-pro"]);

    // The registry's own `kind` must still drive capabilities on this path.
    const [image] = await buildModelsList(["image"]);
    expect(image.capabilities).toMatchObject({ imageOutput: true });
  });
});
