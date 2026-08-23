import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelTargetFormat, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import opencodeRegistry from "../../open-sse/providers/registry/opencode.js";

const OX_ID = "x-preview-f-free";
const GO_ID = "ox-alpha-free";

describe("OpenCode Free Ox Alpha Free (oc/x-preview-f-free)", () => {
  it("exposes Ox Alpha Free as static OpenAI Chat Completions model", () => {
    const ids = (PROVIDER_MODELS.oc || []).map((m) => m.id);
    expect(ids).toContain(OX_ID);
    const entry = (PROVIDER_MODELS.oc || []).find((m) => m.id === OX_ID);
    expect(entry?.name).toBe("Ox Alpha Free");
    expect(getModelTargetFormat("oc", OX_ID)).toBe("openai");
    expect(getModelSupportedFormats("oc", OX_ID)).toEqual(["openai"]);
  });

  it("keeps dynamic fetcher + passthrough and does not require explicit transports on base", () => {
    expect(opencodeRegistry.modelsFetcher).toEqual({ url: "https://opencode.ai/zen/v1/models", type: "opencode-free" });
    expect(opencodeRegistry.passthroughModels).toBe(true);
    expect(PROVIDERS.opencode.format).toBe("openai");
    expect(PROVIDERS.opencode.baseUrl).toBe("https://opencode.ai");
  });

  it("OpenCodeExecutor.buildUrl routes Ox Alpha Free to Zen Chat Completions", () => {
    const url = new OpenCodeExecutor().buildUrl(OX_ID);
    expect(url).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("Claude-source request still targets openai (no extra transport needed on base)", () => {
    expect(getModelTargetFormat("oc", OX_ID)).toBe("openai");
    expect(getModelSupportedFormats("oc", OX_ID)).toEqual(["openai"]);
    expect(new OpenCodeExecutor().buildUrl(OX_ID)).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("resolves image input + reasoning capability deltas from models.dev metadata", () => {
    const caps = getCapabilitiesForModel("opencode", OX_ID);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai-low-high-max");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(131072);
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

describe("Ox Alpha capabilities — 4 provider/id pairs + isolation", () => {
  it.each([
    ["opencode", OX_ID],
    ["oc", OX_ID],
    ["opencode-go", GO_ID],
    ["ocg", GO_ID],
  ])("caps %s/%s equals OX_ALPHA_CAPABILITIES", (provider, model) => {
    const caps = getCapabilitiesForModel(provider, model);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai-low-high-max");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(131072);
    expect(caps.videoInput).toBe(false);
  });

  it("bare ids without provider do not pick up Ox Alpha caps", () => {
    expect(getCapabilitiesForModel(null, OX_ID).vision).toBe(false);
    expect(getCapabilitiesForModel(null, GO_ID).vision).toBe(false);
    expect(getCapabilitiesForModel(undefined, OX_ID).vision).toBe(false);
  });

  it("cross-provider isolation: nvidia and other provider do not pick up Ox Alpha caps", () => {
    expect(getCapabilitiesForModel("nvidia", OX_ID).vision).toBe(false);
    expect(getCapabilitiesForModel("nvidia", GO_ID).vision).toBe(false);
    expect(getCapabilitiesForModel("openai", OX_ID).thinkingFormat).not.toBe("openai-low-high-max");
  });

  it("suffix deep equality for 4 Ox pairs", () => {
    expect(getCapabilitiesForModel("opencode", `${OX_ID}(max)`)).toEqual(getCapabilitiesForModel("opencode", OX_ID));
    expect(getCapabilitiesForModel("oc", `${OX_ID}(max)`)).toEqual(getCapabilitiesForModel("oc", OX_ID));
    expect(getCapabilitiesForModel("opencode-go", `${GO_ID}(max)`)).toEqual(getCapabilitiesForModel("opencode-go", GO_ID));
    expect(getCapabilitiesForModel("ocg", `${GO_ID}(max)`)).toEqual(getCapabilitiesForModel("ocg", GO_ID));
    expect(getCapabilitiesForModel("ocg", `${GO_ID}(8192)`)).toEqual(getCapabilitiesForModel("ocg", GO_ID));
  });

  it("suffix deep equality for generic Claude family (existing pattern)", () => {
    expect(getCapabilitiesForModel(null, "claude-sonnet-4.6(max)")).toEqual(getCapabilitiesForModel(null, "claude-sonnet-4.6"));
  });

  it("getThinkingLevels for Ox Alpha returns low/high/max only", () => {
    expect(getThinkingLevels("opencode", OX_ID)).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("oc", OX_ID)).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("opencode-go", GO_ID)).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("ocg", GO_ID)).toEqual(["low", "high", "max"]);
  });

  it("getThinkingLevels bare/other returns null or without exact Ox set", () => {
    const bare = getThinkingLevels(null, OX_ID);
    expect(bare === null || JSON.stringify(bare) !== JSON.stringify(["low", "high", "max"])).toBe(true);
  });
});

describe("Ox Alpha effort mapping (openai-low-high-max)", () => {
  const apply = (body, provider, model) => {
    const b = JSON.parse(JSON.stringify(body));
    applyThinking(FORMATS.OPENAI, model, b, provider);
    return b;
  };
  it.each([
    ["low", "low"],
    ["minimal", "low"],
    ["none", "low"],
    ["medium", "high"],
    ["high", "high"],
    ["xhigh", "max"],
    ["max", "max"],
    ["ultra", "max"],
  ])("opencode Ox %s -> %s", (input, expected) => {
    const out = apply({ reasoning_effort: input }, "opencode", OX_ID);
    expect(out.reasoning_effort).toBe(expected);
  });

  it("auto omits reasoning_effort", () => {
    const out = apply({ reasoning_effort: "auto" }, "oc", OX_ID);
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("unknown omits reasoning_effort", () => {
    const out = apply({ reasoning_effort: "unknown" }, "opencode", OX_ID);
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("numeric 8192 suffix -> high via budgetToLevel", () => {
    const out = apply({}, "opencode", `${OX_ID}(8192)`);
    expect(out.reasoning_effort).toBe("high");
  });

  it("generic OpenAI max still clamps to xhigh", () => {
    const out = apply({ reasoning_effort: "max" }, "openai", "gpt-5");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("suffixed ocg image_url preservation and videoInput false", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
    ] }] };
    const caps = getCapabilitiesForModel("ocg", `${GO_ID}(max)`);
    expect(caps.videoInput).toBe(false);
    expect(caps.vision).toBe(true);
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    expect(body.messages[0].content.some((b) => b.type === "image_url")).toBe(true);
  });
});
