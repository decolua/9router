// /api/settings/database hands out every stored credential. The guard admits it on a
// dashboard JWT alone, so the route's own password re-auth is the real gate — and the
// CLI shortcut around it must require the actual machine-derived token (GHSA-qvfm).
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  exportDb: vi.fn(),
  importDb: vi.fn(),
  getSettings: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  exportDb: mocks.exportDb,
  importDb: mocks.importDb,
  getSettings: mocks.getSettings,
  validateApiKey: vi.fn(),
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardPassword: mocks.verifyDashboardPassword,
  verifyDashboardAuthToken: vi.fn(),
}));
vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

const { GET, POST } = await import("../../src/app/api/settings/database/route.js");

function req(method, headers = {}, body) {
  return new Request("http://localhost/api/settings/database", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("database import/export re-auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue("real-cli-token");
    mocks.verifyDashboardPassword.mockImplementation(async (p) => p === "correct-horse");
    mocks.exportDb.mockResolvedValue({ providerConnections: [{ apiKey: "sk-secret" }] });
    mocks.getSettings.mockResolvedValue({});
  });

  it("rejects export with a forged CLI token header and no password", async () => {
    const res = await GET(req("GET", { "x-9r-cli-token": "anything" }));

    expect(res.status).toBe(401);
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });

  it("rejects import with a forged CLI token header and no password", async () => {
    const res = await POST(req("POST", { "x-9r-cli-token": "anything" }, { settings: { requireLogin: false } }));

    expect(res.status).toBe(401);
    expect(mocks.importDb).not.toHaveBeenCalled();
  });

  it("still exports for the real CLI token without a password", async () => {
    const res = await GET(req("GET", { "x-9r-cli-token": "real-cli-token" }));

    expect(res.status).toBe(200);
    expect(mocks.exportDb).toHaveBeenCalledOnce();
  });

  it("still exports for a browser session that re-enters the password", async () => {
    const res = await GET(req("GET", { "x-9r-password": "correct-horse" }));

    expect(res.status).toBe(200);
  });

  it("still imports for a browser session that re-enters the password", async () => {
    const res = await POST(req("POST", {}, { password: "correct-horse", settings: {} }));

    expect(res.status).toBe(200);
    expect(mocks.importDb).toHaveBeenCalledWith({ settings: {} });
  });
});
