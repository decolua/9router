import { describe, it, expect } from "vitest";
import { scoreQuotas, orderByScore } from "../../open-sse/services/tokenmaxxing.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const now = Date.UTC(2026, 9, 27);
const h = (n) => new Date(now + n * 3600e3).toISOString();

describe("tokenmaxxing", () => {
  it("exhausted quota -> 0; unlimited-only -> null", () => {
    expect(scoreQuotas([{ name: "Monthly", remainingPercentage: 0, resetAt: h(24) }], now)).toBe(0);
    expect(scoreQuotas([{ name: "chat", unlimited: true }], now)).toBeNull();
  });
  it("monthly anchor: 88% in 4d beats 97% in 26d", () => {
    const a = scoreQuotas([{ name: "Monthly", remainingPercentage: 88, resetAt: h(96) }], now);
    const b = scoreQuotas([{ name: "Monthly", remainingPercentage: 97, resetAt: h(624) }], now);
    expect(a).toBeGreaterThan(b);
  });
  it("derives % from used/total when remainingPercentage missing", () => {
    expect(scoreQuotas([{ name: "Monthly", used: 12, total: 100, resetAt: h(96) }], now)).toBeCloseTo(22, 0);
    expect(scoreQuotas([{ name: "Monthly", used: 100, total: 100, resetAt: h(96) }], now)).toBe(0);
  });
  it("order: known desc, unknown mid, exhausted last", () => {
    expect(orderByScore(["a", "b", "c", "d"], { a: 0, b: 5, c: null, d: 9 })).toEqual(["d", "b", "c", "a"]);
  });
  it("combo routes in quota order", async () => {
    const tried = [];
    const log = { info() {}, warn() {}, debug() {}, error() {} };
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] }, models: ["x/1", "y/2"], log,
      comboName: "t", comboStrategy: "tokenmaxxing", resolveQuotaOrder: async (m) => [...m].reverse(),
      handleSingleModel: async (_b, m) => { tried.push(m); return new Response("{}", { status: 200 }); },
    });
    expect(tried[0]).toBe("y/2");
  });
});
