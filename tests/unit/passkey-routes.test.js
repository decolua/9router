import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body, headers: init?.headers || {} })),
  cookieJar: new Map(),
  cookieSet: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  countPasskeys: vi.fn(),
  countRemotePasskeys: vi.fn(),
  getPasskeys: vi.fn(),
  getPasskeyById: vi.fn(),
  updatePasskeyUsage: vi.fn(),
  deletePasskey: vi.fn(),
  renamePasskey: vi.fn(),
  createPasskey: vi.fn(),
  checkLock: vi.fn(),
  recordFail: vi.fn(),
  recordSuccess: vi.fn(),
  getClientIp: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  getDashboardAuthSession: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  isLocalRequest: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  bcryptCompare: vi.fn(),
  isOidcConfigured: vi.fn(),
  isSamlConfigured: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name) => (mocks.cookieJar.has(name) ? { value: mocks.cookieJar.get(name) } : undefined),
    set: mocks.cookieSet,
  })),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  countPasskeys: mocks.countPasskeys,
  countRemotePasskeys: mocks.countRemotePasskeys,
  getPasskeys: mocks.getPasskeys,
  getPasskeyById: mocks.getPasskeyById,
  updatePasskeyUsage: mocks.updatePasskeyUsage,
  deletePasskey: mocks.deletePasskey,
  renamePasskey: mocks.renamePasskey,
  createPasskey: mocks.createPasskey,
}));

vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock,
  recordFail: mocks.recordFail,
  recordSuccess: mocks.recordSuccess,
  getClientIp: mocks.getClientIp,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
  getDashboardAuthSession: mocks.getDashboardAuthSession,
  verifyDashboardPassword: mocks.verifyDashboardPassword,
  shouldUseSecureCookie: () => true,
  deriveInstallId: (label, bytes) => new Uint8Array(bytes).fill(7),
}));

vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: mocks.isOidcConfigured }));
vi.mock("@/lib/auth/saml.js", () => ({ isSamlConfigured: mocks.isSamlConfigured }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.bcryptCompare, genSalt: vi.fn(), hash: vi.fn() } }));

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: mocks.generateAuthenticationOptions,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
}));

const passwordLogin = await import("../../src/app/api/auth/login/route.js");
const settingsRoute = await import("../../src/app/api/settings/route.js");
const loginOptions = await import("../../src/app/api/auth/passkey/login/options/route.js");
const loginVerify = await import("../../src/app/api/auth/passkey/login/verify/route.js");
const registerOptions = await import("../../src/app/api/auth/passkey/register/options/route.js");
const registerVerify = await import("../../src/app/api/auth/passkey/register/verify/route.js");
const credentialsList = await import("../../src/app/api/auth/passkey/credentials/route.js");
const credentialRoute = await import("../../src/app/api/auth/passkey/credentials/[id]/route.js");
const resetPassword = await import("../../src/app/api/auth/reset-password/route.js");
const { saveChallenge, clearChallenges } = await import("../../src/lib/auth/passkey.js");

const ORIGIN = "https://router.example.com";
const HOST = "router.example.com";

function request(body, headers = {}) {
  return {
    headers: new Headers({ origin: ORIGIN, host: HOST, ...headers }),
    json: async () => body,
  };
}

const STORED = {
  id: "cred-1",
  publicKey: "AQID",
  counter: 4,
  transports: ["internal"],
  rpId: HOST,
  name: "MacBook",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieJar.clear();
  clearChallenges();
  mocks.getSettings.mockResolvedValue({ requireLogin: true, password: "hash", passkeyMode: "on" });
  mocks.countPasskeys.mockResolvedValue(1);
  mocks.countRemotePasskeys.mockResolvedValue(1);
  mocks.isOidcConfigured.mockReturnValue(false);
  mocks.isSamlConfigured.mockReturnValue(false);
  mocks.checkLock.mockReturnValue({ locked: false });
  mocks.recordFail.mockReturnValue({ remainingBeforeLock: 4 });
  mocks.getClientIp.mockReturnValue("203.0.113.9");
  mocks.isLocalRequest.mockReturnValue(false);
  mocks.getDashboardAuthSession.mockResolvedValue(null);
});

describe("password login in passkey-only mode", () => {
  beforeEach(() => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, password: "hash", passkeyMode: "only" });
  });

  it("refuses remote password attempts before comparing the password", async () => {
    const res = await passwordLogin.POST(request({ password: "guess" }));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Password login is disabled. Sign in with a passkey.");
    expect(mocks.bcryptCompare).not.toHaveBeenCalled();
    expect(mocks.recordFail).not.toHaveBeenCalled();
  });

  it("still honours the lockout before anything else", async () => {
    mocks.checkLock.mockReturnValue({ locked: true, retryAfter: 30 });

    const res = await passwordLogin.POST(request({ password: "guess" }));

    expect(res.status).toBe(429);
  });

  it("keeps password login for local requests (owner recovery)", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    mocks.bcryptCompare.mockResolvedValue(true);

    const res = await passwordLogin.POST(request({ password: "right" }, { origin: "http://localhost:20128", host: "localhost:20128" }));

    expect(res.status).toBe(200);
    expect(mocks.bcryptCompare).toHaveBeenCalledWith("right", "hash");
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalled();
  });

  it("falls back to password login when 'only' is set but no passkey exists", async () => {
    mocks.countPasskeys.mockResolvedValue(0);
    mocks.countRemotePasskeys.mockResolvedValue(0);
    mocks.bcryptCompare.mockResolvedValue(false);

    const res = await passwordLogin.POST(request({ password: "guess" }));

    expect(res.status).toBe(401);
    expect(mocks.bcryptCompare).toHaveBeenCalled();
  });

  it("falls back to password login when the only passkeys are bound to localhost", async () => {
    mocks.countPasskeys.mockResolvedValue(2);
    mocks.countRemotePasskeys.mockResolvedValue(0);
    mocks.bcryptCompare.mockResolvedValue(false);

    const res = await passwordLogin.POST(request({ password: "guess" }));

    expect(res.status).toBe(401);
    expect(mocks.bcryptCompare).toHaveBeenCalled();
  });

  it("honours PASSKEY_MODE_OVERRIDE=on as an operator recovery switch", async () => {
    process.env.PASSKEY_MODE_OVERRIDE = "on";
    try {
      mocks.bcryptCompare.mockResolvedValue(false);

      const res = await passwordLogin.POST(request({ password: "guess" }));

      expect(res.status).toBe(401);
      expect(mocks.bcryptCompare).toHaveBeenCalled();
    } finally {
      delete process.env.PASSKEY_MODE_OVERRIDE;
    }
  });
});

describe("POST /api/auth/reset-password", () => {
  it("steps passkey-only back to passkey + password so the reset password works remotely", async () => {
    mocks.getSettings.mockResolvedValue({ password: "hash", passkeyMode: "only" });

    const res = await resetPassword.POST();

    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ password: null, passkeyMode: "on" });
  });

  it("leaves other passkey modes alone", async () => {
    mocks.getSettings.mockResolvedValue({ password: "hash", passkeyMode: "on" });

    await resetPassword.POST();

    expect(mocks.updateSettings).toHaveBeenCalledWith({ password: null });
  });
});

describe("PATCH /api/settings passkeyMode", () => {
  it("rejects values outside the enum", async () => {
    const res = await settingsRoute.PATCH(request({ passkeyMode: "always" }));

    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("refuses passkey-only when no passkey is registered", async () => {
    mocks.countPasskeys.mockResolvedValue(0);
    mocks.countRemotePasskeys.mockResolvedValue(0);

    const res = await settingsRoute.PATCH(request({ passkeyMode: "only" }));

    expect(res.status).toBe(409);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("refuses passkey-only when every passkey is bound to localhost", async () => {
    mocks.countPasskeys.mockResolvedValue(1);
    mocks.countRemotePasskeys.mockResolvedValue(0);

    const res = await settingsRoute.PATCH(request({ passkeyMode: "only" }));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not localhost/);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("accepts passkey-only once a passkey exists", async () => {
    mocks.updateSettings.mockResolvedValue({ passkeyMode: "only", password: "hash" });

    const res = await settingsRoute.PATCH(request({ passkeyMode: "only" }));

    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ passkeyMode: "only" });
    expect(res.body.password).toBeUndefined();
  });
});

describe("POST /api/auth/passkey/login/options", () => {
  it("is unavailable when passkey mode is off", async () => {
    mocks.getSettings.mockResolvedValue({ passkeyMode: "off" });

    const res = await loginOptions.POST(request({}));

    expect(res.status).toBe(404);
    expect(mocks.generateAuthenticationOptions).not.toHaveBeenCalled();
  });

  it("issues discoverable-credential options and a scoped challenge cookie", async () => {
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: "chal", rpId: HOST });

    const res = await loginOptions.POST(request({}));

    expect(res.status).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(mocks.generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: HOST,
      userVerification: "required",
      allowCredentials: [],
    });
    expect(mocks.getPasskeys).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith("passkey_challenge", expect.any(String), expect.objectContaining({
      httpOnly: true,
      sameSite: "strict",
      path: "/api/auth/passkey",
    }));
  });

  it("blocks tunnel hosts when tunnel dashboard access is off", async () => {
    mocks.getSettings.mockResolvedValue({ passkeyMode: "on", tunnelUrl: "https://router.example.com" });

    const res = await loginOptions.POST(request({}));

    expect(res.status).toBe(403);
  });

  it("rejects IP-address origins with a helpful message", async () => {
    const res = await loginOptions.POST(request({}, { origin: "http://192.168.1.5:20128", host: "192.168.1.5:20128" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/HTTPS or http:\/\/localhost/);
  });

  it("answers 429 while the IP is locked", async () => {
    mocks.checkLock.mockReturnValue({ locked: true, retryAfter: 12 });

    const res = await loginOptions.POST(request({}));

    expect(res.status).toBe(429);
    expect(res.body.retryAfter).toBe(12);
  });

  it("is unavailable while SSO-only login is enforced", async () => {
    mocks.getSettings.mockResolvedValue({ passkeyMode: "on", authMode: "sso", ssoType: "oidc" });
    mocks.isOidcConfigured.mockReturnValue(true);

    const res = await loginOptions.POST(request({}));

    expect(res.status).toBe(404);
    expect(mocks.generateAuthenticationOptions).not.toHaveBeenCalled();
  });

  it("stays available when SSO is selected but its provider is not configured", async () => {
    mocks.getSettings.mockResolvedValue({ passkeyMode: "on", authMode: "sso", ssoType: "saml" });
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: "chal" });

    const res = await loginOptions.POST(request({}));

    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/passkey/login/verify", () => {
  function withChallenge(type = "login") {
    const id = saveChallenge({ challenge: "chal", type, rpId: HOST, origin: ORIGIN });
    mocks.cookieJar.set("passkey_challenge", id);
    return id;
  }

  const assertion = { id: "cred-1", rawId: "cred-1", type: "public-key", response: {} };

  it("fails generically and counts the attempt when the signature does not verify", async () => {
    withChallenge();
    mocks.getPasskeyById.mockResolvedValue(STORED);
    mocks.verifyAuthenticationResponse.mockRejectedValue(new Error("Signature verification failed"));

    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Passkey sign-in failed" });
    expect(mocks.recordFail).toHaveBeenCalledWith("203.0.113.9");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("gives the same answer for an unknown credential", async () => {
    withChallenge();
    mocks.getPasskeyById.mockResolvedValue(null);

    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Passkey sign-in failed" });
    expect(mocks.recordFail).toHaveBeenCalled();
    expect(mocks.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("fails without a challenge cookie, without counting it, and always clears the cookie", async () => {
    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Passkey sign-in expired. Try again." });
    expect(mocks.recordFail).not.toHaveBeenCalled();
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith("passkey_challenge", "", expect.objectContaining({ maxAge: 0 }));
  });

  it("refuses a registration challenge used for sign-in", async () => {
    withChallenge("register");
    mocks.getPasskeyById.mockResolvedValue(STORED);

    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(400);
    expect(mocks.verifyAuthenticationResponse).not.toHaveBeenCalled();
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("survives an options flood from another address and does not lock the owner out", async () => {
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: "chal" });
    mocks.getClientIp.mockReturnValue("198.51.100.7");
    await loginOptions.POST(request({}));
    const ownerChallenge = mocks.cookieSet.mock.calls.at(-1)[1];

    mocks.getClientIp.mockReturnValue("203.0.113.66");
    for (let i = 0; i < 1500; i += 1) await loginOptions.POST(request({}));

    mocks.getClientIp.mockReturnValue("198.51.100.7");
    mocks.cookieJar.set("passkey_challenge", ownerChallenge);
    mocks.getPasskeyById.mockResolvedValue(STORED);
    mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 5 } });

    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(200);
    expect(mocks.recordFail).not.toHaveBeenCalled();
  });

  it("is refused while SSO-only login is enforced", async () => {
    withChallenge();
    mocks.getSettings.mockResolvedValue({ passkeyMode: "only", authMode: "saml", ssoType: "saml" });
    mocks.isSamlConfigured.mockReturnValue(true);
    mocks.getPasskeyById.mockResolvedValue(STORED);
    mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 5 } });

    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(404);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("refuses a credential registered for another RP ID", async () => {
    withChallenge();
    mocks.getPasskeyById.mockResolvedValue({ ...STORED, rpId: "other.example.com" });

    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(401);
    expect(mocks.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("signs in, updates the counter and issues a passkey session", async () => {
    withChallenge();
    mocks.getPasskeyById.mockResolvedValue(STORED);
    mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 5 } });

    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(200);
    expect(mocks.verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: "chal",
      expectedOrigin: ORIGIN,
      expectedRPID: HOST,
      requireUserVerification: true,
      credential: expect.objectContaining({ id: "cred-1", counter: 4, publicKey: expect.any(Uint8Array) }),
    }));
    expect(mocks.updatePasskeyUsage).toHaveBeenCalledWith("cred-1", 5);
    expect(mocks.recordSuccess).toHaveBeenCalled();
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      passkey: true,
      passkeyId: "cred-1",
      passkeyName: "MacBook",
    });
  });

  it("cannot replay a consumed challenge", async () => {
    const id = withChallenge();
    mocks.getPasskeyById.mockResolvedValue(STORED);
    mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 5 } });
    await loginVerify.POST(request({ response: assertion }));

    mocks.cookieJar.set("passkey_challenge", id);
    mocks.setDashboardAuthCookie.mockClear();
    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(400);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("is refused when passkey mode is off", async () => {
    withChallenge();
    mocks.getSettings.mockResolvedValue({ passkeyMode: "off" });

    const res = await loginVerify.POST(request({ response: assertion }));

    expect(res.status).toBe(404);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/passkey/register/options", () => {
  it("requires a dashboard session", async () => {
    const res = await registerOptions.POST(request({ currentPassword: "x" }));

    expect(res.status).toBe(401);
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });

  it("routes a wrong step-up password through the login limiter", async () => {
    mocks.cookieJar.set("auth_token", "jwt");
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
    mocks.verifyDashboardPassword.mockResolvedValue(false);

    const res = await registerOptions.POST(request({ currentPassword: "wrong" }));

    expect(res.status).toBe(401);
    expect(mocks.recordFail).toHaveBeenCalledWith("203.0.113.9");
    expect(mocks.generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("enforces the passkey cap", async () => {
    mocks.cookieJar.set("auth_token", "jwt");
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    mocks.getPasskeys.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ ...STORED, id: `c${i}` })));

    const res = await registerOptions.POST(request({ currentPassword: "right" }));

    expect(res.status).toBe(409);
    expect(mocks.generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("excludes existing credentials for this RP ID and requires resident keys + UV", async () => {
    mocks.cookieJar.set("auth_token", "jwt");
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    mocks.getPasskeys.mockResolvedValue([STORED, { ...STORED, id: "cred-2", rpId: "other.example.com" }]);
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "reg-chal" });

    const res = await registerOptions.POST(request({ currentPassword: "right" }));

    expect(res.status).toBe(200);
    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: HOST,
      attestationType: "none",
      excludeCredentials: [{ id: "cred-1", transports: ["internal"] }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: [-7, -257],
    }));
  });

  it("uses the per-install user handle, not a constant", async () => {
    mocks.cookieJar.set("auth_token", "jwt");
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    mocks.getPasskeys.mockResolvedValue([]);
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "reg-chal" });

    await registerOptions.POST(request({ currentPassword: "right" }));

    const { userID } = mocks.generateRegistrationOptions.mock.calls[0][0];
    expect(userID).toEqual(new Uint8Array(32).fill(7));
  });
});

describe("POST /api/auth/passkey/register/verify", () => {
  const attestation = { id: "new-cred", rawId: "new-cred", type: "public-key", response: { transports: ["usb"] } };
  const registrationInfo = {
    credential: { id: "new-cred", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal", "bogus"] },
    credentialDeviceType: "multiDevice",
    credentialBackedUp: true,
  };

  function withRegisterChallenge(overrides = {}) {
    const id = saveChallenge({ challenge: "reg-chal", type: "register", rpId: HOST, origin: ORIGIN, ...overrides });
    mocks.cookieJar.set("passkey_challenge", id);
  }

  beforeEach(() => {
    mocks.cookieJar.set("auth_token", "jwt");
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
    mocks.getPasskeyById.mockResolvedValue(null);
    mocks.verifyRegistrationResponse.mockResolvedValue({ verified: true, registrationInfo });
    mocks.createPasskey.mockImplementation(async (row) => ({ ...row, createdAt: "2026-11-03T00:00:00.000Z", lastUsedAt: null }));
  });

  it("stores the verified credential under the challenge's RP ID without leaking key material", async () => {
    withRegisterChallenge();

    const res = await registerVerify.POST(request({ response: attestation, name: "  MacBook\n Touch ID  " }));

    expect(res.status).toBe(200);
    expect(mocks.verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: "reg-chal",
      expectedOrigin: ORIGIN,
      expectedRPID: HOST,
      requireUserVerification: true,
    }));
    expect(mocks.createPasskey).toHaveBeenCalledWith({
      id: "new-cred",
      publicKey: "AQID",
      counter: 0,
      transports: ["internal"],
      rpId: HOST,
      name: "MacBook Touch ID",
      deviceType: "multiDevice",
      backedUp: true,
    });
    expect(res.body.passkey).not.toHaveProperty("publicKey");
    expect(res.body.passkey).not.toHaveProperty("counter");
    expect(res.body.passkey).not.toHaveProperty("transports");
  });

  it("requires a dashboard session", async () => {
    withRegisterChallenge();
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const res = await registerVerify.POST(request({ response: attestation }));

    expect(res.status).toBe(401);
    expect(mocks.createPasskey).not.toHaveBeenCalled();
  });

  it("rejects a missing or already used challenge", async () => {
    const res = await registerVerify.POST(request({ response: attestation }));

    expect(res.status).toBe(400);
    expect(mocks.verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it("rejects a login challenge", async () => {
    withRegisterChallenge({ type: "login" });

    const res = await registerVerify.POST(request({ response: attestation }));

    expect(res.status).toBe(400);
    expect(mocks.verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it("rejects an origin that changed since the options call", async () => {
    withRegisterChallenge({ rpId: "other.example.com", origin: "https://other.example.com" });

    const res = await registerVerify.POST(request({ response: attestation }));

    expect(res.status).toBe(400);
    expect(mocks.verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it("rejects a duplicate credential", async () => {
    withRegisterChallenge();
    mocks.getPasskeyById.mockResolvedValue(STORED);

    const res = await registerVerify.POST(request({ response: attestation }));

    expect(res.status).toBe(409);
    expect(mocks.createPasskey).not.toHaveBeenCalled();
  });

  it("enforces the passkey cap at verify time", async () => {
    withRegisterChallenge();
    mocks.countPasskeys.mockResolvedValue(20);

    const res = await registerVerify.POST(request({ response: attestation }));

    expect(res.status).toBe(409);
    expect(mocks.createPasskey).not.toHaveBeenCalled();
  });

  it("fails generically when the attestation does not verify", async () => {
    withRegisterChallenge();
    mocks.verifyRegistrationResponse.mockRejectedValue(new Error("Unexpected registration response origin"));

    const res = await registerVerify.POST(request({ response: attestation }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Passkey registration failed" });
    expect(mocks.createPasskey).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/passkey/credentials", () => {
  beforeEach(() => {
    mocks.cookieJar.set("auth_token", "jwt");
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
  });

  it("lists passkeys without public keys, counters or transports", async () => {
    mocks.getPasskeys.mockResolvedValue([{ ...STORED, deviceType: "multiDevice", backedUp: true, createdAt: "c", lastUsedAt: null }]);

    const res = await credentialsList.GET();

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.passkeys[0]).sort()).toEqual(["backedUp", "createdAt", "deviceType", "id", "lastUsedAt", "name", "rpId"]);
    expect(JSON.stringify(res.body)).not.toContain("AQID");
  });

  it("reports both the stored and the enforced mode", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, passkeyMode: "only" });
    mocks.getPasskeys.mockResolvedValue([]);
    mocks.countPasskeys.mockResolvedValue(0);
    mocks.countRemotePasskeys.mockResolvedValue(0);

    const res = await credentialsList.GET();

    expect(res.body.passkeyMode).toBe("only");
    expect(res.body.effectivePasskeyMode).toBe("on");
    expect(res.body.passkeyModeReason).toBe("no-remote-passkey");
  });

  it("requires a dashboard session", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const res = await credentialsList.GET();

    expect(res.status).toBe(401);
    expect(mocks.getPasskeys).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/auth/passkey/credentials/[id]", () => {
  beforeEach(() => {
    mocks.cookieJar.set("auth_token", "jwt");
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
  });

  it("renames with a sanitised name and returns only public fields", async () => {
    mocks.renamePasskey.mockResolvedValue({ ...STORED, name: "Work laptop" });

    const res = await credentialRoute.PATCH(request({ name: "  Work\u0000 laptop " }), { params: Promise.resolve({ id: "cred-1" }) });

    expect(res.status).toBe(200);
    expect(mocks.renamePasskey).toHaveBeenCalledWith("cred-1", "Work laptop");
    expect(res.body.passkey).not.toHaveProperty("publicKey");
  });

  it("requires a name", async () => {
    const res = await credentialRoute.PATCH(request({ name: 42 }), { params: Promise.resolve({ id: "cred-1" }) });

    expect(res.status).toBe(400);
    expect(mocks.renamePasskey).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown or malformed id", async () => {
    mocks.renamePasskey.mockResolvedValue(null);

    expect((await credentialRoute.PATCH(request({ name: "x" }), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
    expect((await credentialRoute.PATCH(request({ name: "x" }), { params: Promise.resolve({ id: "a/b" }) })).status).toBe(404);
  });

  it("requires a dashboard session", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const res = await credentialRoute.PATCH(request({ name: "x" }), { params: Promise.resolve({ id: "cred-1" }) });

    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/auth/passkey/credentials/[id]", () => {
  beforeEach(() => {
    mocks.cookieJar.set("auth_token", "jwt");
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
    mocks.getPasskeyById.mockResolvedValue(STORED);
  });

  it("refuses to remove the last passkey while passkey-only is on", async () => {
    mocks.getSettings.mockResolvedValue({ passkeyMode: "only" });

    const res = await credentialRoute.DELETE(request({}), { params: Promise.resolve({ id: "cred-1" }) });

    expect(res.status).toBe(409);
    expect(mocks.deletePasskey).not.toHaveBeenCalled();
  });

  it("refuses to remove the last domain passkey even if localhost passkeys remain", async () => {
    mocks.getSettings.mockResolvedValue({ passkeyMode: "only" });
    mocks.countPasskeys.mockResolvedValue(3);
    mocks.countRemotePasskeys.mockResolvedValue(1);

    const res = await credentialRoute.DELETE(request({}), { params: Promise.resolve({ id: "cred-1" }) });

    expect(res.status).toBe(409);
    expect(mocks.deletePasskey).not.toHaveBeenCalled();
  });

  it("always lets a localhost passkey be removed in passkey-only mode", async () => {
    mocks.getSettings.mockResolvedValue({ passkeyMode: "only" });
    mocks.getPasskeyById.mockResolvedValue({ ...STORED, id: "local-1", rpId: "localhost" });
    mocks.deletePasskey.mockResolvedValue(true);

    const res = await credentialRoute.DELETE(request({}), { params: Promise.resolve({ id: "local-1" }) });

    expect(res.status).toBe(200);
    expect(mocks.deletePasskey).toHaveBeenCalledWith("local-1");
  });

  it("removes a passkey otherwise", async () => {
    mocks.deletePasskey.mockResolvedValue(true);

    const res = await credentialRoute.DELETE(request({}), { params: Promise.resolve({ id: "cred-1" }) });

    expect(res.status).toBe(200);
    expect(mocks.deletePasskey).toHaveBeenCalledWith("cred-1");
  });

  it("requires a dashboard session", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const res = await credentialRoute.DELETE(request({}), { params: Promise.resolve({ id: "cred-1" }) });

    expect(res.status).toBe(401);
  });
});
