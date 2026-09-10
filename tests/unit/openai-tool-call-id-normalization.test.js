import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const validToolCallId = /^[a-zA-Z0-9_-]+$/;
const overlongId = `call_${"a".repeat(81)}`;

function toolCall(id, name = "lookup") {
  return {
    id,
    type: "function",
    function: { name, arguments: "{}" },
  };
}

function request(messages) {
  return {
    model: "gpt-5.6-luna",
    messages,
    stream: false,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  }));
});

describe("official OpenAI tool-call ID normalization", () => {
  it("normalizes an 86-character multi-turn ID and preserves its call/result relationship", () => {
    const shortId = "call_short_1";
    const out = new DefaultExecutor("openai").transformRequest(
      "gpt-5.6-luna",
      request([
        { role: "assistant", content: null, tool_calls: [toolCall(shortId)] },
        { role: "tool", tool_call_id: shortId, content: "short result" },
        { role: "assistant", content: null, tool_calls: [toolCall(overlongId)] },
        { role: "tool", tool_call_id: overlongId, content: "long result" },
      ]),
      true,
    );

    const normalizedCallId = out.messages[2].tool_calls[0].id;
    expect(overlongId).toHaveLength(86);
    expect(normalizedCallId).toHaveLength(64);
    expect(normalizedCallId).toMatch(validToolCallId);
    expect(out.messages[3].tool_call_id).toBe(normalizedCallId);
    expect(out.messages[0].tool_calls[0].id).toBe(shortId);
    expect(out.messages[1].tool_call_id).toBe(shortId);
  });

  it("normalizes repeated occurrences of the same overlong ID identically", () => {
    const out = new DefaultExecutor("openai").transformRequest(
      "gpt-5.6-luna",
      request([
        { role: "assistant", content: null, tool_calls: [toolCall(overlongId, "first")] },
        { role: "tool", tool_call_id: overlongId, content: "first result" },
        { role: "assistant", content: null, tool_calls: [toolCall(overlongId, "replayed")] },
        { role: "tool", tool_call_id: overlongId, content: "replayed result" },
      ]),
      true,
    );

    const ids = [
      out.messages[0].tool_calls[0].id,
      out.messages[1].tool_call_id,
      out.messages[2].tool_calls[0].id,
      out.messages[3].tool_call_id,
    ];
    expect(new Set(ids)).toEqual(new Set([ids[0]]));
  });

  it("is encounter-order independent when the tool result precedes its assistant call", () => {
    const out = new DefaultExecutor("openai").transformRequest(
      "gpt-5.6-luna",
      request([
        { role: "tool", tool_call_id: overlongId, content: "result first" },
        { role: "assistant", content: null, tool_calls: [toolCall(overlongId)] },
      ]),
      true,
    );

    expect(out.messages[0].tool_call_id).toBe(out.messages[1].tool_calls[0].id);
  });

  it("keeps IDs distinct when truncation alone would collide", () => {
    const sharedPrefix = `call_${"z".repeat(80)}`;
    const firstId = `${sharedPrefix}x`;
    const secondId = `${sharedPrefix}y`;
    const out = new DefaultExecutor("openai").transformRequest(
      "gpt-5.6-luna",
      request([
        { role: "assistant", content: null, tool_calls: [toolCall(firstId), toolCall(secondId)] },
        { role: "tool", tool_call_id: firstId, content: "first" },
        { role: "tool", tool_call_id: secondId, content: "second" },
      ]),
      true,
    );

    const [first, second] = out.messages[0].tool_calls.map(({ id }) => id);
    expect(firstId.slice(0, 64)).toBe(secondId.slice(0, 64));
    expect(first).not.toBe(second);
    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(first).toMatch(validToolCallId);
    expect(second).toMatch(validToolCallId);
    expect(out.messages[1].tool_call_id).toBe(first);
    expect(out.messages[2].tool_call_id).toBe(second);
  });

  it("is deterministic for the same ID across independent requests", () => {
    const executor = new DefaultExecutor("openai");
    const normalize = () => executor.transformRequest(
      "gpt-5.6-luna",
      request([{ role: "assistant", content: null, tool_calls: [toolCall(overlongId)] }]),
      true,
    ).messages[0].tool_calls[0].id;

    expect(normalize()).toBe(normalize());
  });

  it.each(["openrouter", "openai-compatible-custom"])(
    "does not normalize IDs for the %s provider",
    (provider) => {
      const out = new DefaultExecutor(provider).transformRequest(
        "gpt-5.6-luna",
        request([
          { role: "assistant", content: null, tool_calls: [toolCall(overlongId)] },
          { role: "tool", tool_call_id: overlongId, content: "result" },
        ]),
        true,
      );

      expect(out.messages[0].tool_calls[0].id).toBe(overlongId);
      expect(out.messages[1].tool_call_id).toBe(overlongId);
    },
  );

  it("sends the same normalized ID on both sides of the upstream request", async () => {
    const executor = new DefaultExecutor("openai");
    await executor.execute({
      model: "gpt-5.6-luna",
      body: request([
        { role: "assistant", content: null, tool_calls: [toolCall(overlongId)] },
        { role: "tool", tool_call_id: overlongId, content: "result" },
        { role: "user", content: "continue" },
      ]),
      stream: true,
      credentials: { apiKey: "sk-test" },
    });

    const [, init] = fetchMock.mock.calls[0];
    const upstreamBody = JSON.parse(init.body);
    const assistantId = upstreamBody.messages[0].tool_calls[0].id;
    expect(assistantId).toHaveLength(64);
    expect(assistantId).toMatch(validToolCallId);
    expect(upstreamBody.messages[1].tool_call_id).toBe(assistantId);
  });
});
