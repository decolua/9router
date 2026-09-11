import { describe, expect, it, beforeEach, vi } from "vitest";

// The request path (chatCore) strips media blocks the target model cannot read.
// It used to consult only the static name-pattern table, so an operator who
// hand-declared "vision: true" on a custom model still had their images dropped
// before the upstream call. getDeclaredModelCaps supplies that declaration; it
// is cached because it runs on every chat completion.
describe("getDeclaredModelCaps", () => {
  let getDeclaredModelCaps;
  let invalidateDeclaredModelCaps;
  let getCustomModels;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("../../src/lib/db/repos/aliasRepo.js", () => ({
      getCustomModels: vi.fn(async () => [
        { providerAlias: "vendor", id: "flash-v1", caps: { vision: true, reasoning: true } },
        { providerAlias: "vendor", id: "text-only-v1", caps: { vision: false } },
        { providerAlias: "vendor", id: "no-declaration" },
      ]),
    }));
    ({ getDeclaredModelCaps, invalidateDeclaredModelCaps } = await import(
      "../../open-sse/providers/declaredCaps.js"
    ));
    ({ getCustomModels } = await import("../../src/lib/db/repos/aliasRepo.js"));
  });

  it("returns the declared caps for a known model", async () => {
    await expect(getDeclaredModelCaps("vendor", "flash-v1")).resolves.toEqual({
      vision: true,
      reasoning: true,
    });
  });

  it("accepts a bare model id", async () => {
    await expect(getDeclaredModelCaps("vendor", "flash-v1")).resolves.toBeDefined();
  });

  it("accepts a provider-prefixed model id", async () => {
    const bare = await getDeclaredModelCaps("vendor", "flash-v1");
    const prefixed = await getDeclaredModelCaps("vendor", "vendor/flash-v1");
    expect(prefixed).toEqual(bare);
  });

  it("returns undefined for a model with no declaration", async () => {
    await expect(getDeclaredModelCaps("vendor", "no-declaration")).resolves.toBeUndefined();
  });

  it("returns undefined for an unknown model rather than throwing", async () => {
    await expect(getDeclaredModelCaps("vendor", "definitely-not-a-model")).resolves.toBeUndefined();
  });

  it("returns undefined for an empty model id", async () => {
    await expect(getDeclaredModelCaps("vendor", "")).resolves.toBeUndefined();
    await expect(getDeclaredModelCaps("vendor", undefined)).resolves.toBeUndefined();
  });

  it("serves repeat lookups from cache without re-reading kv", async () => {
    await getDeclaredModelCaps("vendor", "flash-v1");
    const callsAfterFirst = getCustomModels.mock.calls.length;
    await getDeclaredModelCaps("vendor", "flash-v1");
    expect(getCustomModels.mock.calls.length).toBe(callsAfterFirst);
  });

  it("re-reads after invalidation", async () => {
    await getDeclaredModelCaps("vendor", "flash-v1");
    const callsAfterFirst = getCustomModels.mock.calls.length;
    invalidateDeclaredModelCaps();
    await getDeclaredModelCaps("vendor", "flash-v1");
    expect(getCustomModels.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("fails open when the kv read throws", async () => {
    getCustomModels.mockRejectedValueOnce(new Error("db down"));
    invalidateDeclaredModelCaps();
    // A read failure must degrade to the static-table guess, never break the request.
    await expect(getDeclaredModelCaps("vendor", "flash-v1")).resolves.toBeUndefined();
  });
});
