// tests/unit/price-chip-view.test.js
import { describe, it, expect } from "vitest";
import { priceChipView, validatePriceForm } from "../../src/shared/utils/priceChipView.js";

describe("priceChipView", () => {
  it("unpriced -> orange $ ? with the consequence in the tooltip", () => {
    const v = priceChipView({ pricing: null, source: "none" });
    expect(v).toMatchObject({ label: "$ ?", tone: "warn" });
    expect(v.tooltip).toMatch(/no price/i);
  });
  it("built-in price -> neutral $ with the rate and the rule", () => {
    const v = priceChipView({ pricing: { input: 2, output: 10 }, source: "pattern" });
    expect(v).toMatchObject({ label: "$", tone: "muted" });
    expect(v.tooltip).toBe("$2 in / $10 out per 1M tokens (wildcard price)");
  });
  it("override -> primary tone and says override", () => {
    const v = priceChipView({ pricing: { input: 0.1, output: 0.4 }, source: "override" });
    expect(v.tone).toBe("primary");
    expect(v.tooltip).toBe("$0.1 in / $0.4 out per 1M tokens (your override)");
  });
  it("free -> $0 and no warning", () => {
    expect(priceChipView({ pricing: { input: 0, output: 0 }, source: "free" }).tone).toBe("muted");
  });
  it("no data yet -> null (render nothing)", () => {
    expect(priceChipView(undefined)).toBeNull();
  });
});

describe("validatePriceForm", () => {
  it("needs input and output, accepts optional extras, returns numbers", () => {
    expect(validatePriceForm({ input: "0.1", output: "0.4", cached: "", reasoning: "", cache_creation: "" }))
      .toEqual({ ok: true, value: { input: 0.1, output: 0.4 } });
    expect(validatePriceForm({ input: "1", output: "2", cached: "0.5", reasoning: "3", cache_creation: "1.25" }))
      .toEqual({ ok: true, value: { input: 1, output: 2, cached: 0.5, reasoning: 3, cache_creation: 1.25 } });
  });
  it.each([
    [{ input: "", output: "1" }], [{ input: "1", output: "" }], [{ input: "-1", output: "1" }],
    [{ input: "abc", output: "1" }], [{ input: "1", output: "1", cached: "-2" }],
  ])("rejects %j", (form) => {
    expect(validatePriceForm(form).ok).toBe(false);
  });
});
