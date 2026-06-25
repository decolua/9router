import { afterEach, describe, expect, it, vi } from "vitest";

import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function responseSse(text) {
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function responseSseChunks(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodexExecutor SSE capacity detection", () => {
  it("returns a retryable error when a 200 SSE stream carries a model_at_capacity failure", async () => {
    const executor = new CodexExecutor();
    executor.config = { ...executor.config, retry: { 503: { attempts: 0, delayMs: 0 } } };

    vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: responseSse([
        "event: response.failed",
        `data: ${JSON.stringify({
          type: "response.failed",
          response: {
            status: "failed",
            error: {
              code: "model_at_capacity",
              message: "Selected model is at capacity. Please try a different model.",
            },
          },
        })}`,
        "",
      ].join("\n")),
      url: "https://provider.invalid/responses",
      headers: {},
      transformedBody: {},
    });

    const result = await executor.execute({
      model: "gpt-5.5",
      body: {},
      stream: true,
      credentials: { apiKey: "k" },
      signal: new AbortController().signal,
      log: {},
    });

    expect(result.response.status).toBe(503);
    expect(await result.response.json()).toMatchObject({
      error: {
        message: "Selected model is at capacity. Please try a different model.",
      },
    });
  });

  it("keeps probing beyond the first peek window until a pre-output capacity failure arrives", async () => {
    const executor = new CodexExecutor();
    executor.config = { ...executor.config, retry: { 503: { attempts: 0, delayMs: 0 } } };

    const padding = [
      "event: response.created",
      `data: ${JSON.stringify({
        type: "response.created",
        response: { id: "resp_1", status: "in_progress", metadata: "x".repeat(5000) },
      })}`,
      "",
      "",
    ].join("\n");
    const failure = [
      "event: response.failed",
      `data: ${JSON.stringify({
        type: "response.failed",
        response: {
          status: "failed",
          error: {
            code: "model_at_capacity",
            message: "Selected model is at capacity. Please try a different model.",
          },
        },
      })}`,
      "",
      "",
    ].join("\n");

    vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: responseSseChunks([padding, failure]),
      url: "https://provider.invalid/responses",
      headers: {},
      transformedBody: {},
    });

    const result = await executor.execute({
      model: "gpt-5.5",
      body: {},
      stream: true,
      credentials: { apiKey: "k" },
      signal: new AbortController().signal,
      log: {},
    });

    expect(result.response.status).toBe(503);
    expect(await result.response.json()).toMatchObject({
      error: {
        message: "Selected model is at capacity. Please try a different model.",
      },
    });
  });
});
