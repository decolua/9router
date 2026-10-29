import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deleteProxyPool: vi.fn(), getProviderConnections: vi.fn(), getProxyPoolById: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }));
vi.mock("@/models", () => mocks);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}
const context = (id) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProxyPoolById.mockResolvedValue({ id: "pool-1" });
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.deleteProxyPool.mockResolvedValue({ id: "pool-1" });
});

describe("proxy pool DELETE route", () => {
  it("waits for committed delete before success", async () => {
    const gate = deferred();
    mocks.deleteProxyPool.mockReturnValue(gate.promise);
    const { DELETE } = await import("../../src/app/api/proxy-pools/[id]/route.js");
    let settled = false;
    const response = DELETE({}, context("pool-1")).then((value) => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve({ id: "pool-1" });
    await expect(response).resolves.toEqual({ status: 200, body: { success: true } });
  });
  it("maps rejection and preserves repeat 404 without another delete", async () => {
    const { DELETE } = await import("../../src/app/api/proxy-pools/[id]/route.js");
    mocks.deleteProxyPool.mockRejectedValueOnce(new Error("transaction failed"));
    await expect(DELETE({}, context("pool-1"))).resolves.toEqual({ status: 500, body: { error: "Failed to delete proxy pool" } });
    mocks.getProxyPoolById.mockResolvedValueOnce(null);
    await expect(DELETE({}, context("pool-1"))).resolves.toEqual({ status: 404, body: { error: "Proxy pool not found" } });
    expect(mocks.deleteProxyPool).toHaveBeenCalledTimes(1);
  });
});
