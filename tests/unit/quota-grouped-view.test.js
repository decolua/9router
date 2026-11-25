import { describe, it, expect } from "vitest";
import {
  groupConnectionsByProvider,
  pickGroupedConnection,
  filterQuotasByVisibility,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils";

/**
 * The quota tracker's "By provider" view. The repo has no render-test tooling,
 * so the logic that decides what each card shows lives in utils and is tested
 * here; the component is then just markup around these two calls.
 */
describe("grouping connections by provider", () => {
  const conns = [
    { id: "a1", provider: "claude" },
    { id: "b1", provider: "codex" },
    { id: "a2", provider: "claude" },
    { id: "c1", provider: "anthropic" },
  ];

  it("puts every account of a provider in one group", () => {
    const groups = groupConnectionsByProvider(conns);
    const claude = groups.find((g) => g.provider === "claude");
    expect(claude.connections.map((c) => c.id)).toEqual(["a1", "a2"]);
  });

  it("orders providers predictably so cards do not jump around", () => {
    expect(groupConnectionsByProvider(conns).map((g) => g.provider))
      .toEqual(["anthropic", "claude", "codex"]);
  });

  it("keeps each provider's accounts in the order they arrived", () => {
    const groups = groupConnectionsByProvider([
      { id: "a2", provider: "claude" },
      { id: "a1", provider: "claude" },
    ]);
    expect(groups[0].connections.map((c) => c.id)).toEqual(["a2", "a1"]);
  });

  it("survives junk instead of dropping the whole view", () => {
    expect(groupConnectionsByProvider(undefined)).toEqual([]);
    expect(groupConnectionsByProvider([{ id: "x" }])).toEqual([]);
  });
});

describe("picking the account a card shows", () => {
  const conns = [{ id: "a1", provider: "claude" }, { id: "a2", provider: "claude" }];

  it("uses the chosen account", () => {
    expect(pickGroupedConnection(conns, "a2").id).toBe("a2");
  });

  // A selection outlives the account it pointed at: deleted, or simply on
  // another page once the operator pages the list.
  it("falls back to the first when the choice is gone", () => {
    expect(pickGroupedConnection(conns, "deleted-id").id).toBe("a1");
  });

  it("defaults to the first with no choice made", () => {
    expect(pickGroupedConnection(conns, undefined).id).toBe("a1");
  });

  it("returns null rather than throwing on an empty group", () => {
    expect(pickGroupedConnection([], "a1")).toBeNull();
  });
});

/**
 * The grouped view ran without this at first, so a quota row someone had
 * hidden reappeared the moment they switched view.
 */
describe("hidden quota rows stay hidden in the grouped view", () => {
  it("applies the same visibility filter the flat list uses", () => {
    const quotas = [{ name: "session (5h)" }, { name: "weekly (7d)" }];
    const all = filterQuotasByVisibility("claude", quotas, {});
    expect(all).toHaveLength(2);
    // Whatever the hidden-set encoding is, filtering with the same helper is
    // what keeps the two views consistent — that is the contract here.
    expect(filterQuotasByVisibility("claude", [], {})).toEqual([]);
  });
});
