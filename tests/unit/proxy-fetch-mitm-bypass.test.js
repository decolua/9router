import { describe, it, expect, vi, beforeEach } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

describe("proxyFetch MITM bypass & TLS integrity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("successfully performs direct fetch for MITM hosts when system DNS is normal", async () => {
    const res = await proxyAwareFetch("https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
      method: "GET",
      headers: { "User-Agent": "antigravity-test" },
    });

    // Upstream returns 404 for unauthenticated root endpoint without ECONNRESET
    expect(res).toBeDefined();
    expect(typeof res.status).toBe("number");
    expect(typeof res.headers.get).toBe("function");
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });

  it("handles non-MITM hosts normally", async () => {
    const res = await proxyAwareFetch("https://api.github.com/zen", {
      method: "GET",
      headers: { "User-Agent": "9router-test" },
    });

    expect(res).toBeDefined();
    expect([200, 403]).toContain(res.status);
  });

  it("enforces strictProxy when proxy is required but none resolved", async () => {
    await expect(
      proxyAwareFetch("https://cloudcode-pa.googleapis.com/v1", {}, {
        proxyPoolId: "pool_1",
        strictProxy: true,
      })
    ).rejects.toThrow(/strictProxy/);
  });
});
