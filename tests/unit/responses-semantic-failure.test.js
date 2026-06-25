import { describe, expect, it } from "vitest";

import { detectRetryableResponsesStreamFailure } from "../../open-sse/utils/responsesStreamHelpers.js";

describe("Responses SSE semantic failure detection", () => {
  it("detects retryable capacity failures carried inside a 200 Responses stream", () => {
    const text = [
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
    ].join("\n");

    const failure = detectRetryableResponsesStreamFailure(text);

    expect(failure).toMatchObject({
      matched: "model_at_capacity",
      status: 503,
      message: "Selected model is at capacity. Please try a different model.",
    });
  });

  it("keeps legacy overloaded text detection", () => {
    const failure = detectRetryableResponsesStreamFailure("event: error\ndata: {\"code\":\"server_is_overloaded\"}\n\n");

    expect(failure).toMatchObject({
      matched: "server_is_overloaded",
      status: 503,
    });
  });

  it("does not classify non-retryable semantic failures as transient capacity errors", () => {
    const text = [
      "event: response.failed",
      `data: ${JSON.stringify({
        type: "response.failed",
        response: {
          status: "failed",
          error: {
            code: "model_not_found",
            message: "The requested model does not exist.",
          },
        },
      })}`,
      "",
    ].join("\n");

    expect(detectRetryableResponsesStreamFailure(text)).toBeNull();
  });
});
