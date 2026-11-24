import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { send, channelConfig, destination, webhookUrl } from "@/lib/notifications/transport";
import { filterConsole } from "@/shared/utils/consoleFilter";

const now = Date.UTC(2026, 10, 24, 12);
const fresh = { keys: [], providers: [], errors: 0, requests: 0, healthy: true, diskPercent: 0, backup: "ok" };
const key = { id: "00faca00-abcd-4d11-bbbb-123456789abc", name: "Build runner", limits: [] };
const quota = used => ({ keys: [{ ...key, limits: [{ used, limit: 100 }] }] });
const expiring = offset => ({ keys: [{ ...key, expiresAt: new Date(now + offset).toISOString() }] });
const provider = (state, ms) => ({ providers: [{ state, target: "connection:00faca00", since: now - ms }] });
const telegram = { kind: "telegram", chatId: "-123456", token: "12345:FAKE_TOKEN_FOR_LOCAL_TEST_ONLY", perMinute: 10 };
const tmp = mkdtempSync(join(tmpdir(), "notification-tests-"));
let db, repo, store, sources, evaluate;
beforeAll(async () => {
  vi.stubEnv("DATA_DIR", tmp);
  ({ evaluate } = await import("@/lib/notifications/rules"));
  db = await (await import("@/lib/db/driver")).getAdapter();
  repo = await (await import("@/lib/db/index.js")).getNotificationsRepo();
  store = await import("@/lib/notifications/store");
  sources = await import("@/lib/notifications/sources");
});
beforeEach(() => {
  for (const table of ["notificationDeliveries","notificationChannels","notificationMutes","notifications","notificationOutages"])
    db.run("DELETE FROM " + table);
  db.run("DELETE FROM _meta WHERE key='notificationThresholds'");
});
afterAll(() => { db?.close(); delete global._dbAdapter; vi.unstubAllEnvs(); rmSync(tmp, { recursive: true, force: true }); });

it.each([
  ["key.quota.80", quota(80), quota(79)], ["key.quota.100", quota(100), quota(99)],
  ["key.expiring", expiring(72 * 3600000), expiring(72 * 3600000 + 1)],
  ["provider.unavailable", provider("rate_limited", 900000), provider("rate_limited", 899999)],
  ["provider.unavailable", provider("unavailable", 900000), provider("healthy", 900000)],
  ["provider.needs_reauth", provider("needs_reauth", 0), provider("disabled", 0)],
  ["errors.high", { errors: 5, requests: 20 }, { errors: 4, requests: 20 }],
  ["errors.high", { errors: 5, requests: 20 }, { errors: 5, requests: 19 }],
  ["health.failed", { healthy: false }, {}], ["disk.critical", { diskPercent: 90 }, { diskPercent: 89.999 }],
  ["backup.failed", { backup: "failed" }, { backup: "ok" }],
])("opens and resolves %s at its boundary", async (type, bad, good) => {
  await store.addChannel(repo, telegram);
  const out = vi.fn(async () => true);
  for (let n = 0; n < 5; n++) store.reconcile(repo, { ...fresh, ...bad }, now + n);
  // Boundary input expresses observation times relative to the original sample clock.
  for (let n = 0; n < 2; n++) store.reconcile(repo, { ...fresh, ...good }, now);
  await store.drain(repo, () => now + 10, out);
  expect(out.mock.calls.map(c => c[2]).filter(p => p.event === type).map(p => p.state)).toEqual(["open", "resolved"]);
  expect(db.get("SELECT count,state FROM notifications WHERE type=?", [type])).toMatchObject({ count: 5, state: "resolved" });
});
it("defers muted incidents until expiry and respects adjustable thresholds", async () => {
  store.saveThresholds(repo, { minRequests: 3, errorPercent: 50 });
  store.addMute(repo, { target: "gateway", minutes: 2 }, now);
  await store.addChannel(repo, telegram);
  const sample = { ...fresh, requests: 4, errors: 2 };
  const out = vi.fn(async () => true);
  store.reconcile(repo, sample, now + 119999);
  await store.drain(repo, () => now + 119999, out);
  expect(repo.inbox().unread).toBe(0);
  expect(out).not.toHaveBeenCalled();
  store.reconcile(repo, sample, now + 120000);
  await store.drain(repo, () => now + 120000, out);
  expect(out).toHaveBeenCalledTimes(1);
  store.addMute(repo, { type: "health.failed", minutes: 1 }, now);
  store.reconcile(repo, { ...sample, healthy: false }, now + 1);
  expect(repo.inbox().unread).toBe(1);
});
it("shares rolling channel limit with tests and delivers queued transitions in order", async () => {
  const id = await store.addChannel(repo, { ...telegram, perMinute: 1 });
  await store.addChannel(repo, telegram);
  const out = vi.fn(async () => true);
  store.reconcile(repo, { ...fresh, healthy: false }, now);
  store.reconcile(repo, fresh, now + 1);
  await store.drain(repo, () => now, out);
  expect(out).toHaveBeenCalledTimes(3);
  expect(await store.testChannel(repo, id, now + 59999, out)).toBe(429);
  await store.drain(repo, () => now + 60000, out);
  expect(out.mock.calls.at(-1)[2].state).toBe("resolved");
  expect(await store.testChannel(repo, id, now + 120000, out)).toBe(200);
});
it("keeps missing backup evidence unknown, probes loopback and reads disk capacity", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  const read = () => sources.readProbes({ fetcher, directory: tmp, disk: async () => ({ blocks: 100, bavail: 10 }) });
  expect(await read()).toEqual({ healthy: true, diskPercent: 90, backup: null });
  expect(fetcher.mock.calls[0][0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/health$/);
  for (const status of ["ok","failed"]) {
    writeFileSync(join(tmp, "backup-status.json"), JSON.stringify({ status }));
    expect((await read()).backup).toBe(status);
  }
  store.reconcile(repo, { ...fresh, backup: "failed" }, now);
  store.reconcile(repo, { ...fresh, backup: null }, now + 60000);
  expect(repo.inbox().notifications[0].state).toBe("open");
});
it("encrypts complete destinations, binds ciphertext to channel ID and omits config from responses", async () => {
  const id = await store.addChannel(repo, telegram);
  const row = db.get("SELECT * FROM notificationChannels WHERE id=?", [id]);
  expect(row.config).toMatch(/^v1:/);
  for (const value of [JSON.stringify(row), JSON.stringify(store.settings(repo, now))]) {
    expect(value).not.toContain(telegram.token);
    expect(value).not.toContain(telegram.chatId);
  }
  const { decryptChannel, decryptKey } = await import("@/lib/db/helpers/keyEncryption");
  expect(decryptChannel(db, row)).toMatchObject({ token: telegram.token });
  expect(decryptChannel(db, { ...row, id: "other" })).toBeNull();
  expect(decryptKey(db, { id, key_version: 1, key_ciphertext: row.config })).toBeNull();
  const fetcher = vi.fn(async () => new Response(null));
  expect(await send("telegram", telegram, { event: "health.failed" }, { fetcher, resolve: publicDns })).toBe(true);
  expect(fetcher.mock.calls[0][0].hostname).toBe("api.telegram.org");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).chat_id).toBe(telegram.chatId);
});
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
it.each(["127.2.3.4","10.1.1.1","172.31.255.255","192.168.2.2","100.127.255.255","169.254.169.254","169.254.2.3",
  "[fd00::1]","[fc00::1]","[::1]","[fe80::1]","[::ffff:7f00:1]","[64:ff9b::a00:1]","localhost."])("blocks literal and HTTP opt-in destination %s", host => {
  expect(() => webhookUrl("https://" + host)).toThrow();
  expect(() => webhookUrl("http://" + host, true)).toThrow();
});
it("rejects default HTTP and mixed/private DNS answers at enrollment and delivery; fails closed on DNS error", async () => {
  expect(() => webhookUrl("http://example.org")).toThrow();
  expect(webhookUrl("http://example.org", true).protocol).toBe("http:");
  const resolve = async () => [...await publicDns(), { address: "10.0.0.1", family: 4 }];
  const input = { kind: "webhook", url: "https://receiver.test" }, fetcher = vi.fn();
  await expect(channelConfig(input, resolve)).rejects.toThrow();
  expect(await send("webhook", input, {}, { fetcher, resolve })).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(destination(new URL(input.url), async () => { throw Error(); })).rejects.toThrow();
});
it("signs exact JSON bytes; cancels unread body and stops at redirect", async () => {
  const payload = { event: "disk.critical", severity: "critical", state: "open", target: "data", at: new Date(now).toISOString() };
  const body = { cancel: vi.fn() };
  const fetcher = vi.fn(async () => ({ status: 302, body, headers: new Headers({ location: "https://other.test" }) }));
  const resolve = vi.fn(publicDns);
  expect(await send("webhook", { url: "https://receiver.test", secret: "test-key" }, payload, { fetcher, resolve })).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledTimes(1);
  const options = fetcher.mock.calls[0][1];
  expect(options).toMatchObject({ redirect: "manual", body: JSON.stringify(payload), headers: {
    "X-9Router-Signature": "sha256=" + createHmac("sha256", "test-key").update(JSON.stringify(payload)).digest("hex"),
  } });
  expect(options.dispatcher).toBeTruthy();
  expect(body.cancel).toHaveBeenCalledOnce();
});
it("filters masked lines by captured level, case-independent text, request ID and trailing limit", () => {
  const lines = ["[ERROR] RequestId: Abc-12 START", '[WARN] {"requestId":"abc-13","msg":"start"}', "[LOG] abc-12 start", "[DEBUG] done"];
  expect(filterConsole(lines, { query: "start", requestId: "ABC", level: "warn" })).toEqual([{ line: lines[1], level: "warn", requestId: "abc-13" }]);
  expect(filterConsole(lines, { level: "info" })[0].line).toBe(lines[2]);
  expect(filterConsole(lines, { query: "start", limit: 1 })[0].line).toBe(lines[2]);
});
it("drops sensitive key names and imported identifiers from event details", () => {
  for (const name of ["abc@example.org", "sk-fixture", "Bearer credential"]) {
    const [event] = evaluate({ ...fresh, ...expiring(5000), keys: [{ ...expiring(5000).keys[0], id: name, name }] }, now);
    expect(event.label).toBeNull(); expect(event.target).not.toContain(name);
  }
});

it("measures current UTC quotas, held budget, rolling failures and continuous outages from SQLite", () => {
  const stamp = delta => new Date(now + delta).toISOString();
  db.run(`INSERT INTO apiKeys(id,name,createdAt,key_ciphertext,hourlyRequestLimit,requestHour,hourlyRequests,budget)
    VALUES(?,?,?,'fixture',5,?,4,?)`, [key.id, key.name, stamp(0), Math.floor(now / 3600000), JSON.stringify({ tokenLimit: 100, costLimitMicros: 50 })]);
  db.run(`INSERT INTO budgetReservations(requestId,keyId,createdAt,state,policy,reservedTokens,reservedMicros)
    VALUES('sample',?,?,'pending','{}',20,50)`, [key.id, stamp(0)]);
  const ids = ["00faca00-abcd-4d11-bbbb-123456789abc","00faca00-abcd-4d11-8888-111111111111"];
  for (const id of ids) db.run(`INSERT INTO providerConnections(id,provider,authType,data,createdAt,updatedAt)
    VALUES(?,'fixture','oauth',?,?,?)`, [id, JSON.stringify({ unavailableUntil: stamp(3600000) }), stamp(0), stamp(0)]);
  for (let n = 0; n < 21; n++) db.run("INSERT INTO usageHistory(timestamp,status) VALUES(?,?)",
    [stamp(n === 20 ? -900001 : n === 19 ? -900000 : 0), n < 5 || n === 20 ? "error" : "ok"]);
  const snap = offset => ({ ...fresh, ...sources.readSources(repo, now + offset) });
  const first = snap(0);
  expect(first).toMatchObject({ requests: 20, errors: 5 });
  expect(evaluate(first, now).map(r => r.type)).toEqual(["key.quota.80", "key.quota.100", "errors.high"]);
  db.run("DELETE FROM budgetReservations WHERE keyId=?", [key.id]);
  expect(evaluate(snap(1), now + 1).map(r => r.type)).toEqual(["key.quota.80"]);
  const outage = snap(900000);
  store.reconcile(repo, outage, now + 900000);
  expect(repo.inbox().notifications.filter(n => n.type === "provider.unavailable")).toHaveLength(2);
  db.run("UPDATE providerConnections SET data='{}' WHERE id=?", [ids[0]]);
  store.reconcile(repo, snap(900001), now + 900001);
  expect(db.get("SELECT COUNT(*) AS n FROM notifications WHERE type='provider.unavailable' AND state='open'").n).toBe(1);
  db.run("UPDATE providerConnections SET data=? WHERE id=?", [JSON.stringify({ unavailableUntil: stamp(3600000) }), ids[0]]);
  expect(snap(950000).providers.find(p => p.subject.endsWith(ids[0])).since).toBe(now + 950000);
  expect(evaluate(snap(3600000), now + 3600000)).toEqual([]);
});
