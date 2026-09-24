// GHSA-vmjq-hvgq-2wv4: a session alone (stolen cookie, or requireLogin=false) could PATCH
// /api/settings to turn authentication off or repoint SSO. Those changes now need the
// current dashboard password (or the local CLI token); everything else is unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  validateApiKey: vi.fn(),
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardPassword: mocks.verifyDashboardPassword,
  verifyDashboardAuthToken: vi.fn(),
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));

const { PATCH } = await import("../../src/app/api/settings/route.js");
const { reauthRequiredKeys } = await import("../../src/lib/auth/settingsReauth.js");

const STORED = {
  requireLogin: true, requireApiKey: true, tunnelDashboardAccess: false,
  authMode: "password", oidcIssuerUrl: "", oidcClientSecret: "", rtkEnabled: true,
};

function patch(body, headers = {}) {
  return PATCH(new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

describe("reauthRequiredKeys", () => {
  it("flags downgrades and auth repointing, not hardening or unchanged values", () => {
    expect(reauthRequiredKeys({ requireLogin: false }, STORED)).toEqual(["requireLogin"]);
    expect(reauthRequiredKeys({ requireApiKey: false }, STORED)).toEqual(["requireApiKey"]);
    expect(reauthRequiredKeys({ tunnelDashboardAccess: true }, STORED)).toEqual(["tunnelDashboardAccess"]);
    expect(reauthRequiredKeys({ authMode: "oidc", oidcIssuerUrl: "https://idp.evil" }, STORED)).toEqual(["authMode", "oidcIssuerUrl"]);

    expect(reauthRequiredKeys({ requireLogin: true }, { ...STORED, requireLogin: false })).toEqual([]);
    expect(reauthRequiredKeys({ authMode: "password", oidcClientSecret: "" }, STORED)).toEqual([]);
    expect(reauthRequiredKeys({ rtkEnabled: false }, STORED)).toEqual([]);
  });
});

describe("PATCH /api/settings re-auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ ...STORED });
    mocks.updateSettings.mockImplementation(async (u) => ({ ...STORED, ...u }));
    mocks.verifyDashboardPassword.mockImplementation(async (p) => p === "correct-horse");
    mocks.getConsistentMachineId.mockResolvedValue("real-cli-token");
  });

  it.each([
    [{ requireLogin: false }],
    [{ requireApiKey: false }],
    [{ tunnelDashboardAccess: true }],
    [{ authMode: "oidc", oidcIssuerUrl: "https://idp.attacker.example", oidcClientId: "x", oidcClientSecret: "y" }],
  ])("refuses %j with a session but no password", async (body) => {
    const res = await patch(body);

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("REAUTH_REQUIRED");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("refuses a wrong password", async () => {
    const res = await patch({ requireLogin: false, currentPassword: "guess" });

    expect(res.status).toBe(401);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("applies the change with the current password and never persists it", async () => {
    const res = await patch({ requireLogin: false, currentPassword: "correct-horse" });

    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ requireLogin: false });
  });

  it("lets the local CLI token make the change without a password", async () => {
    const res = await patch({ authMode: "oidc" }, { "x-9r-cli-token": "real-cli-token" });

    expect(res.status).toBe(200);
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });

  it("does not accept a forged CLI token as a substitute for the password", async () => {
    const res = await patch({ requireLogin: false }, { "x-9r-cli-token": "forged" });

    expect(res.status).toBe(401);
  });

  it("leaves ordinary settings changes alone", async () => {
    const res = await patch({ rtkEnabled: false, requireLogin: true });

    expect(res.status).toBe(200);
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });

  it("never stores a stray currentPassword on an ordinary change", async () => {
    await patch({ rtkEnabled: false, currentPassword: "correct-horse" });

    expect(mocks.updateSettings).toHaveBeenCalledWith({ rtkEnabled: false });
  });
});
