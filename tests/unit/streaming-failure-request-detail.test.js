import { describe, expect, it, vi } from "vitest";

import {
  extractOpenAIResponsesFailure,
  isOpenAIResponsesFailureEvent,
  isOpenAIResponsesTerminalEvent,
} from "../../open-sse/utils/responsesStreamHelpers.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const SERVER_ERROR = {
  type: "error",
  error: {
    type: "server_error",
    code: "server_error",
    message: "An error occurred while processing your request.",
    param: null,
  },
  sequence_number: 2,
};

const FAILED_RESPONSE = {
  type: "response.failed",
  response: {
    id: "resp_020667fbda84b64e016aaa5b46b4d487d09c90621aac39a27f",
    status: "failed",
    error: { code: "server_error", message: "An error occurred while processing your request." },
  },
};

describe("isOpenAIResponsesFailureEvent", () => {
  it("flags the client-visible failure events", () => {
    expect(isOpenAIResponsesFailureEvent("error", SERVER_ERROR)).toBe(true);
    expect(isOpenAIResponsesFailureEvent("response.failed", FAILED_RESPONSE)).toBe(true);
  });

  it("flags a failed status even without the event name", () => {
    expect(isOpenAIResponsesFailureEvent(null, FAILED_RESPONSE)).toBe(true);
  });

  it("does not flag a completed turn", () => {
    const completed = { type: "response.completed", response: { id: "resp_1", status: "completed" } };
    expect(isOpenAIResponsesFailureEvent("response.completed", completed)).toBe(false);
    expect(isOpenAIResponsesFailureEvent("response.output_text.done", { delta: "x" })).toBe(false);
  });

  it("keeps failure events inside the terminal set", () => {
    // response.failed and error are terminal AND failing; that combination is
    // what makes finalizeStream() run on a failed turn.
    expect(isOpenAIResponsesTerminalEvent("error", SERVER_ERROR)).toBe(true);
    expect(isOpenAIResponsesTerminalEvent("response.failed", FAILED_RESPONSE)).toBe(true);
  });
});

describe("extractOpenAIResponsesFailure", () => {
  it("reads the error frame", () => {
    expect(extractOpenAIResponsesFailure(SERVER_ERROR)).toEqual({
      type: "server_error",
      code: "server_error",
      message: "An error occurred while processing your request.",
    });
  });

  it("reads the error off a response.failed event", () => {
    expect(extractOpenAIResponsesFailure(FAILED_RESPONSE)).toEqual({
      type: "stream_error",
      code: "server_error",
      message: "An error occurred while processing your request.",
    });
  });

  it("falls back when the payload carries no error", () => {
    const extracted = extractOpenAIResponsesFailure({ type: "error" });
    expect(extracted.type).toBe("stream_error");
    expect(extracted.code).toBe("stream_failed");
    expect(extracted.message).toMatch(/failed Responses stream/);
  });

  it("accepts a string error", () => {
    expect(extractOpenAIResponsesFailure({ error: "upstream exploded" }).message).toBe("upstream exploded");
  });
});

// End-to-end through the SSE transform: a codex Responses stream that fails after
// HTTP 200 must still tell onStreamComplete that the turn failed, so
// buildOnStreamComplete writes status "error" instead of "success" (#4104).
async function runStream(lines) {
  const onStreamComplete = vi.fn();
  const encoder = new TextEncoder();
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join("\n")));
      controller.close();
    },
  });

  const output = input.pipeThrough(
    createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "codex",
      null,
      null,
      "gpt-6-astra",
      null,
      null,
      onStreamComplete,
    ),
  );

  const reader = output.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
  return onStreamComplete;
}

describe("stream failure reaches onStreamComplete (#4104)", () => {
  it("reports the failure when the upstream ends the stream with error + response.failed", async () => {
    const onStreamComplete = await runStream([
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1", status: "in_progress" } })}`,
      ``,
      `event: error`,
      `data: ${JSON.stringify(SERVER_ERROR)}`,
      ``,
      `event: response.failed`,
      `data: ${JSON.stringify(FAILED_RESPONSE)}`,
      ``,
      `data: [DONE]`,
      ``,
    ]);

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    const result = onStreamComplete.mock.calls[0][3];
    expect(result).toBeTruthy();
    expect(result.error).toEqual({
      type: "server_error",
      code: "server_error",
      message: "An error occurred while processing your request.",
    });
  });

  it("reports no failure for a stream that completes normally", async () => {
    const onStreamComplete = await runStream([
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1", status: "in_progress" } })}`,
      ``,
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", status: "completed" } })}`,
      ``,
    ]);

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][3]).toBeNull();
  });
});