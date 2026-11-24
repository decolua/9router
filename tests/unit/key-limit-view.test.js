// tests/unit/key-limit-view.test.js
import { describe, it, expect } from "vitest";
import { keyLimitView, limitSwitchState } from "../../src/shared/utils/keyLimitView.js";

const st = (over) => ({ eligible: true, unbounded: false, unpriced: [], effective: true, spentUsd: 0, resetsAt: null, ...over });

describe("keyLimitView: the limit can always be edited; the status only decides the look and the hint", () => {
  it("unrestricted key with no limit: editable, with a hint that a saved limit will not be enforced yet", () => {
    const v = keyLimitView({ limit: null, limitStatus: st({ eligible: false, unbounded: true, effective: false }) });
    expect(v.greyed).toBe(false);
    expect(v.warning).toBeNull();
    expect(v.note).toMatch(/no price/i);
    expect(v.note).toMatch(/not enforced/i);
  });
  it("restricted key reaching an unpriced model, no limit: editable, hint names the models", () => {
    const v = keyLimitView({ limit: null, limitStatus: st({ eligible: false, unpriced: ["a/x", "b/y"], effective: false }) });
    expect(v.greyed).toBe(false);
    expect(v.note).toContain("a/x, b/y");
    expect(v.note).toMatch(/not enforced/i);
  });
  it("limit set but a model is unpriced: greyed out with the red warning", () => {
    const v = keyLimitView({ limit: { usd: 5, window: "day" }, limitStatus: st({ eligible: false, unpriced: ["a/x"], effective: false }) });
    expect(v.greyed).toBe(true);
    expect(v.warning).toBe("Cost limit is disabled because this key can access unpriced models: a/x");
    expect(v.summary).toBeNull();
  });
  it("limit set on an unrestricted key: greyed with the unpriced-models warning", () => {
    const v = keyLimitView({ limit: { usd: 5, window: "day" }, limitStatus: st({ eligible: false, unbounded: true, effective: false }) });
    expect(v.greyed).toBe(true);
    expect(v.warning).toMatch(/unpriced/);
  });
  it("effective limit: normal look, spend and reset shown", () => {
    const v = keyLimitView({ limit: { usd: 10, window: "month" }, limitStatus: st({ spentUsd: 2.5, resetsAt: "2026-12-01T00:00:00.000Z" }) });
    expect(v.greyed).toBe(false);
    expect(v.warning).toBeNull();
    expect(v.summary).toBe("$2.50 of $10 this month, resets 2026-12-01T00:00:00.000Z");
  });
  it("a daily limit reads 'today'", () => {
    const v = keyLimitView({ limit: { usd: 5, window: "day" }, limitStatus: st({ spentUsd: 0.03, resetsAt: "2026-11-25T00:00:00.000Z" }) });
    expect(v.summary).toBe("$0.03 of $5 today, resets 2026-11-25T00:00:00.000Z");
  });
  it("eligible key with no limit: nothing to say", () => {
    const v = keyLimitView({ limit: null, limitStatus: st({ spentUsd: null }) });
    expect(v).toEqual({ greyed: false, warning: null, note: null, summary: null });
  });
  it("no status yet (older server): neutral, never throws", () => {
    expect(keyLimitView({ limit: null })).toEqual({ greyed: false, warning: null, note: null, summary: null });
  });
});

describe("limitSwitchState: the Cost limit switch does not depend on Restrict access or on pricing", () => {
  const cases = {
    eligible: { limit: null, limitStatus: st({}) },
    unrestricted: { limit: null, limitStatus: st({ eligible: false, unbounded: true, effective: false }) },
    unpriced: { limit: null, limitStatus: st({ eligible: false, unpriced: ["a/x"], effective: false }) },
    limited: { limit: { usd: 5, window: "day" }, limitStatus: st({ spentUsd: 0 }) },
    limitedDisabled: { limit: { usd: 5, window: "day" }, limitStatus: st({ eligible: false, unpriced: ["a/x"], effective: false }) },
    noStatus: { limit: null },
  };
  it("is off until switched on, for every kind of key", () => {
    for (const [name, key] of Object.entries(cases)) {
      if (key.limit) continue;
      expect(limitSwitchState(key, false), name).toEqual({ on: false });
      expect(limitSwitchState(key, true), name).toEqual({ on: true });
    }
  });
  it("is on whenever a limit is saved, enforceable or not, and stays that way", () => {
    expect(limitSwitchState(cases.limited, false)).toEqual({ on: true });
    expect(limitSwitchState(cases.limitedDisabled, false)).toEqual({ on: true });
  });
  it("changing the key's eligibility (Restrict access toggled) never changes the switch", () => {
    // same local state, key flips between eligible and unrestricted: identical result
    expect(limitSwitchState(cases.eligible, true)).toEqual(limitSwitchState(cases.unrestricted, true));
    expect(limitSwitchState(cases.eligible, false)).toEqual(limitSwitchState(cases.unrestricted, false));
  });
});

describe("limitConfirmView (popup when enabling the Cost limit)", () => {
  it("unpriced reachable models: says the limit will NOT be applied and points to the $ price override", async () => {
    const { limitConfirmView } = await import("../../src/shared/utils/keyLimitView.js");
    const v = limitConfirmView({ limitStatus: { eligible: false, unbounded: false, unpriced: ["a/x"], effective: false } });
    expect(v.enforced).toBe(false);
    expect(v.lines.join(" ")).toMatch(/NOT be applied/);
    expect(v.lines.join(" ")).toMatch(/"\$" icon/);
    expect(v.lines.join(" ")).not.toMatch(/restrict/i);
  });
  it("all priced: says it will be applied", async () => {
    const { limitConfirmView } = await import("../../src/shared/utils/keyLimitView.js");
    expect(limitConfirmView({ limitStatus: { eligible: true, unpriced: [], effective: true } }).enforced).toBe(true);
  });
});
