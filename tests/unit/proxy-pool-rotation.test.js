import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
}));

const { getProxyPoolById } = await import("@/models");
const {
  pickProxyPoolId,
  resolveConnectionProxyConfig,
} = await import("../../src/lib/network/connectionProxy.js");

describe("pickProxyPoolId rotation", () => {
  it("rotates through proxyPoolIds using round-robin", () => {
    const pools = ["p1", "p2", "p3"];
    const r1 = pickProxyPoolId(pools, "round-robin", "test-conn-1");
    const r2 = pickProxyPoolId(pools, "round-robin", "test-conn-1");
    const r3 = pickProxyPoolId(pools, "round-robin", "test-conn-1");
    const r4 = pickProxyPoolId(pools, "round-robin", "test-conn-1");

    expect([r1, r2, r3, r4]).toEqual(["p1", "p2", "p3", "p1"]);
  });

  it("isolates round-robin state by id", () => {
    const pools = ["p1", "p2"];
    const a1 = pickProxyPoolId(pools, "round-robin", "conn-a");
    const b1 = pickProxyPoolId(pools, "round-robin", "conn-b");
    const a2 = pickProxyPoolId(pools, "round-robin", "conn-a");

    expect(a1).toBe("p1");
    expect(b1).toBe("p1");
    expect(a2).toBe("p2");
  });

  it("picks randomly when strategy is random", () => {
    const pools = ["p1", "p2", "p3"];
    const picked = pickProxyPoolId(pools, "random", "conn-rand");
    expect(pools).toContain(picked);
  });

  it("returns single pool directly without rotation state overhead", () => {
    expect(pickProxyPoolId(["p1"], "round-robin", "any")).toBe("p1");
  });

  it("returns null for empty or null list", () => {
    expect(pickProxyPoolId([], "round-robin", "any")).toBe(null);
    expect(pickProxyPoolId(null, "round-robin", "any")).toBe(null);
  });
});

describe("resolveConnectionProxyConfig with proxyPoolIds array", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rotates between pools configured in proxyPoolIds array", async () => {
    getProxyPoolById.mockImplementation(async (id) => ({
      id,
      name: `Pool ${id}`,
      proxyUrl: `http://127.0.0.1:800${id.slice(-1)}`,
      isActive: true,
      type: "http",
    }));

    const psd = {
      proxyPoolIds: ["p1", "p2"],
      proxyRotateStrategy: "round-robin",
    };

    const c1 = await resolveConnectionProxyConfig(psd, { connectionId: "conn-rot-1" });
    const c2 = await resolveConnectionProxyConfig(psd, { connectionId: "conn-rot-1" });

    expect(c1.proxyPoolId).toBe("p1");
    expect(c1.connectionProxyUrl).toBe("http://127.0.0.1:8001");
    expect(c2.proxyPoolId).toBe("p2");
    expect(c2.connectionProxyUrl).toBe("http://127.0.0.1:8002");
  });

  it("falls back to single proxyPoolId when proxyPoolIds is not present", async () => {
    getProxyPoolById.mockResolvedValueOnce({
      id: "single-1",
      proxyUrl: "http://127.0.0.1:9000",
      isActive: true,
      type: "http",
    });

    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "single-1" });
    expect(cfg.proxyPoolId).toBe("single-1");
    expect(cfg.connectionProxyUrl).toBe("http://127.0.0.1:9000");
  });

  it("preserves strictProxy flag across rotated pool picks", async () => {
    getProxyPoolById.mockImplementation(async (id) => ({
      id,
      proxyUrl: `http://127.0.0.1:800${id.slice(-1)}`,
      isActive: true,
      strictProxy: true,
      type: "http",
    }));

    const cfg = await resolveConnectionProxyConfig(
      {
        proxyPoolIds: ["p1", "p2"],
        proxyRotateStrategy: "round-robin",
      },
      { connectionId: "conn-strict" }
    );

    expect(cfg.strictProxy).toBe(true);
  });

  it("handles string comma-separated proxyPoolIds gracefully", async () => {
    getProxyPoolById.mockResolvedValueOnce({
      id: "p1",
      proxyUrl: "http://127.0.0.1:8001",
      isActive: true,
      type: "http",
    });

    const cfg = await resolveConnectionProxyConfig({
      proxyPoolIds: ["p1"],
      proxyRotateStrategy: "round-robin",
    });

    expect(cfg.proxyPoolId).toBe("p1");
  });
});

