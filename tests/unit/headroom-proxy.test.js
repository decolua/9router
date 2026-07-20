import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

const { GET } = await import("@/app/api/headroom/proxy/[...path]/route.js");
const originalFetch = global.fetch;

describe("Headroom dashboard proxy", () => {
  beforeEach(() => {
    mocks.getSettings.mockResolvedValue({ headroomUrl: "http://localhost:8787" });
    global.fetch = vi.fn(async () => new Response("ok"));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("does not forward process proof or peer metadata", async () => {
    const request = new Request("http://router.test/api/headroom/proxy/health", {
      headers: {
        "x-9r-request-proof": "process-secret",
        "x-9r-real-ip": "127.0.0.1",
        "x-9r-ip-source": "socket",
        "x-9r-via-proxy": "1",
        "x-9r-future-private": "private",
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "203.0.113.10",
        "x-real-ip": "203.0.113.10",
        forwarded: "for=203.0.113.10",
        "x-safe-header": "kept",
      },
    });

    await GET(request, { params: Promise.resolve({ path: ["health"] }) });

    const forwarded = global.fetch.mock.calls[0][1].headers;
    expect(forwarded.get("x-safe-header")).toBe("kept");
    for (const name of [
      "x-9r-request-proof",
      "x-9r-real-ip",
      "x-9r-ip-source",
      "x-9r-via-proxy",
      "x-9r-future-private",
      "cf-connecting-ip",
      "x-forwarded-for",
      "x-real-ip",
      "forwarded",
    ]) {
      expect(forwarded.has(name), name).toBe(false);
    }
  });
});
