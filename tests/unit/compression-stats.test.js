import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stored: null,
  getMeta: vi.fn(async (_key, fallback) => mocks.stored ?? fallback),
  setMeta: vi.fn(async (_key, value) => { mocks.stored = value; }),
}));

vi.mock("../../src/lib/db/helpers/metaStore.js", () => ({
  getMeta: mocks.getMeta,
  setMeta: mocks.setMeta,
}));

describe("compression stats", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.stored = null;
  });

  it("returns empty aggregate stats for all token saver tools", async () => {
    const { getCompressionStats } = await import("../../src/lib/compressionStats.js");

    const stats = await getCompressionStats();

    expect(stats.tools.rtk).toMatchObject({ requests: 0, hits: 0, bytesSaved: 0 });
    expect(stats.tools.caveman).toMatchObject({ requests: 0, hits: 0, bytesSaved: 0 });
    expect(stats.tools.headroom).toMatchObject({ requests: 0, hits: 0, bytesSaved: 0 });
  });

  it("merges byte savings for RTK and Headroom without inventing Caveman savings", async () => {
    const { getCompressionStats, recordCompressionStats } = await import("../../src/lib/compressionStats.js");

    await recordCompressionStats("rtk", {
      bytesBefore: 1000,
      bytesAfter: 400,
      hits: 2,
      detail: "git-diff,grep",
    });
    await recordCompressionStats("headroom", {
      bytesBefore: 5000,
      bytesAfter: 1000,
      hits: 1,
      detail: "claude-sonnet-4",
    });
    await recordCompressionStats("caveman", {
      hits: 1,
      detail: "level=full",
    });

    const stats = await getCompressionStats();

    expect(stats.tools.rtk).toMatchObject({ requests: 1, hits: 2, bytesBefore: 1000, bytesAfter: 400, bytesSaved: 600, estimatedTokensSaved: 150, tokenSavingsAvailable: true, lastDetail: "git-diff,grep" });
    expect(stats.tools.headroom).toMatchObject({ requests: 1, hits: 1, bytesBefore: 5000, bytesAfter: 1000, bytesSaved: 4000, estimatedTokensSaved: 1000, tokenSavingsAvailable: true, lastDetail: "claude-sonnet-4" });
    expect(stats.tools.caveman).toMatchObject({ requests: 1, hits: 1, bytesBefore: 0, bytesAfter: 0, bytesSaved: 0, estimatedTokensSaved: 0, tokenSavingsAvailable: false, lastDetail: "level=full" });
  });

  it("preserves concurrent tool updates from the same request", async () => {
    const { getCompressionStats, recordCompressionStats } = await import("../../src/lib/compressionStats.js");

    await Promise.all([
      recordCompressionStats("rtk", { bytesBefore: 1000, bytesAfter: 700, hits: 1, detail: "git-diff" }),
      recordCompressionStats("caveman", { hits: 1, detail: "level=ultra" }),
    ]);

    const stats = await getCompressionStats();

    expect(stats.tools.rtk).toMatchObject({ requests: 1, hits: 1, bytesSaved: 300, estimatedTokensSaved: 75, tokenSavingsAvailable: true, lastDetail: "git-diff" });
    expect(stats.tools.caveman).toMatchObject({ requests: 1, hits: 1, bytesSaved: 0, lastDetail: "level=ultra" });
  });
});
