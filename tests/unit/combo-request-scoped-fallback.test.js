// Regression: a combo stopped at the first member that returned a
// request-scoped 4xx (validation failure, unsupported parameter, context
// overflow) and handed that member's error to the client, even when a later
// member could serve the request. checkFallbackError() returns
// shouldFallback:false for these on purpose — a request-scoped fault must not
// cool down a healthy account — but "no account fallback" is not "no combo
// fallback": members run on different providers with different validation.
//
// Reported shapes include OpenCode Zen's generic `400 Request validation failed`
// and a provider rejecting `response_format`, neither of which any
// model-scoped phrase list matches.
import { describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const silentLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function validationError(message = "Request validation failed") {
  return jsonResponse({ error: { message, type: "invalid_request_error" } }, 400);
}

describe("combo fallback — request-scoped 4xx from a member", () => {
  it("flags a generic 400 as request-scoped without cooling the account", () => {
    expect(checkFallbackError(400, "Request validation failed")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      requestScoped: true,
    });
  });

  it("advances to the next member instead of returning the 400", async () => {
    const handleSingleModel = vi.fn(async (_body, modelStr) => (
      modelStr === "provider-a/model-a"
        ? validationError()
        : jsonResponse({ choices: [{ message: { content: "served by member b" } }] })
    ));

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-a", "provider-b/model-b"],
      handleSingleModel,
      log: silentLog,
      comboStrategy: "fallback",
    });

    expect(result.status).toBe(200);
    expect(handleSingleModel.mock.calls.map(([, m]) => m)).toEqual([
      "provider-a/model-a",
      "provider-b/model-b",
    ]);
    const body = await result.json();
    expect(body.choices[0].message.content).toBe("served by member b");
  });

  it("still returns the last error when every member rejects the request", async () => {
    const handleSingleModel = vi.fn(async (_body, modelStr) => (
      modelStr === "provider-a/model-a"
        ? validationError("Request validation failed")
        : validationError("Unsupported parameter: response_format")
    ));

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-a", "provider-b/model-b"],
      handleSingleModel,
      log: silentLog,
      comboStrategy: "fallback",
    });

    // The FIRST member's own response, not a synthesized envelope: the synthesized
    // one surfaces to the client as a 200 carrying an error object.
    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error.message).toBe("Request validation failed");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("returns the rejected member's response when a later member fails differently", async () => {
    // Boundary case: member 1 rejected the request, member 2 failed for an
    // unrelated reason. No member served it, so the request-scoped failure is the
    // actionable answer and its own status/body are returned.
    const handleSingleModel = vi.fn(async (_body, modelStr) => (
      modelStr === "provider-a/model-a"
        ? validationError("Request validation failed")
        : jsonResponse({ error: { message: "service unavailable" } }, 503)
    ));

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-a", "provider-b/model-b"],
      handleSingleModel,
      log: silentLog,
      comboStrategy: "fallback",
    });

    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error.message).toBe("Request validation failed");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });
});
