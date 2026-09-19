import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  exportDb: vi.fn(),
  getSettings: vi.fn(),
  importDb: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/localDb", () => ({
  exportDb: mocks.exportDb,
  getSettings: mocks.getSettings,
  importDb: mocks.importDb,
}));

vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardPassword: mocks.verifyDashboardPassword,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

const { GET, POST } = await import("../../src/app/api/settings/database/route.js");

const VALID_TOKEN = "valid-cli-token-value";

function makeRequest({ headers = {}, method = "GET", body } = {}) {
  return new Request("http://127.0.0.1:20128/api/settings/database", {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("/api/settings/database CLI token bypass (A1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue(VALID_TOKEN);
    mocks.exportDb.mockResolvedValue({ tables: {} });
    mocks.getSettings.mockResolvedValue({});
    mocks.verifyDashboardPassword.mockResolvedValue(false);
  });

  describe("GET", () => {
    it("skips password re-auth when the CLI token header carries the machineId-derived value", async () => {
      const res = await GET(makeRequest({ headers: { "x-9r-cli-token": VALID_TOKEN } }));

      expect(mocks.getConsistentMachineId).toHaveBeenCalledWith("9r-cli-auth");
      expect(res.status).toBe(200);
      expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
      expect(mocks.exportDb).toHaveBeenCalled();
    });

    it("rejects a garbage CLI token header when the password is wrong", async () => {
      const res = await GET(makeRequest({ headers: { "x-9r-cli-token": "x" } }));

      expect(res.status).toBe(401);
      expect(mocks.exportDb).not.toHaveBeenCalled();
    });

    it("rejects an empty CLI token header when the password is wrong", async () => {
      const res = await GET(makeRequest({ headers: { "x-9r-cli-token": "" } }));

      expect(res.status).toBe(401);
      expect(mocks.exportDb).not.toHaveBeenCalled();
    });

    it("treats a garbage CLI token as absent: falls back to the password check", async () => {
      mocks.verifyDashboardPassword.mockResolvedValue(true);
      const res = await GET(makeRequest({ headers: { "x-9r-cli-token": "not-the-token", "x-9r-password": "secret" } }));

      expect(res.status).toBe(200);
      expect(mocks.verifyDashboardPassword).toHaveBeenCalledWith("secret");
    });

    it("requires a valid password when no CLI header is present", async () => {
      const res = await GET(makeRequest());

      expect(res.status).toBe(401);
      expect(mocks.exportDb).not.toHaveBeenCalled();
    });

    it("accepts a valid password when no CLI header is present", async () => {
      mocks.verifyDashboardPassword.mockResolvedValue(true);
      const res = await GET(makeRequest({ headers: { "x-9r-password": "secret" } }));

      expect(res.status).toBe(200);
      expect(mocks.verifyDashboardPassword).toHaveBeenCalledWith("secret");
      expect(mocks.exportDb).toHaveBeenCalled();
    });
  });

  describe("POST", () => {
    it("skips password re-auth when the CLI token header carries the machineId-derived value", async () => {
      const res = await POST(makeRequest({ method: "POST", headers: { "x-9r-cli-token": VALID_TOKEN }, body: { tables: {} } }));

      expect(res.status).toBe(200);
      expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
      expect(mocks.importDb).toHaveBeenCalled();
    });

    it("rejects a garbage CLI token header without a valid password", async () => {
      const res = await POST(makeRequest({ method: "POST", headers: { "x-9r-cli-token": "junk" }, body: { password: "wrong", tables: {} } }));

      expect(res.status).toBe(401);
      expect(mocks.importDb).not.toHaveBeenCalled();
    });

    it("rejects an empty CLI token header without a valid password", async () => {
      const res = await POST(makeRequest({ method: "POST", headers: { "x-9r-cli-token": "" }, body: { password: "wrong", tables: {} } }));

      expect(res.status).toBe(401);
      expect(mocks.importDb).not.toHaveBeenCalled();
    });

    it("requires a valid password when no CLI header is present", async () => {
      const res = await POST(makeRequest({ method: "POST", body: { password: "wrong", tables: {} } }));

      expect(res.status).toBe(401);
      expect(mocks.importDb).not.toHaveBeenCalled();
    });

    it("accepts a valid password when no CLI header is present", async () => {
      mocks.verifyDashboardPassword.mockResolvedValue(true);
      const res = await POST(makeRequest({ method: "POST", body: { password: "secret", tables: {} } }));

      expect(res.status).toBe(200);
      expect(mocks.verifyDashboardPassword).toHaveBeenCalledWith("secret");
      expect(mocks.importDb).toHaveBeenCalled();
    });
  });
});
