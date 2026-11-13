import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true }) }));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshWithRetry: vi.fn() }));
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter media egress", () => {
  it("applies System One policy without changing its decision payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: {} })));
    vi.stubGlobal("fetch", fetchMock);
    const body = { state: "hello", questions: { ready: { type: "boolean" } } };
    await handleSystemoneCore({ body, modelInfo: { provider: "openrouter", model: "typesafe/jev-1.13" }, credentials: { apiKey: "test" }, routingPolicy: { zdr: true } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ ...body, provider: { zdr: true } });
    expect(body.provider).toBeUndefined();
  });

  it("applies embedding policy after body construction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], usage: { prompt_tokens: 1, total_tokens: 1 } })));
    vi.stubGlobal("fetch", fetchMock);
    await handleEmbeddingsCore({
      body: { input: "hello", provider: { sort: "latency", zdr: false } },
      modelInfo: { provider: "openrouter", model: "openai/text-embedding-3-small" },
      credentials: { apiKey: "test" }, routingPolicy: { zdr: true, quantizations: ["fp8"] },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).toEqual({ sort: "latency", zdr: true });
  });

  it("forwards policy through the separate TTS audio-completion adapter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"audio":{"data":"YQ=="}}}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleTtsCore({ provider: "openrouter", model: "openai/gpt-4o-mini-tts/alloy", input: "hello", credentials: { apiKey: "test" }, routingPolicy: { zdr: true, quantizations: ["bf16"] } });
    expect(result.success).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).toEqual({ zdr: true });
  });

  it("still restricts open-weight embedding models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], usage: {} })));
    vi.stubGlobal("fetch", fetchMock);
    await handleEmbeddingsCore({
      body: { input: "hello" },
      modelInfo: { provider: "openrouter", model: "qwen/qwen3-embedding-8b" },
      credentials: { apiKey: "test" }, routingPolicy: { quantizations: ["bf16"] },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).toEqual({ quantizations: ["bf16"] });
  });

  it("preserves explicit TTS precision filters for proprietary models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"audio":{"data":"YQ=="}}}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleTtsCore({ provider: "openrouter", input: "hello", credentials: { apiKey: "test" }, routingPolicy: { quantizations: ["bf16"] }, requestProvider: { quantizations: ["unknown"] } });
    expect(result.success).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).toEqual({ quantizations: ["unknown"] });
  });

  it("rejects conflicting TTS policy before network I/O", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleTtsCore({ provider: "openrouter", model: "vendor/open-model/alloy", input: "hello", credentials: { apiKey: "test" }, routingPolicy: { quantizations: ["bf16"] }, requestProvider: { quantizations: ["fp4"] } });
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
