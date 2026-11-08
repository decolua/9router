
import { describe, it, expect } from "vitest";
import { createOpencodeRateLimitError } from "open-sse/services/opencodeServiceBridge.js";

describe("OpenCode Rate Limit 429 Interception", () => {
  it("creates a properly structured 429 error for Free usage limit reached", () => {
    const rawCause = 'AI.Error: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go';
    const err = createOpencodeRateLimitError(rawCause);
    expect(err.status).toBe(429);
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe("rate_limit_exceeded");
    expect(err.message).toContain("Free usage limit reached");
    expect(err.isOpenCodeServiceError).toBe(true);
    expect(err.rawCause).toBe(rawCause);
  });

  it("matches the daemon log pattern accurately", () => {
    const sampleLog = 'timestamp=2026-10-27T03:22:01.439Z level=ERROR run=f971b778 message="Failed to drain Session" cause="AI.Error: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go"';
    const pattern = /(?:Free usage limit reached|subscribe to OpenCode Go|Failed to drain Session.*Free usage limit)/i;
    expect(pattern.test(sampleLog)).toBe(true);
  });
});
