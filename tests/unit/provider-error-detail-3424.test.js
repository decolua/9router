/**
 * #3424 (suggestion 2) — the connection's `lastError` said only "Provider error".
 *
 * `markAccountUnavailable` kept the text only when it was already a string:
 *
 *     const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
 *
 * A failed `fetch` is the case that matters most and is not a string: Node throws
 * `TypeError: fetch failed` and puts the actionable part on `error.cause.code`
 * (ECONNREFUSED, ENOTFOUND, ETIMEDOUT). The operator saw an account marked
 * unavailable with no way to tell a wrong port from a firewall from a proxy.
 */
import { describe, expect, it } from "vitest";
import { describeProviderError } from "@/sse/services/auth.js";

/** The shape Node produces for a refused connection. */
function fetchFailed(code) {
  const error = new TypeError("fetch failed");
  error.cause = Object.assign(new Error(`connect ${code} 127.0.0.1:11434`), { code });
  return error;
}

describe("describeProviderError (#3424)", () => {
  it("keeps a string reason exactly as before, clamped to 100 chars", () => {
    expect(describeProviderError("upstream said no")).toBe("upstream said no");
    expect(describeProviderError("x".repeat(200))).toBe("x".repeat(100));
  });

  it("names the transport failure behind `fetch failed`", () => {
    expect(describeProviderError(fetchFailed("ECONNREFUSED"))).toBe("fetch failed (ECONNREFUSED)");
    expect(describeProviderError(fetchFailed("ENOTFOUND"))).toBe("fetch failed (ENOTFOUND)");
  });

  it("does not repeat a code the message already carries", () => {
    const error = Object.assign(new Error("connect ETIMEDOUT 10.0.0.5:443"), { code: "ETIMEDOUT" });
    expect(describeProviderError(error)).toBe("connect ETIMEDOUT 10.0.0.5:443");
  });

  it("reads the usual provider JSON error shapes", () => {
    expect(describeProviderError({ error: { message: "model not found" } })).toBe("model not found");
    expect(describeProviderError({ message: "quota exceeded" })).toBe("quota exceeded");
    expect(describeProviderError({ error: "invalid api key" })).toBe("invalid api key");
    expect(describeProviderError({ detail: "no such deployment" })).toBe("no such deployment");
  });

  it("falls back to the code when there is no message at all", () => {
    expect(describeProviderError({ code: "EAI_AGAIN" })).toBe("Provider error (EAI_AGAIN)");
  });

  it("still says 'Provider error' when there is nothing to say", () => {
    expect(describeProviderError({})).toBe("Provider error");
    expect(describeProviderError(null)).toBe("Provider error");
    expect(describeProviderError(undefined)).toBe("Provider error");
    expect(describeProviderError(42)).toBe("Provider error");
  });

  it("never serializes the error object wholesale", () => {
    // A payload attached to the error must not end up in the stored reason.
    const withPayload = {
      code: "EPIPE",
      request: { headers: { authorization: "Bearer sk-do-not-store" } },
    };
    const reason = describeProviderError(withPayload);
    expect(reason).toBe("Provider error (EPIPE)");
    expect(reason).not.toContain("sk-do-not-store");
    expect(reason).not.toContain("authorization");
  });

  it("collapses newlines so the dashboard line stays one line", () => {
    expect(describeProviderError({ message: "line one\nline two" })).toBe("line one line two");
  });
});
