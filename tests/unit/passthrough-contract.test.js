import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

const frame = (delta, finish_reason = null, extra = {}) => `data: ${JSON.stringify({
  id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1,
  choices: [{ index: 0, delta, finish_reason, ...extra }],
})}\n\n`;

async function transform(raw, onComplete) {
  const bytes = new TextEncoder().encode(raw);
  const input = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  return new Response(input.pipeThrough(createPassthroughStreamWithLogger("openai", null, "test", null, null, onComplete))).text();
}

describe("OpenAI passthrough contract", () => {
  it("emits one finish and one DONE when upstream repeats both", async () => {
    const finish = frame({}, "stop");
    const result = await transform(frame({ content: "ok" }) + finish + finish + "data: [DONE]\n\ndata: [DONE]\n\n");
    expect(result.match(/"finish_reason":"stop"/g)).toHaveLength(1);
    expect(result.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("retains final provider usage from a duplicate finish chunk", async () => {
    const onComplete = vi.fn();
    const usage = { prompt_tokens: 13, completion_tokens: 2, total_tokens: 15 };
    const trailer = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage })}\n\n`;
    const result = await transform(frame({ content: "ok" }) + frame({}, "stop") + trailer, onComplete);
    expect(result.match(/"finish_reason":"stop"/g)).toHaveLength(1);
    const chunks = result.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
    expect(chunks.find((chunk) => chunk.choices.length === 0)?.usage.completion_tokens).toBe(2);
    expect(onComplete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ prompt_tokens: 13, completion_tokens: 2 }), expect.any(Number));
    expect(onComplete.mock.calls[0][1]).not.toHaveProperty("estimated");
  });

  it("normalizes a reasoning-only delta before filtering empty chunks", async () => {
    const result = await transform(frame({ reasoning: "thinking" }) + frame({ content: "answer" }) + frame({}, "stop"));
    expect(result).toContain('"reasoning_content":"thinking"');
    expect(result).not.toContain('"reasoning":"thinking"');
  });

  it("does not append a second DONE when the last sentinel has no newline", async () => {
    const result = await transform(frame({ content: "ok" }) + "data: [DONE]");
    expect(result.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("separates an unterminated final JSON frame from DONE", async () => {
    const result = await transform(frame({ content: "tail" }, "stop").trimEnd());
    expect(result).toContain('}\n\ndata: [DONE]\n\n');
  });

  it("fails an empty completion carrying a native provider error", async () => {
    await expect(transform(frame({}, "stop", { native_finish_reason: "network_error" }))).rejects.toThrow("network_error");
  });

  it("keeps an already emitted tool call when the provider later reports an error", async () => {
    const tool = { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }] };
    const result = await transform(frame(tool) + frame({}, "stop", { native_finish_reason: "network_error" }));
    expect(result).toContain('"name":"lookup"');
  });
});
