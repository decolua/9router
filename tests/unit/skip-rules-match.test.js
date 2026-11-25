import { describe, expect, it } from "vitest";
import { matchSkipRule, findMatchingSkipRule, resolveProviderHeaderTimeout, resolveRetryAttempts, ruleSpecificity, SKIP_RULE_RETRY_ATTEMPTS_DEFAULT } from "../../open-sse/services/accountFallback.js";

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

  it("the MORE SPECIFIC rule wins regardless of array order", () => {
    const generalFirst = [
      { provider: "p", match: { status: 503 }, action: "retry" },
      { provider: "p", match: { status: 503, contains: "capacity" }, action: "skip" },
    ];
    // status+contains (3) outranks status-only (1) even though it is listed second.
    expect(matchSkipRule("p", { status: 503, text: "capacity" }, generalFirst).action).toBe("skip");

    // Reversing the array must not change the outcome.
    expect(matchSkipRule("p", { status: 503, text: "capacity" }, [...generalFirst].reverse()).action).toBe("skip");

    // A failure the specific rule does not cover still falls back to the general one.
    expect(matchSkipRule("p", { status: 503, text: "gateway boom" }, generalFirst).action).toBe("retry");
  });

  it("array order still breaks ties between equally specific rules", () => {
    const tie = [
      { provider: "p", match: { status: 429 }, action: "retry" },
      { provider: "p", match: { status: 429 }, action: "skip" },
    ];
    expect(matchSkipRule("p", { status: 429 }, tie).action).toBe("retry");
  });

  it("an empty match is a provider-wide wildcard, overridden by any specific rule", () => {
    // This is the case the flat first-match model got wrong: a blanket skip listed
    // first used to swallow 429 and the retry rule became dead config.
    const rules = [
      { provider: "p", match: {}, action: "skip" },
      { provider: "p", match: { status: 429 }, action: "retry", retryAttempts: 5 },
    ];
    expect(matchSkipRule("p", { status: 429 }, rules)).toEqual({ action: "retry", retryAttempts: 5 });
    expect(matchSkipRule("p", { status: 500 }, rules)).toEqual({ action: "skip" });
    expect(matchSkipRule("p", { errorKind: "network" }, rules)).toEqual({ action: "skip" });
    // Wildcard is scoped to its provider, never global.
    expect(matchSkipRule("other", { status: 500 }, rules)).toBeNull();
  });

  it("ranks specificity: status+contains > contains > status > wildcard", () => {
    expect(ruleSpecificity({})).toBe(0);
    expect(ruleSpecificity({ status: 429 })).toBe(1);
    expect(ruleSpecificity({ kind: "network" })).toBe(1);
    expect(ruleSpecificity({ contains: "boom" })).toBe(2);
    expect(ruleSpecificity({ status: 429, contains: "boom" })).toBe(3);
    // Blank strings do not count as conditions (a cleared UI field is not a filter).
    expect(ruleSpecificity({ status: "", contains: "" })).toBe(0);
    expect(ruleSpecificity(null)).toBe(0);

    const rules = [
      { provider: "p", match: {}, action: "skip" },
      { provider: "p", match: { status: 500 }, action: "skip", sweep: true },
      { provider: "p", match: { contains: "overloaded" }, action: "retry", retryAttempts: 2 },
      { provider: "p", match: { status: 500, contains: "overloaded" }, action: "retry", retryAttempts: 9 },
    ];
    expect(matchSkipRule("p", { status: 500, text: "server OVERLOADED" }, rules).retryAttempts).toBe(9);
    expect(matchSkipRule("p", { status: 502, text: "overloaded" }, rules).retryAttempts).toBe(2);
    expect(matchSkipRule("p", { status: 500, text: "other" }, rules)).toEqual({ action: "skip", sweep: true });
    expect(matchSkipRule("p", { status: 418, text: "other" }, rules)).toEqual({ action: "skip" });
  });

  it("returns sweep:true only when a matched skip rule opts in", () => {
    const withSweep = [{ provider: "ag", match: { status: 503 }, action: "skip", sweep: true }];
    expect(matchSkipRule("ag", { status: 503 }, withSweep)).toEqual({ action: "skip", sweep: true });

    const noSweep = [{ provider: "ag", match: { status: 503 }, action: "skip" }];
    expect(matchSkipRule("ag", { status: 503 }, noSweep)).toEqual({ action: "skip" });

    // sweep is ignored on retry rules (not a skip); retryAttempts is resolved instead.
    const retrySweep = [{ provider: "ag", match: { status: 429 }, action: "retry", sweep: true }];
    expect(matchSkipRule("ag", { status: 429 }, retrySweep))
      .toEqual({ action: "retry", retryAttempts: SKIP_RULE_RETRY_ATTEMPTS_DEFAULT });
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

  it("matchSkipRule is a thin wrapper — derives {action,sweep,retryAttempts} from the found rule", () => {
    expect(matchSkipRule("ag", { status: 503, text: "capacity" }, rules)).toEqual({ action: "skip", sweep: true });
    expect(matchSkipRule("ag", { status: 429 }, rules))
      .toEqual({ action: "retry", retryAttempts: SKIP_RULE_RETRY_ATTEMPTS_DEFAULT });
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

describe("resolveRetryAttempts", () => {
  it("honours any positive integer, with no upper bound", () => {
    expect(resolveRetryAttempts({ retryAttempts: 1 })).toBe(1);
    expect(resolveRetryAttempts({ retryAttempts: 3 })).toBe(3);
    expect(resolveRetryAttempts({ retryAttempts: 10 })).toBe(10);
    expect(resolveRetryAttempts({ retryAttempts: 50 })).toBe(50);
    expect(resolveRetryAttempts({ retryAttempts: 1000 })).toBe(1000);
  });

  it("falls back to the default rather than disabling the rule", () => {
    // A rule the user explicitly created should still retry once even if the
    // stored value is junk; 0/negative must not silently mean "never retry".
    for (const bad of [undefined, null, 0, -2, 2.5, "3", NaN]) {
      expect(resolveRetryAttempts({ retryAttempts: bad })).toBe(SKIP_RULE_RETRY_ATTEMPTS_DEFAULT);
    }
    expect(resolveRetryAttempts({})).toBe(SKIP_RULE_RETRY_ATTEMPTS_DEFAULT);
    expect(resolveRetryAttempts(null)).toBe(SKIP_RULE_RETRY_ATTEMPTS_DEFAULT);
  });

  it("matchSkipRule surfaces it only for retry rules", () => {
    const rules = [
      { provider: "p", match: { status: 502 }, action: "retry", retryAttempts: 4 },
      { provider: "p", match: { status: 503 }, action: "skip" },
    ];
    expect(matchSkipRule("p", { status: 502 }, rules).retryAttempts).toBe(4);
    expect("retryAttempts" in matchSkipRule("p", { status: 503 }, rules)).toBe(false);
  });
});
