// Skip-rules modal pure logic: provider dropdown merge + row↔rule validation.
// These live in skipRulesLogic.js (no JSX) so the "node" vitest env can import them.
import { describe, expect, it } from "vitest";
import { mergeProviderOptions, rowToRule, ruleToRow } from "../../src/app/(dashboard)/dashboard/profile/skipRulesLogic.js";

describe("mergeProviderOptions", () => {
  const AI = {
    anthropic: { id: "anthropic", name: "Anthropic" },
    antigravity: { id: "antigravity", name: "Antigravity" },
    secret: { id: "secret", name: "Secret", hidden: true },
  };

  it("includes dynamic compatible nodes so kr-ac appears", () => {
    const nodes = [{ id: "anthropic-compatible-5edf", name: "kr-ac", type: "anthropic-compatible" }];
    const opts = mergeProviderOptions(AI, nodes);
    expect(opts.map(o => o.value)).toContain("anthropic-compatible-5edf");
    expect(opts.find(o => o.value === "anthropic-compatible-5edf").label).toBe("kr-ac (anthropic-compatible)");
  });

  it("hides providers flagged hidden", () => {
    expect(mergeProviderOptions(AI, []).map(o => o.value)).not.toContain("secret");
  });

  it("dedupes by id (static wins over node)", () => {
    const opts = mergeProviderOptions(AI, [{ id: "anthropic", name: "Anthropic Node", type: "custom" }]);
    expect(opts.filter(o => o.value === "anthropic")).toHaveLength(1);
    expect(opts.find(o => o.value === "anthropic").label).toBe("Anthropic");
  });

  it("tolerates null/undefined inputs", () => {
    expect(mergeProviderOptions(null, null)).toEqual([]);
    expect(mergeProviderOptions(AI, undefined).length).toBeGreaterThan(0);
  });
});

describe("rowToRule validation (no silent drop, multi-condition)", () => {
  const httpRow = (o) => ({ provider: "anthropic", matchMode: "http", status: "", contains: "", action: "skip", ...o });
  const kindRow = (o) => ({ provider: "kr-ac", matchMode: "kind", kind: "connect_timeout", action: "skip", ...o });

  it("flags a row missing provider", () => {
    expect(rowToRule(httpRow({ provider: "", status: "429" })).error).toBeTruthy();
  });

  it("flags an http row with neither status nor contains", () => {
    expect(rowToRule(httpRow({ status: "", contains: "" })).error).toBeTruthy();
  });

  it("flags an out-of-range status", () => {
    expect(rowToRule(httpRow({ status: "99" })).error).toBeTruthy();
    expect(rowToRule(httpRow({ status: "700" })).error).toBeTruthy();
  });

  it("flags a bad headerTimeoutMs on a connect_timeout rule", () => {
    expect(rowToRule(kindRow({ headerTimeoutMs: "50" })).error).toBeTruthy();
  });

  it("builds a valid status-only rule", () => {
    const { rule, error } = rowToRule(httpRow({ status: "429", action: "retry" }));
    expect(error).toBeUndefined();
    expect(rule).toEqual({ provider: "anthropic", match: { status: 429 }, action: "retry" });
  });

  it("builds a valid status+contains rule (AND)", () => {
    const { rule, error } = rowToRule(httpRow({ provider: "antigravity", status: "503", contains: "capacity" }));
    expect(error).toBeUndefined();
    expect(rule).toEqual({ provider: "antigravity", match: { status: 503, contains: "capacity" }, action: "skip" });
  });

  it("builds a valid contains-only rule", () => {
    const { rule } = rowToRule(httpRow({ provider: "some", contains: "overloaded" }));
    expect(rule).toEqual({ provider: "some", match: { contains: "overloaded" }, action: "skip" });
  });

  it("builds a valid connect_timeout rule with headerTimeoutMs", () => {
    const { rule } = rowToRule(kindRow({ headerTimeoutMs: "25000" }));
    expect(rule).toEqual({ provider: "kr-ac", match: { kind: "connect_timeout" }, action: "skip", headerTimeoutMs: 25000 });
  });

  it("round-trips a combined rule: rule → row → rule", () => {
    const original = { provider: "antigravity", match: { status: 503, contains: "capacity" }, action: "skip" };
    const { rule } = rowToRule(ruleToRow(original));
    expect(rule).toEqual(original);
  });

  it("round-trips sweep:true through row and back", () => {
    const original = { provider: "antigravity", match: { status: 503, contains: "capacity" }, action: "skip", sweep: true };
    const { rule } = rowToRule(ruleToRow(original));
    expect(rule).toEqual(original);
  });

  it("drops sweep when action is retry (sweep only meaningful for skip)", () => {
    const { rule } = rowToRule({ provider: "anthropic", matchMode: "http", status: "429", contains: "", action: "retry", sweep: true });
    expect(rule).toEqual({ provider: "anthropic", match: { status: 429 }, action: "retry" });
  });
});

describe("retryAttempts round-trips through the modal", () => {
  it("keeps the value across rule → row → rule", () => {
    const rule = { provider: "kr-ac", match: { status: 502 }, action: "retry", retryAttempts: 4 };
    const row = ruleToRow(rule);
    expect(row.retryAttempts).toBe("4");
    expect(rowToRule(row).rule).toEqual(rule);
  });

  it("omits retryAttempts for a retry rule saved before the field existed", () => {
    // Absent → blank row → omitted again, so accountFallback applies its default
    // rather than the modal silently inventing a number.
    const row = ruleToRow({ provider: "kr-ac", match: { status: 502 }, action: "retry" });
    expect(row.retryAttempts).toBe("");
    expect("retryAttempts" in rowToRule(row).rule).toBe(false);
  });

  it("drops retryAttempts when the row switches to skip", () => {
    const row = { ...ruleToRow({ provider: "kr-ac", match: { status: 502 }, action: "retry", retryAttempts: 3 }), action: "skip" };
    const { rule } = rowToRule(row);
    expect(rule.action).toBe("skip");
    expect("retryAttempts" in rule).toBe(false);
  });

  it("rejects non-positive and non-integer values (no upper bound)", () => {
    const base = ruleToRow({ provider: "kr-ac", match: { status: 502 }, action: "retry" });
    for (const bad of ["0", "-1", "abc"]) {
      expect(rowToRule({ ...base, retryAttempts: bad }).error).toBeTruthy();
    }
    expect(rowToRule({ ...base, retryAttempts: "1" }).rule.retryAttempts).toBe(1);
    expect(rowToRule({ ...base, retryAttempts: "10" }).rule.retryAttempts).toBe(10);
    // Just past the removed ceiling: the modal must not silently clamp it.
    expect(rowToRule({ ...base, retryAttempts: "11" }).rule.retryAttempts).toBe(11);
    expect(rowToRule({ ...base, retryAttempts: "50" }).rule.retryAttempts).toBe(50);
    expect(rowToRule({ ...base, retryAttempts: "1000" }).rule.retryAttempts).toBe(1000);
  });

  it("does not attach retryAttempts to a sweep-carrying skip rule", () => {
    const { rule } = rowToRule({ ...ruleToRow({ provider: "kr-ac", match: { status: 502 }, action: "skip", sweep: true }), retryAttempts: "3" });
    expect(rule.sweep).toBe(true);
    expect("retryAttempts" in rule).toBe(false);
  });
});
