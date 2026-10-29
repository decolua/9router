import { describe, expect, it } from "vitest";
import { __test__ } from "../../open-sse/utils/requestLogger.js";

describe("request logger header redaction", () => {
  it("redacts Freebuff bearer credentials before target-request serialization", () => {
    // Given: Freebuff executor headers containing an OAuth bearer credential.
    const headers = {
      Authorization: "Bearer freebuff-oauth-token",
      "Content-Type": "application/json",
    };

    // When: request logging serializes the provider headers.
    const serializedHeaders = __test__.maskSensitiveHeaders(headers);

    // Then: the credential is absent while diagnostic headers remain intact.
    expect(serializedHeaders.Authorization).toBe("[REDACTED]");
    expect(serializedHeaders["Content-Type"]).toBe("application/json");
  });

  it("keeps ordinary provider diagnostics visible while redacting token-like headers", () => {
    // Given: mixed provider diagnostic and credential-bearing headers.
    const headers = {
      "X-Request-Id": "request-123",
      "Proxy-Authorization": "Basic proxy-credential",
      "X-Custom-Token": "provider-token",
    };

    // When: request logging serializes the provider headers.
    const serializedHeaders = __test__.maskSensitiveHeaders(headers);

    // Then: only credential-bearing values are redacted.
    expect(serializedHeaders["X-Request-Id"]).toBe("request-123");
    expect(serializedHeaders["Proxy-Authorization"]).toBe("[REDACTED]");
    expect(serializedHeaders["X-Custom-Token"]).toBe("[REDACTED]");
  });
});
