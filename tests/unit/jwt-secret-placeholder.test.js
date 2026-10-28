// `cp .env.example .env` used to sign dashboard sessions with the published example
// JWT_SECRET, so anyone could mint a valid auth_token cookie (GHSA-jphh class).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

let tmpDir;

vi.mock("@/lib/dataDir", () => ({
  get DATA_DIR() {
    return tmpDir;
  },
}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})) }));

async function forge(secret) {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(new TextEncoder().encode(secret));
}

async function loadSession(jwtSecret) {
  vi.resetModules();
  if (jwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = jwtSecret;
  return await import("../../src/lib/auth/dashboardSession.js");
}

describe("dashboard JWT secret", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-jwt-"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("does not accept tokens forged with the .env.example placeholder", async () => {
    const session = await loadSession("change-me-to-a-long-random-secret");

    expect(await session.verifyDashboardAuthToken(await forge("change-me-to-a-long-random-secret"))).toBe(false);
    // Falls back to the persisted random secret rather than failing closed at boot.
    expect(fs.existsSync(path.join(tmpDir, "jwt-secret"))).toBe(true);
    expect(await session.verifyDashboardAuthToken(await session.createDashboardAuthToken())).toBe(true);
  });

  it("rejects every documented placeholder", async () => {
    const { isPlaceholderJwtSecret } = await loadSession(undefined);

    for (const value of ["your-secure-secret-change-this", "your-secure-secret", "your-secret", "generated-secret-here"]) {
      expect(isPlaceholderJwtSecret(value), value).toBe(true);
    }
  });

  it("keeps honoring a real operator-supplied JWT_SECRET", async () => {
    const secret = "f3b1c9e2-operator-chosen-secret-7d41a0";
    const session = await loadSession(secret);

    expect(await session.verifyDashboardAuthToken(await forge(secret))).toBe(true);
  });
});
