import { describe, it, expect } from "vitest";
import { optimisticProviderClear, handleMutationBarrier } from "../../../src/app/(dashboard)/dashboard/proxy-pools/proxyFitnessHelpers.js";

describe("ProxyFitnessCard UI logic", () => {
  it("optimisticProviderClear removes exact scopes and wildcards for target provider", () => {
    const snapshot = {
      "pool-1": {
        "freebuff::openai/gpt-4o": { until: 1, reason: "r" },
        "freebuff::*": { until: 1, reason: "r" },
        "other::model": { until: 1, reason: "r" },
      },
      "pool-2": {
        "freebuff::anthropic/claude": { until: 1, reason: "r" },
      }
    };

    const next = optimisticProviderClear(snapshot, "freebuff");

    // pool-1 should keep "other::model" but lose "freebuff" entries
    expect(next["pool-1"]).toEqual({ "other::model": { until: 1, reason: "r" } });

    // pool-2 only had freebuff entries, so it should be deleted entirely
    expect(next["pool-2"]).toBeUndefined();
  });

  it("optimisticProviderClear does not match partial provider names", () => {
    const snapshot = {
      "pool-1": {
        "freebuff-test::model": { until: 1, reason: "r" },
        "freebuff::*": { until: 1, reason: "r" },
      }
    };

    const next = optimisticProviderClear(snapshot, "freebuff");

    // Should clear freebuff::* but leave freebuff-test::model
    expect(next["pool-1"]).toEqual({
      "freebuff-test::model": { until: 1, reason: "r" }
    });
  });

  it("optimisticProviderClear ignores empty provider strings", () => {
    const snapshot = {
      "pool-1": {
        "freebuff::*": { until: 1, reason: "r" },
      }
    };

    const next = optimisticProviderClear(snapshot, "");
    expect(next).toEqual(snapshot);
  });

  describe("Mutation Barrier", () => {
    it("applies fetched snapshot if fetch generation matches mutation generation", () => {
      const current = { "pool-1": { "foo::bar": { until: 1, reason: "r" } } };
      const fetched = { "pool-1": { "foo::bar": { until: 1, reason: "r" }, "new::entry": { until: 1, reason: "r" } } };

      const result = handleMutationBarrier(current, fetched, 0, 0);
      expect(result).toBe(fetched);
    });

    it("rejects fetched snapshot and preserves optimistic current if a mutation occurred during fetch", () => {
      const current = { "pool-1": { "foo::bar": { until: 1, reason: "r" } } };
      const fetched = { "pool-1": { "foo::bar": { until: 1, reason: "r" }, "stale::entry": { until: 1, reason: "r" } } };

      const result = handleMutationBarrier(current, fetched, 0, 1);
      expect(result).toBe(current);
    });
  });
});