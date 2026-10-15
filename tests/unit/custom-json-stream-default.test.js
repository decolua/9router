import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args) }));
vi.mock("open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest() {}, logRawRequest() {}, logOpenAIRequest() {}, logTargetRequest() {},
    logProviderResponse() {}, logConvertedResponse() {}, logError() {},
    appendProviderChunk() {}, appendOpenAIChunk() {}, appendClientChunk() {},
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { CUSTOM_JSON_DEFAULTS } from "open-sse/config/customJson.js";

const provider = "openai-compatible-custom-json-stream-test";
const model = "test-model";
const credentials = { apiKey: "fixture-key", providerSpecificData: {
  apiType: "custom-json", baseUrl: "https://example.com/business", customJson: { ...CUSTOM_JSON_DEFAULTS, responsePath: "message" },
} };
const log = { debug() {}, info() {}, warn() {}, error() {} };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "翻译成功" })));
});
afterEach(() => vi.unstubAllGlobals());

async function call(stream, accept) {
  const body = { model: `${provider}/${model}`, messages: [{ role: "user", content: "Translate hello" }], ...(stream === undefined ? {} : { stream }) };
  return handleChatCore({ body, modelInfo: { provider, model }, credentials: structuredClone(credentials), log,
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: accept ? { accept } : {} },
  });
}

describe("custom JSON response format for translation clients", () => {
  it.each([undefined, "*/*", "application/json"])("returns parseable JSON when stream is omitted and Accept is %s", async (accept) => {
    const { response } = await call(undefined, accept);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).choices[0].message.content).toBe("翻译成功");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({ model, messages: [{ role: "user", content: "Translate hello" }] });
  });
  it("keeps explicit stream:false as JSON", async () => {
    const { response } = await call(false, "*/*");
    expect((await response.json()).choices[0].message.content).toBe("翻译成功");
  });
  it("keeps explicit stream:true as SSE even with Accept: application/json", async () => {
    const { response } = await call(true, "application/json");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const raw = await response.text();
    expect(raw).toContain("翻译成功");
    expect(raw).toContain("data: [DONE]");
  });
});
