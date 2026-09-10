import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

const terminalEvent = {
  model: "qwen3",
  message: { role: "assistant", content: "final", thinking: "final thought" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 8,
  eval_count: 1,
};

describe("Ollama terminal stream chunks", () => {
  it("preserves content and thinking when the terminal chunk also carries a message", () => {
    const out = translateResponse(FORMATS.OLLAMA, FORMATS.OPENAI, terminalEvent, initState(FORMATS.OPENAI));
    expect(out[0].choices[0]).toMatchObject({
      delta: { content: "final", reasoning_content: "final thought" },
      finish_reason: "stop",
    });
  });

  it("records terminal native Ollama content for request logging", async () => {
    const onStreamComplete = vi.fn();
    const stream = createSSEStream({
      targetFormat: FORMATS.OLLAMA,
      sourceFormat: FORMATS.OPENAI,
      provider: "ollama",
      body: {},
      onStreamComplete,
    });
    const response = new Response(stream.readable);
    const consumed = response.text();
    const writer = stream.writable.getWriter();
    await writer.write(new TextEncoder().encode(`${JSON.stringify(terminalEvent)}\n`));
    await writer.close();
    await consumed;

    expect(onStreamComplete).toHaveBeenCalledWith(
      { content: "final", thinking: "final thought" },
      expect.any(Object),
      expect.any(Number),
    );
  });
});
