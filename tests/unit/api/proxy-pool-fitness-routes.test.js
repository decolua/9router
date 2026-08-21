import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../src/app/api/proxy-pools/fitness/route.js";
import { POST as clearAll } from "../../../src/app/api/proxy-pools/fitness/clear-all/route.js";
import { POST as clearExact } from "../../../src/app/api/proxy-pools/[id]/fitness/clear/route.js";

const mocks = vi.hoisted(() => ({
  clearAllPoolUnfit: vi.fn(),
  clearPoolUnfit: vi.fn(),
  poolFitnessSnapshot: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init.status || 200 }),
  },
}));
vi.mock("../../../open-sse/services/proxyPoolFitness.js", () => mocks);

function request(body, jsonError = null) {
  return {
    json: jsonError ? vi.fn().mockRejectedValue(jsonError) : vi.fn().mockResolvedValue(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.poolFitnessSnapshot.mockResolvedValue({});
  mocks.clearAllPoolUnfit.mockResolvedValue(true);
  mocks.clearPoolUnfit.mockResolvedValue(true);
});

describe("Proxy Fitness API Routes", () => {
  describe("GET /api/proxy-pools/fitness", () => {
    it("returns the documented public snapshot shape", async () => {
      mocks.poolFitnessSnapshot.mockResolvedValue({
        "pool-1": { "freebuff::model": { until: 123, reason: "limited" } },
      });

      await expect(GET()).resolves.toEqual({
        status: 200,
        body: { pools: { "pool-1": { "freebuff::model": { until: 123, reason: "limited" } } } },
      });
    });

    it("allowlists fitness fields and redacts credentials from reasons", async () => {
      mocks.poolFitnessSnapshot.mockResolvedValue({
        "pool-1": {
          "freebuff::model": {
            until: 123,
            reason: "Bearer secret-token https://user:pass@example.com/path\nlimited",
            proxyUrl: "http://user:password@proxy.example",
            token: "secret",
            config: { noProxy: "internal" },
          },
        },
      });

      const response = await GET();
      expect(response.body).toEqual({
        pools: {
          "pool-1": {
            "freebuff::model": {
              until: 123,
              reason: "[REDACTED_BEARER] [REDACTED_URL] limited",
            },
          },
        },
      });
    });

    it("handles service errors", async () => {
      mocks.poolFitnessSnapshot.mockRejectedValue(new Error("db unavailable"));
      await expect(GET()).resolves.toEqual({ status: 500, body: { error: "Failed to read proxy fitness" } });
    });

    it("drops malformed service entries instead of returning their fields", async () => {
      mocks.poolFitnessSnapshot.mockResolvedValue({
        "pool-1": { "freebuff::model": { until: "not-a-timestamp", reason: 42, token: "secret" } },
      });
      await expect(GET()).resolves.toEqual({ status: 200, body: { pools: {} } });
    });
  });

  describe("POST /api/proxy-pools/fitness/clear-all", () => {
    it("clears valid providers including hyphenated names", async () => {
      for (const provider of ["freebuff", "provider-name"]) {
        const response = await clearAll(request({ provider }));
        expect(response).toEqual({ status: 200, body: { ok: true, provider } });
        expect(mocks.clearAllPoolUnfit).toHaveBeenCalledWith(provider);
      }
    });

    it("requires a provider", async () => {
      await expect(clearAll(request({}))).resolves.toEqual({ status: 400, body: { error: "provider is required" } });
      await expect(clearAll(request({ provider: "   " }))).resolves.toEqual({ status: 400, body: { error: "provider is required" } });
    });

    it("rejects wildcard, SQL-like, uppercase, and control-character providers", async () => {
      for (const provider of ["freebuff%", "freebuff_1", "freebuff::*", "FREEBUFF", "freebuff;DROP", "freebuff\n"]) {
        await expect(clearAll(request({ provider }))).resolves.toEqual({ status: 400, body: { error: "Invalid provider format" } });
      }
      expect(mocks.clearAllPoolUnfit).not.toHaveBeenCalled();
    });

    it("rejects invalid or malformed bodies", async () => {
      await expect(clearAll(request([]))).resolves.toEqual({ status: 400, body: { error: "Invalid JSON body" } });
      await expect(clearAll(request(null))).resolves.toEqual({ status: 400, body: { error: "Invalid JSON body" } });
      await expect(clearAll(request("freebuff"))).resolves.toEqual({ status: 400, body: { error: "Invalid JSON body" } });
      await expect(clearAll(request(null, new SyntaxError("invalid")))).resolves.toEqual({ status: 400, body: { error: "Invalid JSON body" } });
    });

    it("maps generic JSON reader failures to 500", async () => {
      await expect(clearAll(request(null, new Error("reader failed")))).resolves.toEqual({ status: 500, body: { error: "Failed to clear proxy fitness" } });
    });

    it("returns 500 when the service fails", async () => {
      mocks.clearAllPoolUnfit.mockResolvedValue(false);
      await expect(clearAll(request({ provider: "freebuff" }))).resolves.toEqual({ status: 500, body: { error: "Failed to clear proxy fitness" } });
    });

    it("maps service exceptions to 500", async () => {
      mocks.clearAllPoolUnfit.mockRejectedValue(new Error("db unavailable"));
      await expect(clearAll(request({ provider: "freebuff" }))).resolves.toEqual({ status: 500, body: { error: "Failed to clear proxy fitness" } });
    });
  });

  describe("POST /api/proxy-pools/[id]/fitness/clear", () => {
    it("clears one exact pool and scope", async () => {
      const response = await clearExact(request({ scope: "freebuff::model" }), { params: Promise.resolve({ id: "pool-1" }) });
      expect(response).toEqual({ status: 200, body: { ok: true, poolId: "pool-1", scope: "freebuff::model" } });
      expect(mocks.clearPoolUnfit).toHaveBeenCalledWith("pool-1", "freebuff::model");
    });

    it("requires poolId and scope", async () => {
      await expect(clearExact(request({ scope: "x" }), { params: Promise.resolve({ id: "" }) })).resolves.toEqual({ status: 400, body: { error: "poolId is required" } });
      await expect(clearExact(request({}), { params: Promise.resolve({ id: "pool-1" }) })).resolves.toEqual({ status: 400, body: { error: "scope is required" } });
    });

    it("rejects invalid and malformed bodies", async () => {
      await expect(clearExact(request([]), { params: Promise.resolve({ id: "pool-1" }) })).resolves.toEqual({ status: 400, body: { error: "Invalid JSON body" } });
      await expect(clearExact(request(null), { params: Promise.resolve({ id: "pool-1" }) })).resolves.toEqual({ status: 400, body: { error: "Invalid JSON body" } });
      await expect(clearExact(request(null, new SyntaxError("invalid")), { params: Promise.resolve({ id: "pool-1" }) })).resolves.toEqual({ status: 400, body: { error: "Invalid JSON body" } });
    });

    it("maps generic JSON reader failures to 500", async () => {
      await expect(clearExact(request(null, new Error("reader failed")), { params: Promise.resolve({ id: "pool-1" }) })).resolves.toEqual({ status: 500, body: { error: "Failed to clear proxy fitness" } });
    });

    it("returns 500 when the service fails", async () => {
      mocks.clearPoolUnfit.mockResolvedValue(false);
      await expect(clearExact(request({ scope: "freebuff::model" }), { params: Promise.resolve({ id: "pool-1" }) })).resolves.toEqual({ status: 500, body: { error: "Failed to clear proxy fitness" } });
    });

    it("maps service exceptions to 500", async () => {
      mocks.clearPoolUnfit.mockRejectedValue(new Error("db unavailable"));
      await expect(clearExact(request({ scope: "freebuff::model" }), { params: Promise.resolve({ id: "pool-1" }) })).resolves.toEqual({ status: 500, body: { error: "Failed to clear proxy fitness" } });
    });
  });
});
