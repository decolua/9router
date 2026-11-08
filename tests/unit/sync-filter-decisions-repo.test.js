import { describe, it, expect, beforeEach } from "vitest";
import {
  getFilterDecisions,
  setFilterDecision,
  setFilterDecisions,
  deleteFilterDecision,
  clearFilterDecisions,
} from "../../src/lib/db/repos/syncFilterDecisionsRepo.js";

describe("syncFilterDecisionsRepo", () => {
  beforeEach(async () => {
    await clearFilterDecisions();
  });

  it("stores and retrieves a decision for a single model", async () => {
    await setFilterDecision("custom/my-model-1", "keep", "User approved");
    const all = await getFilterDecisions();
    expect(all["custom/my-model-1"]).toBeDefined();
    expect(all["custom/my-model-1"].decision).toBe("keep");
    expect(all["custom/my-model-1"].note).toBe("User approved");
  });

  it("stores and retrieves batch decisions", async () => {
    await setFilterDecisions({
      "model-a": "keep",
      "model-b": { decision: "reject", note: "Not on leaderboard" },
    });

    const all = await getFilterDecisions();
    expect(all["model-a"].decision).toBe("keep");
    expect(all["model-b"].decision).toBe("reject");
  });

  it("deletes a single decision", async () => {
    await setFilterDecision("model-x", "keep");
    await deleteFilterDecision("model-x");
    const all = await getFilterDecisions();
    expect(all["model-x"]).toBeUndefined();
  });

  it("clears all decisions", async () => {
    await setFilterDecisions({ m1: "keep", m2: "reject" });
    await clearFilterDecisions();
    const all = await getFilterDecisions();
    expect(Object.keys(all)).toHaveLength(0);
  });
});
