import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  translateResponse: vi.fn((_target, _source, chunk) => [chunk]),
  needsTranslation: vi.fn(() => false),
  fakeExecutor: { execute: vi.fn(), parseError: vi.fn(), noAuth: true },
}));

vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(async () => {}), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: mocks.saveRequestDetail, saveRequestUsage: mocks.saveRequestUsage }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn(async () => {}) }));
vi.mock("../../open-sse/translator/index.js", () => ({ translateRequest: vi.fn((_source, _target, _model, body) => ({ ...body })), translateResponse: mocks.translateResponse, initState: vi.fn(() => ({ usage: null })), needsTranslation: mocks.needsTranslation, register: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => mocks.fakeExecutor }));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const input = (overrides = {}) => ({ body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: false }, modelInfo: { provider: "groq", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} }, log: { debug() {}, info() {}, warn() {}, line() {}, errorLine() {} }, sourceFormatOverride: "openai", connectionId: "connection", clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} }, ...overrides });

describe("chatCore dispatch behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needsTranslation.mockReturnValue(false);
  });

  it("preserves an upstream failure status without recording account success", async () => {
    mocks.fakeExecutor.execute.mockResolvedValueOnce({ response: new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 }), url: "https://provider.invalid/chat", headers: {}, transformedBody: {} });
    const onRequestSuccess = vi.fn();
    const result = await handleChatCore(input({ onRequestSuccess }));
    expect(result).toMatchObject({ success: false, status: 503 });
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("keeps success bookkeeping errors out of a valid non-stream response", async () => {
    mocks.fakeExecutor.execute.mockResolvedValueOnce({ response: new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } }), url: "https://provider.invalid/chat", headers: {}, transformedBody: {} });
    const onRequestSuccess = vi.fn(async () => { throw new Error("bookkeeping unavailable"); });
    const result = await handleChatCore(input({ onRequestSuccess }));
    expect(result.success).toBe(true);
    expect(onRequestSuccess).toHaveBeenCalledOnce();
  });

  it("persists authoritative usage once for a failed Responses stream", async () => {
    const encoder = new TextEncoder();
    mocks.fakeExecutor.execute.mockResolvedValueOnce({ response: new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('event: response.in_progress\ndata: {"response":{"usage":{"input_tokens":11,"output_tokens":7}}}\n\nevent: response.failed\ndata: {"response":{"status":"failed","error":{"message":"capacity exhausted","status":503}}}\n\n')); controller.close(); } }), { headers: { "content-type": "text/event-stream" } }), url: "https://provider.invalid/responses", headers: {}, transformedBody: {}, responseFormat: "openai-responses" });
    const onRequestSuccess = vi.fn();
    const result = await handleChatCore(input({ body: { model: "gpt-test", messages: [], stream: true }, modelInfo: { provider: "codex", model: "gpt-test" }, sourceFormatOverride: "openai-responses", clientRawRequest: { endpoint: "/v1/responses", body: {}, headers: {} }, onRequestSuccess }));
    await result.response.text();
    await Promise.resolve();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(mocks.saveRequestUsage).toHaveBeenCalledOnce();
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "error", tokens: expect.objectContaining({ prompt_tokens: 11, completion_tokens: 7 }) }));
  });
});
