import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getCompressionStats: vi.fn(async () => ({ tools: { rtk: { hits: 3 } } })),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/compressionStats", () => ({
  getCompressionStats: mocks.getCompressionStats,
}));

describe("compression stats API", () => {
  it("returns aggregate compression stats", async () => {
    const { GET } = await import("../../src/app/api/compression/stats/route.js");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.tools.rtk.hits).toBe(3);
    expect(mocks.getCompressionStats).toHaveBeenCalledOnce();
  });
});
