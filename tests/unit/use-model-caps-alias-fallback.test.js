// useModelCaps.resolveCaps — the local fallback path (when /api/models has no
// entry for the key) must map the seat's UI alias to the provider id before
// calling getCapabilitiesForModel. The tables are keyed by provider id
// (opencode-go, commandcode, …); a raw alias like `ocg` misses the
// provider-scoped entries and falls to the generic patterns, under-reporting
// (any *claude*haiku* id reads 200k regardless of the 1M provider entry).
//
// resolveCaps is exported for this test; the hook itself is client code and is
// not exercised here.
import { describe, it, expect } from "vitest";
import { resolveCaps } from "@/shared/hooks/useModelCaps.js";

describe("useModelCaps resolveCaps — alias → provider id in the fallback", () => {
  it("ocg/claude-haiku-5-5 resolves through opencode-go, not the haiku pattern", () => {
    const caps = resolveCaps({}, {}, "ocg/claude-haiku-5-5");
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(128000);
  });

  it("cmc/<unlisted> resolves through commandcode (1M/384k fallback)", () => {
    const caps = resolveCaps({}, {}, "cmc/some-unlisted-model");
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(384000);
  });

  it("byFull hit still wins over the fallback", () => {
    const fed = { contextWindow: 555000 };
    const caps = resolveCaps({ "ocg/claude-haiku-5-5": fed }, {}, "ocg/claude-haiku-5-5");
    expect(caps).toBe(fed);
  });

  it("bare id without a slash still works (no provider)", () => {
    const caps = resolveCaps({}, {}, "kimi-k3");
    expect(caps.contextWindow).toBeGreaterThan(0);
  });
});
