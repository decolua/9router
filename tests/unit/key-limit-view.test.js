// tests/unit/key-limit-view.test.js
import { describe, it, expect } from "vitest";
import { keyLimitView, limitSwitchState } from "../../src/shared/utils/keyLimitView.js";

const st = (over) => ({ eligible: true, unbounded: false, unpriced: [], effective: true, spentUsd: 0, resetsAt: null, ...over });

describe("keyLimitView", () => {
  it("unrestricted key: controls disabled, reason explains it", () => {
    const v = keyLimitView({ limit: null, limitStatus: st({ eligible: false, unbounded: true, effective: false }) });
    expect(v.disabled).toBe(true);
    expect(v.warning).toBeNull();
    expect(v.note).toMatch(/restricted/i);
  });
  it("restricted key with an unpriced model and no limit: disabled with the models named", () => {
    const v = keyLimitView({ limit: null, limitStatus: st({ eligible: false, unpriced: ["a/x", "b/y"], effective: false }) });
    expect(v.disabled).toBe(true);
    expect(v.note).toContain("a/x, b/y");
  });
  it("limit set but a model is now unpriced: greyed out with the red warning", () => {
    const v = keyLimitView({ limit: { usd: 5, window: "day" }, limitStatus: st({ eligible: false, unpriced: ["a/x"], effective: false }) });
    expect(v.greyed).toBe(true);
    expect(v.warning).toBe("Cost limit is disabled because this key can access unpriced models: a/x");
  });
  it("limit set on a key that became unrestricted: greyed with the unrestricted warning", () => {
    const v = keyLimitView({ limit: { usd: 5, window: "day" }, limitStatus: st({ eligible: false, unbounded: true, effective: false }) });
    expect(v.greyed).toBe(true);
    expect(v.warning).toMatch(/unrestricted/);
  });
  it("effective limit: editable, shows spend and reset", () => {
    const v = keyLimitView({ limit: { usd: 10, window: "month" }, limitStatus: st({ spentUsd: 2.5, resetsAt: "2026-12-01T00:00:00.000Z" }) });
    expect(v.disabled).toBe(false);
    expect(v.greyed).toBe(false);
    expect(v.warning).toBeNull();
    expect(v.summary).toBe("$2.50 of $10 this month, resets 2026-12-01T00:00:00.000Z");
  });
  it("a daily limit reads 'today'", () => {
    const v = keyLimitView({ limit: { usd: 5, window: "day" }, limitStatus: st({ spentUsd: 0.03, resetsAt: "2026-11-25T00:00:00.000Z" }) });
    expect(v.summary).toBe("$0.03 of $5 today, resets 2026-11-25T00:00:00.000Z");
  });
  it("eligible key with no limit: editable, no summary", () => {
    const v = keyLimitView({ limit: null, limitStatus: st({ spentUsd: null }) });
    expect(v.disabled).toBe(false);
    expect(v.summary).toBeNull();
  });
  it("no status yet (older server): behaves as disabled-neutral, never throws", () => {
    const v = keyLimitView({ limit: null });
    expect(v.disabled).toBe(true);
  });
});

describe("limitSwitchState (the Cost limit switch is independent of Restrict access, and never stuck)", () => {
  const eligible = { limit: null, limitStatus: st({}) };
  const blockedKey = { limit: null, limitStatus: st({ eligible: false, unbounded: true, effective: false }) };
  const limited = { limit: { usd: 5, window: "day" }, limitStatus: st({ spentUsd: 0 }) };
  const limitedDisabled = { limit: { usd: 5, window: "day" }, limitStatus: st({ eligible: false, unpriced: ["a/x"], effective: false }) };

  it("off by default; on once switched on locally; the switch is usable", () => {
    expect(limitSwitchState(eligible, false)).toEqual({ on: false, disabled: false });
    expect(limitSwitchState(eligible, true)).toEqual({ on: true, disabled: false });
  });
  it("a saved limit keeps the switch on and usable, even when the limit is not enforceable", () => {
    expect(limitSwitchState(limited, false)).toEqual({ on: true, disabled: false });
    expect(limitSwitchState(limitedDisabled, false)).toEqual({ on: true, disabled: false });
  });
  it("a key that cannot take a limit shows the switch off and disabled", () => {
    expect(limitSwitchState(blockedKey, false)).toEqual({ on: false, disabled: true });
  });
  it("switched on locally, then the key stops being eligible (Restrict access turned off): switch drops to off, never stuck on and disabled", () => {
    expect(limitSwitchState(blockedKey, true)).toEqual({ on: false, disabled: true });
  });
});
