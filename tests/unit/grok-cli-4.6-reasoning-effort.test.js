import { describe, expect, it } from "vitest";
import { supportsGrokCliReasoningEffort } from "../../open-sse/config/grokCli.js";

describe("supportsGrokCliReasoningEffort", () => {
  it("returns true for grok-4.5 (exact)", () => {
    expect(supportsGrokCliReasoningEffort("grok-4.5")).toBe(true);
  });

  it("returns true for grok-4.5 with suffix", () => {
    expect(supportsGrokCliReasoningEffort("grok-4.5-turbo")).toBe(true);
    expect(supportsGrokCliReasoningEffort("grok-4.5-pro")).toBe(true);
  });

  it("returns true for grok-4.6 (exact)", () => {
    expect(supportsGrokCliReasoningEffort("grok-4.6")).toBe(true);
  });

  it("returns true for grok-4.6 with suffix", () => {
    expect(supportsGrokCliReasoningEffort("grok-4.6-reasoning")).toBe(true);
    expect(supportsGrokCliReasoningEffort("grok-4.6-mini")).toBe(true);
  });

  it("returns false for grok-4 (no subversion)", () => {
    expect(supportsGrokCliReasoningEffort("grok-4")).toBe(false);
  });

  it("returns false for grok-4.7 (newer, not yet listed)", () => {
    expect(supportsGrokCliReasoningEffort("grok-4.7")).toBe(false);
  });

  it("returns false for grok-build (legacy default model)", () => {
    expect(supportsGrokCliReasoningEffort("grok-build")).toBe(false);
  });

  it("returns false for empty or null", () => {
    expect(supportsGrokCliReasoningEffort("")).toBe(false);
    expect(supportsGrokCliReasoningEffort(null)).toBe(false);
    expect(supportsGrokCliReasoningEffort(undefined)).toBe(false);
  });
});
