import { describe, expect, it, vi, beforeEach } from "vitest";

// The route reaches for stored bindings and the leaderboard catalog; both are
// stubbed so the merge rules can be tested without a database or a network.
const store = { bindings: {}, saved: [] };
vi.mock("@/models", () => ({
  getRankingBindings: async () => ({ ...store.bindings }),
  setRankingBindings: async (map) => { store.saved.push(map); Object.assign(store.bindings, map); },
  deleteRankingBinding: async (m) => { delete store.bindings[m]; },
  clearRankingBindings: async () => { store.bindings = {}; },
}));

const CATALOG = {
  models: [
    { slug: "gpt-5-6-sol", name: "GPT-5.6 Sol", compositeScore: 90, intelligenceIndex: 60 },
    { slug: "claude-opus-5", name: "Claude Opus 5", compositeScore: 95, intelligenceIndex: 63 },
    { slug: "kimi-k3", name: "Kimi K3", compositeScore: 80, intelligenceIndex: 59 },
  ],
  sources: [],
};
vi.mock("@/lib/aihot/leaderboardScraper.js", () => ({
  getAihotLeaderboardCatalog: async () => ({
    models: CATALOG.models,
    count: CATALOG.models.length,
    fetchedAt: "2026-01-01T00:00:00Z",
    stale: false,
  }),
  AIHOT_LEADERBOARD_BASE: "https://aihot.news/leaderboard",
}));
vi.mock("@/lib/rankings/store", () => ({ readComposite: () => CATALOG }));
vi.mock("@/lib/aa/store", () => ({
  readSnapshot: () => ({ models: CATALOG.models, fetchedAt: "2026-01-01", count: 3, stale: false }),
}));

const { POST, DELETE } = await import("../../src/app/api/aa/rank/route.js");

const call = async (body) => {
  const res = await POST(new Request("http://x/api/aa/rank", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
};

describe("remembered ranking bindings", () => {
  beforeEach(() => { store.bindings = {}; store.saved = []; });

  it("persists a binding the user just chose", async () => {
    const { json } = await call({ models: ["vendor/some-new-model"], bindings: { "vendor/some-new-model": "kimi-k3" } });
    expect(store.saved).toEqual([{ "vendor/some-new-model": "kimi-k3" }]);
    expect(json.remembered["vendor/some-new-model"]).toBe("kimi-k3");
  });

  it("applies a remembered binding without the client resending it", async () => {
    store.bindings = { "vendor/some-new-model": "kimi-k3" };
    const { json } = await call({ models: ["vendor/some-new-model"] });
    // Resolved from memory, so nothing is left for the user to review.
    expect(json.unmatched).toEqual([]);
    expect(json.order).toContain("vendor/some-new-model");
  });

  it("lets a fresh choice override a remembered one", async () => {
    store.bindings = { "vendor/m": "kimi-k3" };
    const { json } = await call({ models: ["vendor/m"], bindings: { "vendor/m": "gpt-5-6-sol" } });
    expect(json.remembered["vendor/m"]).toBe("gpt-5-6-sol");
    expect(store.saved).toEqual([{ "vendor/m": "gpt-5-6-sol" }]);
  });

  it('remembers an explicit "leave unranked" and does not auto-bind over it', async () => {
    const { json } = await call({ models: ["vendor/m"], bindings: { "vendor/m": "" } });
    expect(store.saved).toEqual([{ "vendor/m": "" }]);
    // Recorded as an explicit decision, so it stays in review rather than being
    // silently auto-bound to something plausible.
    expect(json.autoBound).not.toHaveProperty("vendor/m");
  });

  it("does not persist anything when the client sends no bindings", async () => {
    await call({ models: ["claude-opus-5"] });
    expect(store.saved).toEqual([]);
  });

  it("forgets remembered bindings on request", async () => {
    store.bindings = { a: "kimi-k3" };
    const res = await DELETE(new Request("http://x/api/aa/rank", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    }));
    expect(res.status).toBe(200);
    expect(store.bindings).toEqual({});
  });
});
