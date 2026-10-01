// #4333: "Strict Proxy" did not hold. With a strict pool assigned and every
// proxy in it dead, requests still went out over the direct IP — the exact
// leak the setting exists to prevent.
//
// Two halves, one per layer:
//
// 1. resolveConnectionProxyConfig drops strictProxy whenever the pool is not
//    usable (inactive, or saved with an empty proxyUrl). isValidPool gates the
//    only two returns that carry strictProxy, so an unusable strict pool falls
//    through to the legacy/none branches, which report strictProxy:false.
//
// 2. proxyAwareFetch only honours strictProxy inside the catch of a proxy
//    attempt. When no proxy URL resolves there is nothing to try, so it
//    reaches the trailing `return originalFetch(url, options)` and connects
//    directly.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
}));

const { getProxyPoolById } = await import("@/models");
const { resolveConnectionProxyConfig } = await import("../../src/lib/network/connectionProxy.js");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

describe("strict pool keeps strictProxy when the pool is unusable (#4333)", () => {
  it("keeps strictProxy for an inactive strict pool", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p1", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p1" });
    expect(cfg.strictProxy).toBe(true);
  });

  it("keeps strictProxy for a strict pool saved without a proxy url", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p2", isActive: true, proxyUrl: "", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p2" });
    expect(cfg.strictProxy).toBe(true);
  });

  it("still reports strictProxy:false for a non-strict pool", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p3", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: false,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p3" });
    expect(cfg.strictProxy).toBe(false);
  });

  it("still reports strictProxy:false when no pool is assigned", async () => {
    const cfg = await resolveConnectionProxyConfig({});
    expect(cfg.strictProxy).toBe(false);
  });
});

describe("strictProxy refuses a direct connection (#4333)", () => {
  it("throws when a pool is assigned but no proxy url resolved", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { proxyPoolId: "p1", strictProxy: true }),
    ).rejects.toThrow(/strictProxy/);
  });

  it("throws when the pool is enabled but carries an empty url", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { enabled: true, url: "", strictProxy: true }),
    ).rejects.toThrow(/strictProxy/);
  });

  it("does not block a caller that sets strictProxy with no proxy configured", async () => {
    // The Qoder executor passes strictProxy:true to mean "do not replay this
    // request directly if the proxy fails" — a replayed COSY signature gets a
    // 403. With nothing configured it must still reach the network.
    await expect(
      proxyAwareFetch("https://nonexistent.invalid/v1/chat", {}, { strictProxy: true }),
    ).rejects.not.toThrow(/strictProxy/);
  });

  it("does not block a request when strictProxy is off", async () => {
    // No proxy, not strict: the call is allowed to reach the network layer.
    // It fails on DNS here, which is fine — what matters is that the refusal
    // is NOT the strictProxy guard.
    await expect(
      proxyAwareFetch("https://nonexistent.invalid/v1/chat", {}, { strictProxy: false }),
    ).rejects.not.toThrow(/strictProxy/);
  });
});
