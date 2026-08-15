import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-models-list-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { buildModelsList } = await import("@/app/api/v1/models/route.js");
  return {
    buildModelsList,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("/v1/models listing with zero configured connections", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    // No network in tests: the opencode live catalog falls back to empty.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network disabled in tests");
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("lists only connection-less noAuth providers, not the full static catalog", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    const models = await ctx.buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);

    // Connection-less noAuth providers are usable with zero setup.
    expect(ids).toContain("mmf/mimo-auto");
    // API-key providers must not appear on a container with nothing configured.
    expect(ids.some((id) => id.startsWith("bzl/"))).toBe(false);
    expect(ids.some((id) => id.startsWith("alicode-intl/"))).toBe(false);
    expect(ids.some((id) => id.startsWith("openai/"))).toBe(false);
  });

  it("still backfills the live opencode free catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "big-pickle" }, { id: "deepseek-v4-flash-free" }] }),
    })));

    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    const models = await ctx.buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("oc/big-pickle");
    expect(ids).toContain("oc/deepseek-v4-flash-free");
  });

  it("keeps the full static catalog when the DB itself is unavailable", async () => {
    // Degraded mode: better a stale-but-complete list than an empty one.
    vi.doMock("@/lib/localDb", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        getProviderConnections: vi.fn(async () => {
          throw new Error("db unavailable");
        }),
      };
    });
    vi.resetModules();
    const { buildModelsList } = await import("@/app/api/v1/models/route.js");
    cleanup = () => {};

    const models = await buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);
    expect(ids.some((id) => id.startsWith("openai/"))).toBe(true);
    expect(ids.some((id) => id.startsWith("bzl/"))).toBe(true);
  });
});
