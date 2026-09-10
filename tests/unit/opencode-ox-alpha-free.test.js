import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelTargetFormat, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import opencodeRegistry from "../../open-sse/providers/registry/opencode.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const OX_ID = "x-preview-f-free";

describe("OpenCode Free Ox Alpha Free (oc/x-preview-f-free)", () => {
  it("exposes Ox Alpha Free as static OpenAI Chat Completions model", () => {
    const ids = (PROVIDER_MODELS.oc || []).map((m) => m.id);
    expect(ids).toContain(OX_ID);
    // exact metadata per Zen docs: display Ox Alpha Free, protocol @ai-sdk/openai-compatible / Chat Completions
    const entry = (PROVIDER_MODELS.oc || []).find((m) => m.id === OX_ID);
    expect(entry?.name).toBe("Ox Alpha Free");
    expect(getModelTargetFormat("oc", OX_ID)).toBe("openai");
    expect(getModelSupportedFormats("oc", OX_ID)).toEqual(["openai"]);
  });

  it("keeps dynamic fetcher + passthrough and does not require explicit transports on base", () => {
    expect(opencodeRegistry.modelsFetcher).toEqual({ url: "https://opencode.ai/zen/v1/models", type: "opencode-free" });
    expect(opencodeRegistry.passthroughModels).toBe(true);
    // base PROVIDERS.opencode defaults to openai format; executor fallback handles URL
    expect(PROVIDERS.opencode.format).toBe("openai");
    expect(PROVIDERS.opencode.baseUrl).toBe("https://opencode.ai");
  });

  it("OpenCodeExecutor.buildUrl routes Ox Alpha Free to Zen Chat Completions", () => {
    const url = new OpenCodeExecutor().buildUrl(OX_ID);
    expect(url).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("Claude-source request still targets openai (no extra transport needed on base)", () => {
    // chatCore: targetFormat = modelTargetFormat || useTransport?.format || getTargetFormat
    // with no transports, useTransport is null, so target is modelTargetFormat=openai
    expect(getModelTargetFormat("oc", OX_ID)).toBe("openai");
    // supportedFormats guard: model declares ["openai"], so claude transport would be ignored anyway
    expect(getModelSupportedFormats("oc", OX_ID)).toEqual(["openai"]);
    expect(new OpenCodeExecutor().buildUrl(OX_ID)).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("resolves image input + reasoning capability deltas from models.dev metadata", () => {
    const caps = getCapabilitiesForModel("opencode", OX_ID);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(131072);
    // input-only: no output/other modality claims until transport-verified
    expect(caps.imageOutput).toBe(false);
    expect(caps.audioInput).toBe(false);
    expect(caps.videoInput).toBe(false);
    expect(caps.pdf).toBe(false);
  });

  it("keeps an OpenAI image_url block for Ox Alpha Free (vision declared -> no strip)", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "what is in this picture?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
    ] }] };
    const caps = getCapabilitiesForModel("opencode", OX_ID);
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    const blocks = body.messages[0].content;
    expect(blocks.some((b) => b.type === "image_url")).toBe(true);
    expect(blocks.some((b) => /image omitted/.test(b.text || ""))).toBe(false);
  });
});
