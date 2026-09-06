import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { nativeResponse, sseEvents } from "../helpers/kiroNative.js";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {})
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => ({
  logClientRawRequest() {}, logRawRequest() {}, logTargetRequest() {}, logError() {},
  logProviderResponse() {}, logConvertedResponse() {},
  appendUpstreamChunk() {}, appendConvertedChunk() {}, appendOpenAIChunk() {}
}) }));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { kiroCreditCache } = await import("../../open-sse/services/kiroCreditCache.js");
const { selectKiroCacheResponse } = await import("../../open-sse/services/kiroCacheDelivery.js");
const { clearKiroSessionReplayStore } = await import("../../open-sse/utils/kiroSessionReplay.js");
beforeEach(() => {
  kiroCreditCache.scopes.clear();
  clearKiroSessionReplayStore();
});
afterEach(() => vi.clearAllMocks());

describe("Kiro public usage boundaries", () => {
  it("preserves existing public credit fields without exposing estimator metadata", async () => {
    fetchMock.mockResolvedValueOnce(nativeResponse());
    const result = await new KiroExecutor().execute({ model: "claude-opus-5", body: {},
      stream: true, credentials: { accessToken: "fixture" } });
    const text = await result.response.text();
    expect(sseEvents(text).at(-1).usage).toMatchObject({ kiro_credits: 10, kiro_credit_unit: "credit" });
    expect(text).not.toMatch(/calibration|fingerprint|observation|responseDelivery/);
  });

  for (const sourceFormat of [FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE]) {
    it.each([true, false])(`${sourceFormat} preserves fully cached native usage, stream=%s`, async stream => {
      fetchMock.mockResolvedValueOnce(nativeResponse({ metrics: {
        inputTokens: 0, outputTokens: 20, cacheReadInputTokens: 10000
      } }));
      const body = { model: "kiro/claude-opus-5", stream, max_tokens: 100,
        ...(sourceFormat === FORMATS.OPENAI_RESPONSES
          ? { input: [{ role: "user", content: "hello" }] }
          : { messages: [{ role: "user", content: "hello" }] }) };
      const result = await handleChatCore({ body,
        modelInfo: { provider: "kiro", model: "claude-opus-5" },
        credentials: { connectionId: "fixture", accessToken: "fixture", providerSpecificData: {} },
        connectionId: "fixture", sourceFormatOverride: sourceFormat });
      const text = await result.response.text();
      expect(text).not.toMatch(/calibration|fingerprint|observation|responseDelivery/);
      const events = stream ? sseEvents(text) : [JSON.parse(text)];
      const usage = events.map(e => e.response?.usage || e.usage).filter(Boolean).at(-1);
      expect(usage).toBeDefined();
      if (sourceFormat === FORMATS.CLAUDE) {
        expect(usage.cache_read_input_tokens).toBe(10000);
        expect(usage.input_tokens).toBeLessThanOrEqual(2000); // existing stream safety buffer
      } else {
        expect((usage.prompt_tokens_details || usage.input_tokens_details)?.cached_tokens).toBe(10000);
        expect(usage.prompt_tokens ?? usage.input_tokens).toBeGreaterThanOrEqual(10000);
        expect(usage.prompt_tokens ?? usage.input_tokens).toBeLessThanOrEqual(12000);
      }
    });
  }
});

describe("calibration through real request/response translators and chatCore", () => {
  for (const sourceFormat of [FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE]) {
    it.each([true, false])(`${sourceFormat} append-only cold/warm accounting, stream=%s`, async stream => {
      const storage = new AsyncLocalStorage();
      const symbol = Symbol.for("9router.responseDelivery");
      const old = globalThis[symbol];
      globalThis[symbol] = storage;
      const messages = [{ role: "user", content: "canonical prefix ".repeat(1600) }];
      const usages = [];
      try {
        for (const credits of [10, 2, 2, 2]) {
          const delivery = { callbacks: new Set(), finished: false, selected: null };
          await storage.run(delivery, async () => {
            fetchMock.mockResolvedValueOnce(nativeResponse({ credits }));
            const body = { stream, max_tokens: 100, session_id: "fixture-session",
              ...(sourceFormat === FORMATS.OPENAI_RESPONSES ? { input: structuredClone(messages) } : { messages: structuredClone(messages) }) };
            const result = await handleChatCore({ body,
              modelInfo: { provider: "kiro", model: "claude-opus-5" },
              credentials: { accessToken: "fixture", connectionId: "account-calibration" },
              connectionId: "account-calibration", sourceFormatOverride: sourceFormat,
              clientRawRequest: { headers: { "x-session-id": "fixture-session" } } });
            selectKiroCacheResponse(result.response);
            const text = await result.response.text();
            expect(text).not.toMatch(/calibration|fingerprint|observation|responseDelivery/);
            const events = stream ? sseEvents(text) : [JSON.parse(text)];
            const usage = events.map(e => e.response?.usage || e.usage).filter(Boolean).at(-1);
            usages.push(usage);
            // Merely draining the response (including JSON conversion) is not a
            // successful client write. The transport receipt is still pending.
            expect([...kiroCreditCache.scopes.values()].some(s => s.active === 1)).toBe(true);
            delivery.finished = true;
            for (const callback of delivery.callbacks) callback(true);
          });
          messages.push({ role: "assistant", content: "A complete answer." }, { role: "user", content: "continue" });
        }
        const read = u => u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0;
        expect(usages.slice(0, 3).map(read)).toEqual([0, 0, 0]);
        expect(read(usages[3])).toBeGreaterThan(5000);
        if (sourceFormat === FORMATS.CLAUDE) {
          expect(usages[3].input_tokens + read(usages[3])).toBe(usages[0].input_tokens);
        } else {
          expect(usages[3].prompt_tokens ?? usages[3].input_tokens).toBe(usages[0].prompt_tokens ?? usages[0].input_tokens);
        }
        // No new public names except the existing protocol's cache usage fields.
        const cacheKeys = new Set(["cache_read_input_tokens", "cache_creation_input_tokens", "prompt_tokens_details", "input_tokens_details"]);
        expect(Object.keys(usages[3]).filter(k => !cacheKeys.has(k)).sort())
          .toEqual(Object.keys(usages[0]).filter(k => !cacheKeys.has(k)).sort());
      } finally { globalThis[symbol] = old; }
    });
  }
});
