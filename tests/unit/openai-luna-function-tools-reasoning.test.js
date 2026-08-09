import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const overlongId = `call_${"a".repeat(81)}`;

function functionTool() {
  return {
    type: "function",
    function: {
      name: "lookup_weather",
      description: "Look up the weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  };
}

function toolCall(id = overlongId) {
  return {
    id,
    type: "function",
    function: { name: "lookup_weather", arguments: '{"city":"Jakarta"}' },
  };
}

function request(overrides = {}) {
  return {
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: "What is the weather?" }],
    stream: false,
    max_tokens: 321,
    tools: [functionTool()],
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  }));
});

describe("official OpenAI Luna function-tool reasoning compatibility", () => {
  it("forces reasoning_effort:none and preserves the existing compatibility transforms", async () => {
    const executor = new DefaultExecutor("openai");
    await executor.execute({
      model: "gpt-5.6-luna",
      body: request({
        reasoning_effort: "high",
        messages: [
          { role: "assistant", content: null, tool_calls: [toolCall()] },
          { role: "tool", tool_call_id: overlongId, content: "sunny" },
        ],
      }),
      stream: true,
      credentials: { apiKey: "sk-test" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    const normalizedId = body.messages[0].tool_calls[0].id;

    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 321,
      reasoning_effort: "none",
    });
    expect(body.max_tokens).toBeUndefined();
    expect(normalizedId).toHaveLength(64);
    expect(body.messages[1].tool_call_id).toBe(normalizedId);
  });

  it("overrides an explicit non-none effort but leaves an explicit none unchanged", () => {
    const executor = new DefaultExecutor("openai");
    expect(executor.transformRequest("gpt-5.6-luna", request()).reasoning_effort)
      .toBe("none");
    expect(executor.transformRequest("gpt-5.6-luna", request({ reasoning_effort: "high" })).reasoning_effort)
      .toBe("none");
    expect(executor.transformRequest("gpt-5.6-luna", request({ reasoning_effort: "none" })).reasoning_effort)
      .toBe("none");
  });

  it("does not infer current tools from tool-call history alone", () => {
    const body = request({
      reasoning_effort: "high",
      tools: undefined,
      messages: [
        { role: "assistant", content: null, tool_calls: [toolCall()] },
        { role: "tool", tool_call_id: overlongId, content: "sunny" },
      ],
    });

    const out = new DefaultExecutor("openai").transformRequest("gpt-5.6-luna", body);
    expect(out.reasoning_effort).toBe("high");
  });

  it("does not change Luna requests without a function tool declaration", () => {
    const executor = new DefaultExecutor("openai");
    expect(executor.transformRequest("gpt-5.6-luna", request({ tools: [], reasoning_effort: "high" })).reasoning_effort)
      .toBe("high");
    expect(executor.transformRequest("gpt-5.6-luna", request({ tools: [{ type: "web_search" }], reasoning_effort: "high" })).reasoning_effort)
      .toBe("high");
  });

  it("does not apply to the client-facing Responses API path", async () => {
    await new DefaultExecutor("openai").execute({
      model: "gpt-5.6-luna",
      body: request({ reasoning_effort: "high" }),
      stream: true,
      sourceFormat: "openai-responses",
      credentials: { apiKey: "sk-test" },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe("high");
  });

  it("does not affect other models or providers", () => {
    const body = request({ reasoning_effort: "high" });
    expect(new DefaultExecutor("openai").transformRequest("gpt-4o", body).reasoning_effort).toBe("high");
    expect(new DefaultExecutor("openrouter").transformRequest("gpt-5.6-luna", request({ reasoning_effort: "high" })).reasoning_effort)
      .toBe("high");
    expect(new DefaultExecutor("openai-compatible-custom").transformRequest("gpt-5.6-luna", request({ reasoning_effort: "high" })).reasoning_effort)
      .toBe("high");
  });
});
