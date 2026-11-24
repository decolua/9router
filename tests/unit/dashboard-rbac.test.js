import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(), idToken: vi.fn(), samlProfile: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/oidc", async original => ({
  ...await original(), fetchOidcDiscovery: async () => ({ issuer: "https://idp.test" }),
  exchangeOidcCode: async () => ({ id_token: "fixture" }), verifyOidcIdToken: mocks.idToken,
}));
vi.mock("@/lib/auth/saml.js", async original => ({
  ...await original(), validateSamlResponse: mocks.samlProfile,
}));

const dir = mkdtempSync(join(tmpdir(), "dashboard-rbac-"));
const secret = "rbac-test-fixture-not-production";
let repo, guard, session, viewer, admin, jar, driver;
const req = (path, method = "GET", token = viewer, extra = {}) =>
  new NextRequest("http://localhost" + path, { method, headers: { ...(token ? { cookie: "auth_token=" + token } : {}), ...extra } });
const gate = (...args) => guard(req(...args));
const passwordRequest = (url, body) => new NextRequest("http://localhost" + url, { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  vi.stubEnv("DATA_DIR", dir); vi.stubEnv("HOME", dir); vi.stubEnv("JWT_SECRET", secret);
  vi.stubEnv("BASE_URL", "http://localhost");
  vi.stubEnv("INITIAL_PASSWORD", "fixture-dashboard-password");
  vi.stubEnv("NINEROUTER_PEER_TOKEN", "rbac-peer");
  repo = await import("@/lib/db/index.js");
  driver = await (await import("@/lib/db/driver.js")).getAdapter();
  ({ proxy: guard } = await import("@/dashboardGuard"));
  session = await import("@/lib/auth/dashboardSession");
});
beforeEach(async () => {
  await repo.updateSettings({ requireLogin: true, authMode: "password", password: null,
    ssoAdminEmails: ["Admin@Example.org"], ssoAdminGroups: ["Operators"],
    oidcIssuerUrl: "https://idp.test", oidcClientId: "fixture", oidcClientSecret: "fixture-secret",
    samlCert: "fixture", samlEntryPoint: "https://idp.test/saml" });
  viewer = await session.createDashboardAuthToken({ role: "viewer" });
  admin = await session.createDashboardAuthToken({ role: "admin" });
  jar = new Map();
  mocks.cookies.mockResolvedValue({ get: k => jar.has(k) ? { value: jar.get(k) } : undefined,
    set: (k, v) => jar.set(k, v), delete: k => jar.delete(k) });
});
afterAll(() => {
  driver?.close(); delete global._dbAdapter; vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("dashboard identities", () => {
  it("replaces a viewer cookie with an admin cookie after password verification", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const request = passwordRequest("/api/auth/login", { password: "fixture-dashboard-password", role: "viewer" });
    request.cookies.set("auth_token", viewer);
    jar.set("auth_token", viewer);
    expect((await guard(request)).headers.get("x-middleware-next")).toBe("1");
    expect((await POST(request)).status).toBe(200);
    expect(await session.getDashboardAuthSession(jar.get("auth_token"))).toMatchObject({
      role: "admin", sessionEpoch: (await repo.getSettings()).sessionEpoch,
    });
  });

  it.each([
    [{ email: " ADMIN@example.org ", email_verified: true }, "admin"],
    [{ email: "other@example.org", email_verified: true, role: "admin" }, "viewer"],
    [{ email: "admin@example.org", email_verified: false }, "viewer"],
    [{ email: "admin@example.org" }, "viewer"],
    [{ groups: ["Operators"] }, "admin"], [{ groups: ["operators"] }, "viewer"],
  ])("maps verified OIDC claims %j to %s", async (claims, role) => {
    await repo.updateSettings({ authMode: "both" });
    for (const name of ["oidc_state", "oidc_nonce", "oidc_code_verifier"]) jar.set(name, "fixture");
    mocks.idToken.mockResolvedValue(claims);
    const { GET } = await import("@/app/api/auth/oidc/callback/route");
    expect((await GET(req("/api/auth/oidc/callback?state=fixture&code=code"))).headers.get("location")).toMatch(/\/dashboard$/);
    expect(await session.getDashboardAuthSession(jar.get("auth_token"))).toMatchObject({ role, oidc: true });
    const event = driver.get("SELECT * FROM auditLog WHERE action='login' ORDER BY id DESC LIMIT 1");
    expect(event).toMatchObject({ actorRole: role, result: "success", actor: expect.stringMatching(/^oidc:/) });
    expect(event.actor).not.toContain("example.org");
  });

  it.each([
    [{ attributes: { groups: ["staff", "Operators"] } }, "admin"],
    [{ groups: "Operators" }, "admin"], [{ nameID: "admin@example.org" }, "viewer"],
    [{ attributes: { email: " ADMIN@example.org " } }, "admin"],
  ])("maps signed SAML profile %j to %s", async (profile, role) => {
    mocks.samlProfile.mockResolvedValue(profile);
    const body = new FormData(); body.set("SAMLResponse", "fixture");
    const { POST } = await import("@/app/api/auth/saml/acs/route");
    const response = await POST(new NextRequest("http://localhost/api/auth/saml/acs", { method: "POST", body }));
    expect(response.headers.get("location")).toMatch(/\/dashboard$/);
    expect(await session.getDashboardAuthSession(jar.get("auth_token"))).toMatchObject({ role, saml: true });
    const event = driver.get("SELECT * FROM auditLog WHERE action='login' ORDER BY id DESC LIMIT 1");
    expect(event).toMatchObject({ actorRole: role, result: "success", actor: expect.stringMatching(/^saml:/) });
    expect(event.actor).not.toContain("example.org");
  });
});

describe("dashboard policy", () => {
  it.each(["analytics", "export"])("rejects viewer at usage/%s before parsing or querying", async name => {
    const { GET } = name === "analytics" ? await import("@/app/api/usage/analytics/route") : await import("@/app/api/usage/export/route");
    const path = "/api/usage/" + name + "?period=bad";
    expect((await gate(path)).status).toBe(403);
    expect((await GET(req(path))).status).toBe(403);
    expect((await GET(req(path, "GET", admin))).status).toBe(400);
  });

  it("serves only incident summaries to viewers and guards notification writes at the handler", async () => {
    const path = "/api/notifications";
    const api = await import("@/app/api/notifications/route");
    const channels = await import("@/app/api/notifications/channels/route");
    const mutes = await import("@/app/api/notifications/mutes/route");
    const config = await import("@/app/api/notifications/settings/route");
    const test = await import("@/app/api/notifications/channels/test/route");
    for (const handler of [api.PATCH, channels.POST, channels.DELETE, mutes.POST, config.GET, test.POST])
      expect((await handler(req(path))).status).toBe(403);
    const write = (body, method = "POST") => new NextRequest("http://localhost" + path, {
      method, headers: { cookie: "auth_token=" + admin, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const token = "101:telegram-test-credential-fixture";
    const created = await channels.POST(write({ kind: "telegram", token, chatId: "12345", perMinute: 1 }));
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const listed = await config.GET(req(path, "GET", admin));
    expect((await listed.json()).channels).toEqual([{ id, kind: "telegram", perMinute: 1 }]);
    const fixture = await import("@/lib/notifications/store");
    fixture.reconcile(await repo.getNotificationsRepo(), { keys: [], providers: [], healthy: false }, Date.now());
    const res = await api.GET(req(path));
    expect(res.status).toBe(200);
    const inbox = await res.json();
    expect(Object.keys(inbox).sort()).toEqual(["notifications", "unread"]);
    expect(Object.keys(inbox.notifications[0]).sort()).toEqual(["id","type","target","label","severity","state","firstAt","lastAt","count","readAt"].sort());
    expect(inbox.notifications[0].target).toBe("gateway");
    expect((await api.PATCH(write({ id: inbox.notifications[0].id }, "PATCH"))).status).toBe(200);
    expect((await (await api.GET(req(path))).json()).unread).toBe(0);
    expect((await test.POST(write({ id: "missing" }))).status).toBe(404);
    expect((await channels.DELETE(write({ id }, "DELETE"))).status).toBe(200);
    const audit = driver.all("SELECT * FROM auditLog WHERE action LIKE 'notification.channel.%'");
    expect(audit.map(e => e.action)).toEqual(["notification.channel.add","notification.channel.test","notification.channel.delete"]);
    expect(JSON.stringify([audit,inbox])).not.toContain(token);
  });
  it("rejects viewer at the health handler too", async () => {
    const { GET } = await import("@/app/api/providers/health/route");
    expect((await GET(req("/api/providers/health"))).status).toBe(403);
  });
  it.each([
    ["POST", "/api/locale"], ["POST", "/api/auth/login"], ["GET", "/api/auth/oidc/start"],
    ["GET", "/api/auth/oidc/callback"], ["GET", "/api/auth/saml/start"], ["POST", "/api/auth/saml/acs"],
    ["GET", "/api/init"], ["GET", "/api/settings/require-login"], ["GET", "/api/auth/saml/metadata"],
    ["GET", "/api/version"], ["GET", "/api/health"], ["GET", "/api/auth/status"], ["POST", "/api/auth/logout"],
  ])("passes public %s %s regardless of cookie", async (method, path) => {
    for (const token of [null, "invalid-token", viewer, admin]) {
      expect((await gate(path, method, token)).headers.get("x-middleware-next")).toBe("1");
    }
  });

  it.each(["/api/models", "/api/combos", "/api/usage/chart?period=24h", "/api/usage/providers",
    "/api/notifications", "/api/usage/stats", "/api/providers/summary", "/api/keys?view=summary"])("allows viewer GET and HEAD only: %s", async path => {
    for (const method of ["GET", "HEAD"]) {
      const response = await gate(path, method);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await gate(path, method);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Administrator required" });
    }
  });

  it.each(["/api/keys", "/api/keys/id/rotate", "/api/settings/database", "/api/settings",
    "/api/settings?view=summary", "/api/mcp/config", "/api/tunnel/status",
    "/api/cloud", "/api/cli-tools/cowork-settings", "/api/usage/request-details", "/api/usage/stream",
    "/api/usage/history", "/api/providers", "/api/providers/client", "/api/oauth/cursor/auto-import",
    "/api/auth/oidc/test", "/api/auth/saml/test", "/api/version/update", "/api/auth/sessions/revoke",
    "/api/notifications/settings", "/api/notifications/channels", "/api/notifications/channels/test", "/api/notifications/mutes",
    "/api/headroom/start", "/api/headroom/stop", "/api/headroom/restart", "/api/headroom/proxy/dashboard", "/api/headroom/status",
    "/api/providers/health", "/api/new-route"])("denies viewer for every method: %s", async path => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await gate(path, method, viewer, { "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": "rbac-peer" });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Administrator required" });
    }
  });

  it.each(["/api/keys/?view=summary", "/api/Keys?view=summary", "/api/usage%2Fchart",
    "/api/models/../settings", "/api/models/%2e%2e/keys", "/api/keys?view=full&view=summary",
    "/api/keys?view=summary&view=full", "/api/keys?view=summary&export=1", "/api/version/private",
    "/api/auth/status/else"])("checks exact normalized path and key view: %s", async path => {
    expect((await gate(path)).status).toBe(403);
  });

  it("applies admin compression presets and restores stored manual settings", async () => {
    const { PATCH } = await import("@/app/api/settings/route");
    const patch = async body => {
      const request = passwordRequest("/api/settings", body);
      request.cookies.set("auth_token", admin);
      return PATCH(request);
    };
    await patch({ compressionProfile: "custom", headroomTimeoutMs: 7500, rtkEnabled: true });
    expect(await (await patch({ compressionProfile: "chat" })).json()).toMatchObject({ compressionProfile: "chat", rtkEnabled: false, headroomTimeoutMs: 3000 });
    expect((await patch({ compressionProfile: "unknown" })).status).toBe(400);
    expect((await patch({ headroomUrl: "http://169.254.169.254" })).status).toBe(400);
    expect((await repo.getSettings()).compressionProfile).toBe("chat");
    expect(await (await patch({ compressionProfile: "custom" })).json()).toMatchObject({ rtkEnabled: true, headroomTimeoutMs: 7500 });
  });

  it.each(["start", "stop", "restart", "proxy/dashboard"])("requires local admin or CLI for Headroom %s", async suffix => {
    const path = "/api/headroom/" + suffix;
    expect((await gate(path, "POST", admin)).status).toBe(403);
    expect((await gate(path, "POST", admin, { "host": "localhost", "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": "rbac-peer" })).status).toBe(200);
  });

  it("allows logout, page reads, existing admin requests and credentialed CLI", async () => {
    expect((await gate("/api/auth/logout", "POST")).status).toBe(200);
    expect((await gate("/dashboard/endpoint")).status).toBe(200);
    expect((await gate("/api/keys", "POST", admin)).status).toBe(200);
    expect((await gate("/api/settings/database", "GET", admin)).status).toBe(200);
    expect((await gate("/api/mcp/config", "GET", admin)).status).toBe(403);
    const { getConsistentMachineId } = await import("@/shared/utils/machineId");
    const headers = { "x-9r-cli-token": await getConsistentMachineId("9r-cli-auth") };
    expect((await gate("/api/mcp/config", "POST", null, headers)).status).toBe(200);
    const { GET } = await import("@/app/api/auth/status/route");
    expect((await (await GET(req("/api/auth/status", "GET", null, headers))).json()).role).toBe("admin");
    await repo.updateSettings({ requireLogin: false });
    expect((await gate("/api/settings", "PATCH", null)).status).toBe(200);
    expect((await gate("/api/settings", "PATCH", viewer)).status).toBe(403);
    expect((await gate("/api/settings/database", "GET", null)).status).toBe(401);
    expect((await (await GET(req("/api/auth/status", "GET", null))).json()).role).toBe("admin");
  });
});

it("rejects legacy claims, unsupported roles, missing epochs and a modified signature", async () => {
  const [header, body, signature] = viewer.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url")), role: "admin" })).toString("base64url");
  const legacy = claims => new SignJWT({ authenticated: true, ...claims }).setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h").sign(new TextEncoder().encode(secret));
  for (const token of [await legacy({ sessionEpoch: (await repo.getSettings()).sessionEpoch }), await legacy({ role: "admin" }),
    await legacy({ role: "Admin", sessionEpoch: (await repo.getSettings()).sessionEpoch }), [header, forged, signature].join(".")]) {
    expect(await session.getDashboardAuthSession(token)).toBeNull();
    expect(await session.verifyDashboardAuthToken(token)).toBe(false);
    expect((await gate("/api/models", "GET", token)).status).toBe(401);
  }
});

it("revokes every issued cookie, clears the caller cookie, and ignores imported epochs", async () => {
  const { POST } = await import("@/app/api/auth/sessions/revoke/route");
  const path = "/api/auth/sessions/revoke";
  const before = (await repo.getSettings()).sessionEpoch;
  jar.set("auth_token", admin);
  expect((await POST(req(path, "POST", viewer))).status).toBe(403);
  expect((await POST(req(path, "POST", admin))).status).toBe(200);
  expect(jar.has("auth_token")).toBe(false);
  expect((await repo.getSettings()).sessionEpoch).toBe(before + 1);
  await repo.importDb({ settings: { sessionEpoch: before } });
  expect((await repo.getSettings()).sessionEpoch).toBe(before + 2);
  for (const token of [admin, viewer]) {
    expect((await gate("/api/models", "GET", token)).status).toBe(401);
    expect(await session.verifyDashboardAuthToken(token)).toBe(false);
  }
});

it("invalidates sessions on password change and CLI reset, prevents epoch rollback via settings PATCH", async () => {
  const { PATCH } = await import("@/app/api/settings/route");
  const { POST: reset } = await import("@/app/api/auth/reset-password/route");
  const patch = async body => PATCH(passwordRequest("/api/settings", body));
  const before = (await repo.getSettings()).sessionEpoch;
  expect((await patch({ ssoAdminEmails: [" Team@Example.Org "], ssoAdminGroups: [" Staff "], sessionEpoch: 4242 })).status).toBe(200);
  expect(await repo.getSettings()).toMatchObject({ sessionEpoch: before, ssoAdminEmails: ["team@example.org"], ssoAdminGroups: ["Staff"] });
  expect((await patch({ ssoAdminGroups: "Staff" })).status).toBe(400);
  expect((await patch({ newPassword: "replacement-fixture" })).status).toBe(200);
  expect((await gate("/api/models", "GET", admin)).status).toBe(401);
  const fresh = await session.createDashboardAuthToken({ role: "admin" });
  expect((await reset()).status).toBe(200);
  expect((await gate("/api/models", "GET", fresh)).status).toBe(401);
  expect((await repo.getSettings()).sessionEpoch).toBe(before + 2);
});

it("serves only viewer-safe fields, even with credentials in connections and nested imported data", async () => {
  const marker = "fixture-hidden-secret";
  await repo.createProviderConnection({ provider: "fixture-provider", authType: "oauth", accessToken: marker,
    refreshToken: marker, lastError: marker, apiKey: marker, providerSpecificData: { connectionProxyUrl: marker } });
  await repo.createCombo({ name: "fixture-combo", models: ["fixture-provider/chat", { token: marker }] });
  await repo.addCustomModel({ id: "rbac-fixture", providerAlias: "fixture-provider", caps: { secret: marker } });
  const key = await repo.createApiKey("Read-only fixture", "fixture-machine");
  await repo.saveRequestUsage({ apiKey: key.key, endpoint: marker, model: "rbac-fixture", provider: "fixture-provider",
    tokens: { prompt_tokens: 1, completion_tokens: 1 } });
  const routes = [
    ["/api/providers/summary", await import("@/app/api/providers/summary/route")],
    ["/api/usage/stats", await import("@/app/api/usage/stats/route")],
    ["/api/usage/chart", await import("@/app/api/usage/chart/route")],
    ["/api/models", await import("@/app/api/models/route")],
    ["/api/combos", await import("@/app/api/combos/route")],
    ["/api/keys?view=summary", await import("@/app/api/keys/route")],
  ];
  for (const [path, route] of routes) {
    const response = await route.GET(req(path));
    expect(response.status, path).toBe(200);
    const body = await response.text();
    expect(body, path).not.toContain(marker);
    expect(body, path).not.toContain(key.key);
    if (path === "/api/providers/summary") expect(JSON.parse(body).providers).toContainEqual({
      provider: "fixture-provider", total: 1, active: 1,
    });
    if (path === "/api/usage/stats") expect(JSON.parse(body)).toEqual({
      totalRequests: 1, totalCost: 0, totalCachedTokens: 0, totalCompletionTokens: 1, totalPromptTokens: 1,
    });
  }
  expect((await gate("/dashboard", "POST")).status).toBe(403);
  expect((await gate("/API/keys?view=summary")).status).toBe(403);
});

it("applies the project query to analytics and export and rejects unsafe or ambiguous filters", async () => {
  const { GET: analytics } = await import("@/app/api/usage/analytics/route");
  const { GET: download } = await import("@/app/api/usage/export/route");
  const project = "Blue & Green";
  const key = await repo.createApiKey("Query test", "fixture", { project });
  await repo.saveRequestUsage({ apiKey: key.key, provider:"query", model:"test", tokens:{prompt_tokens:1} });
  const url = "/api/usage/analytics?period=all&" + new URLSearchParams({project});
  const report = await analytics(req(url, "GET", admin));
  expect(report.status).toBe(200);
  expect(await report.json()).toMatchObject({ range:{project}, totals:{requests:1}, breakdowns:{apiKey:[{id:key.id,project}]} });
  expect(await (await download(req(url.replace("/analytics", "/export")+"&format=json", "GET", admin))).json())
    .toMatchObject([{project,keyName:"Query test"}]);
  for (const query of ["project=x&project=y","project=sk-","project=x@y.com","project="+"x".repeat(121)]) {
    const invalid = await analytics(req("/api/usage/analytics?"+query, "GET", admin));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({error:"Invalid project filter"});
  }
});
