import { describe, it, expect, vi } from "vitest";

vi.mock("dns/promises", () => ({
  default: {
    lookup: vi.fn().mockImplementation(async (hostname) => {
      if (hostname.includes("cloudcode")) {
        return { address: "127.0.0.1", family: 4 };
      }
      return { address: "172.217.118.4", family: 4 };
    }),
  },
  lookup: vi.fn().mockImplementation(async (hostname) => {
    if (hostname.includes("cloudcode")) {
      return { address: "127.0.0.1", family: 4 };
    }
    return { address: "172.217.118.4", family: 4 };
  }),
}));

const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

describe("proxyFetch loopback MITM spoof bypass", () => {
  it("resolves real IP and establishes connection via Undici custom DNS dispatcher when spoofed", async () => {
    const res = await proxyAwareFetch("https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
      method: "GET",
      headers: { "User-Agent": "antigravity-test" },
    });

    expect(res).toBeDefined();
    expect(typeof res.status).toBe("number");
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });
});
