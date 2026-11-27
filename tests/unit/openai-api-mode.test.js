// OpenAI API-key provider: per-connection endpoint selector (Auto / Chat / Responses)
// plus Auto-mode model-family routing (GPT-5.6+ / GPT-6 → /v1/responses).
//
// Drives the REAL handleChatCore routing; only the executor's HTTP call is mocked.
// The assertion target is credentials.runtimeTransport — the field DefaultExecutor.buildUrl
// reads — plus the translated body, so a wrong decision shows up as the wrong URL/shape.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/translator/concerns/image.js", () => ({
  encodeDataUri: (mimeType, base64) => `data:${mimeType};base64,${base64}`,
  parseDataUri: () => null,
  fetchImageAsBase64: async () => null,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
const { resolveApiModeTransport } = await import("../../open-sse/services/provider.js");
const { PROVIDERS } = await import("../../open-sse/config/providers.js");
const { getModelTargetFormat, getModelSupportedFormats } = await import("../../open-sse/config/providerModels.js");
const { API_MODE, resolveApiMode } = await import("../../open-sse/config/apiModeConstants.js");
const { sanitizeApiMode, normalizeProviderSpecificData } = await import("../../src/lib/providerNormalization.js");

const transportFor = (format) => PROVIDERS.openai.transports.find((t) => t.format === format);
const CHAT_URL = transportFor("openai").baseUrl;
const RESPONSES_URL = transportFor("openai-responses").baseUrl;

const LEGACY_MODEL = "gpt-4o";
const RESPONSES_MODEL = "gpt-5.6-sol";

const TOOLS = [{ type: "function", function: { name: "calc", parameters: { type: "object", properties: { expr: { type: "string" } } } } }];

function bodyFor(model, sourceFormat) {
  if (sourceFormat === "openai-responses") {
    return { model: `openai/${model}`, stream: false, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
  }
  if (sourceFormat === "claude") {
    return { model: `openai/${model}`, stream: false, max_tokens: 16, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
  }
  return { model: `openai/${model}`, stream: false, reasoning_effort: "high", tools: TOOLS, messages: [{ role: "user", content: "2+2? use the tool" }] };
}

async function route(model, sourceFormat, apiMode) {
  executeMock.mockImplementationOnce(async () => {
    throw new Error("stop after routing");
  });
  const credentials = { apiKey: "sk-test", providerSpecificData: apiMode === undefined ? {} : { apiMode } };
  await handleChatCore({
    body: bodyFor(model, sourceFormat),
    modelInfo: { provider: "openai", model },
    credentials,
    connectionId: "openai-api-mode-test",
    sourceFormatOverride: sourceFormat,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }).catch(() => {});
  const call = executeMock.mock.calls.at(-1)?.[0];
  const rt = call?.credentials?.runtimeTransport ?? null;
  const url = new DefaultExecutor("openai").buildUrl(model, false, 0, call?.credentials);
  return { rt, url, body: call?.body };
}

describe("openai registry: multi-endpoint + api modes", () => {
  it("declares Chat and Responses transports on api.openai.com", () => {
    expect(new URL(CHAT_URL).pathname).toBe("/v1/chat/completions");
    expect(new URL(RESPONSES_URL).pathname).toBe("/v1/responses");
    expect(new URL(CHAT_URL).origin).toBe(new URL(RESPONSES_URL).origin);
  });

  it("exposes auto/chat/responses", () => {
    expect(PROVIDERS.openai.apiModes).toEqual([API_MODE.AUTO, API_MODE.CHAT, API_MODE.RESPONSES]);
  });

  it("model family: GPT-5.6+ / GPT-6 need Responses, older models don't", () => {
    for (const id of ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-6-astra", "gpt-6.1-terra", "gpt-6.2-sol"]) {
      expect(getModelTargetFormat("openai", id), id).toBe("openai-responses");
      expect(getModelSupportedFormats("openai", id), id).toEqual(["openai-responses"]);
    }
    for (const id of ["gpt-5.5", "gpt-5", "gpt-4o", "gpt-4.1-mini", "o3", "gpt-image-2.5"]) {
      expect(getModelTargetFormat("openai", id), id).toBeNull();
      expect(getModelSupportedFormats("openai", id), id).toBeNull();
    }
  });

  it("model families are scoped to the declaring provider only", async () => {
    const { PROVIDER_MODEL_FAMILIES } = await import("../../open-sse/providers/index.js");
    expect(Object.keys(PROVIDER_MODEL_FAMILIES)).toEqual(["openai"]);
  });
});

describe("openai routing via real handleChatCore", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("Auto (default)", () => {
    it("legacy model + chat client → /v1/chat/completions", async () => {
      const { url } = await route(LEGACY_MODEL, "openai");
      expect(url).toBe(CHAT_URL);
    });

    it("legacy model + responses client → native /v1/responses", async () => {
      const { rt, url, body } = await route(LEGACY_MODEL, "openai-responses");
      expect(rt?.format).toBe("openai-responses");
      expect(url).toBe(RESPONSES_URL);
      expect(body.input).toBeDefined();
    });

    it("legacy model + claude client → /v1/chat/completions", async () => {
      const { url, body } = await route(LEGACY_MODEL, "claude");
      expect(url).toBe(CHAT_URL);
      expect(body.messages).toBeDefined();
    });

    it("GPT-5.6 Sol + chat client with tools + reasoning → /v1/responses with nested reasoning", async () => {
      const { rt, url, body } = await route(RESPONSES_MODEL, "openai");
      expect(rt?.format).toBe("openai-responses");
      expect(url).toBe(RESPONSES_URL);
      expect(body.input).toBeDefined();
      expect(body.messages).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.reasoning?.effort).toBe("high");
      expect(body.tools?.[0]).toMatchObject({ type: "function", name: "calc" });
    });

    it("GPT-6 + claude client → /v1/responses", async () => {
      const { url } = await route("gpt-6-astra", "claude");
      expect(url).toBe(RESPONSES_URL);
    });

    it("an unknown/tampered apiMode behaves like auto", async () => {
      const { url } = await route(RESPONSES_MODEL, "openai", "<script>");
      expect(url).toBe(RESPONSES_URL);
      const legacy = await route(LEGACY_MODEL, "openai", "../../evil");
      expect(legacy.url).toBe(CHAT_URL);
    });
  });

  describe("Chat (forced)", () => {
    for (const src of ["openai", "openai-responses", "claude"]) {
      it(`${RESPONSES_MODEL} + ${src} client → /v1/chat/completions`, async () => {
        const { rt, url, body } = await route(RESPONSES_MODEL, src, API_MODE.CHAT);
        expect(rt?.format).toBe("openai");
        expect(url).toBe(CHAT_URL);
        expect(body.messages).toBeDefined();
        expect(body.input).toBeUndefined();
      });
    }
  });

  describe("Responses (forced)", () => {
    for (const src of ["openai", "openai-responses", "claude"]) {
      it(`${LEGACY_MODEL} + ${src} client → /v1/responses`, async () => {
        const { rt, url, body } = await route(LEGACY_MODEL, src, API_MODE.RESPONSES);
        expect(rt?.format).toBe("openai-responses");
        expect(url).toBe(RESPONSES_URL);
        expect(body.input).toBeDefined();
        expect(body.messages).toBeUndefined();
      });
    }
  });
});

describe("resolveApiModeTransport", () => {
  it("is null for auto and for providers without apiModes", () => {
    expect(resolveApiModeTransport("openai", { providerSpecificData: { apiMode: "auto" } })).toBeNull();
    expect(resolveApiModeTransport("openai", null)).toBeNull();
    expect(resolveApiModeTransport("muse", { providerSpecificData: { apiMode: "chat" } })).toBeNull();
    expect(resolveApiModeTransport("kimi", { providerSpecificData: { apiMode: "responses" } })).toBeNull();
  });

  it("pins the declared transport for chat/responses", () => {
    expect(resolveApiModeTransport("openai", { providerSpecificData: { apiMode: "chat" } })?.baseUrl).toBe(CHAT_URL);
    expect(resolveApiModeTransport("openai", { providerSpecificData: { apiMode: "responses" } })?.baseUrl).toBe(RESPONSES_URL);
  });
});

describe("apiMode persistence sanitizing", () => {
  it("resolveApiMode coerces unknown values to auto and ignores undeclared providers", () => {
    expect(resolveApiMode(["auto", "chat", "responses"], "chat")).toBe("chat");
    expect(resolveApiMode(["auto", "chat", "responses"], "bogus")).toBe("auto");
    expect(resolveApiMode(undefined, "chat")).toBeNull();
  });

  it("keeps a valid apiMode for openai, coerces a bad one, strips it for other providers", () => {
    expect(sanitizeApiMode("openai", { apiMode: "responses" })).toEqual({ apiMode: "responses" });
    expect(sanitizeApiMode("openai", { apiMode: { $ne: 1 } })).toEqual({ apiMode: "auto" });
    expect(sanitizeApiMode("anthropic", { apiMode: "responses", region: "x" })).toEqual({ region: "x" });
    expect(sanitizeApiMode("openai", { region: "x" })).toEqual({ region: "x" });
  });

  it("normalizeProviderSpecificData (create path) sanitizes apiMode", () => {
    expect(normalizeProviderSpecificData("openai", {}, { apiMode: "chat" })).toEqual({ apiMode: "chat" });
    expect(normalizeProviderSpecificData("groq", {}, { apiMode: "chat" })).toBeNull();
  });
});
