import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDisciplineStrikes,
  consumeNudge,
  recordStrike,
  strikeStore,
} from "../../open-sse/utils/discipline.js";

const MODEL = "provider/model";

describe("output discipline strikes", () => {
  beforeEach(() => {
    clearDisciplineStrikes();
    vi.useRealTimers();
  });

  it("locks every third strike within ten minutes", () => {
    expect(recordStrike(MODEL, "doubled-json", 0)).toEqual({ count: 1, shouldLock: false });
    expect(recordStrike(MODEL, "doubled-json", 1)).toEqual({ count: 2, shouldLock: false });
    expect(recordStrike(MODEL, "doubled-json", 2)).toEqual({ count: 3, shouldLock: true });
    expect(recordStrike(MODEL, "doubled-json", 3)).toEqual({ count: 1, shouldLock: false });
  });

  it("resets strikes after ten minutes of inactivity", () => {
    recordStrike(MODEL, "doubled-json", 0);
    recordStrike(MODEL, "doubled-json", 1);

    expect(recordStrike(MODEL, "doubled-json", 10 * 60 * 1000 + 2)).toEqual({ count: 1, shouldLock: false });
  });

  it("does not count non-corruption strikes toward model locking", () => {
    recordStrike(MODEL, "echo", 0);
    recordStrike(MODEL, "think-aloud", 1);

    expect(recordStrike(MODEL, "doubled-json", 2)).toEqual({ count: 1, shouldLock: false });
    expect(recordStrike(MODEL, "doubled-json", 3)).toEqual({ count: 2, shouldLock: false });
    expect(recordStrike(MODEL, "doubled-json", 4)).toEqual({ count: 3, shouldLock: true });
  });

  it("tracks kinds and consumes a pending nudge once", () => {
    recordStrike(MODEL, "doubled-json", 0);
    recordStrike(MODEL, "echo", 1);

    expect(strikeStore.get(MODEL).kinds).toEqual(new Set(["doubled-json", "echo"]));
    expect(consumeNudge(MODEL, 2)).toBe(true);
    expect(consumeNudge(MODEL, 3)).toBe(false);
    expect(consumeNudge("missing", 3)).toBe(false);
  });
});
