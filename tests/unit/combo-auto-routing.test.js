import { describe, it, expect, vi, afterEach } from "vitest";
import { AUTO_ROUTING_TIERS, validateAutoRouting } from "../../open-sse/config/autoRouting.js";
import { buildClassificationContext, classifyRequest, handleAutoRoutingChat, parseClassifiedTier } from "../../open-sse/services/autoRouting.js";
import * as capabilities from "../../open-sse/providers/capabilities.js";

const config = () => ({ classifierModel: "openai/classifier", timeoutMs: 2000, tiers: Object.fromEntries(AUTO_ROUTING_TIERS.map(({ id }) => [id, [`openai/${id}`]])) });
const body = () => ({ model: "smart", messages: [{ role: "user", content: "Explain this algorithm" }], stream: true, tools: [{ type: "function", function: { name: "run" } }] });
const ok = (content = '{"tier":"MEDIUM"}') => Response.json({ choices: [{ message: { content } }] });
const error = (status = 429) => Response.json({ error: { message: "Unavailable" } }, { status });
const log = { info: vi.fn(), warn: vi.fn() };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("auto-routing configuration", () => {
  it("requires all four concrete pools and rejects nested combos and duplicates", () => {
    expect(validateAutoRouting(config())).toBeNull();
    expect(validateAutoRouting({ ...config(), classifierModel: "another-combo" })).toMatch(/concrete/);
    for (const tiers of [{ SIMPLE: ["openai/a"] }, { ...config().tiers, MEDIUM: ["smart"] }, { ...config().tiers, SIMPLE: ["openai/a", "openai/a"] }]) {
      expect(validateAutoRouting({ ...config(), tiers })).toBeTruthy();
    }
    expect(validateAutoRouting({ ...config(), timeoutMs: 0 })).toMatch(/timeout/);
    expect(validateAutoRouting({ ...config(), timeoutMs: 1.5 })).toMatch(/timeout/);
  });
});

describe("classification context", () => {
  it("includes assistant context for approvals while excluding tools and reasoning", () => {
    const request = { messages: [
      { role: "system", content: "system" },
      { role: "user", content: "Refactor authentication" },
      { role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "A complex plan. Proceed?" }], tool_calls: [{ function: { arguments: "secret" } }] },
      { role: "tool", content: "private output" },
      { role: "user", content: [{ type: "text", text: "yes" }, { type: "image", source: { data: "secret image" } }] },
      { role: "user", content: [{ type: "tool_result", content: "more private output" }] },
    ] };
    const before = structuredClone(request);
    const result = buildClassificationContext(request);
    expect(result.currentAsk).toBe("yes");
    expect(result.recentConversation.map((turn) => turn.text)).toEqual(["Refactor authentication", "A complex plan. Proceed?"]);
    expect(result.requiredCapabilities).toContain("vision");
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
    expect(request).toEqual(before);
  });
  it.each([
    [{ input: "hello", instructions: "system" }, "hello"],
    [{ input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "response ask" }] }, { type: "function_call_output", output: "secret" }] }, "response ask"],
    [{ system: [{ type: "text", text: "system" }], messages: [{ role: "user", content: [{ type: "text", text: "claude ask" }] }] }, "claude ask"],
    [{ contents: [{ role: "user", parts: [{ text: "gemini ask" }, { inlineData: { mimeType: "image/png", data: "secret" } }] }], systemInstruction: { parts: [{ text: "system" }] } }, "gemini ask"],
    [{ request: { contents: [{ role: "model", parts: [{ text: "secret", thought: true }, { text: "previous answer" }] }, { role: "user", parts: [{ text: "wrapped ask" }] }] } }, "wrapped ask"],
  ])("extracts supported request shapes", (request, ask) => {
    const result = buildClassificationContext(request);
    expect(result.currentAsk).toBe(ask);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("bounds text and takes the nearest three turns", () => {
    const result = buildClassificationContext({ system: "s".repeat(3000), messages: [
      { role: "user", content: "old" },
      { role: "assistant", content: "recent1" },
      { role: "user", content: "recent2" },
      { role: "assistant", content: "x".repeat(9000) },
      { role: "user", content: "a".repeat(9000) },
    ] });
    expect(result.currentAsk).toHaveLength(8000);
    expect(result.currentAsk).toMatch(/\[truncated\]$/);
    expect(result.callerSystemContext).toHaveLength(2000);
    expect(result.recentConversation.reduce((n, turn) => n + turn.text.length, 0)).toBe(8000);
    expect(JSON.stringify(result)).not.toContain('"old"');
    expect(buildClassificationContext({ messages: [{ role: "tool", content: "output" }] })).toBeNull();
  });
});

describe("LLM classification", () => {
  it.each(AUTO_ROUTING_TIERS.map(({ id }) => id))("selects %s with an isolated request", async (tier) => {
    const classify = vi.fn(async () => ok(JSON.stringify({ tier })));
    expect(await classifyRequest({ body: body(), config: config(), classify })).toBe(tier);
    const [request, model, signal] = classify.mock.calls[0];
    expect(model).toBe("openai/classifier");
    expect(request.stream).toBe(false);
    expect(request.tools).toBeUndefined();
    expect(request.messages[0].role).toBe("system");
    expect(JSON.parse(request.messages[1].content).currentAsk).toBe("Explain this algorithm");
    expect(signal).toBeInstanceOf(AbortSignal);
  });
  it.each(["", "MEDIUM", '{"tier":"other"}', '{"tier":"SIMPLE","extra":1}', "null"])("rejects malformed output %s", (content) => {
    expect(() => parseClassifiedTier({ choices: [{ message: { content } }] })).toThrow();
  });
  it("bounds parsing as well as the provider call and aborts upstream", async () => {
    vi.useFakeTimers();
    let signal;
    const pending = classifyRequest({ body: body(), config: config(), classify: async (_b, _m, s) => {
      signal = s;
      return { ok: true, json: () => new Promise(() => {}) };
    } });
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(signal.aborted).toBe(true);
  });
  it("refuses nested classifier models before any call", async () => {
    const classify = vi.fn();
    await expect(classifyRequest({ body: body(), config: { ...config(), classifierModel: "smart" }, classify })).rejects.toThrow(/concrete/);
    expect(classify).not.toHaveBeenCalled();
  });
});

describe("auto-routing execution", () => {
  const run = (overrides = {}) => handleAutoRoutingChat({ body: body(), models: ["openai/emergency"], config: config(), classify: async () => ok(), handleSingleModel: async () => ok("answer"), settings: {}, log, comboName: "smart", ...overrides });
  it("tries the tier pool before deduplicated emergency models and isolates mutations", async () => {
    const request = body();
    const before = structuredClone(request);
    const cfg = config();
    cfg.tiers.MEDIUM = ["openai/a", "openai/b"];
    const handleSingleModel = vi.fn(async (b, model) => {
      expect(b).toEqual(before);
      b.messages[0].content = "mutated";
      return model === "openai/emergency" ? ok("answer") : error();
    });
    expect((await run({ body: request, config: cfg, models: ["openai/b", "openai/emergency"], handleSingleModel })).ok).toBe(true);
    expect(handleSingleModel.mock.calls.map((call) => call[1])).toEqual(["openai/a", "openai/b", "openai/emergency"]);
    expect(request).toEqual(before);
  });
  it.each([async () => error(), async () => ok("invalid"), async () => { throw new Error("offline"); }])("uses combo fallback on classifier failure", async (classify) => {
    const single = vi.fn(async () => ok("answer"));
    await run({ classify, handleSingleModel: single });
    expect(single.mock.calls[0][1]).toBe("openai/emergency");
  });
  it("does not classify requests without a human ask", async () => {
    const classify = vi.fn();
    const single = vi.fn(async () => ok());
    await run({ body: { messages: [] }, classify, handleSingleModel: single });
    expect(classify).not.toHaveBeenCalled();
    expect(single.mock.calls[0][1]).toBe("openai/emergency");
  });
  it("does not fall through non-retryable errors", async () => {
    const single = vi.fn(async () => error(400));
    expect((await run({ handleSingleModel: single })).status).toBe(400);
    expect(single).toHaveBeenCalledTimes(1);
  });
  it("keeps capable emergency models behind the selected tier", async () => {
    const cfg = config();
    cfg.tiers.MEDIUM = ["openai/gpt-4o"];
    const single = vi.fn(async () => ok());
    await run({ config: cfg, models: ["openai/gpt-4o-mini"], body: { messages: [{ role: "user", content: [{ type: "text", text: "Describe" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] }] }, handleSingleModel: single });
    expect(single.mock.calls[0][1]).toBe("openai/gpt-4o");
  });
  it("stops on client cancellation without calling fallback", async () => {
    const controller = new AbortController();
    let upstream;
    const single = vi.fn();
    const pending = run({ signal: controller.signal, classify: (_b, _m, signal) => { upstream = signal; return new Promise(() => {}); }, handleSingleModel: single });
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(upstream.aborted).toBe(true);
    expect(single).not.toHaveBeenCalled();
  });
  it.each([true, false])("only trims history when a model is actually added by an adapter (tier capable: %s)", async (tierCapable) => {
    vi.spyOn(capabilities, "getCapabilitiesForModel").mockImplementation((_provider, model) => ({ vision: model === "vision", contextWindow: 100 }));
    const cfg = config();
    cfg.tiers.MEDIUM = [tierCapable ? "openai/vision" : "openai/text"];
    const request = { messages: [
      ...Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "history".repeat(100) })),
      { role: "user", content: [{ type: "text", text: "Describe this" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] },
    ] };
    const single = vi.fn(async () => ok());
    await run({ config: cfg, body: request, settings: { capacityAdapter: { vision: { enabled: true, models: ["openai/vision"] } } }, handleSingleModel: single });
    const [sent, model] = single.mock.calls[0];
    expect(model).toBe("openai/vision");
    if (tierCapable) expect(sent.messages).toEqual(request.messages);
    else expect(sent.messages.length).toBeLessThan(request.messages.length);
    expect(sent.messages.at(-1)).toEqual(request.messages.at(-1));
  });
});
