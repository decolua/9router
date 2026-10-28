import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  exportDb: vi.fn(),
  getSettings: vi.fn(),
  importDb: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  },
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

const VALID_CLI_TOKEN = "real-cli-token";

function request(headers = {}) {
  return { headers: new Headers(headers) };
}

// Regression: the route used to skip password re-auth when *any* x-9r-cli-token
// header was present. Middleware admits JWT sessions too, so a session carrying
// a bogus token header could export the whole DB (OAuth tokens, API keys,
// password hash) without knowing the dashboard password.
describe("GET /api/settings/database auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue(VALID_CLI_TOKEN);
    mocks.applyOutboundProxyEnv.mockReturnValue();
  });

  it("exports when the dashboard password is correct", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    mocks.exportDb.mockResolvedValue({ settings: {} });

    const res = await GET(request({ "x-9r-password": "correct" }));

    expect(res.status).toBe(200);
    expect(mocks.exportDb).toHaveBeenCalledTimes(1);
  });

  it("exports with a valid CLI token and no password (CLI flow)", async () => {
    mocks.exportDb.mockResolvedValue({ settings: {} });

    const res = await GET(request({ "x-9r-cli-token": VALID_CLI_TOKEN }));

    expect(res.status).toBe(200);
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });

  it("rejects a bogus x-9r-cli-token without the password", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(false);

    const res = await GET(request({ "x-9r-cli-token": "spoofed-by-jwt-session" }));

    expect(res.status).toBe(401);
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });

  it("rejects a wrong password even with a bogus CLI token header", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(false);

    const res = await GET(
      request({ "x-9r-cli-token": "spoofed-by-jwt-session", "x-9r-password": "wrong" })
    );

    expect(res.status).toBe(401);
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });
});

describe("POST /api/settings/database auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue(VALID_CLI_TOKEN);
    mocks.getSettings.mockResolvedValue({});
    mocks.applyOutboundProxyEnv.mockReturnValue();
  });

  function postRequest(headers, body) {
    return {
      headers: new Headers(headers),
      json: () => Promise.resolve(body),
    };
  }

  it("imports with a valid CLI token and no password (CLI flow)", async () => {
    mocks.importDb.mockResolvedValue();

    const res = await POST(
      postRequest({ "x-9r-cli-token": VALID_CLI_TOKEN }, { settings: {} })
    );

    expect(res.status).toBe(200);
    expect(mocks.importDb).toHaveBeenCalledTimes(1);
  });

  it("rejects import with a bogus CLI token and no password", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(false);

    const res = await POST(
      postRequest({ "x-9r-cli-token": "spoofed-by-jwt-session" }, { settings: {} })
    );

    expect(res.status).toBe(401);
    expect(mocks.importDb).not.toHaveBeenCalled();
  });

  it("imports with the correct dashboard password from the browser", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    mocks.importDb.mockResolvedValue();

    const res = await POST(postRequest({}, { settings: {}, password: "correct" }));

    expect(res.status).toBe(200);
    expect(mocks.importDb).toHaveBeenCalledTimes(1);
    // The password must be stripped from the imported payload.
    expect(mocks.importDb.mock.calls[0][0]).not.toHaveProperty("password");
  });
});
