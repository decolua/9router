import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb.js", () => ({ getProviderConnections: vi.fn(async () => []) }));
vi.mock("@/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, connection) => connection),
}));

describe("Codex Native model metadata cohorts", () => {
  it("keeps one complete ModelInfo cohort and deterministically prefers account count then priority", async () => {
    const { hashCodexModelInfo, selectCodexModelCohorts } = await import("@/lib/codexNative/catalog.js");
    const rich = {
      slug: "gpt-native",
      display_name: "Native",
      priority: 2,
      base_instructions: "cohort-rich",
      context_window: 300_000,
      supported_reasoning_levels: [{ effort: "high" }],
      experimental_supported_tools: ["shell", "search"],
    };
    const different = {
      ...rich,
      base_instructions: "cohort-other",
      context_window: 200_000,
      experimental_supported_tools: [],
    };
    const result = selectCodexModelCohorts([
      { ok: true, connectionId: "a", models: [rich] },
      { ok: true, connectionId: "b", models: [rich] },
      { ok: true, connectionId: "priority-first", models: [different] },
    ], [
      { id: "priority-first", priority: 1 },
      { id: "a", priority: 2 },
      { id: "b", priority: 3 },
    ]);

    expect(result.models).toEqual([rich]);
    expect(result.eligibleConnectionIds["gpt-native"]).toEqual(["a", "b"]);
    expect(result.cohortHashes["gpt-native"]).toBe(hashCodexModelInfo(rich));
  });

  it("uses account priority as the tie breaker without merging fields", async () => {
    const { selectCodexModelCohorts } = await import("@/lib/codexNative/catalog.js");
    const first = { slug: "gpt-native", display_name: "First", context_window: 100 };
    const second = { slug: "gpt-native", display_name: "Second", context_window: 200 };
    const result = selectCodexModelCohorts([
      { ok: true, connectionId: "low-priority", models: [first] },
      { ok: true, connectionId: "high-priority", models: [second] },
    ], [
      { id: "high-priority", priority: 1 },
      { id: "low-priority", priority: 2 },
    ]);
    expect(result.models[0]).toEqual(second);
    expect(result.models[0]).not.toHaveProperty("context_window", 100);
  });

  it("hashes the whole ModelInfo independent of object key order", async () => {
    const { hashCodexModelInfo } = await import("@/lib/codexNative/catalog.js");
    expect(hashCodexModelInfo({ slug: "a", nested: { z: 1, a: 2 } }))
      .toBe(hashCodexModelInfo({ nested: { a: 2, z: 1 }, slug: "a" }));
  });
});
