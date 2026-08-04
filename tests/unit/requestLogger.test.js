import { describe, expect, it } from "vitest";
import { maskSensitiveHeaders } from "../../open-sse/utils/requestLogger.js";

describe("requestLogger", () => {
  it("masks sensitive request headers without mutating non-sensitive headers", () => {
    const headers = {
      Authorization: "Bearer sk-test-1234567890abcdef",
      "x-api-key": "abc123456789xyz",
      Cookie: "sid=session-secret; theme=dark",
      Accept: "application/json",
      "User-Agent": "official-client/1.2.3"
    };

    const masked = maskSensitiveHeaders(headers);

    expect(masked.Authorization).toBe("Bearer sk-test-...[REDACTED]...cdef");
    expect(masked["x-api-key"]).toBe("abc1...[REDACTED]");
    expect(masked.Cookie).toContain("[REDACTED]");
    expect(masked.Accept).toBe("application/json");
    expect(masked["User-Agent"]).toBe("official-client/1.2.3");
    expect(headers.Authorization).toBe("Bearer sk-test-1234567890abcdef");
  });

  it("supports Headers objects and masks provider response secrets", () => {
    const headers = new Headers({
      "set-cookie": "token=secret-cookie-value",
      "x-ratelimit-remaining": "42"
    });

    const masked = maskSensitiveHeaders(headers);

    expect(masked["set-cookie"]).toContain("[REDACTED]");
    expect(masked["x-ratelimit-remaining"]).toBe("42");
  });
});
