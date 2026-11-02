import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const mocks = vi.hoisted(() => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "passkey-session-test-secret";
  return { originalSecret, getSettings: vi.fn(), getPasskeyById: vi.fn() };
});

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getPasskeyById: mocks.getPasskeyById,
}));

vi.mock("@/lib/dataDir", () => ({ DATA_DIR: "/nonexistent-9router-test" }));

const {
  createDashboardAuthToken,
  getDashboardAuthSession,
  verifyDashboardAuthToken,
  deriveInstallId,
} = await import("../../src/lib/auth/dashboardSession.js");

afterAll(() => {
  if (mocks.originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = mocks.originalSecret;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("passkey session revocation", () => {
  it("accepts a passkey session while its credential is enrolled", async () => {
    mocks.getPasskeyById.mockResolvedValue({ id: "cred-1" });
    const token = await createDashboardAuthToken({ passkey: true, passkeyId: "cred-1", passkeyName: "MacBook" });

    expect(await getDashboardAuthSession(token)).toMatchObject({ passkey: true, passkeyId: "cred-1" });
    expect(await verifyDashboardAuthToken(token)).toBe(true);
    expect(mocks.getPasskeyById).toHaveBeenCalledWith("cred-1");
  });

  it("rejects a passkey session once its credential is removed", async () => {
    mocks.getPasskeyById.mockResolvedValue(null);
    const token = await createDashboardAuthToken({ passkey: true, passkeyId: "cred-1" });

    expect(await getDashboardAuthSession(token)).toBeNull();
    expect(await verifyDashboardAuthToken(token)).toBe(false);
  });

  it("rejects a passkey session without a credential id", async () => {
    const token = await createDashboardAuthToken({ passkey: true });

    expect(await getDashboardAuthSession(token)).toBeNull();
    expect(mocks.getPasskeyById).not.toHaveBeenCalled();
  });

  it("fails closed when the credential lookup errors", async () => {
    mocks.getPasskeyById.mockRejectedValue(new Error("database unavailable"));
    const token = await createDashboardAuthToken({ passkey: true, passkeyId: "cred-1" });

    expect(await verifyDashboardAuthToken(token)).toBe(false);
  });

  it("does not look up credentials for password sessions", async () => {
    const token = await createDashboardAuthToken();

    expect(await verifyDashboardAuthToken(token)).toBe(true);
    expect(mocks.getPasskeyById).not.toHaveBeenCalled();
  });

  it("rejects tampered tokens", async () => {
    expect(await verifyDashboardAuthToken("not-a-jwt")).toBe(false);
    expect(await getDashboardAuthSession("")).toBeNull();
  });
});

describe("deriveInstallId", () => {
  it("is stable per label and differs between labels", () => {
    const a = deriveInstallId("label-a", 32);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a).toHaveLength(32);
    expect(deriveInstallId("label-a", 32)).toEqual(a);
    expect(deriveInstallId("label-b", 32)).not.toEqual(a);
  });
});
