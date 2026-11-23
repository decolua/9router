//
// The cached runtime resolve in src/lib/observability/config.js: one shared cache for both
// capture mechanisms, a settings PATCH takes effect immediately, and the request path is
// not blocked on the DB after the first read.

import { describe, it, expect, beforeEach, vi } from "vitest";

const store = vi.hoisted(() => ({ raw: {}, reads: 0 }));

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: async () => { store.reads += 1; return { enableObservability: false, ...store.raw }; },
  exportSettings: async () => ({ ...store.raw }),
}));

const { getObservabilityConfig, invalidateObservabilityConfigCache } =
  await import("@/lib/observability/config.js");

describe("getObservabilityConfig", () => {
  beforeEach(() => {
    store.raw = {};
    store.reads = 0;
    invalidateObservabilityConfigCache();
  });

  it("serves both gates from one cached read", async () => {
    store.raw = { enableObservability: true, observabilityFrameLogging: true, observabilityRetentionHours: 6 };
    const a = await getObservabilityConfig();
    const b = await getObservabilityConfig();
    expect(a).toMatchObject({ enabled: true, frameLogging: true, retentionHours: 6 });
    expect(b).toBe(a);           // same object → no second DB read
    expect(store.reads).toBe(1);
  });

  it("picks up a settings change immediately once the cache is invalidated", async () => {
    store.raw = { enableObservability: true, observabilityFrameLogging: false };
    expect((await getObservabilityConfig()).frameLogging).toBe(false);

    // What PATCH /api/settings does after writing the row.
    store.raw = { enableObservability: true, observabilityFrameLogging: true };
    invalidateObservabilityConfigCache();

    expect((await getObservabilityConfig()).frameLogging).toBe(true);
  });

  it("fails closed when the settings row cannot be read", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/repos/settingsRepo.js", () => { throw new Error("db down"); });
    const mod = await import("@/lib/observability/config.js");
    const cfg = await mod.getObservabilityConfig();
    expect(cfg).toMatchObject({ enabled: false, frameLogging: false, retentionHours: 12 });
    vi.doUnmock("@/lib/db/repos/settingsRepo.js");
    vi.resetModules();
  });
});
