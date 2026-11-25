import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DAY_MS, cleanLogs, startLogMaintenance } from "@/lib/db/logRetention";

const jar = new Map();
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: k => ({ value: jar.get(k) }), set: (k,v) => jar.set(k,v), delete: k => jar.delete(k),
}) }));
const dir = mkdtempSync(join(tmpdir(), "log-privacy-"));
const password = "fixture-admin-credential";
let db, repo, admin, viewer, token, debug, auditList;
const req = (path, method, data, cookie = admin, headers = {}) => new NextRequest("http://localhost/api/" + path, {
  method, headers: { cookie: "auth_token=" + cookie, "x-forwarded-for": "192.0.2.33", ...headers },
  ...(data !== undefined && { body: JSON.stringify(data) }),
});
beforeAll(async () => {
  vi.stubEnv("DATA_DIR", dir); vi.stubEnv("HOME", dir); vi.stubEnv("JWT_SECRET", "privacy-fixture-secret");
  vi.stubEnv("INITIAL_PASSWORD", password); vi.stubEnv("NINEROUTER_PEER_TOKEN", "fixture-peer");
  delete process.env.ENABLE_REQUEST_LOGS;
  repo = await import("@/lib/db/index.js");
  db = await (await import("@/lib/db/driver")).getAdapter();
  ({ createDashboardAuthToken: token } = await import("@/lib/auth/dashboardSession"));
  admin = await token({ role: "admin", oidc: true, oidcEmail: "operator@example.invalid" });
  viewer = await token({ role: "viewer" });
  await repo.updateSettings({ observabilityBatchSize: 1 });
  debug = await import("@/app/api/settings/debug-logging/route");
  auditList = (await import("@/app/api/audit-log/route")).GET;
});
afterAll(() => { db?.close(); delete global._dbAdapter; vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

const start = (minutes = 1, cookie = admin) => debug.POST(req("settings/debug-logging", "POST", { minutes }, cookie));
const stop = () => debug.DELETE(req("settings/debug-logging", "DELETE"));
const body = { headers: { cookie: "private-cookie" }, content: "private-prompt" };
const detail = id => ({ id, status: "error", errorCategory: "timeout", latency: { total: 19 }, tokens: { prompt_tokens: 8 },
  provider: "test", model: "model", connectionId: "conn", request: body, response: body, providerRequest: body, providerResponse: body });
const row = id => db.get("SELECT * FROM requestDetails WHERE id=?", [id]);
function metaOnly(id) {
  expect(JSON.parse(row(id).data)).toEqual({ id, timestamp: expect.any(String), provider: "test", model: "model", connectionId: "conn",
    status: "error", errorCategory: "timeout", latency: { total: 19 }, tokens: { prompt_tokens: 8 } });
  expect(row(id).bodyExpiresAt).toBeNull();
}

describe("request log storage boundary", () => {
  it("defaults to metadata, including with the legacy env flag", async () => {
    await repo.saveRequestDetail(detail("default")); metaOnly("default");
    vi.stubEnv("ENABLE_REQUEST_LOGS", "true");
    await repo.saveRequestDetail(detail("env")); metaOnly("env");
    const logger = await (await import("open-sse/utils/requestLogger.js")).createRequestLogger("src","dst","m");
    expect(logger.sessionPath).toBeNull();
  });
  it("requires a credentialed administrator and bounded integer duration", async () => {
    expect((await start(5, viewer)).status).toBe(403);
    expect((await auditList(req("audit-log","GET",undefined,viewer))).status).toBe(403);
    for (const n of [0,-1,1.5,1441,"5"]) expect((await start(n)).status).toBe(400);
    const settings = await import("@/app/api/settings/route");
    await settings.PATCH(req("settings","PATCH",{ debugBodyLoggingUntil:"2999-01-01T00:00:00Z" }));
    expect((await repo.getSettings()).debugBodyLoggingUntil).toBeNull();
  });
  it("masks nested names, header values, structured strings and error text before truncation", async () => {
    expect((await start(1440)).status).toBe(200);
    const names = ["Authorization","COOKIE","Set-Cookie","X-API-Key","x-goog-api-key","api_key","apiKey","access_token",
      "refresh_token","id_token","client_secret","password","secret","token","private_key"];
    const secrets = ["Bearer bearer-fixture","sk-fixture","sk-ant-fixture", "AIzaTestFixtureKey",
      "eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.fixture", "-----BEGIN RSA PRIVATE KEY-----\nfixture-pem\n-----END RSA PRIVATE KEY-----",
      "sk-0123456789abcdef-" + "a".repeat(64) + "-deadbeef"];
    const fields = Object.fromEntries(names.map((k,i) => [k,"named-private-" + i]));
    await repo.saveRequestDetail({ ...detail("masked"), request: { headers: fields, chain: [{ ...fields }],
      arguments: JSON.stringify(fields), content: "inspect me" }, response: { error: secrets.join(" / ") },
      providerRequest: { secret:"named-private-large", blob:"x".repeat(7000) } });
    const raw = row("masked").data, parsed = JSON.parse(raw);
    expect(raw).not.toMatch(/named-private|fixture-pem|bearer-fixture/);
    for (const secret of secrets) expect(raw).not.toContain(secret);
    for (const name of names) expect(parsed.request.headers[name]).toBe("[REDACTED]");
    expect(parsed.request.content).toBe("inspect me");
    expect(parsed.response.error.split(" / ")).toEqual(secrets.map(() => "[REDACTED]"));
    expect(parsed.providerRequest._truncated).toBe(true);
    await stop();
  });
  it("checks expiry on every write; clears only bodies 24h after the window", async () => {
    const { debugBodyLoggingUntil } = await (await start()).json();
    const until = Date.parse(debugBodyLoggingUntil);
    await repo.saveRequestDetail(detail("captured"));
    const clock = vi.spyOn(Date,"now").mockReturnValue(until);
    try {
      await repo.saveRequestDetail(detail("expired")); metaOnly("expired");
      cleanLogs(db, until + DAY_MS - 1);
      expect(JSON.parse(row("captured").data).request.content).toBe(body.content);
      cleanLogs(db, until + DAY_MS); metaOnly("captured");
    } finally { clock.mockRestore(); }
  });
  it("runs expiry cleanup on startup and periodically even with no traffic", async () => {
    await start(); await repo.saveRequestDetail(detail("boot")); await repo.saveRequestDetail(detail("idle"));
    vi.useFakeTimers();
    let timer;
    try {
      const now = Date.now();
      for (const [id, offset] of [["boot", -1], ["idle", 30_000]])
        db.run("UPDATE requestDetails SET bodyExpiresAt=? WHERE id=?", [new Date(now + offset).toISOString(), id]);
      timer = startLogMaintenance(db);
      metaOnly("boot"); expect(JSON.parse(row("idle").data).request.content).toBe(body.content);
      vi.advanceTimersByTime(60_000); metaOnly("idle");
    } finally { clearInterval(timer); vi.useRealTimers(); }
  });
  it("migrates old payloads without interrupting metadata correlation", async () => {
    const d = detail("pre-008");
    db.run("INSERT INTO requestDetails(id,timestamp,provider,model,connectionId,status,data) VALUES(?,?,?,?,?,?,?)",
      [d.id, new Date().toISOString(), d.provider, d.model, d.connectionId, d.status, JSON.stringify(d)]);
    (await import("@/lib/db/migrations/008-log-privacy.js")).default.up(db);
    metaOnly(d.id);
  });
  it("explicit debug capture is separate from the metadata switch", async () => {
    vi.stubEnv("ENABLE_REQUEST_LOGS", "false");
    try {
      await start(); await repo.saveRequestDetail(detail("debug-only"));
      expect(JSON.parse(row("debug-only").data).request.content).toBe(body.content);
      await stop(); await repo.saveRequestDetail(detail("all-off"));
      expect(row("all-off")).toBeUndefined();
    } finally { vi.stubEnv("ENABLE_REQUEST_LOGS", "true"); }
  });
  it("rechecks revocation at batch flush, even after a new window opens", async () => {
    await start(15);
    await repo.updateSettings({ observabilityBatchSize: 20 });
    await repo.saveRequestDetail(detail("queued"));
    await stop(); await start(60);
    await repo.updateSettings({ observabilityBatchSize: 1 });
    await repo.saveRequestDetail(detail("next")); metaOnly("queued");
    expect(JSON.parse(row("next").data).response.content).toBe(body.content);
    await stop(); await repo.saveRequestDetail(detail("stopped")); metaOnly("stopped");
  });
});

describe("audit trail at management routes", () => {
  it("records authenticated actions, results and masked identity; never values or forged IPs", async () => {
    const login = await import("@/app/api/auth/login/route");
    const valid = { "x-9r-peer-token":"fixture-peer","x-9r-socket-ip":"127.0.0.1" };
    expect((await login.POST(req("auth/login","POST",{ password:"wrong-fixture" }))).status).toBe(401);
    expect((await login.POST(req("auth/login","POST",{ password },admin,valid))).status).toBe(200);
    await (await import("@/app/api/auth/logout/route")).POST(req("auth/logout","POST"));
    const keys = await import("@/app/api/keys/route"), key = await import("@/app/api/keys/[id]/route");
    const created = await (await keys.POST(req("keys","POST",{ name:"private-project" }))).json();
    expect(created.id).toBeTruthy();
    const params = { params: Promise.resolve({ id: created.id }) };
    await key.PUT(req("keys/id","PUT",{ isActive:false, rpmLimit:5 }),params);
    await (await import("@/app/api/keys/[id]/rotate/route")).POST(req("keys/id/rotate","POST",{ keyVersion:1 }),params);
    await key.DELETE(req("keys/id","DELETE"),params);
    const providers = await import("@/app/api/providers/route"), provider = await import("@/app/api/providers/[id]/route");
    const add = await providers.POST(req("providers","POST",{ provider:"openai", name:"private-account", apiKey:"private-api-value" }));
    expect(add.status).toBe(201);
    const connection = (await add.json()).connection;
    const conn = { params: Promise.resolve({ id: connection.id }) };
    expect((await provider.PUT(req("providers/id","PUT",{ name:"private-changed" }),conn)).status).toBe(200);
    expect((await provider.DELETE(req("providers/id","DELETE"),conn)).status).toBe(200);
    const database = await import("@/app/api/settings/database/route");
    const exported = await database.GET(req("settings/database","GET",undefined,admin,{"x-9r-password":password}));
    expect(exported.ok).toBe(true);
    const dump = await exported.json(); dump.settings.debugBodyLoggingUntil = "2999-01-01T00:00:00Z";
    expect((await database.POST(req("settings/database","POST",{ password,...dump }))).ok).toBe(true);
    expect((await repo.getSettings()).debugBodyLoggingUntil).toBeNull();
    admin = await token({ role:"admin" });
    const revoke = await import("@/app/api/auth/sessions/revoke/route");
    await revoke.POST(req("auth/sessions/revoke","POST"));
    admin = await token({ role:"admin" });
    const settings = await import("@/app/api/settings/route");
    expect((await settings.PATCH(req("settings","PATCH",{ newPassword:"new-private-password", auditRetentionDays:3 }))).ok).toBe(true);
    admin = await token({ role:"admin" });
    const { getConsistentMachineId } = await import("@/shared/utils/machineId");
    const cli = await getConsistentMachineId("9r-cli-auth");
    expect((await debug.DELETE(req("settings/debug-logging","DELETE",undefined,"",{"x-9r-cli-token":cli}))).ok).toBe(true);
    const rows = db.all("SELECT * FROM auditLog");
    expect(rows).toContainEqual(expect.objectContaining({ actor:"cli",actorRole:"admin",action:"debug.disable" }));
    expect(rows.map(r=>r.action)).toEqual(expect.arrayContaining(["login","logout","session.revoke","password.change",
      "settings.update","debug.enable","debug.disable","key.create","key.delete","key.rotate","key.pause","key.policy",
      "provider.create","provider.delete","provider.update","db.export","db.import"]));
    expect(rows).toContainEqual(expect.objectContaining({ action:"login",result:"failure",ip:null }));
    expect(rows).toContainEqual(expect.objectContaining({ action:"login",result:"success",ip:"127.0.0.1" }));
    expect(rows).toContainEqual(expect.objectContaining({ action:"key.create",actor:"oidc:o***@***",target:created.id,actorRole:"admin" }));
    for (const value of [password,created.key,"wrong-fixture","new-private-password","private-api-value","private-account",
      "operator@example.invalid","private-project","192.0.2.33"]) expect(JSON.stringify(rows)).not.toContain(value);
    const page = await (await auditList(req("audit-log?action=login&pageSize=1&startDate=2020-01-01","GET"))).json();
    expect(page.entries).toHaveLength(1); expect(page.entries[0].action).toBe("login"); expect(page.hasNext).toBe(true);
    expect((await auditList(req("audit-log?startDate=invalid","GET"))).status).toBe(400);
    cleanLogs(db, Date.now()+4*DAY_MS);
    expect(db.get("SELECT COUNT(*) n FROM auditLog").n).toBe(0);
  });
  it("keeps successful response and warns if audit insertion fails", async () => {
    db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON auditLog BEGIN SELECT RAISE(FAIL,'fixture'); END");
    const warn = vi.spyOn(console,"warn").mockImplementation(()=>{});
    try {
      expect((await start()).status).toBe(200);
      expect(warn).toHaveBeenCalledWith("[audit] Event could not be recorded:", "debug.enable");
    } finally { db.exec("DROP TRIGGER reject_audit"); warn.mockRestore(); }
  });
});
