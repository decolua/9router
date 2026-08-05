import { describe, expect, it, vi } from "vitest";

import {
  getModelUnavailableUntil,
  isModelUnavailable,
  markModelUnavailable,
} from "../../open-sse/services/accountFallback.js";

describe("model negative cache", () => {
  it("expires an unsupported model after its TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00Z"));
    markModelUnavailable("opencode", "retired-free", 600_000);

    expect(isModelUnavailable("opencode", "retired-free")).toBe(true);
    expect(getModelUnavailableUntil("opencode", "retired-free")).toBe(Date.now() + 600_000);

    vi.advanceTimersByTime(600_001);
    expect(isModelUnavailable("opencode", "retired-free")).toBe(false);
    vi.useRealTimers();
  });
});
