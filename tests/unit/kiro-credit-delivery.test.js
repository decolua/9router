import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { nativeResponse, kiroFrame, sseEvents } from "../helpers/kiroNative.js";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
const { kiroCreditCache } = await import("../../open-sse/services/kiroCreditCache.js");
const { selectKiroCacheResponse } = await import("../../open-sse/services/kiroCacheDelivery.js");
const symbol = Symbol.for("9router.responseDelivery");
let oldStorage;
let storage;
let executor;
const args = () => ({ model: "claude-opus-5", stream: true,
  credentials: { connectionId: "account", accessToken: "fixture" },
  body: { conversationState: { conversationId: "session", agentContinuationId: "continuation",
    currentMessage: { userInputMessage: { modelId: "claude-opus-5", content: "cacheable words ".repeat(1500) } }, history: [] } }
});
const settle = (receipt, success) => {
  receipt.finished = true;
  for (const cb of receipt.callbacks) cb(success);
};
async function run(response = nativeResponse(), { selected = true, written = true } = {}) {
  const receipt = { callbacks: new Set(), selected: null, finished: false };
  return storage.run(receipt, async () => {
    fetchMock.mockResolvedValueOnce(response);
    const result = await executor.execute(args());
    if (selected) selectKiroCacheResponse(result.response);
    const text = await result.response.text();
    settle(receipt, written);
    return text;
  });
}
function counts() {
  return [...kiroCreditCache.scopes.values()].map(s => ({ active: s.active,
    prefixes: s.prefixes.size, samples: s.samples.size, pairs: s.pairs.length }));
}
beforeEach(() => {
  oldStorage = globalThis[symbol];
  storage = new AsyncLocalStorage(); globalThis[symbol] = storage;
  kiroCreditCache.scopes.clear();
  fetchMock.mockReset().mockImplementation(async () => nativeResponse({ credits: 2 }));
  executor = new KiroExecutor();
});
afterEach(() => { globalThis[symbol] = oldStorage; });

describe("native EOF plus selected successful client delivery", () => {
  it("does not learn at native EOF or JSON/SSE consumption; commits once on delivery", async () => {
    const receipt = { callbacks: new Set(), selected: null, finished: false };
    await storage.run(receipt, async () => {
      fetchMock.mockResolvedValueOnce(nativeResponse());
      const result = await executor.execute(args());
      selectKiroCacheResponse(result.response);
      await result.response.text();
      expect(counts()).toEqual([{ active: 1, prefixes: 0, samples: 0, pairs: 0 }]);
      settle(receipt, true); settle(receipt, true);
      expect(counts()).toEqual([{ active: 0, prefixes: 1, samples: 1, pairs: 0 }]);
    });
  });

  it.each(["failed client write", "discarded fallback", "web-search side generation"])("excludes %s", async reason => {
    await run(nativeResponse(), { selected: reason === "failed client write", written: reason !== "failed client write" });
    expect(counts()).toEqual([{ active: 0, prefixes: 0, samples: 0, pairs: 0 }]);
  });

  it("a successful side generation cannot win the final response selection", async () => {
    const receipt = { callbacks: new Set(), selected: null, finished: false };
    await storage.run(receipt, async () => {
      const result = await executor.execute(args());
      await result.response.text();
      selectKiroCacheResponse(new Response("synthetic web search result"));
      settle(receipt, true);
    });
    expect(counts()).toEqual([{ active: 0, prefixes: 0, samples: 0, pairs: 0 }]);
  });

  it("does not learn without an authoritative delivery hook", async () => {
    globalThis[symbol] = undefined;
    const result = await executor.execute(args());
    await result.response.text();
    expect(counts()).toEqual([]);
  });

  it.each([401, 502])("excludes endpoint fallback or same-endpoint retry after HTTP %s", async status => {
    executor.config = { ...executor.config, retry: { 502: { attempts: 1, delayMs: 0 } } };
    await run(new Response("fixture failure", { status }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(counts()).toEqual([{ active: 0, prefixes: 0, samples: 0, pairs: 0 }]);
  });

  it("freezes the cold/warm plan before headers, including overlapping slow fetches", async () => {
    let release;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const receipt = { callbacks: new Set(), selected: null, finished: false };
    const first = storage.run(receipt, () => executor.execute(args()));
    expect(counts()[0].active).toBe(1);
    await run(nativeResponse({ credits: 2 }));
    release(nativeResponse({ credits: 10 }));
    const result = await first;
    await storage.run(receipt, async () => {
      selectKiroCacheResponse(result.response);
      const text = await result.response.text();
      expect(sseEvents(text).at(-1).usage.prompt_tokens_details).toBeUndefined();
      settle(receipt, true);
    });
    expect(counts()).toEqual([{ active: 0, prefixes: 1, samples: 0, pairs: 0 }]);
  });

  it.each([null, false, "", "NaN", 0, -1])("rejects invalid native metering %s", async credits => {
    await run(nativeResponse({ credits }));
    expect(counts()).toEqual([{ active: 0, prefixes: 0, samples: 0, pairs: 0 }]);
  });

  it.each(["max_tokens", "model_context_window_exceeded", "cancelled", "refusal", "unknown_reason"])("does not observe terminal %s", async stop => {
    await run(nativeResponse({ stop }));
    expect(counts()).toEqual([{ active: 0, prefixes: 0, samples: 0, pairs: 0 }]);
  });

  it.each(["CRC", "truncated", "JSON", "malformed event", "bad tool"])("excludes %s even if an integrity retry returns usable output", async kind => {
    let bad;
    if (kind === "CRC") { bad = kiroFrame("metadataEvent", {}); bad[bad.length - 1] ^= 1; }
    if (kind === "truncated") bad = kiroFrame("metadataEvent", {}).subarray(0, 13);
    if (kind === "JSON") bad = kiroFrame("metadataEvent", "invalid PRIVATE_PROMPT_SENTINEL", true);
    if (kind === "malformed event") bad = kiroFrame("assistantResponseEvent", { content: 123 });
    if (kind === "bad tool") bad = kiroFrame("toolUseEvent", { toolUseId: "bad", name: "tool_call", input: {} });
    const text = await run(nativeResponse({ extra: [bad] }));
    expect(text).not.toContain("PRIVATE_PROMPT_SENTINEL");
    expect(counts()).toEqual([{ active: 0, prefixes: 0, samples: 0, pairs: 0 }]);
  });

  it("missing metering and transport read errors cannot warm prefixes", async () => {
    const response = new Response(new ReadableStream({ start(c) {
      c.enqueue(kiroFrame("assistantResponseEvent", { content: "answer" }));
      c.enqueue(kiroFrame("metricsEvent", { inputTokens: 10000, outputTokens: 20 }));
      c.close();
    } }));
    await run(response);
    expect(counts()[0].prefixes).toBe(0);
    await run(new Response(new ReadableStream({ start(c) { c.error(new Error("transport failed")); } })));
    expect(counts()[0].prefixes).toBe(0);
  });

  it("explicit zero native cache fields override learned savings", async () => {
    for (const credits of [10, 2, 2]) await run(nativeResponse({ credits }));
    const text = await run(nativeResponse({ metrics: { inputTokens: 10000, outputTokens: 20,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }));
    expect(sseEvents(text).at(-1).usage.prompt_tokens_details).toEqual({ cached_tokens: 0, cache_creation_tokens: 0 });
  });

  it("sums native credit events privately while retaining public last-event serialization", async () => {
    const text = await run(nativeResponse({ credits: 2, extra: [kiroFrame("meteringEvent", { usage: 3, unit: "credit" })] }));
    expect(sseEvents(text).at(-1).usage).toMatchObject({ kiro_credits: 3, kiro_credit_unit: "credit" });
    const scope = [...kiroCreditCache.scopes.values()][0];
    expect([...scope.samples.values()][0].coldDensity).toBe(5 / 10020);
  });

  it("rejects a late abort even after native EOF, before a purported delivery success", async () => {
    const controller = new AbortController();
    const receipt = { callbacks: new Set(), selected: null, finished: false };
    await storage.run(receipt, async () => {
      const result = await executor.execute({ ...args(), signal: controller.signal });
      selectKiroCacheResponse(result.response);
      await result.response.text();
      controller.abort();
      settle(receipt, true);
    });
    expect(counts()).toEqual([{ active: 0, prefixes: 0, samples: 0, pairs: 0 }]);
  });

  it("out-of-order concurrent native requests never train billing pairs", async () => {
    const receipts = [];
    await Promise.all(Array.from({ length: 12 }, async () => {
      const receipt = { callbacks: new Set(), selected: null, finished: false }; receipts.push(receipt);
      await storage.run(receipt, async () => {
        const result = await executor.execute(args()); selectKiroCacheResponse(result.response);
        await result.response.text();
      });
    }));
    receipts.reverse().forEach(receipt => settle(receipt, true));
    expect(counts()).toEqual([{ active: 0, prefixes: 1, samples: 0, pairs: 0 }]);
  });
});


describe("late Kiro input estimation", () => {
  it("fills missing input after output metrics and refreshes total before calibration", async () => {
    const text = await run(nativeResponse({ metrics: { outputTokens: 37 }, extra: [
      kiroFrame("contextUsageEvent", { contextUsagePercentage: 10 })
    ] }));
    const usage = sseEvents(text).findLast(e => e.usage)?.usage;
    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBe(37);
    expect(usage.total_tokens).toBe(usage.prompt_tokens + 37);
    expect([...kiroCreditCache.scopes.values()][0].samples.values().next().value.coldDensity)
      .toBe(10 / usage.total_tokens);
  });
  it("does not refill fully cached native input from context percentage", async () => {
    const text = await run(nativeResponse({ metrics: { inputTokens: 0, outputTokens: 37, cacheReadInputTokens: 10000 },
      extra: [kiroFrame("contextUsageEvent", { contextUsagePercentage: 50 })] }));
    const usage = sseEvents(text).findLast(e => e.usage)?.usage;
    expect(usage.prompt_tokens).toBe(10000);
    expect(usage.total_tokens).toBe(10037);
  });
});


describe("startup fallback delivery boundaries", () => {
  it("does not apply or train a warmed fallback on a retried attempt", async () => {
    const previous = kiroCreditCache.staticReadRatio;
    kiroCreditCache.staticReadRatio = 0.4;
    try {
      await run(nativeResponse({ credits: 10 }));
      const retry = await run(new Response("fixture failure", { status: 401 }));
      expect(sseEvents(retry).at(-1).usage.prompt_tokens_details).toBeUndefined();
      expect(counts()[0].pairs).toBe(0);
      const next = await run(nativeResponse({ credits: 2 }), { written: false });
      expect(sseEvents(next).at(-1).usage.prompt_tokens_details.cached_tokens).toBe(4000);
      expect(counts()[0].pairs).toBe(0); // failed delivery cannot train the warm pair
    } finally { kiroCreditCache.staticReadRatio = previous; }
  });
});
