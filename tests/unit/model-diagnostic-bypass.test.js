import { describe, expect, it, vi } from "vitest";

const { createModelWhitelistBypassNonce, consumeModelWhitelistBypassNonce } = await import("../../src/shared/utils/modelDiagnosticBypass.js");

describe("model diagnostic whitelist bypass nonce", () => {
  it("allows a minted nonce exactly once", () => {
    const nonce = createModelWhitelistBypassNonce();

    expect(consumeModelWhitelistBypassNonce(nonce)).toBe(true);
    expect(consumeModelWhitelistBypassNonce(nonce)).toBe(false);
  });

  it("rejects missing and unknown nonces", () => {
    expect(consumeModelWhitelistBypassNonce(null)).toBe(false);
    expect(consumeModelWhitelistBypassNonce("missing")).toBe(false);
  });

  it("rejects expired nonces", () => {
    vi.useFakeTimers();
    try {
      const nonce = createModelWhitelistBypassNonce();
      vi.advanceTimersByTime(30_001);

      expect(consumeModelWhitelistBypassNonce(nonce)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
