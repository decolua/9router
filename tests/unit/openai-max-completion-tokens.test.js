import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const request = (overrides = {}) => ({
  messages: [{ role: "user", content: "hello" }],
  max_tokens: 321,
  ...overrides,
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  }));
});

describe("OpenAI Chat Completions token-limit compatibility", () => {
  it("maps max_tokens for openai/gpt-5.6-luna", () => {
    const out = new DefaultExecutor("openai").transformRequest("gpt-5.6-luna", request());

    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBe(321);
  });

  it("preserves an explicit max_completion_tokens value", () => {
    const out = new DefaultExecutor("openai").transformRequest(
      "gpt-5.6-luna",
      request({ max_completion_tokens: 654 }),
    );

    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBe(654);
  });

  it("also maps the established OpenAI reasoning-model families", () => {
    const out = new DefaultExecutor("openai").transformRequest("o3-mini", request());

    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBe(321);
  });

  it("keeps max_tokens for legacy OpenAI models", () => {
    const out = new DefaultExecutor("openai").transformRequest("gpt-4o", request());

    expect(out.max_tokens).toBe(321);
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it.each(["openrouter", "openai-compatible-custom"])(
    "does not rewrite max_tokens for the %s provider",
    (provider) => {
      const out = new DefaultExecutor(provider).transformRequest("gpt-5.6-luna", request());

      expect(out.max_tokens).toBe(321);
      expect(out.max_completion_tokens).toBeUndefined();
    },
  );
});

describe("official OpenAI force-stream request consistency", () => {
  it("sends stream:true upstream when the resolved executor mode is streaming", async () => {
    const executor = new DefaultExecutor("openai");
    expect(PROVIDERS.openai.forceStream).toBe(true);

    await executor.execute({
      model: "gpt-5.6-luna",
      body: request({ stream: false }),
      stream: PROVIDERS.openai.forceStream,
      credentials: { apiKey: "sk-test" },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      stream: true,
      max_completion_tokens: 321,
      stream_options: { include_usage: true },
    });
  });

  it("does not add forced-stream usage options for an explicit streaming request", async () => {
    const executor = new DefaultExecutor("openai");

    await executor.execute({
      model: "gpt-5.6-luna",
      body: request({ stream: true }),
      stream: true,
      credentials: { apiKey: "sk-test" },
    });

    const [, init] = fetchMock.mock.calls[0];
    const upstreamBody = JSON.parse(init.body);
    expect(upstreamBody.stream).toBe(true);
    expect(upstreamBody.stream_options).toBeUndefined();
  });

  it("preserves explicit non-streaming when the executor mode is non-streaming", async () => {
    const executor = new DefaultExecutor("openai");

    await executor.execute({
      model: "gpt-5.6-luna",
      body: request({ stream: false }),
      stream: false,
      credentials: { apiKey: "sk-test" },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).stream).toBe(false);
  });

  it.each(["openrouter", "openai-compatible-custom"])(
    "does not override stream:false for the %s provider",
    async (provider) => {
      const executor = new DefaultExecutor(provider);

      await executor.execute({
        model: "gpt-5.6-luna",
        body: request({ stream: false }),
        stream: true,
        credentials: {
          apiKey: "sk-test",
          providerSpecificData: { baseUrl: "https://compatible.example/v1" },
        },
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body).stream).toBe(false);
    },
  );
});
