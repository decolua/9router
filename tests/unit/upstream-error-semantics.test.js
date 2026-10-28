import { describe, expect, it } from "vitest";
import { parseUpstreamError, createErrorResult } from "../../open-sse/utils/error.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";

const message = "Your input exceeds the context window of this model. Please adjust your input and try again.";
const response = (error, status = 400) => new Response(JSON.stringify({ error }), { status });

async function clientError(upstream, executor) {
  const parsed = await parseUpstreamError(upstream, executor);
  const result = createErrorResult(parsed.statusCode, parsed.message, parsed.resetsAtMs, null, parsed.upstreamError);
  return { parsed, result, json: await result.response.json() };
}

describe("structured upstream error semantics", () => {
  it("preserves the upstream context code and type through error parsing and serialization", async () => {
    const { json } = await clientError(response({ code: "context_length_exceeded", type: "invalid_request_error", message }));
    expect(json.error).toEqual({ message, code: "context_length_exceeded", type: "invalid_request_error" });
  });

  it("retains structured fields when an executor supplies its own message", async () => {
    const { parsed, json } = await clientError(response({ code: "context_length_exceeded", type: "invalid_request_error", message }), {
      parseError: () => ({ status: 400, message: "custom context error", resetsAtMs: 123456 }),
    });
    expect(parsed.resetsAtMs).toBe(123456);
    expect(json.error).toEqual({ message: "custom context error", code: "context_length_exceeded", type: "invalid_request_error" });
  });

  it("normalizes Copilot's specific context-overflow rejection", async () => {
    const { json, result } = await clientError(response({ code: "invalid_request_body", message }), new GithubExecutor());
    expect(result.status).toBe(400);
    expect(json.error).toEqual({ message, code: "context_length_exceeded", type: "invalid_request_error" });
  });

  it.each([
    [400, "invalid_request_body", "Missing required field input"],
    [403, "invalid_request_body", message],
    [400, "unsupported_model", message],
  ])("does not classify unrelated Copilot errors (%s/%s) as context overflow", async (status, code, text) => {
    const { result, json } = await clientError(response({ code, message: text }, status), new GithubExecutor());
    expect(result.status).toBe(status);
    expect(json.error.code).not.toBe("context_length_exceeded");
  });

  it("keeps default errors for unstructured responses", async () => {
    const { json } = await clientError(new Response("plain upstream error", { status: 400 }));
    expect(json.error).toEqual({ message: "plain upstream error", type: "invalid_request_error", code: "bad_request" });
  });

  it("does not copy malformed fields or arbitrary upstream properties", async () => {
    const { json } = await clientError(response({ message: "bad", code: { nested: true }, type: 42, private: "do not forward" }));
    expect(json.error).toEqual({ message: "bad", type: "invalid_request_error", code: "bad_request" });
  });

  it("keeps raw structured error fields if the executor parser throws", async () => {
    const { json } = await clientError(response({ code: "context_length_exceeded", type: "invalid_request_error", message }), {
      parseError() { throw new Error("unsupported error envelope"); },
    });
    expect(json.error).toEqual({ message, code: "context_length_exceeded", type: "invalid_request_error" });
  });
});
