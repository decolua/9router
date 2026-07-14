import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { redactSensitive } from "../../src/lib/redactSensitive.js";

describe("redactSensitive (console-log redaction)", () => {
  it("redacts Bearer JWT tokens in plain strings", () => {
    const input = "GET /v1/foo Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature";
    const out = redactSensitive(input);
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toMatch(/Bearer \[REDACTED/);
  });

  it("redacts Bearer opaque tokens (non-JWT) longer than 20 chars", () => {
    const input = "Authorization: Bearer fb-1234567890abcdefABCDEFGH";
    const out = redactSensitive(input);
    expect(out).not.toContain("fb-1234567890abcdefABCDEFGH");
    expect(out).toMatch(/Bearer \[REDACTED/);
  });

  it("redacts JSON-like sensitive key/value pairs", () => {
    const input = '{"accessToken":"sk-abc123","refreshToken":"rt-xyz","email":"a@b.com"}';
    const out = redactSensitive(input);
    expect(out).not.toContain("sk-abc123");
    expect(out).not.toContain("rt-xyz");
    expect(out).toContain('"email":"a@b.com"');
  });

  it("redacts auth token field names", () => {
    const input = '{"authToken":"fb_xyz","apiKey":"sk_abc"}';
    const out = redactSensitive(input);
    expect(out).not.toContain("fb_xyz");
    expect(out).not.toContain("sk_abc");
    expect(out).toMatch(/"authToken":"\[REDACTED\]"/);
    expect(out).toMatch(/"apiKey":"\[REDACTED\]"/);
  });

  it("does not mangle short non-secret values", () => {
    const input = "model=claude-sonnet-4.6 status=200 took=42ms";
    const out = redactSensitive(input);
    expect(out).toBe(input);
  });

  it("handles non-string inputs by returning them unchanged", () => {
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
    expect(redactSensitive(42)).toBe(42);
  });
});

describe("consoleLogBuffer redaction integration", () => {
  let buffer;
  let originals;

  beforeEach(async () => {
    // Reset module-level state by clearing globals + re-importing fresh
    delete global._consoleLogBufferState;
    vi.resetModules();
    buffer = await import("../../src/lib/consoleLogBuffer.js");
    originals = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
  });

  afterEach(() => {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
    delete global._consoleLogBufferState;
  });

  it("strips Bearer tokens from buffered log lines", () => {
    buffer.initConsoleLogCapture();
    console.warn("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature");
    const lines = buffer.getConsoleLogs();
    const last = lines[lines.length - 1];
    expect(last).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(last).toMatch(/\[REDACTED/);
  });

  it("strips sensitive JSON keys from object args", () => {
    buffer.initConsoleLogCapture();
    console.error("creds:", { authToken: "fb_abc123XYZ", note: "hi" });
    const lines = buffer.getConsoleLogs();
    const last = lines[lines.length - 1];
    expect(last).not.toContain("fb_abc123XYZ");
    expect(last).toContain("hi");
  });
});
