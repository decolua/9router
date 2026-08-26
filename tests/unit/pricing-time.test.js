import { describe, expect, it } from "vitest";
import { isPeakPricingTime } from "../../open-sse/providers/pricing.js";
import { hasPricingChanges, parseOpenCodePricing, shiftPricingWindows } from "../../src/shared/services/pricingSync.js";

describe("China-time peak pricing", () => {
  it("evaluates configured windows in China Standard Time", () => {
    expect(isPeakPricingTime("09:00-12:00", "2026-08-24T01:30:00.000Z")).toBe(true);
    expect(isPeakPricingTime("09:00-12:00", "2026-08-24T00:59:00.000Z")).toBe(false);
    expect(isPeakPricingTime("23:00-02:00", "2026-08-24T16:30:00.000Z")).toBe(true);
  });

  it("converts OpenCode UTC windows to China time", () => {
    expect(shiftPricingWindows("01:00-04:00,06:00-10:00", 8 * 60)).toBe("09:00-12:00,14:00-18:00");
    expect(shiftPricingWindows("20:00-02:00", 8 * 60)).toBe("04:00-10:00");
  });

  it("stores converted China-time windows when parsing OpenCode prices", () => {
    const html = `<table><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存读取</th><th>缓存写入</th></tr>
      <tr><td>GLM-5.2 (Peak)</td><td>$1</td><td>$2</td><td>$0.1</td><td>$0.2</td></tr>
      <tr><td>GLM-5.2 (Off-Peak)</td><td>$0.5</td><td>$1</td><td>$0.05</td><td>$0.1</td></tr></table>`;

    expect(parseOpenCodePricing(html)["glm-5.2"].peakWindows).toBe("09:00-12:00,14:00-18:00");
  });

  it("discovers newly documented models from the OpenCode model ID table", () => {
    const html = `<table><tr><th>模型</th><th>模型 ID</th><th>端点</th></tr>
      <tr><td>GLM-5.3-Flash</td><td><code>glm-5.3-flash</code></td><td><code>https://opencode.ai/zen/go/v1/chat/completions</code></td></tr></table>
      <table><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存读取</th><th>缓存写入</th></tr>
      <tr><td>GLM-5.3-Flash</td><td>$0.15</td><td>$0.50</td><td>$0.03</td><td>-</td></tr></table>`;

    expect(parseOpenCodePricing(html)["glm-5.3-flash"]).toEqual({ input: 0.15, output: 0.5, cached: 0.03 });
  });

  it("normalizes an unknown pricing row when the model ID table is unavailable", () => {
    const html = `<table><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存读取</th><th>缓存写入</th></tr>
      <tr><td>Future Model 2.1 Flash</td><td>$1</td><td>$2</td><td>$0.1</td><td>-</td></tr></table>`;

    expect(parseOpenCodePricing(html)["future-model-2.1-flash"]).toEqual({ input: 1, output: 2, cached: 0.1 });
  });

  it("counts only pricing fields changed by the OpenCode source", () => {
    const current = { input: 1, output: 2, cached: 0.1, reasoning: 3, lastUpdated: "2026-08-25T00:00:00.000Z" };

    expect(hasPricingChanges(current, { input: 1, output: 2, cached: 0.1 })).toBe(false);
    expect(hasPricingChanges(current, { input: 1.5, output: 2, cached: 0.1 })).toBe(true);
  });
});
