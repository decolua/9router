import { describe, expect, it } from "vitest";

import {
  MODEL_LOCK_ALL,
  getEarliestModelLockUntil,
  getModelLockKey,
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
