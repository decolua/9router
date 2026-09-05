import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyTokenPlanModel,
  clearAlibabaTokenPlanModelCache,
  resolveAlibabaTokenPlanModels,
} from "../../open-sse/services/alibabaTokenPlanModels.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";

// Exactly what the live subscription returns today.
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

function modelsResponse(ids = LIVE_CATALOG) {
  return new Response(JSON.stringify({ object: "list", data: ids.map((id) => ({ id, object: "model" })) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Token Plan model classification", () => {
  it("routes chat, image and speech models to their own kinds", () => {
    expect(classifyTokenPlanModel("qwen3.8-max")).toBe("llm");
    expect(classifyTokenPlanModel("deepseek-v4-flash-0731")).toBe("llm");
    expect(classifyTokenPlanModel("wan2.7-image")).toBe("image");
    expect(classifyTokenPlanModel("wan2.7-image-pro")).toBe("image");
    expect(classifyTokenPlanModel("qwen-audio-3.0-tts-plus")).toBe("tts");
  });

  it("withholds models this gateway cannot execute", () => {
    // WebSocket/WebRTC speech-to-speech only.
    expect(classifyTokenPlanModel("qwen-audio-3.0-realtime-plus")).toBeNull();
    // Async video jobs have no executor.
    expect(classifyTokenPlanModel("wan2.7-t2v")).toBeNull();
    expect(classifyTokenPlanModel("wan2.7-i2v")).toBeNull();
    expect(classifyTokenPlanModel("happyhorse1.1")).toBeNull();
    expect(classifyTokenPlanModel("paraformer-asr-v2")).toBeNull();
    expect(classifyTokenPlanModel("")).toBeNull();
  });
});

describe("Token Plan live catalog resolver", () => {
  beforeEach(() => {
    clearAlibabaTokenPlanModelCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearAlibabaTokenPlanModelCache();
  });

  it("fetches the authenticated catalog and classifies every entry", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(modelsResponse());

    const result = await resolveAlibabaTokenPlanModels({ apiKey: "sk-test" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models");
    expect(init.headers.Authorization).toBe("Bearer sk-test");

    // Static registry snapshot never contained these; only a live fetch can.
    expect(result.models.map((m) => m.id)).toContain("deepseek-v4-flash-0731");
    expect(result.models.filter((m) => m.kind === "image").map((m) => m.id))
      .toEqual(["wan2.7-image", "wan2.7-image-pro"]);
    expect(result.models.filter((m) => m.kind === "tts").map((m) => m.id))
      .toEqual(["qwen-audio-3.0-tts-plus"]);
    expect(result.models.map((m) => m.id)).not.toContain("qwen-audio-3.0-realtime-plus");
    expect(result.models.every((m) => m.name)).toBe(true);
  });

  it("caches the catalog per key instead of refetching per request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(modelsResponse());

    await resolveAlibabaTokenPlanModels({ apiKey: "sk-test" });
    await resolveAlibabaTokenPlanModels({ apiKey: "sk-test" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the static list when discovery fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    expect(await resolveAlibabaTokenPlanModels({ apiKey: "sk-test" })).toBeNull();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(modelsResponse([]));
    expect(await resolveAlibabaTokenPlanModels({ apiKey: "sk-test" })).toBeNull();

    expect(await resolveAlibabaTokenPlanModels({})).toBeNull();
  });
});

describe("Token Plan image adapter", () => {
  const adapter = getImageAdapter("alitp-intl");

  it("posts a DashScope multimodal-generation request", () => {
    expect(adapter.buildUrl("wan2.7-image", {}))
      .toBe("https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
    expect(adapter.buildHeaders({ apiKey: "sk-test" }).Authorization).toBe("Bearer sk-test");

    // OpenAI clients send "1024x1024"; DashScope only accepts "1024*1024".
    expect(adapter.buildBody("wan2.7-image", { prompt: "a red cube", size: "1024x1024", n: 2 })).toEqual({
      model: "wan2.7-image",
      input: { messages: [{ role: "user", content: [{ text: "a red cube" }] }] },
      parameters: { size: "1024*1024", n: 2 },
    });
  });

  it("normalizes the signed OSS url into the OpenAI image shape", () => {
    const normalized = adapter.normalize({
      output: {
        choices: [{ message: { content: [{ type: "image", image: "https://oss.example/img.png?Signature=x" }] } }],
      },
    }, "a red cube");

    expect(normalized.data).toEqual([{ url: "https://oss.example/img.png?Signature=x" }]);
    expect(normalized.created).toBeTypeOf("number");
  });
});

describe("Token Plan TTS handler", () => {
  const synthesize = FORMAT_HANDLERS["dashscope-tts"];
  const baseUrl = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the expiring audio url when no inline audio is returned", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: { audio: { data: "", url: "https://oss.example/speech.mp3" } },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(256), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }));

    const result = await synthesize({ baseUrl, apiKey: "sk-test", text: "Router check.", modelId: "qwen-audio-3.0-tts-plus" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: "qwen-audio-3.0-tts-plus",
      input: { text: "Router check.", voice: "longanlingxin" },
      parameters: { format: "mp3", sample_rate: 24000 },
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://oss.example/speech.mp3");
    expect(result.format).toBe("mp3");
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it("uses the caller's voice and inline audio when present", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      output: { audio: { data: "AAAA" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await synthesize({
      baseUrl,
      apiKey: "sk-test",
      text: "Router check.",
      modelId: "qwen-audio-3.0-tts-plus",
      voiceId: "longanlufeng",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input.voice).toBe("longanlufeng");
    expect(result).toEqual({ base64: "AAAA", format: "mp3" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces DashScope errors instead of returning empty audio", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "InvalidApiKey",
      message: "Invalid API-key provided.",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(synthesize({ baseUrl, apiKey: "bad", text: "x", modelId: "qwen-audio-3.0-tts-plus" }))
      .rejects.toThrow("Invalid API-key provided.");
  });
});
