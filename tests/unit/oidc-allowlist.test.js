import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  settings: {},
  jwks: { keys: [] },
  cookieStore: { get: vi.fn(), delete: vi.fn() },
  setDashboardAuthCookie: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => mocks.cookieStore) }));
// Keep signing and verification real; replace only the remote JWKS transport.
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => actual.createLocalJWKSet(mocks.jwks)),
  };
});
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => mocks.settings),
  updateSettings: mocks.updateSettings,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({ setDashboardAuthCookie: mocks.setDashboardAuthCookie }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn(), genSalt: vi.fn(), hash: vi.fn() } }));

import * as oidc from "../../src/lib/auth/oidc.js";
import { GET as callback } from "../../src/app/api/auth/oidc/callback/route.js";
import { PATCH as patchSettings } from "../../src/app/api/settings/route.js";
import { mergeWithDefaults } from "../../src/lib/db/repos/settingsRepo.js";

let privateKey;
const discovery = {
  issuer: "https://idp.test",
  token_endpoint: "https://idp.test/token",
  jwks_uri: "https://idp.test/jwks",
};

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  mocks.jwks = { keys: [{ ...await exportJWK(keys.publicKey), alg: "RS256", kid: "test-key" }] };
});

function signToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://idp.test")
    .setAudience("client")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function verifyToken(payload, nonce) {
  return oidc.verifyOidcIdToken({
    idToken: await signToken(payload),
    issuer: discovery.issuer,
    audience: "client",
    jwksUri: discovery.jwks_uri,
    nonce,
  });
}

async function runCallback(payload, settings = mocks.settings) {
  mocks.settings = settings;
  const idToken = await signToken(payload);
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url) === `${mocks.settings.oidcIssuerUrl}/.well-known/openid-configuration`) {
      return Response.json(discovery);
    }
    if (String(url) === discovery.token_endpoint) return Response.json({ id_token: idToken });
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  return callback(new Request("http://localhost/api/auth/oidc/callback?code=code&state=state"));
}

function request(body) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BASE_URL", "http://localhost");
  mocks.settings = {
    authMode: "oidc",
    ssoType: "oidc",
    oidcIssuerUrl: "https://idp.test",
    oidcClientId: "client",
    oidcClientSecret: "secret",
    oidcAllowedSubjects: [],
  };
  const cookieValues = { oidc_state: "state", oidc_nonce: "nonce", oidc_code_verifier: "verifier" };
  mocks.cookieStore.get.mockImplementation((name) => cookieValues[name] ? { value: cookieValues[name] } : undefined);
  mocks.updateSettings.mockImplementation(async (body) => {
    mocks.settings = { ...mocks.settings, ...body };
    return mocks.settings;
  });
});

describe("OIDC nonce verification", () => {
  it("accepts a signed token with the exact expected nonce", async () => {
    expect(await verifyToken({ sub: "user-1", nonce: "nonce" }, "nonce")).toMatchObject({ sub: "user-1", nonce: "nonce" });
  });

  it.each([
    ["mismatched", "other"],
    ["missing", undefined],
    ["wrong type", 42],
    ["case changed", "Nonce"],
    ["whitespace changed", "nonce "],
  ])("rejects a signed token with %s nonce", async (_, nonce) => {
    await expect(verifyToken({ sub: "user-1", nonce }, "nonce")).rejects.toThrow(/nonce/i);
  });

  it.each([undefined, "", 42])("rejects an invalid expected nonce (%s)", async (nonce) => {
    await expect(verifyToken({ sub: "user-1", nonce: "nonce" }, nonce)).rejects.toThrow(/nonce/i);
  });

  it.each(["other", undefined])("does not issue a session for a signed token with invalid nonce (%s)", async (nonce) => {
    const response = await runCallback({ sub: "user-1", nonce }, { ...mocks.settings, oidcAllowedSubjects: ["user-1"] });
    expect(response.headers.get("location")).toMatch(/\/login\?error=.*nonce/i);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    expect(mocks.cookieStore.delete.mock.calls.map(([name]) => name)).toEqual(["oidc_state", "oidc_nonce", "oidc_code_verifier"]);
  });
});

describe("OIDC allowlist", () => {
  it("fails closed for legacy settings without an allowlist", async () => {
    const legacy = { ...mocks.settings };
    delete legacy.oidcAllowedSubjects;
    const response = await runCallback({ sub: "user-1", nonce: "nonce" }, mergeWithDefaults(legacy));
    expect(response.headers.get("location")).toContain("oidc_subject_not_allowed");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("fails closed before issuing a cookie when the allowlist is empty", async () => {
    const response = await runCallback({ sub: "user-1", nonce: "nonce" });
    expect(response.headers.get("location")).toContain("oidc_subject_not_allowed");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it.each(["oidc", "both", "sso"])("executes exact subject allow and deny decisions in %s mode", async (authMode) => {
    const settings = { ...mocks.settings, authMode, oidcAllowedSubjects: ["Allowed@Subject"] };
    const allowed = await runCallback({ sub: "Allowed@Subject", nonce: "nonce" }, settings);
    expect(allowed.headers.get("location")).toBe("http://localhost/dashboard");
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);

    mocks.setDashboardAuthCookie.mockClear();
    const denied = await runCallback({ sub: "allowed@subject", nonce: "nonce" }, settings);
    expect(denied.headers.get("location")).toContain("oidc_subject_not_allowed");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("requires explicit email: entries for verified email instead of treating subjects as emails", () => {
    const allowed = oidc.normalizeOidcAllowedSubjects([" User-1 ", " ADMIN@Example.com ", "User-1", "Mixed@Subject "]);
    expect(allowed).toEqual(["User-1", "ADMIN@Example.com", "Mixed@Subject"]);
    expect(oidc.isOidcIdentityAllowed({ sub: "User-1" }, allowed)).toBe(true);
    expect(oidc.isOidcIdentityAllowed({ sub: "Mixed@Subject" }, allowed)).toBe(true);
    expect(oidc.isOidcIdentityAllowed({ sub: "mixed@subject" }, allowed)).toBe(false);
    expect(oidc.isOidcIdentityAllowed({ sub: "user-1" }, allowed)).toBe(false);
    expect(oidc.isOidcIdentityAllowed({ sub: "other", email: "admin@example.com", email_verified: true }, allowed)).toBe(false);
  });

  it("matches email: entries case-insensitively only with boolean email_verified", () => {
    const allowed = ["email:ADMIN@Example.com"];
    expect(oidc.isOidcIdentityAllowed({ sub: "other", email: "admin@example.com", email_verified: true }, allowed)).toBe(true);
    for (const email_verified of [false, undefined, "true"]) {
      expect(oidc.isOidcIdentityAllowed({ sub: "other", email: "admin@example.com", email_verified }, allowed)).toBe(false);
    }
    expect(oidc.isOidcIdentityAllowed({ sub: "email:ADMIN@Example.com" }, allowed)).toBe(false);
    expect(oidc.isOidcIdentityAllowed({ sub: "other", email: "", email_verified: true }, ["email:"])).toBe(false);
  });

  it("executes verified email allow and namespace collision deny decisions in callback", async () => {
    const settings = { ...mocks.settings, oidcAllowedSubjects: ["email:ADMIN@Example.com"] };
    const allowed = await runCallback({ sub: "other", email: "admin@example.com", email_verified: true, nonce: "nonce" }, settings);
    expect(allowed.headers.get("location")).toBe("http://localhost/dashboard");
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    mocks.setDashboardAuthCookie.mockClear();
    const denied = await runCallback({ sub: "email:ADMIN@Example.com", nonce: "nonce" }, settings);
    expect(denied.headers.get("location")).toContain("oidc_subject_not_allowed");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("does not enable the OIDC callback for SAML both mode", async () => {
    const response = await runCallback({ sub: "user-1", nonce: "nonce" }, {
      ...mocks.settings, authMode: "both", ssoType: "saml", oidcAllowedSubjects: ["user-1"],
    });
    expect(response.headers.get("location")).toContain("oidc_not_configured");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("normalizes valid settings and refuses enabling OIDC with an empty list", async () => {
    const bad = await patchSettings(request({ authMode: "oidc", oidcAllowedSubjects: ["  "] }));
    expect(bad.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    const good = await patchSettings(request({ oidcAllowedSubjects: [" User-1 ", " email:ADMIN@Example.com ", "User-1"] }));
    expect(good.status).toBe(200);
    expect((await good.json()).oidcAllowedSubjects).toEqual(["User-1", "email:ADMIN@Example.com"]);

    for (const oidcAllowedSubjects of ["user-1", ["user-1", 7], ["x".repeat(201)], Array.from({ length: 101 }, (_, i) => `user-${i}`)]) {
      mocks.updateSettings.mockClear();
      expect((await patchSettings(request({ oidcAllowedSubjects }))).status).toBe(400);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    }
  });

  it.each([
    { comboStrategy: "round-robin" },
    { requireLogin: false },
    { oidcIssuerUrl: "https://repaired-idp.test" },
    { oidcClientSecret: "repaired-secret" },
  ])("permits unrelated/recovery PATCH with an existing empty allowlist (%j)", async (body) => {
    const response = await patchSettings(request(body));
    expect(response.status).toBe(200);
    const saved = await response.json();
    if (body.oidcClientSecret) expect(saved).not.toHaveProperty("oidcClientSecret");
    else expect(saved).toMatchObject(body);
    expect(mocks.settings).toMatchObject(body);
    const denied = await runCallback({ sub: "user-1", nonce: "nonce" });
    expect(denied.headers.get("location")).toContain("oidc_subject_not_allowed");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it.each([
    { authMode: "password", oidcAllowedSubjects: [] },
    { authMode: "saml", ssoType: "saml" },
    { authMode: "both", ssoType: "saml", oidcAllowedSubjects: [] },
  ])("permits disabling OIDC with an empty allowlist (%j)", async (body) => {
    const response = await patchSettings(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(body);
  });

  it.each([
    { authMode: "oidc" },
    { authMode: "sso", ssoType: "oidc" },
    { authMode: "both", ssoType: "oidc" },
  ])("requires the list when enabling OIDC (%j)", async (body) => {
    mocks.settings = { ...mocks.settings, authMode: "password", ssoType: "saml" };
    expect((await patchSettings(request(body))).status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("Test connection saves the entered allowlist before probing a migrated OIDC configuration", async () => {
    // Execute the actual UI handler without mounting the unrelated profile panels.
    const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/profile/page.js", import.meta.url), "utf8");
    const handler = source.slice(source.indexOf("  const testOidcConnection = async () => {"), source.indexOf("  const updateSamlForm ="));
    const statuses = [];
    let probed = false;
    const uiFetch = async (url, options) => {
      if (url === "/api/settings") return patchSettings(request(JSON.parse(options.body)));
      if (url === "/api/auth/oidc/test") {
        expect(mocks.settings.oidcAllowedSubjects).toEqual(["User-1", "email:ADMIN@Example.com"]);
        probed = true;
        return Response.json({ ok: true, issuerUrl: "https://idp.test" });
      }
      throw new Error(`Unexpected UI fetch: ${url}`);
    };
    const run = new Function("oidcForm", "oidcClientSecret", "settings", "fetch", "setOidcTestLoading", "setOidcStatus", "setOidcTestStatus", `${handler}\nreturn testOidcConnection();`);
    await run({
      ...mocks.settings,
      oidcScopes: "openid profile email",
      oidcLoginLabel: "Sign in with OIDC",
      oidcAllowedSubjects: " User-1 \n\n email:ADMIN@Example.com \n User-1 ",
    }, "", mocks.settings, uiFetch, () => {}, () => {}, (status) => statuses.push(status));
    expect(probed).toBe(true);
    expect(statuses.at(-1).type).toBe("success");
  });

  it("refuses removing the last allowed identity while OIDC remains active", async () => {
    mocks.settings.oidcAllowedSubjects = ["user-1"];
    expect((await patchSettings(request({ oidcAllowedSubjects: [] }))).status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
