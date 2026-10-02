import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Gemini 4 "Argon" (2026-09-30). Spec taken from the Artificial Analysis model
// page; models.dev does not carry it yet.

describe("gemini-4-argon capabilities", () => {
  it("resolves the announced spec", () => {
    const c = getCapabilitiesForModel("gemini", "gemini-4-argon");
    expect(c.vision).toBe(true);            // image input documented
    expect(c.reasoning).toBe(true);         // reasoning model
    expect(c.search).toBe(true);            // Gemini line standard
    expect(c.contextWindow).toBe(1048576);  // 1.0M tokens
    expect(c.thinkingFormat).toBe("gemini-level");
  });

  it("has the announced 1M output limit, not the line's 64K", () => {
    // Corrected after the announcement: Argon's output limit was raised to 1M,
    // where every other Gemini entry carries 65536.
    const argon = getCapabilitiesForModel("gemini", "gemini-4-argon");
    const flash = getCapabilitiesForModel("gemini", "gemini-3.8-flash");
    expect(argon.maxOutput).toBe(1048576);
    expect(flash.maxOutput).toBe(65536);   // neighbours unchanged
  });

  it("is NOT captured by the gemini-3 wildcard", () => {
    // Patterns match in order, so gemini-4 needs its own entry above *gemini-3*.
    const c4 = getCapabilitiesForModel("gemini", "gemini-4-argon");
    const c3 = getCapabilitiesForModel("gemini", "gemini-3.8-flash");
    // The distinguishing claim: audio/video are not documented for Argon yet.
    expect(c4.audioInput).toBe(false);
    expect(c4.videoInput).toBe(false);
    // ...while the 3.x line does claim them, proving the patterns differ.
    expect(c3.audioInput).toBe(true);
    expect(c3.videoInput).toBe(true);
  });

  it("leaves the rest of the Gemini line untouched", () => {
    for (const [id, expectLevel] of [
      ["gemini-3.8-flash", "gemini-level"],
      ["gemini-2.5-pro", "gemini-budget"],
      ["gemini-2.0-flash", null],
    ]) {
      const c = getCapabilitiesForModel("gemini", id);
      expect(c.thinkingFormat, id).toBe(expectLevel);
      expect(c.contextWindow, id).toBe(1048576);
    }
  });
});

describe("gemini-4-argon pricing", () => {
  it("carries the confirmed input/output rates", () => {
    const p = getPricingForModel("gemini", "gemini-4-argon");
    expect(p.input).toBe(2.00);
    expect(p.output).toBe(10.00);
  });

  it("does not invent unpublished cache/reasoning rates", () => {
    const p = getPricingForModel("gemini", "gemini-4-argon");
    // Absent, not a fabricated number — a 0 here would silently mis-bill.
    expect("cached" in p).toBe(false);
    expect("reasoning" in p).toBe(false);
    expect("cache_creation" in p).toBe(false);
  });
});