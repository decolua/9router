import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveAntigravityTargetHost } from "../../src/mitm/hostFidelity.js";

describe("Antigravity upstream host fidelity", () => {
  it("uses production cloudcode-pa as the primary executor host", () => {
    expect(PROVIDERS.antigravity.baseUrls[0]).toBe("https://cloudcode-pa.googleapis.com");
    expect(PROVIDERS.antigravity.baseUrls).not.toContain("https://daily-cloudcode-pa.googleapis.com");
  });

  it("does not rewrite production cloudcode-pa to daily-cloudcode-pa in MITM passthrough", () => {
    expect(resolveAntigravityTargetHost("cloudcode-pa.googleapis.com", true)).toBe("cloudcode-pa.googleapis.com");
  });
});
