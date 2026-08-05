import { describe, expect, it } from "vitest";

import { classifyAccountFailure } from "../../open-sse/services/accountFallback.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";

describe("account failure classification (#2951)", () => {
  it.each([
    [400, "invalid_request_error", {}, "request", false, false],
    [404, "model_not_found", {}, "model", false, false],
    [401, "invalid_api_key", {}, "credential", true, true],
    [401, "Model minimax-m3-free is not supported", { providerErrorType: "ModelError" }, "model", false, false],
    [429, "MODEL_CAPACITY_EXHAUSTED", {}, "provider", false, false],
    [429, "quota exceeded", { resetsAtMs: Date.now() + 60_000 }, "account_quota", true, true],
    [502, "Proxy required but failed", {}, "proxy", false, false],
    [400, "bad request", { providerErrorCode: "invalid_api_key" }, "credential", true, true],
    [403, "forbidden", { providerErrorCode: "insufficient_permissions" }, "credential", true, true],
    [429, "retry later", { providerReason: "MODEL_CAPACITY_EXHAUSTED", retryAfterMs: 12_000 }, "provider", false, false],
    [502, "fetch failed", { providerErrorCode: "ETIMEDOUT" }, "network", false, false],
    [502, "stream ended early", { failureScope: "stream" }, "stream", false, false],
  ])("classifies %s %s", (status, message, metadata, scope, retryNextAccount, persistAccountLock) => {
    expect(classifyAccountFailure(status, message, metadata)).toMatchObject({
      scope,
      retryNextAccount,
      persistAccountLock,
    });
  });
});

describe("structured upstream errors (#2951)", () => {
  it("preserves JSON error metadata when the base executor only returns a message", async () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "ModelError", message: "Model qwen3.6-plus-free is not supported" },
    });
    const executor = { parseError: (response, bodyText) => ({ status: response.status, message: bodyText }) };

    await expect(parseUpstreamError(new Response(body, { status: 401 }), executor)).resolves.toMatchObject({
      statusCode: 401,
      providerErrorType: "ModelError",
    });
  });

  it("preserves provider classification fields and Retry-After", async () => {
    const response = new Response(JSON.stringify({
      error: { message: "No capacity", code: "MODEL_CAPACITY_EXHAUSTED", type: "provider_error", reason: "overloaded" },
    }), { status: 429, headers: { "Retry-After": "12" } });

    await expect(parseUpstreamError(response)).resolves.toMatchObject({
      providerErrorCode: "MODEL_CAPACITY_EXHAUSTED",
      providerErrorType: "provider_error",
      providerReason: "overloaded",
      retryAfterMs: 12_000,
    });
  });

  it("extracts nested provider reasons", async () => {
    const response = new Response(JSON.stringify({
      error: {
        message: "Unavailable",
        details: [{ reason: "MODEL_CAPACITY_EXHAUSTED" }],
      },
    }), { status: 429 });

    await expect(parseUpstreamError(response)).resolves.toMatchObject({
      providerReason: "MODEL_CAPACITY_EXHAUSTED",
    });
  });

  it("parses HTTP-date Retry-After", async () => {
    const retryAt = new Date(Date.now() + 60_000).toUTCString();
    const parsed = await parseUpstreamError(new Response("quota", {
      status: 429,
      headers: { "Retry-After": retryAt },
    }));

    expect(parsed.retryAfterMs).toBeGreaterThan(55_000);
    expect(parsed.retryAfterMs).toBeLessThanOrEqual(60_000);
  });
});
