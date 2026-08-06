// Skip-rules modal pure logic: provider dropdown merge + row↔rule validation.
// These live in skipRulesLogic.js (no JSX) so the "node" vitest env can import them.
import { describe, expect, it } from "vitest";
import { mergeProviderOptions, rowToRule, ruleToRow } from "../../src/app/(dashboard)/dashboard/profile/skipRulesLogic.js";

describe("mergeProviderOptions", () => {
  const AI = {
    kiro: { id: "kiro", name: "Kiro" },
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
    const opts = mergeProviderOptions(AI, [{ id: "kiro", name: "Kiro Node", type: "custom" }]);
    expect(opts.filter(o => o.value === "kiro")).toHaveLength(1);
    expect(opts.find(o => o.value === "kiro").label).toBe("Kiro");
  });

  it("tolerates null/undefined inputs", () => {
    expect(mergeProviderOptions(null, null)).toEqual([]);
    expect(mergeProviderOptions(AI, undefined).length).toBeGreaterThan(0);
  });
});

describe("rowToRule validation (no silent drop, multi-condition)", () => {
  const httpRow = (o) => ({ provider: "kiro", matchMode: "http", status: "", contains: "", action: "skip", ...o });
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
    expect(rule).toEqual({ provider: "kiro", match: { status: 429 }, action: "retry" });
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
    const { rule } = rowToRule({ provider: "kiro", matchMode: "http", status: "429", contains: "", action: "retry", sweep: true });
    expect(rule).toEqual({ provider: "kiro", match: { status: 429 }, action: "retry" });
  });
});
