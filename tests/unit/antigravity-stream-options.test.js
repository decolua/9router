import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const credentials = {
  projectId: "synthetic-project",
  connectionId: "synthetic-connection",
};

function requestBody(stream) {
  return {
    stream,
    stream_options: { include_usage: true },
    request: {
      contents: [{ role: "user", parts: [{ text: "Reply only OK" }] }],
    },
  };
}

describe("AntigravityExecutor stream_options normalization", () => {
  it("removes stream_options from a non-streaming request", () => {
    const executor = new AntigravityExecutor();
    const output = executor.transformRequest(
      "gpt-oss-120b-medium",
      requestBody(false),
      false,
      credentials,
    );

    expect(output.stream).toBe(false);
    expect(output.stream_options).toBeUndefined();
  });

  it("preserves stream_options for a streaming request", () => {
    const executor = new AntigravityExecutor();
    const output = executor.transformRequest(
      "gpt-oss-120b-medium",
      requestBody(true),
      true,
      credentials,
    );

    expect(output.stream).toBe(true);
    expect(output.stream_options).toEqual({ include_usage: true });
  });
});
