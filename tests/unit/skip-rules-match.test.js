import { describe, expect, it } from "vitest";
import { matchSkipRule, findMatchingSkipRule, resolveProviderHeaderTimeout } from "../../open-sse/services/accountFallback.js";

describe("matchSkipRule", () => {
  const rules = [
    { provider: "kr-ac", match: { kind: "connect_timeout" }, action: "skip", headerTimeoutMs: 25000 },
    { provider: "kr-ac", match: { status: 429 }, action: "retry" },
    { provider: "foo", match: { contains: "overloaded" }, action: "skip" },
  ];

  it("matches by error kind", () => {
    const r = matchSkipRule("kr-ac", { errorKind: "connect_timeout" }, rules);
    expect(r).toEqual({ action: "skip", headerTimeoutMs: 25000 });
  });

  it("matches by status (string/number normalized)", () => {
    expect(matchSkipRule("kr-ac", { status: 429 }, rules)?.action).toBe("retry");
    expect(matchSkipRule("kr-ac", { status: "429" }, rules)?.action).toBe("retry");
  });

  it("matches by substring (case-insensitive)", () => {
    expect(matchSkipRule("foo", { text: "Server OVERLOADED now" }, rules)?.action).toBe("skip");
  });

  it("returns null when provider does not match", () => {
    expect(matchSkipRule("other", { status: 429 }, rules)).toBeNull();
  });

  it("AND-matches when a rule carries both status and contains", () => {
    const mixed = [
      { provider: "antigravity", match: { status: 503, contains: "capacity" }, action: "skip" },
    ];
    // both conditions hold → match
    expect(matchSkipRule("antigravity", { status: 503, text: "MODEL_CAPACITY_EXHAUSTED" }, mixed)?.action).toBe("skip");
    expect(matchSkipRule("antigravity", { status: 503, text: "No capacity available for model x" }, mixed)?.action).toBe("skip");
    // status matches but text does not → NO match
    expect(matchSkipRule("antigravity", { status: 503, text: "gateway boom" }, mixed)).toBeNull();
    // text matches but status does not → NO match
    expect(matchSkipRule("antigravity", { status: 500, text: "capacity" }, mixed)).toBeNull();
  });

  it("uses array order — first fully-matching rule wins", () => {
    const ordered = [
      { provider: "p", match: { status: 503 }, action: "retry" },
      { provider: "p", match: { status: 503, contains: "capacity" }, action: "skip" },
    ];
    // first rule (status:503 only) matches first → retry, even though the 2nd also would
    const r = matchSkipRule("p", { status: 503, text: "capacity" }, ordered);
    expect(r.action).toBe("retry");
  });

  it("a match block with no usable condition never matches (no skip-all)", () => {
    expect(matchSkipRule("p", { status: 503 }, [{ provider: "p", match: {}, action: "skip" }])).toBeNull();
  });

  it("returns sweep:true only when a matched skip rule opts in", () => {
    const withSweep = [{ provider: "ag", match: { status: 503 }, action: "skip", sweep: true }];
    expect(matchSkipRule("ag", { status: 503 }, withSweep)).toEqual({ action: "skip", sweep: true });

    const noSweep = [{ provider: "ag", match: { status: 503 }, action: "skip" }];
    expect(matchSkipRule("ag", { status: 503 }, noSweep)).toEqual({ action: "skip" });

    // sweep is ignored on retry rules (not a skip)
    const retrySweep = [{ provider: "ag", match: { status: 429 }, action: "retry", sweep: true }];
    expect(matchSkipRule("ag", { status: 429 }, retrySweep)).toEqual({ action: "retry" });
  });
});

describe("findMatchingSkipRule", () => {
  const rules = [
    { provider: "ag", match: { status: 503, contains: "capacity" }, action: "skip", sweep: true },
    { provider: "ag", match: { status: 429 }, action: "retry" },
  ];

  it("returns the ACTUAL matching rule object (first match), not a derived shape", () => {
    const r = findMatchingSkipRule("ag", { status: 503, text: "MODEL_CAPACITY_EXHAUSTED" }, rules);
    expect(r).toBe(rules[0]); // same object reference → callers can mutate (e.g. raise sweep)
  });

  it("returns null when nothing matches", () => {
    expect(findMatchingSkipRule("ag", { status: 500, text: "boom" }, rules)).toBeNull();
    expect(findMatchingSkipRule("other", { status: 503, text: "capacity" }, rules)).toBeNull();
  });

  it("matchSkipRule is a thin wrapper — derives {action,sweep} from the found rule", () => {
    expect(matchSkipRule("ag", { status: 503, text: "capacity" }, rules)).toEqual({ action: "skip", sweep: true });
    expect(matchSkipRule("ag", { status: 429 }, rules)).toEqual({ action: "retry" });
  });
});

describe("resolveProviderHeaderTimeout", () => {
  it("returns configured timeout for connect_timeout rule", () => {
    const rules = [{ provider: "kr-ac", match: { kind: "connect_timeout" }, action: "skip", headerTimeoutMs: 25000 }];
    expect(resolveProviderHeaderTimeout("kr-ac", rules)).toBe(25000);
  });

  it("returns null for a different provider (no cross-provider leak)", () => {
    const rules = [{ provider: "A", match: { kind: "connect_timeout" }, action: "skip", headerTimeoutMs: 25000 }];
    expect(resolveProviderHeaderTimeout("B", rules)).toBeNull();
  });

  it("earlier rule wins when multiple connect_timeout rules exist", () => {
    const rules = [
      { provider: "A", match: { kind: "connect_timeout" }, action: "skip", headerTimeoutMs: 10000 },
      { provider: "A", match: { kind: "connect_timeout" }, action: "skip", headerTimeoutMs: 30000 },
    ];
    expect(resolveProviderHeaderTimeout("A", rules)).toBe(10000);
  });
});
