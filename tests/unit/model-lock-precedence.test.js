import { describe, expect, it } from "vitest";

import {
  MODEL_LOCK_ALL,
  getEarliestModelLockUntil,
  getModelLockKey,
  getModelLockUntil,
  isModelLockActive,
} from "../../open-sse/services/accountFallback.js";

const MODEL = "claude-fable-5";
const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 7 * 24 * 3600_000).toISOString();

describe("isModelLockActive precedence", () => {
  it("does not let an expired per-model lock mask an active account-wide lock", () => {
    // The shape a GitHub account reaches after a plain 402 (two-minute per-model
    // lock) followed by monthly exhaustion (account-wide lock until next month).
    const connection = {
      [getModelLockKey(MODEL)]: past(),
      [MODEL_LOCK_ALL]: future(),
    };

    expect(isModelLockActive(connection, MODEL)).toBe(true);
    // The asymmetry is what made this visible: the account read as locked for a
    // model it had no history with, and free for the one that had just failed.
    expect(isModelLockActive(connection, "some-other-model")).toBe(true);
    // The UI badge already skipped expired entries, so routing and the dashboard
    // disagreed about the same connection.
    expect(getEarliestModelLockUntil(connection)).not.toBeNull();
  });

  it("keeps an active per-model lock", () => {
    const connection = { [getModelLockKey(MODEL)]: future() };
    expect(isModelLockActive(connection, MODEL)).toBe(true);
    expect(isModelLockActive(connection, "other")).toBe(false);
  });

  it("releases a connection once both locks have expired", () => {
    const connection = {
      [getModelLockKey(MODEL)]: past(),
      [MODEL_LOCK_ALL]: past(),
    };
    expect(isModelLockActive(connection, MODEL)).toBe(false);
    expect(isModelLockActive(connection, "other")).toBe(false);
  });

  it("treats an unparseable timestamp as no lock rather than a permanent one", () => {
    const connection = { [getModelLockKey(MODEL)]: "not-a-date" };
    expect(isModelLockActive(connection, MODEL)).toBe(false);
  });

  it("returns false when the connection carries no lock at all", () => {
    expect(isModelLockActive({}, MODEL)).toBe(false);
  });
});

describe("getModelLockUntil agrees with isModelLockActive, key for key", () => {
  it("reports the later of the two gating locks, not the earlier", () => {
    // The connection is locked for MODEL while either key is live, so it frees up
    // when the LAST of them passes. Returning the earlier one advises a retry that
    // is still locked.
    const soon = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 3600_000).toISOString();

    expect(getModelLockUntil({ [getModelLockKey(MODEL)]: soon, [MODEL_LOCK_ALL]: later }, MODEL))
      .toBe(later);
    expect(getModelLockUntil({ [getModelLockKey(MODEL)]: later, [MODEL_LOCK_ALL]: soon }, MODEL))
      .toBe(later);
  });

  it("ignores a lock belonging to a different model", () => {
    // This is the divergence that made retry timing wrong: the connection-wide
    // helper returns the other model's expiry, so a caller retried while the model
    // it actually asked for was still locked, and burned an upstream request.
    const otherSoon = new Date(Date.now() + 60_000).toISOString();
    const mineLater = new Date(Date.now() + 3600_000).toISOString();
    const connection = {
      [getModelLockKey("some-other-model")]: otherSoon,
      [getModelLockKey(MODEL)]: mineLater,
    };

    expect(getModelLockUntil(connection, MODEL)).toBe(mineLater);
    expect(getEarliestModelLockUntil(connection)).toBe(otherSoon);
  });

  it("returns null exactly when isModelLockActive returns false", () => {
    const cases = [
      {},
      { [getModelLockKey(MODEL)]: past() },
      { [getModelLockKey(MODEL)]: past(), [MODEL_LOCK_ALL]: past() },
      { [getModelLockKey(MODEL)]: "not-a-date" },
      { [getModelLockKey("some-other-model")]: future() },
      { [getModelLockKey(MODEL)]: future() },
      { [MODEL_LOCK_ALL]: future() },
      { [getModelLockKey(MODEL)]: past(), [MODEL_LOCK_ALL]: future() },
    ];

    for (const connection of cases) {
      const locked = isModelLockActive(connection, MODEL);
      const until = getModelLockUntil(connection, MODEL);
      expect(until !== null, JSON.stringify(connection)).toBe(locked);
    }
  });

  it("resolves a null or absent model to the account-wide key, as the sibling does", () => {
    const connection = { [MODEL_LOCK_ALL]: future() };

    for (const model of [null, undefined]) {
      expect(isModelLockActive(connection, model)).toBe(true);
      expect(getModelLockUntil(connection, model)).toBe(connection[MODEL_LOCK_ALL]);
    }
  });

  it("returns null for a missing connection rather than throwing", () => {
    expect(getModelLockUntil(null, MODEL)).toBeNull();
  });
});
