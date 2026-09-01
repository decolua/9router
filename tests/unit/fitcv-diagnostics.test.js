import { describe, expect, it, vi } from "vitest";

import { maskSensitiveHeaders, safePayloadMetadata } from "../../open-sse/utils/requestLogger.js";
import { buildErrorBody, parseUpstreamError } from "../../open-sse/utils/error.js";

describe("FitCV diagnostics safety", () => {
  it("redacts sensitive request headers without exposing credential fragments", () => {
    const headers = maskSensitiveHeaders({
      Authorization: "Bearer secret-token",
      "X-Api-Key": "api-secret",
      Cookie: "session=secret",
      "X-Request-Id": "req-123",
    });

    expect(headers).toEqual({
      Authorization: "[REDACTED]",
      "X-Api-Key": "[REDACTED]",
      Cookie: "[REDACTED]",
      "X-Request-Id": "req-123",
    });
    expect(JSON.stringify(headers)).not.toContain("secret");
  });

  it("logs payload metadata only, never payload values or stream content", () => {
    const metadata = safePayloadMetadata({ prompt: "secret prompt", schema: { token: "secret" } });
    expect(metadata).toEqual({ present: true, type: "object" });
    expect(JSON.stringify(metadata)).not.toContain("secret");
  });

  it("keeps only scalar upstream diagnostics and never uses raw body fallback", async () => {
    const response = new Response(JSON.stringify({
      error: {
        message: "invalid input",
        type: "invalid_request_error",
        param: "input",
        code: "bad_input",
        prompt: "do not expose",
      },
      headers: { authorization: "Bearer secret" },
      schema: { secret: "payload" },
    }), { status: 400, headers: { "x-request-id": "upstream-123" } });

    const parsed = await parseUpstreamError(response);
    expect(parsed).toMatchObject({
      statusCode: 400,
      message: "invalid input",
      type: "invalid_request_error",
      param: "input",
      code: "bad_input",
      request_id: "upstream-123",
    });
    expect(parsed).not.toHaveProperty("prompt");
    expect(parsed).not.toHaveProperty("schema");
    expect(buildErrorBody(parsed.statusCode, parsed.message, parsed)).toEqual({
      error: {
        message: "invalid input",
        type: "invalid_request_error",
        code: "bad_input",
        param: "input",
        request_id: "upstream-123",
      },
    });
  });
});

describe("/v1/responses error boundary", () => {
  it("returns sanitized error fields when handler throws", async () => {
    if (typeof vi.doMock !== "function") return;
    vi.doMock("@/sse/handlers/chat.js", () => ({ handleChat: vi.fn(async () => { throw new Error("Bearer secret prompt"); }) }));
    vi.doMock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn(async () => {}) }));
    const { POST, sanitizeErrorResponse } = await import("../../src/app/api/v1/responses/route.js");
    for (const headers of [{}, { "x-request-id": "client-valid" }, { "x-client-request-id": "client-spoof" }]) {
      const response = await POST(new Request("http://localhost/v1/responses", {
        method: "POST",
        headers,
        body: "{}",
      }));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.error.request_id).not.toBe(headers["x-request-id"] || headers["x-client-request-id"]);
    }

    const upstream = await sanitizeErrorResponse(
      new Response(JSON.stringify({ error: { message: "bad", request_id: "upstream-123", prompt: "secret" } }), { status: 400 }),
      "server-123"
    );
    expect(await upstream.json()).toEqual({
      error: { message: "bad", request_id: "server-123", upstream_request_id: "upstream-123" },
    });
  });
});
