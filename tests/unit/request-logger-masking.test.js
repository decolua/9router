// Credential masking in request dumps: headers (request AND response) and URL query keys.
import { describe, it, expect } from "vitest";
import { maskSensitiveHeaders, maskUrlSecrets } from "../../open-sse/utils/requestLogger.js";

const KEY = "AQ.Ab8RN6J2WeHQ-fake-test-key-0000000000000cIw";

describe("maskSensitiveHeaders", () => {
  it("masks credential headers, keeping only the last 4 chars", () => {
    const m = maskSensitiveHeaders({
      Authorization: `Bearer ${KEY}`, "x-api-key": KEY, "x-goog-api-key": KEY,
      cookie: "sid=abcdefghijklmnop", "x-auth-token": KEY, "content-type": "application/json",
    });
    for (const h of ["Authorization", "x-api-key", "x-goog-api-key", "cookie", "x-auth-token"]) {
      expect(m[h]).toBe(`***${String({ Authorization: `Bearer ${KEY}`, "x-api-key": KEY, "x-goog-api-key": KEY, cookie: "sid=abcdefghijklmnop", "x-auth-token": KEY }[h]).slice(-4)}`);
      expect(m[h]).not.toContain(KEY.slice(0, 12));
    }
    expect(m["content-type"]).toBe("application/json");
  });
  it("masks short secrets entirely", () => {
    expect(maskSensitiveHeaders({ "x-api-key": "short" })["x-api-key"]).toBe("***");
  });
  it("accepts a Headers instance (provider responses)", () => {
    const h = new Headers({ "set-cookie": "session=verysecretvalue123", "content-type": "text/event-stream" });
    const m = maskSensitiveHeaders(h);
    expect(m["set-cookie"]).toBe("***e123");
    expect(m["content-type"]).toBe("text/event-stream");
  });
  it("does not mask non-credential headers that merely contain 'token'", () => {
    const m = maskSensitiveHeaders({ "x-ratelimit-remaining-tokens": "99000" });
    expect(m["x-ratelimit-remaining-tokens"]).toBe("99000");
  });
  it("tolerates null/undefined", () => {
    expect(maskSensitiveHeaders(undefined)).toEqual({});
  });
});

describe("maskUrlSecrets", () => {
  it("masks ?key= and keeps other params", () => {
    const out = maskUrlSecrets(`https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent?alt=sse&key=${KEY}`);
    expect(out).not.toContain(KEY.slice(0, 12));
    expect(out).toContain("alt=sse");
    expect(out).toContain("key=***cIw".replace("***cIw", "***" + KEY.slice(-4)));
  });
  it("leaves URLs without secrets byte-identical", () => {
    const u = "https://api.example.com/v1/chat/completions?stream=true";
    expect(maskUrlSecrets(u)).toBe(u);
  });
  it("falls back for relative URLs", () => {
    expect(maskUrlSecrets(`/v1/x?api_key=${KEY}&a=1`)).toBe("/v1/x?api_key=***&a=1");
  });
  it("tolerates non-strings", () => {
    expect(maskUrlSecrets(undefined)).toBe(undefined);
  });
});
