import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const OVERLOAD_MESSAGE = "Our servers are currently overloaded. Please try again later.";

function streamFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function sseDelta(delta) {
  return [
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta })}`,
    "",
    "",
  ].join("\n");
}

describe("Codex fake 200 overload handling (#3232)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies an overload message split across SSE chunks as retryable", async () => {
    const executor = new CodexExecutor();
    const response = new Response(streamFromChunks([
      "event: response.output_text.delta\n",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Our servers are currently " })}\n\n`,
      sseDelta("overloaded. Please try again later."),
    ]), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);

    expect(peek.matched).toBe("codex_overloaded_output");
    expect(peek.message).toBe(OVERLOAD_MESSAGE);
    expect(peek.accountFallback).toBe(false);
    expect(peek.replacementBody).toBeNull();
  });

  it("does not classify similar legitimate output as an overload", async () => {
    const executor = new CodexExecutor();
    const text = sseDelta("Our servers are currently processing your request.");
    const response = new Response(streamFromChunks([text]), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);

    expect(peek.matched).toBeNull();
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(text);
  });

  it("does not classify an answer that quotes and continues after the overload message", async () => {
    const executor = new CodexExecutor();
    const chunks = [
      sseDelta(OVERLOAD_MESSAGE),
      sseDelta(" This upstream message means the request should be retried."),
    ];
    const response = new Response(streamFromChunks(chunks), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);

    expect(peek.matched).toBeNull();
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(chunks.join(""));
  });

  it("retries the fake success instead of returning it to the client", async () => {
    const executor = new CodexExecutor();
    executor.config = {
      ...executor.config,
      retry: { ...executor.config.retry, 503: { attempts: 1, delayMs: 0 } },
    };
    const recovered = sseDelta("Recovered");
    const baseExecute = vi.spyOn(BaseExecutor.prototype, "execute")
      .mockResolvedValueOnce({
        response: new Response(streamFromChunks([sseDelta(OVERLOAD_MESSAGE)]), { status: 200 }),
      })
      .mockResolvedValueOnce({
        response: new Response(streamFromChunks([recovered]), { status: 200 }),
      });

    const result = await executor.execute({ body: { input: [] }, log: {} });

    expect(baseExecute).toHaveBeenCalledTimes(2);
    await expect(result.response.text()).resolves.toBe(recovered);
  });
});
