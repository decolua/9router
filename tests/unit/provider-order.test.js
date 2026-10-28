/**
 * Unit tests for provider display ordering in the Quota Tracker.
 *
 * Context: `providerConnections.priority` is a PER-PROVIDER rank (assigned as
 * MAX+1 scoped to the provider, renumbered 1..N scoped to the provider), so
 * every provider's first connection ties at priority 1. The quota panel used to
 * break that tie by provider name, which pinned "antigravity" to the top with no
 * way to change it. `settings.providerOrder` now takes precedence, and must
 * never be confused with `priority` (which selects the account used for
 * requests).
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeProviderOrder,
  moveInArray,
  providerSequence,
  moveProviderBlock,
  providerRankMap,
  sortConnectionsByProviderOrder,
} from "@/shared/utils/providerOrder";

const conn = (id, provider, priority = 1, extra = {}) => ({
  id,
  provider,
  priority,
  ...extra,
});

describe("sanitizeProviderOrder", () => {
  it("returns [] for anything that is not an array", () => {
    expect(sanitizeProviderOrder(undefined)).toEqual([]);
    expect(sanitizeProviderOrder(null)).toEqual([]);
    expect(sanitizeProviderOrder("antigravity")).toEqual([]);
    expect(sanitizeProviderOrder({ 0: "a" })).toEqual([]);
  });

  it("drops non-strings, empties and whitespace-only entries", () => {
    expect(sanitizeProviderOrder(["claude", "", "   ", 42, null, {}, "codex"])).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("trims entries and de-duplicates keeping the first occurrence", () => {
    expect(sanitizeProviderOrder([" claude ", "codex", "claude"])).toEqual(["claude", "codex"]);
  });

  it("caps the number of entries so a bad client cannot bloat settings", () => {
    const huge = Array.from({ length: 900 }, (_, i) => `p${i}`);
    expect(sanitizeProviderOrder(huge)).toHaveLength(500);
  });

  it("drops absurdly long provider ids", () => {
    expect(sanitizeProviderOrder(["ok", "x".repeat(300)])).toEqual(["ok"]);
  });
});

describe("moveInArray", () => {
  it("moves an item forward (remove then insert)", () => {
    expect(moveInArray(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves an item backward", () => {
    expect(moveInArray(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("returns a copy unchanged for out-of-range or no-op moves", () => {
    const list = ["a", "b", "c"];
    expect(moveInArray(list, 1, 1)).toEqual(list);
    expect(moveInArray(list, -1, 1)).toEqual(list);
    expect(moveInArray(list, 3, 1)).toEqual(list);
    expect(moveInArray(list, 1.5, 2)).toEqual(list);
    expect(moveInArray(list, 1, 1)).not.toBe(list);
  });
});

describe("providerSequence", () => {
  it("returns distinct providers in first-seen order", () => {
    const list = [
      conn("1", "antigravity"),
      conn("2", "antigravity"),
      conn("3", "claude"),
      conn("4", "codex"),
    ];
    expect(providerSequence(list)).toEqual(["antigravity", "claude", "codex"]);
  });

  it("tolerates a missing/empty list", () => {
    expect(providerSequence(undefined)).toEqual([]);
    expect(providerSequence([])).toEqual([]);
  });
});

describe("moveProviderBlock", () => {
  const list = [
    conn("a1", "antigravity", 1),
    conn("a2", "antigravity", 2),
    conn("c1", "claude", 1),
    conn("x1", "codex", 1),
  ];

  it("moves the whole provider block to the target slot", () => {
    const next = moveProviderBlock(list, "antigravity", "codex");
    expect(next.map((c) => c.id)).toEqual(["c1", "x1", "a1", "a2"]);
  });

  it("preserves account order inside every provider", () => {
    const next = moveProviderBlock(list, "antigravity", "codex");
    expect(next.filter((c) => c.provider === "antigravity").map((c) => c.id)).toEqual(["a1", "a2"]);
  });

  it("is a no-op (same reference) for a same-provider drop", () => {
    // Dropping inside one provider must not reshuffle accounts: that order is
    // the request-time account selection order.
    expect(moveProviderBlock(list, "claude", "claude")).toBe(list);
  });

  it("is a no-op for unknown providers", () => {
    expect(moveProviderBlock(list, "nope", "claude")).toBe(list);
    expect(moveProviderBlock(list, "claude", "nope")).toBe(list);
  });

  it("keeps every connection when moving", () => {
    const next = moveProviderBlock(list, "claude", "antigravity");
    expect(next).toHaveLength(list.length);
    expect(new Set(next.map((c) => c.id))).toEqual(new Set(list.map((c) => c.id)));
  });
});

describe("providerRankMap", () => {
  it("ranks providers by their saved position", () => {
    const ranks = providerRankMap(["codex", "claude"]);
    expect(ranks.get("codex")).toBe(0);
    expect(ranks.get("claude")).toBe(1);
    expect(ranks.has("antigravity")).toBe(false);
  });
});

describe("sortConnectionsByProviderOrder", () => {
  // Every provider's first connection ties at priority 1 — this is what made the
  // old ordering alphabetical and unmovable.
  const tied = [
    conn("a1", "antigravity", 1),
    conn("a2", "antigravity", 2),
    conn("c1", "claude", 1),
    conn("c2", "claude", 2),
    conn("x1", "codex", 1),
  ];

  it("keeps the legacy order byte-identical when no order is saved", () => {
    // Regression guard: default installs must not change.
    //
    // Note the interleaving: the legacy comparator is (priority, provider name),
    // NOT provider-grouped — priority 1 across antigravity/claude/codex comes
    // first, then priority 2. That interleaving is precisely why the quota panel
    // calls groupByProviderStable() client-side to re-group by provider. A saved
    // order instead makes the API output provider-grouped (rank dominates), so
    // the client grouping becomes a no-op.
    expect(sortConnectionsByProviderOrder(tied, { sort: "priority", providerOrder: [] }).map((c) => c.id))
      .toEqual(["a1", "c1", "x1", "a2", "c2"]);
    expect(sortConnectionsByProviderOrder(tied, { sort: "priority" }).map((c) => c.id))
      .toEqual(["a1", "c1", "x1", "a2", "c2"]);
  });

  it("honours the saved provider order over the alphabetical tiebreak", () => {
    const next = sortConnectionsByProviderOrder(tied, {
      sort: "priority",
      providerOrder: ["claude", "antigravity"],
    });
    expect(next.map((c) => c.id)).toEqual(["c1", "c2", "a1", "a2", "x1"]);
  });

  it("emits provider-grouped output once an order is saved", () => {
    // The provider rank dominates the per-provider priority, so each provider's
    // connections are contiguous and the client grouping is a no-op.
    const next = sortConnectionsByProviderOrder(tied, {
      sort: "priority",
      providerOrder: ["antigravity", "claude", "codex"],
    });
    expect(providerSequence(next)).toEqual(["antigravity", "claude", "codex"]);
    expect(next.map((c) => c.id)).toEqual(["a1", "a2", "c1", "c2", "x1"]);
  });

  it("puts providers missing from the saved order last, keeping their relative order", () => {
    const next = sortConnectionsByProviderOrder(tied, {
      sort: "priority",
      providerOrder: ["codex"],
    });
    expect(next.map((c) => c.id)).toEqual(["x1", "a1", "c1", "a2", "c2"]);
  });

  it("still sorts accounts by priority inside a provider", () => {
    const shuffled = [
      conn("c2", "claude", 2),
      conn("c1", "claude", 1),
      conn("a1", "antigravity", 1),
    ];
    const next = sortConnectionsByProviderOrder(shuffled, {
      sort: "priority",
      providerOrder: ["claude", "antigravity"],
    });
    expect(next.map((c) => c.id)).toEqual(["c1", "c2", "a1"]);
  });

  it("treats a null priority as lowest within its provider", () => {
    const list = [conn("n", "claude", null), conn("p", "claude", 3)];
    const next = sortConnectionsByProviderOrder(list, { sort: "priority", providerOrder: ["claude"] });
    expect(next.map((c) => c.id)).toEqual(["p", "n"]);
  });

  it("applies the saved order to the registry-order branch too", () => {
    const next = sortConnectionsByProviderOrder(tied, {
      sort: "provider",
      providerOrder: ["codex"],
      usageOrder: ["antigravity", "claude", "codex"],
    });
    expect(next.map((c) => c.id)).toEqual(["x1", "a1", "a2", "c1", "c2"]);
  });

  it("falls back to the registry order when nothing is saved", () => {
    const next = sortConnectionsByProviderOrder(tied, {
      sort: "provider",
      providerOrder: [],
      usageOrder: ["codex", "claude", "antigravity"],
    });
    expect(next.map((c) => c.id)).toEqual(["x1", "c1", "c2", "a1", "a2"]);
  });

  it("returns an empty array for a missing list", () => {
    expect(sortConnectionsByProviderOrder(undefined, { sort: "priority" })).toEqual([]);
  });

  it("does not mutate the caller's array", () => {
    const original = [...tied];
    sortConnectionsByProviderOrder(tied, { sort: "priority", providerOrder: ["codex"] });
    expect(tied).toEqual(original);
  });
});
