import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getModelSupportedFormats, getModelTargetFormat, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";

const CHAT_URL = "https://api.hcnsec.cn/v1/chat/completions";
const MESSAGES_URL = "https://api.hcnsec.cn/v1/messages";
const MODELS_URL = "https://api.hcnsec.cn/v1/models";

// Models the gateway serves on the Anthropic /v1/messages lane as well as chat.
const CLAUDE_LANE = [
  "auto",
  "DeepSeek-V4-Flash",
  "DeepSeek-V4-Pro",
  "DeepSeek-V4.1-Flash",
  "glm-5.3",
  "glm-5.3-flash",
  "MiniMax-M3.1-Flash",
];

describe("HCNSec provider", () => {
  const entry = REGISTRY.find((e) => e.id === "hcnsec");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("hcnsec");
    expect(entry.aliases).toEqual(expect.arrayContaining(["hc", "hcn"]));
    expect(entry.display.textIcon).toBe("HC");
    expect(entry.display.name).toBe("HCNSec");
  });

  it("points at the verified OpenAI-compatible endpoints", () => {
    expect(PROVIDERS.hcnsec.baseUrl).toBe(CHAT_URL);
    expect(PROVIDERS.hcnsec.validateUrl).toBe(MODELS_URL);
    // transport.format defaults to "openai" via the shared provider default
    expect(PROVIDERS.hcnsec.format).toBe("openai");
  });

  it("forces the openai thinking wire format provider-wide", () => {
    // The relay is a New API fork: every model takes reasoning_effort. Without a
    // provider-wide value, caps.thinkingFormat (zai / qwen / deepseek / minimax /
    // step) would emit vendor-native shapes the relay rejects.
    expect(PROVIDERS.hcnsec.thinkingFormat).toBe("openai");
  });

  it("enables dynamic model discovery and passthrough", () => {
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toMatchObject({ url: MODELS_URL, type: "openai" });
  });

  it("seeds the full live catalogue with bare (unprefixed) ids", () => {
    const ids = (PROVIDER_MODELS.hcnsec || []).map((m) => m.id);
    expect(ids).toHaveLength(19);
    expect(ids).toEqual(expect.arrayContaining(CLAUDE_LANE));
    expect(ids).toEqual(expect.arrayContaining([
      "MiMo-V2.6-Flash",
      "MiniCPM-V-4.7-35B-A3B",
      "Qwen3-Embedding-8B",
      "Qwen3.8-27B",
      "Qwen3.8-Flash-Next",
      "sensenova-6.8-flash-lite",
      "sensenova-u1.5-lite",
      "step-5-preview",
      "stepaudio-2.5-asr",
      "stepaudio-2.5-chat",
      "stepaudio-2.5-realtime",
      "stepaudio-2.5-tts",
    ]));
    // The gateway does not namespace ids by upstream vendor
    expect(ids.every((id) => !id.includes("/"))).toBe(true);
  });

  it("tags the non-chat models with their service kind", () => {
    const byId = Object.fromEntries((PROVIDER_MODELS.hcnsec || []).map((m) => [m.id, m]));
    expect(byId["Qwen3-Embedding-8B"].kind).toBe("embedding");
    expect(byId["stepaudio-2.5-asr"].kind).toBe("stt");
    expect(byId["stepaudio-2.5-tts"].kind).toBe("tts");
    // Everything else stays a plain chat model — `auto` and the stepaudio chat
    // variants included.
    for (const id of ["auto", "glm-5.3", "stepaudio-2.5-chat", "stepaudio-2.5-realtime"]) {
      expect(byId[id].kind ?? "llm").toBe("llm");
    }
  });

  it("declares the media lanes with their OpenAI-compatible endpoints", () => {
    const media = PROVIDER_MEDIA.hcnsec;
    // No "stt": /v1/audio/transcriptions is broken upstream (404 for every multipart
    // shape, including a real speech MP3 from this gateway's own TTS lane), so
    // declaring the lane would surface a card that can never succeed.
    expect(media.serviceKinds).toEqual(["llm", "embedding", "tts"]);
    expect(media.sttConfig).toBeUndefined();
    expect(media.embeddingConfig).toMatchObject({
      baseUrl: "https://api.hcnsec.cn/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
    });
    expect(media.ttsConfig).toMatchObject({
      baseUrl: "https://api.hcnsec.cn/v1/audio/speech",
      format: "openai",
      // The shared openai-compat handler defaults to "alloy", which this relay
      // rejects with voice_id_invalid; the provider default must override it.
      defaultVoice: "cixingnansheng",
    });
  });

  it("resolves the embedding adapter for its embedding lane", () => {
    expect(getEmbeddingAdapter("hcnsec")).toBeTruthy();
  });

  it("routes through the shared DefaultExecutor (no custom adapter)", () => {
    expect(getExecutor("hcnsec")).toBeInstanceOf(DefaultExecutor);
  });

  it("keeps every registry id unique after adding hcnsec", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("HCNSec Anthropic lane", () => {
  const transports = PROVIDERS.hcnsec.transports;

  it("declares both the chat and the messages transport", () => {
    expect(transports.map((t) => t.format)).toEqual(["openai", "claude"]);
    expect(transports.find((t) => t.format === "openai").baseUrl).toBe(CHAT_URL);
    expect(transports.find((t) => t.format === "claude").baseUrl).toBe(MESSAGES_URL);
  });

  it("authenticates the messages lane with a bearer token", () => {
    // Probing /v1/messages with a bad key returns the same 401 for every header
    // variant, so the auth header is not discriminating; bearer is the shape the
    // New API token middleware actually resolves.
    const claude = transports.find((t) => t.format === "claude");
    expect(claude.auth).toMatchObject({ combined: true, header: "Authorization", scheme: "bearer" });
    expect(claude.headers["Anthropic-Version"]).toBe("2023-06-01");
  });

  it("keeps Claude-shaped thinking on the messages lane", () => {
    // Transport-level thinkingFormat wins over the provider-wide "openai" in
    // resolveFormat(), so /v1/messages still receives thinking:{type,budget_tokens}.
    expect(transports.find((t) => t.format === "claude").thinkingFormat).toBe("claude-budget");
    expect(transports.find((t) => t.format === "openai").thinkingFormat).toBeUndefined();
  });

  it("declares supportedFormats on every chat model, dual-lane only where served", () => {
    const models = PROVIDER_MODELS.hcnsec || [];
    const byId = Object.fromEntries(models.map((m) => [m.id, m]));

    for (const id of CLAUDE_LANE) {
      expect(getModelSupportedFormats("hcnsec", id)).toEqual(["openai", "claude"]);
    }
    // Chat-only ids must declare ["openai"] explicitly: chatCore keeps the
    // source-format-matched transport for UNDECLARED models, so omitting the
    // field would route a Claude client to /v1/messages for a model the gateway
    // does not serve there.
    for (const id of ["Qwen3.8-27B", "MiMo-V2.6-Flash", "step-5-preview", "sensenova-u1.5-lite"]) {
      expect(getModelSupportedFormats("hcnsec", id)).toEqual(["openai"]);
    }
    // Media-only ids never travel the chat lane, so they declare nothing.
    for (const m of models.filter((x) => x.kind === "embedding" || x.kind === "stt" || x.kind === "tts")) {
      expect(byId[m.id].supportedFormats).toBeUndefined();
    }
  });

  it("resolves each transport from the client source format", () => {
    expect(resolveTransport("hcnsec", "openai").baseUrl).toBe(CHAT_URL);
    expect(resolveTransport("hcnsec", "claude").baseUrl).toBe(MESSAGES_URL);
    expect(resolveTransport("hcnsec", "gemini")).toBeNull();
  });

  it("keeps chat-only models off the messages lane (chatCore guard replica)", () => {
    // Mirrors chatCore: a source-format-matched transport is only used when the
    // model declares that format; otherwise the model's target format decides.
    const pick = (modelId, sourceFormat) => {
      const alias = PROVIDER_ID_TO_ALIAS.hcnsec || "hcnsec";
      const supported = getModelSupportedFormats(alias, modelId);
      const runtime = resolveTransport("hcnsec", sourceFormat);
      const modelTarget = getModelTargetFormat(alias, modelId);
      const target = modelTarget ? resolveTransport("hcnsec", modelTarget) : null;
      return (!supported || supported.includes(sourceFormat)) ? runtime : target;
    };

    // Claude client + a messages-capable model → messages lane
    expect(pick("glm-5.3", "claude").baseUrl).toBe(MESSAGES_URL);
    // Claude client + a chat-only model → no claude transport for it, so the
    // request keeps the chat lane instead of POSTing a Claude body to /v1/messages.
    expect(pick("Qwen3.8-27B", "claude")).toBeNull();
    // OpenAI client on a dual-lane model → chat lane
    expect(pick("glm-5.3", "openai").baseUrl).toBe(CHAT_URL);
    // OpenAI client on a chat-only model → chat lane
    expect(pick("Qwen3.8-27B", "openai").baseUrl).toBe(CHAT_URL);
  });
});

describe("HCNSec capabilities", () => {
  it("publishes the multimodal limits from the gateway's own table", () => {
    expect(getCapabilitiesForModel("hcnsec", "glm-5.3")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 1000000,
      maxOutput: 131072,
    });
    expect(getCapabilitiesForModel("hcnsec", "glm-5.3-flash")).toMatchObject({
      vision: true,
      reasoning: true,
      contextWindow: 1000000,
      maxOutput: 131072,
    });
    expect(getCapabilitiesForModel("hcnsec", "MiniCPM-V-4.7-35B-A3B")).toMatchObject({
      vision: true,
      reasoning: true,
      contextWindow: 262144,
      maxOutput: 65536,
    });
    expect(getCapabilitiesForModel("hcnsec", "Qwen3.8-27B")).toMatchObject({
      vision: true,
      reasoning: true,
      contextWindow: 200000,
      maxOutput: 65536,
    });
    expect(getCapabilitiesForModel("hcnsec", "Qwen3.8-Flash-Next")).toMatchObject({
      vision: true,
      reasoning: true,
      contextWindow: 262144,
      maxOutput: 65536,
    });
    expect(getCapabilitiesForModel("hcnsec", "step-5-preview")).toMatchObject({
      vision: true,
      reasoning: true,
      contextWindow: 1000000,
      maxOutput: 64000,
    });
  });

  it("does not invent capabilities for an uncatalogued model", () => {
    // Vision/reasoning must not be blanket-granted across the provider.
    const caps = getCapabilitiesForModel("hcnsec", "some-unknown-model-x");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
  });
});

describe("HCNSec app wiring", () => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  it("ships a /public/providers/hcnsec.png icon", () => {
    // getProviderIconSrc() silently falls back to the textIcon tile on a 404.
    expect(existsSync(join(REPO_ROOT, "public", "providers", "hcnsec.png"))).toBe(true);
  });

  it("registers the provider in the /models discovery route", () => {
    // Without this entry the route answers 400 "Provider hcnsec does not support
    // models listing" — /v1/models is auth-gated, so live discovery would fail.
    const route = readFileSync(
      join(REPO_ROOT, "src", "app", "api", "providers", "[id]", "models", "route.js"),
      "utf8"
    );
    const line = route.split("\n").find((l) => l.trim().startsWith("hcnsec: createOpenAIModelsConfig("));
    expect(line).toBeTruthy();
    expect(line).toContain(MODELS_URL);
  });

  it("validates the key against the aggregator endpoint", () => {
    const utils = readFileSync(
      join(REPO_ROOT, "src", "app", "api", "providers", "[id]", "test", "testUtils.js"),
      "utf8"
    );
    expect(utils).toContain('case "hcnsec":');
  });
});
