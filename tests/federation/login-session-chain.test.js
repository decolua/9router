// FED-GAP-06 — the dashboard login chain (POST /api/auth/login → the session cookie
// the real route issues → the gated route the real guard then admits) asserted as ONE
// chain, against the REAL modules, with NO stand-in for any of the three.
//
// Why this file exists: at HEAD the chain was only ever asserted in halves that could
// not meet. tests/unit/api-reference-auth-claims.test.js and
// tests/unit/local-request-peer-trust-3294.test.js mention "api/auth/login" as a
// STRING only, tests/unit/auth-status.test.js covers the session side, and
// tests/unit/dashboard-guard.test.js drives src/dashboardGuard.js with a hand-written
// module stand-in for the token validator. Nothing posted credentials and then checked
// the cookie the login route actually sets, and nothing ever handed that token back to
// the guard. So "login works, then the dashboard opens" was asserted nowhere.
//
// REALNESS IS THE POINT — this file must never gain a stand-in for the app code:
//   * it drives src/app/api/auth/login/route.js (POST), src/lib/auth/dashboardSession.js
//     (the token/cookie issuer and the verifier) and src/dashboardGuard.js (proxy) as
//     the app ships them, against one temp-DATA_DIR SQLite database;
//   * the last describe re-reads the tracked login route from disk, records its
//     path + sha256, and fails if a mock call ever appears in this file.
//
// THE HARD BOUNDARY — how the real route's `cookies()` call runs here
// ------------------------------------------------------------------
// src/app/api/auth/login/route.js:89 is `const cookieStore = await cookies();` from
// next/headers, which only works inside a Next request scope. This file does NOT stub
// next/headers and does NOT inject a fake cookie store: it builds the SAME request
// scope the shipped server builds (Next's own createRequestStoreForAPI, the function
// the app-route module calls at module.js:565) and runs the route inside it. Everything
// the cookie then travels through is Next's own code:
//
//   cookies()                        → next/dist/server/request/cookies.js
//   the mutable request store        → next/dist/server/async-storage/request-store.js
//   setDashboardAuthCookie(store, …) → src/lib/auth/dashboardSession.js  (the real issuer)
//   the Set-Cookie merge onto the    → appendMutableCookies(), the exact call the shipped
//   handler's response                   server makes at route-modules/app-route/module.js:524
//
// The proof that this scaffolding is load-bearing (and that the real next/headers call
// is in the path) is the first test: with NO scope installed the same POST answers 500
// with Next's own "`cookies` was called outside a request scope" error. The route only
// reaches its 200/cookie branch because the scope is real.
//
// NOT COVERED HERE (stated plainly, so nobody reads more into a green run):
//   * the Next HTTP server itself — no build, no boot, no port, no socket, and no
//     middleware ordering: proxy() is driven directly, not through next.config. FED-GAP-05
//     owns the packaged-server proof.
//   * any browser behaviour (cookie jar, redirect following).
//   * the work store is present only so cookies() does not bail inside its own guard; it
//     carries no cookie state. All cookie state lives in the real request-unit store.
//
// The chain's integrity rests on the negative controls: a wrong password must 401 with
// no cookie at all, a tampered token must be refused by the same guard call that accepts
// the real one, and a remote peer presenting the fresh-install default must be refused a
// session outright. Each of those fails if the guard, the issuer or the route is replaced.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";

const require = createRequire(import.meta.url);
const THIS_FILE = fileURLToPath(new URL(import.meta.url));
const REPO = path.resolve(path.dirname(THIS_FILE), "..", "..");

// The module under test, addressed by URL: the SAME URL is imported and read from disk
// below, so the digest describes the file whose POST this test calls.
// (import.meta.resolve("@/…") is not usable here — "@/…" is a bundler alias, not a Node
// package specifier, so Node resolution reports "Cannot find package '@/app'".)
const LOGIN_ROUTE_URL = new URL("../../src/app/api/auth/login/route.js", import.meta.url);
const LOGIN_ROUTE_FILE = fileURLToPath(LOGIN_ROUTE_URL);
const LOGIN_ROUTE_SHA256 = createHash("sha256").update(fs.readFileSync(LOGIN_ROUTE_FILE)).digest("hex");
const GUARD_URL = new URL("../../src/dashboardGuard.js", import.meta.url);
const GUARD_FILE = fileURLToPath(GUARD_URL);
const SESSION_MODULE_URL = new URL("../../src/lib/auth/dashboardSession.js", import.meta.url);
const SESSION_MODULE_FILE = fileURLToPath(SESSION_MODULE_URL);

// Both paths are registered by the shipped guard: /dashboard is the dashboard branch
// (proxy reads request.cookies.get("auth_token") and verifies it), /api/settings is the
// deny-by-default /api branch (hasValidToken). Neither is in PUBLIC_API_PATHS, so a
// pass-through here is a real authentication and not an allow-list bypass.
const DASHBOARD_PATH = "/dashboard";
const PROTECTED_API_PATH = "/api/settings";

// A peer that provably did NOT come from loopback: x-9r-real-ip is only trusted when the
// per-process peer secret proves custom-server.js stamped it, and 203.0.113.7 is not a
// loopback host — so isLocalRequest() is false no matter what NODE_ENV the runner has.
// (Same fixture shape as tests/federation/api-key-http-auth-chain.test.js.)
const PEER_TOKEN = "fed-gap-06-peer-token";
const REMOTE_IP = "203.0.113.7";
const LOOPBACK_IP = "127.0.0.1";

const LOGIN_URL = "http://localhost:20128/api/auth/login";
const INITIAL_PASSWORD = "fed-gap-06-initial-password";
const STORED_PASSWORD = "fed-gap-06-stored-password";

// Everything this file pins or must not inherit: a real deployment could have any of
// these set, and each one alone would let an assertion pass for the wrong reason
// (AUTH_COOKIE_SECURE forces the Secure attribute regardless of x-forwarded-proto, a
// foreign INITIAL_PASSWORD changes which credential is the real one, a peer token that
// makes the request look local defeats the remote rule, REQUIRE_API_KEY / federation
// env re-route other guard branches).
const ENV_KEYS = [
  "DATA_DIR",
  "INITIAL_PASSWORD",
  "AUTH_COOKIE_SECURE",
  "NINEROUTER_PEER_TOKEN",
  "REQUIRE_API_KEY",
  "TRUST_PROXY",
  "FEDERATION_MODE",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_TOKEN",
  "MACHINE_ID_SALT",
];

let tempDir;
let savedEnv = {};
let route; // src/app/api/auth/login/route.js
let session; // src/lib/auth/dashboardSession.js
let guard; // src/dashboardGuard.js
let settingsRepo;
let driver;
let NextRequest;
let createRequestStoreForAPI;
let appendMutableCookies;
let ResponseCookies;
let createWorkStore;
let workAsyncStorage;
let workUnitAsyncStorage;

beforeAll(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-gap-06-"));
  process.env.DATA_DIR = tempDir;
  process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
  process.env.INITIAL_PASSWORD = INITIAL_PASSWORD;

  // Next's request-scope machinery holds a module-level AsyncLocalStorage, created at
  // import time from `globalThis.AsyncLocalStorage`. Inside a vitest module that global
  // is absent (typeof → "undefined"), so Next silently keeps its internal
  // FakeAsyncLocalStorage, whose run() throws — cookies() would then be dead in every
  // case, scope or no scope. Installing Node's real implementation BEFORE the first
  // import of next/headers (the dynamic imports below) is what lets the shipped
  // cookies() run. This is a runtime shim for a missing global, not a stand-in for app
  // code: no module under test is replaced.
  if (typeof globalThis.AsyncLocalStorage === "undefined") {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    globalThis.AsyncLocalStorage = AsyncLocalStorage;
  }

  // driver.js caches the adapter on global; paths.js/dataDir.mjs read DATA_DIR at module
  // load, so the cache must be dropped before anything app-side is imported.
  delete global._dbAdapter;
  vi.resetModules();

  // Next's own request-scope plumbing, loaded from the shipped package (verbatim the
  // pieces the app-route module uses). No app module is replaced by these.
  workAsyncStorage = require("next/dist/server/app-render/work-async-storage.external.js").workAsyncStorage;
  workUnitAsyncStorage = require("next/dist/server/app-render/work-unit-async-storage.external.js").workUnitAsyncStorage;
  ({ createRequestStoreForAPI } = require("next/dist/server/async-storage/request-store.js"));
  ({ appendMutableCookies } = require("next/dist/server/web/spec-extension/adapters/request-cookies.js"));
  ({ ResponseCookies } = require("next/dist/server/web/spec-extension/cookies.js"));
  ({ createWorkStore } = require("next/dist/server/async-storage/work-store.js"));

  ({ NextRequest } = await import("next/server"));

  route = await import(LOGIN_ROUTE_URL.href);
  session = await import(SESSION_MODULE_URL.href);
  guard = await import(GUARD_URL.href);
  settingsRepo = await import("../../src/lib/db/repos/settingsRepo.js");
  driver = await import("../../src/lib/db/driver.js");
}, 120000);

afterAll(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {
    /* noop */
  }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ─── Driving the real route ──────────────────────────────────────────────

function loginRequest({ password, remote = false, forwardedProto, host } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-9r-peer-token", PEER_TOKEN);
  headers.set("x-9r-real-ip", remote ? REMOTE_IP : LOOPBACK_IP);
  if (forwardedProto) headers.set("x-forwarded-proto", forwardedProto);
  if (host) headers.set("host", host);
  return new Request(LOGIN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ password }),
  });
}

// The real server's per-request step, reproduced with Next's own functions:
//   app-route/module.js:565  requestStore = createRequestStoreForAPI(req, req.nextUrl, …)
//   app-route/module.js:575  this.workUnitAsyncStorage.run(requestStore, () => this.workAsyncStorage.run(workStore, …))
//   app-route/module.js:524  appendMutableCookies(new Headers(res.headers), requestStore.mutableCookies)
// The work store is a Next-shaped bag of flags created by Next's own factory; it carries
// no cookie state — all of it lives in the real request-unit store.
async function postLogin(opts = {}) {
  const request = loginRequest(opts);
  const requestStore = createRequestStoreForAPI(
    { headers: request.headers },
    { pathname: "/api/auth/login", search: "" },
    [],
    undefined,
    undefined,
    undefined
  );
  const nextWorkStore = createWorkStore({
    page: "/api/auth/login",
    renderOpts: {
      experimental: {},
      supportsDynamicResponse: true,
      isDraftMode: false,
      isPossibleServerAction: false,
    },
    buildId: "fed-gap-06",
    deploymentId: "fed-gap-06",
    previouslyRevalidatedTags: [],
  });

  let response;
  await workAsyncStorage.run(nextWorkStore, () =>
    workUnitAsyncStorage.run(requestStore, async () => {
      response = await route.POST(request);
    })
  );

  const headers = new Headers(response.headers);
  appendMutableCookies(headers, requestStore.mutableCookies);

  return {
    status: response.status,
    headers,
    body: await response.json(),
    // The cookie the request-scoped store holds — i.e. what the real route's write put
    // into the store Next handed it, before any parsing.
    storeToken: requestStore.mutableCookies.get("auth_token")?.value ?? null,
    setCookie: headers.getSetCookie(),
    cookies: new ResponseCookies(headers),
  };
}

// ─── Driving the real guard ──────────────────────────────────────────────

function guardRequest(pathname, { token } = {}) {
  const headers = { "x-9r-peer-token": PEER_TOKEN, "x-9r-real-ip": REMOTE_IP };
  if (token) headers.cookie = `auth_token=${token}`;
  return new NextRequest(`http://9router.test${pathname}`, { headers });
}

function isPassThrough(res) {
  // NextResponse.next() as the shipped next/server produces it.
  return res.status === 200 && res.headers.get("x-middleware-next") === "1";
}

function tamperSignature(token) {
  // NOTE: the LAST character of a 43-char base64url signature carries only 4 significant
  // bits, so "change the last character" can decode to the IDENTICAL signature bytes
  // (A = 000000 vs B = 000001 — same top 4 bits) and the token still verifies. Observed
  // as a 1-in-8 flake while developing this file. Tamper in the FIRST character instead:
  // all 6 of its bits land in the decoded signature, so the bytes provably change — and
  // that is asserted below rather than assumed.
  expect(typeof token).toBe("string"); // a missing session fails here, readably
  const parts = token.split(".");
  expect(parts).toHaveLength(3);
  const sig = parts[2];
  const nextSig = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  const decode = (s) => Buffer.from(s, "base64url");
  expect(decode(nextSig).equals(decode(sig))).toBe(false); // byte-level tamper, not string-level
  const out = `${parts[0]}.${parts[1]}.${nextSig}`;
  expect(out).not.toBe(token);
  return out;
}

// One issued session, reused by the chain describe. `httpsToken` is the session issued
// on the x-forwarded-proto: https leg.
let issued = {};

// ─── The real route: POST /api/auth/login ────────────────────────────────

describe("real POST /api/auth/login (src/app/api/auth/login/route.js)", () => {
  it("boundary premise: with no request scope the same POST fails on the real cookies() call", async () => {
    // This is what makes the scope below load-bearing rather than decorative: the route
    // really does call next/headers' cookies(), so without a request scope it cannot
    // get past line 89 — and the failure is Next's own message, not ours.
    const res = await route.POST(loginRequest({ password: INITIAL_PASSWORD }));
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).toMatch(/cookies/);
    expect(error).toMatch(/outside a request scope/);
  });

  it("premise: a fresh DATA_DIR has no stored password and requires login", async () => {
    const settings = await settingsRepo.getSettings();
    expect(settings.password).toBeUndefined();
    expect(settings.requireLogin).toBe(true);
    // If requireLogin were false the guard's dashboard branch would pass everything
    // through and every chain assertion below would be vacuous.
    expect(settings.requireLogin).not.toBe(false);
  });

  it("issues a session: 200 {success:true,mustChangePassword:false} + Cache-Control no-store", async () => {
    issued.plain = await postLogin({ password: INITIAL_PASSWORD });
    expect(issued.plain.status).toBe(200);
    expect(issued.plain.body).toEqual({ success: true, mustChangePassword: false });
    expect(issued.plain.headers.get("cache-control")).toBe("no-store");
  });

  it("sets exactly ONE cookie — auth_token — from the request-scoped store the route wrote to", async () => {
    const { setCookie, storeToken, cookies } = issued.plain;
    expect(setCookie).toHaveLength(1);
    const all = cookies.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("auth_token");

    const cookie = cookies.get("auth_token");
    expect(cookie).toBeDefined();
    // The cookie under test is the one the real write put into the store Next handed
    // the route (not something this file synthesised).
    expect(storeToken).toBeTruthy();
    expect(cookie.value).toBe(storeToken);

    // Attributes, from the real serialiser.
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    expect(cookie.maxAge).toBe(86400);
    // No x-forwarded-proto → shouldUseSecureCookie() is false, so the wire form carries
    // no Secure attribute.
    expect(Boolean(cookie.secure)).toBe(false);
    expect(setCookie[0]).not.toMatch(/;\s*Secure/i);
  });

  it("the value is a real HS256 JWT the shipped verifier accepts", async () => {
    const token = issued.plain.cookies.get("auth_token").value;
    expect(token.split(".")).toHaveLength(3);
    expect(await session.verifyDashboardAuthToken(token)).toBe(true);
    const payload = await session.getDashboardAuthSession(token);
    expect(payload).toMatchObject({ authenticated: true });
    // And the issuer's own copy of the check agrees.
    expect(await session.verifyDashboardAuthToken(`${token}x`)).toBe(false);
    expect(await session.verifyDashboardAuthToken(null)).toBe(false);
  });

  it("second leg: x-forwarded-proto: https turns the Secure attribute on", async () => {
    issued.https = await postLogin({ password: INITIAL_PASSWORD, forwardedProto: "https" });
    expect(issued.https.status).toBe(200);

    const cookie = issued.https.cookies.get("auth_token");
    expect(cookie.secure).toBe(true);
    expect(issued.https.setCookie[0]).toMatch(/;\s*Secure/i);
    // Same attributes otherwise — the only difference is the transport rule.
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    expect(cookie.maxAge).toBe(86400);
    // A real JWT of its own (claim-for-claim identical to the plain leg — the two land in
    // the same second, so only the transport attribute distinguishes them).
    expect(issued.https.storeToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(await session.verifyDashboardAuthToken(issued.https.storeToken)).toBe(true);
  });

  it("negative control: a wrong password answers 401 and sets NO cookie", async () => {
    const before = await settingsRepo.getSettings();
    const res = await postLogin({ password: "not-the-password" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/^Invalid password\./);
    // Nothing was minted: not on the response, not in the store.
    expect(res.setCookie).toHaveLength(0);
    expect(res.cookies.getAll()).toHaveLength(0);
    expect(res.storeToken).toBeNull();
    // And the refusal did not rewrite the settings row.
    expect((await settingsRepo.getSettings()).password).toBe(before.password);
  });
});

// ─── The chain: the cookie the route issued, presented to the real guard ──

describe("chain: the real guard admits the session the real login route issued", () => {
  it("premise: the gated paths are NOT public API paths", async () => {
    // /api/auth/login and /api/health ARE public, so a guard pass-through there proves
    // nothing. These two are the protected shapes: the dashboard branch and /api/*.
    expect(guard.__test__.isPublicLlmApi(PROTECTED_API_PATH)).toBe(false);
    expect(guard.__test__.isPublicLlmApi(DASHBOARD_PATH)).toBe(false);
    const settings = await settingsRepo.getSettings();
    expect(settings.requireLogin).toBe(true);
  });

  it("the issued cookie authenticates a PROTECTED dashboard route (dashboard branch)", async () => {
    for (const token of [issued.plain.storeToken, issued.https.storeToken]) {
      const res = await guard.proxy(guardRequest(DASHBOARD_PATH, { token }));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("the issued cookie authenticates a PROTECTED /api route (hasValidToken)", async () => {
    const res = await guard.proxy(guardRequest(PROTECTED_API_PATH, { token: issued.plain.storeToken }));
    expect(isPassThrough(res)).toBe(true);
  });

  it("inverse premise: the same request with NO cookie is not authenticated", async () => {
    const dash = await guard.proxy(guardRequest(DASHBOARD_PATH));
    expect(dash.headers.get("x-middleware-next")).toBeNull();
    expect(dash.status).toBe(307);
    expect(dash.headers.get("location")).toBe("http://9router.test/login");

    const api = await guard.proxy(guardRequest(PROTECTED_API_PATH));
    expect(api.status).toBe(401);
    expect(api.headers.get("x-middleware-next")).toBeNull();
    expect((await api.json()).error).toBe("Unauthorized");
  });

  it("negative control: a TAMPERED token is refused by the same guard call", async () => {
    const tampered = tamperSignature(issued.plain.storeToken);
    // Premise: it is not a valid token as far as the shipped verifier is concerned…
    expect(await session.verifyDashboardAuthToken(tampered)).toBe(false);
    // …so the guard that admitted the real one must now refuse it.
    const dash = await guard.proxy(guardRequest(DASHBOARD_PATH, { token: tampered }));
    expect(dash.status).toBe(307);
    expect(dash.headers.get("location")).toBe("http://9router.test/login");
    expect(dash.headers.get("x-middleware-next")).toBeNull();

    const api = await guard.proxy(guardRequest(PROTECTED_API_PATH, { token: tampered }));
    expect(api.status).toBe(401);
    expect((await api.json()).error).toBe("Unauthorized");

    // Positive control in the same test: the untampered token still passes, so the 307/401
    // above came from the one flipped character and nothing else in this file's ordering.
    expect(isPassThrough(await guard.proxy(guardRequest(PROTECTED_API_PATH, { token: issued.plain.storeToken })))).toBe(true);
  });
});

// ─── The fresh-install default must not mint a session remotely ──────────

describe("default-password remote rule (the 403 gate before issuance)", () => {
  it("premise: INITIAL_PASSWORD is now unset and no stored hash exists", async () => {
    delete process.env.INITIAL_PASSWORD;
    expect(process.env.INITIAL_PASSWORD).toBeUndefined();
    expect((await settingsRepo.getSettings()).password).toBeUndefined();
  });

  it("a remote peer presenting the public default 123456 gets 403 mustChangePassword and NO session", async () => {
    const res = await postLogin({ password: "123456", remote: true });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The whole point of the branch: no credential is minted.
    expect(res.setCookie).toHaveLength(0);
    expect(res.storeToken).toBeNull();
  });

  it("the SAME default password from a loopback peer still issues a session (local UX intact)", async () => {
    const res = await postLogin({ password: "123456" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, mustChangePassword: false });
    expect(res.setCookie).toHaveLength(1);
    // …and that locally-issued session is accepted by the guard, so the 403 above was the
    // peer rule and not a broken issuance path.
    expect(await session.verifyDashboardAuthToken(res.storeToken)).toBe(true);
    const guarded = await guard.proxy(guardRequest(PROTECTED_API_PATH, { token: res.storeToken }));
    expect(isPassThrough(guarded)).toBe(true);
  });

  it("once a password is STORED the remote default is simply the wrong credential (401, no cookie)", async () => {
    const hash = await bcrypt.hash(STORED_PASSWORD, 10);
    await settingsRepo.updateSettings({ password: hash });
    expect((await settingsRepo.getSettings()).password).toBe(hash);

    const remoteDefault = await postLogin({ password: "123456", remote: true });
    expect(remoteDefault.status).toBe(401);
    expect(remoteDefault.setCookie).toHaveLength(0);
    expect(remoteDefault.storeToken).toBeNull();

    // The env credential is no longer the deployment's credential either.
    const oldEnv = await postLogin({ password: INITIAL_PASSWORD, remote: true });
    expect(oldEnv.status).toBe(401);
    expect(oldEnv.storeToken).toBeNull();
  });

  it("the stored-hash path issues a session remotely, and that session passes the guard", async () => {
    const res = await postLogin({ password: STORED_PASSWORD, remote: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, mustChangePassword: false });
    expect(res.setCookie).toHaveLength(1);
    expect(await session.verifyDashboardAuthToken(res.storeToken)).toBe(true);
    expect(isPassThrough(await guard.proxy(guardRequest(DASHBOARD_PATH, { token: res.storeToken })))).toBe(true);
  });
});

// ─── The file's own premise ──────────────────────────────────────────────

describe("FED-GAP-06 realness guard", () => {
  it("declares no module stand-in", () => {
    const src = fs.readFileSync(THIS_FILE, "utf8");
    const needle = (...parts) => parts.join(""); // assembled so this file cannot match itself
    expect(src.includes(needle("vi.", "mock", "("))).toBe(false);
    expect(src.includes(needle("vi.", "doMock", "("))).toBe(false);
    expect(src.includes(needle("vi.", "stubGlobal", "("))).toBe(false);
  });

  it("drives the tracked login route file, addressed by the path whose bytes are digested", () => {
    // Provenance: the URL imported in beforeAll is the URL read here, and the digest plus
    // the two call sites pin the real issuance path.
    expect(LOGIN_ROUTE_FILE).toBe(path.join(REPO, "src", "app", "api", "auth", "login", "route.js"));
    expect(fs.statSync(LOGIN_ROUTE_FILE).isFile()).toBe(true);
    expect(LOGIN_ROUTE_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash("sha256").update(fs.readFileSync(LOGIN_ROUTE_FILE)).digest("hex")).toBe(LOGIN_ROUTE_SHA256);

    const src = fs.readFileSync(LOGIN_ROUTE_FILE, "utf8");
    // The two lines this test depends on: the real next/headers call and the real issuer.
    expect(src).toContain("const cookieStore = await cookies();");
    expect(src).toContain("setDashboardAuthCookie(cookieStore, request);");
    expect(src).toContain('from "next/headers"');

    // …and the guard really is the module that validates the cookie it is handed.
    const guardSrc = fs.readFileSync(GUARD_FILE, "utf8");
    expect(guardSrc).toContain('request.cookies.get("auth_token")');
    expect(guardSrc).toContain("verifyDashboardAuthToken");

    // The issuer module is the tracked one too.
    expect(fs.statSync(SESSION_MODULE_FILE).isFile()).toBe(true);
    expect(fs.readFileSync(SESSION_MODULE_FILE, "utf8")).toContain("export async function setDashboardAuthCookie(");

    // The modules driven are the real exports, not shims.
    expect(typeof route.POST).toBe("function");
    expect(typeof guard.proxy).toBe("function");
    expect(typeof session.verifyDashboardAuthToken).toBe("function");
    // driver.js is only here to close the adapter in afterAll — it must be the real one.
    expect(typeof driver.getAdapter).toBe("function");
  });
});
