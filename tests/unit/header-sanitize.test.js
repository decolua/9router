import { describe, it, expect } from "vitest";
import { sanitizeHeaderValues } from "../../open-sse/utils/headerSanitize.js";

describe("sanitizeHeaderValues", () => {
  it("removes trailing zero-width space (a)", () => {
    const input = { Authorization: "Bearer sk-abc\u200B" };
    expect(sanitizeHeaderValues(input)).toEqual({ Authorization: "Bearer sk-abc" });
  });

  it("removes BOM and trims whitespace (b)", () => {
    const input = { "x-api-key": "\uFEFFsk-abc " };
    expect(sanitizeHeaderValues(input)).toEqual({ "x-api-key": "sk-abc" });
  });

  it("leaves plain ASCII object deep-equal and values identical (c)", () => {
    const input = {
      Authorization: "Bearer sk-12345",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    const res = sanitizeHeaderValues(input);
    expect(res).toEqual(input);
    expect(res.Authorization).toBe(input.Authorization);
  });

  it("leaves Latin-1 values unchanged (d)", () => {
    const input = { "x-custom": "caf\u00E9" };
    expect(sanitizeHeaderValues(input)).toEqual({ "x-custom": "caf\u00E9" });
  });

  it("throws on char > 0xFF without leaking value in error message (e)", () => {
    const secret = "sk-secret-\u4e2d-key";
    expect(() => sanitizeHeaderValues({ Authorization: secret })).toThrowError(
      'Invalid character in header "Authorization": header values must be Latin-1; check for a pasted key with stray characters'
    );
    try {
      sanitizeHeaderValues({ Authorization: secret });
    } catch (err) {
      expect(err.message).not.toContain(secret);
      expect(err.message).not.toContain("\u4e2d");
    }
  });

  it("handles Headers instance input (f)", () => {
    const headers = new Headers();
    headers.set("authorization", "Bearer sk-abc");
    headers.set("x-api-key", "key-val");

    const sanitized = sanitizeHeaderValues(headers);
    expect(sanitized instanceof Headers).toBe(true);
    expect(sanitized.get("authorization")).toBe("Bearer sk-abc");
    expect(sanitized.get("x-api-key")).toBe("key-val");
  });

  it("handles non-string values untouched (g)", () => {
    const input = { "content-length": 42, "x-flag": true, "x-null": null };
    expect(sanitizeHeaderValues(input)).toEqual({
      "content-length": 42,
      "x-flag": true,
      "x-null": null,
    });
  });

  it("passes sanitized headers to directFetch in proxyAwareFetch (g2)", async () => {
    let capturedOptions = null;
    const directFetch = async (url, opts) => {
      capturedOptions = opts;
      return new Response("ok", { status: 200 });
    };

    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await proxyAwareFetch("https://api.example.com/test", {
      directFetch,
      headers: {
        Authorization: "Bearer sk-test\u200B",
        "x-api-key": "\uFEFFkey-val ",
      },
    });

    expect(capturedOptions.headers).toEqual({
      Authorization: "Bearer sk-test",
      "x-api-key": "key-val",
    });
  });

  it("handles null/undefined headers gracefully", () => {
    expect(sanitizeHeaderValues(undefined)).toBe(undefined);
    expect(sanitizeHeaderValues(null)).toBe(null);
  });
});
