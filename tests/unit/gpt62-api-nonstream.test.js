import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { initTranslators } = await import("../../open-sse/translator/index.js");
const upstream = await import("../../open-sse/utils/proxyFetch.js");
afterEach(() => vi.restoreAllMocks());

for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
  it(`${id}: characterizes existing API nonstream controller/body mismatch`, async () => {
    await initTranslators();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected external fetch"); });
    const valid = { id: "api_fixture", object: "chat.completion", model: id, choices: [{ index: 0, message: { role: "assistant", content: "fixture answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } };
    expect(JSON.parse(JSON.stringify(valid))).toEqual(valid);
    const fetch = vi.spyOn(upstream, "proxyAwareFetch").mockResolvedValue(new Response(JSON.stringify(valid), { headers: { "content-type": "application/json" } }));
    const body = { model: id, stream: false, reasoning_effort: "high", messages: [{ role: "user", content: "Hello fixture" }] };
    const result = await handleChatCore({
      body, modelInfo: { provider: "openai", model: id },
      credentials: { apiKey: "api-fixture", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      connectionId: "fixture", rtkEnabled: false, headroomEnabled: false,
      cavemanEnabled: false, ponytailEnabled: false, pxpipeEnabled: false,
      sourceFormatOverride: "openai",
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    });
    const text = await result.response.text();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(init.body).stream).toBe(false);
    expect(text).toContain('"content":"fixture answer"');
    expect(text).toContain("data: [DONE]");
    expect(() => JSON.parse(text)).toThrow(SyntaxError);
  });
}
