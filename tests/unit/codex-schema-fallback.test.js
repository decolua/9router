import { describe, expect, it, vi } from "vitest";

import { isCodexRequestSchemaError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: vi.fn(), warn: vi.fn() };

function errorResponse(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Codex request schema fallback", () => {
  it.each([
    ["Unknown parameter: 'input[150].namespace'.", true],
    [JSON.stringify({ error: { type: "invalid_request_error", code: "unknown_parameter", message: "Unknown parameter: input[2].namespace" } }), true],
    [JSON.stringify({ error: { type: "invalid_request_error", code: "unsupported_value", message: "Unsupported value for input[2].type" } }), true],
    [JSON.stringify({ error: { type: "invalid_request_error", code: "invalid_prompt", message: "Prompt is too long" } }), false],
    ["The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.", false],
  ])("classifies only request schema incompatibilities", (message, expected) => {
    expect(isCodexRequestSchemaError("codex", 400, message)).toBe(expected);
  });

  it("does not intercept other providers or retryable statuses", () => {
    expect(isCodexRequestSchemaError("openai", 400, "Unknown parameter: input[0].x")).toBe(false);
    expect(isCodexRequestSchemaError("codex", 429, "rate limit")).toBe(false);
    expect(isCodexRequestSchemaError("codex", 401, "invalid token")).toBe(false);
  });

  it("stops a combo after a Codex schema error", async () => {
    const handleSingleModel = vi.fn().mockResolvedValue(errorResponse(400, {
      message: "Unknown parameter: 'input[150].namespace'.",
      type: "invalid_request_error",
      code: "unknown_parameter",
    }));

    const response = await handleComboChat({
      body: {},
      models: ["cx/gpt-5.6-sol", "cx/gpt-5.5"],
      handleSingleModel,
      log,
    });

    expect(response.status).toBe(400);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });

  it("keeps normal combo fallback for rate limits", async () => {
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(errorResponse(429, { message: "rate limit" }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await handleComboChat({
      body: {},
      models: ["cx/gpt-5.6-sol", "cx/gpt-5.5"],
      handleSingleModel,
      log,
    });

    expect(response.status).toBe(200);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });
});
