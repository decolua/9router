// API options.now is epoch milliseconds; persisted timestamps are ISO strings.
// enqueueWebhookTest creates its own synthetic envelope, never accepts user data.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.parse("2026-10-18T10:00:00.000Z");
const DAY = 86_400_000;
const iso = (time) => new Date(time).toISOString();
const backends = ["sql.js", ...(process.versions.bun ? ["bun:sqlite"] : [])];
const originalDataDir = process.env.DATA_DIR;
const ok = (result) => {
  expect(result).toMatchObject({ ok: true });
  return result;
};
const event = (overrides = {}) => ({
  id: crypto.randomUUID(), type: "request.failed", schema_version: 1,
  occurred_at: iso(NOW), severity: "error",
  data: { requestId: crypto.randomUUID(), provider: "cx", model: "fixture-model", errorClass: "upstream_http", statusCode: 503 },
  ...overrides,
});

for (const backend of backends) {
  describe(`webhook outbox durable contract (${backend})`, () => {
    let dir, file, adapter, api, destinations, SQL, factory;
    const handles = [];
    let listeners;

    async function openAdapter() {
      if (!factory) {
        const adapterModule = backend === "sql.js"
          ? await import("@/lib/db/adapters/sqljsAdapter.js")
          : await import("@/lib/db/adapters/bunSqliteAdapter.js");
        factory = adapterModule.createSqlJsAdapter || adapterModule.createBunSqliteAdapter;
      }
      const opened = await factory(file);
      handles.push(opened);
      return opened;
    }

    async function bind(target, isolateDriver = false) {
      vi.resetModules();
      global._dbAdapter = { instance: target, initPromise: null, logged: true };
      const getAdapter = isolateDriver ? vi.fn(async () => target) : null;
      if (getAdapter) vi.doMock("@/lib/db/driver.js", () => ({ getAdapter, getAdapterSync: () => target }));
      const { runMigrationOnce } = await import("@/lib/db/migrate.js");
      await runMigrationOnce(target);
      destinations = await import("@/lib/db/repos/webhooksRepo.js");
      api = await import("@/lib/db/repos/webhookDeliveriesRepo.js");
      return getAdapter;
    }

    beforeEach(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-webhook-outbox-"));
      process.env.DATA_DIR = dir;
      fs.mkdirSync(path.join(dir, "db"));
      file = path.join(dir, "db", "data.sqlite");
      listeners = Object.fromEntries(["beforeExit", "SIGINT", "SIGTERM"].map((name) => [name, process.listeners(name)]));
      SQL = await initSqlJs();
      factory = null;
      adapter = await openAdapter();
      await bind(adapter);
      adapter.flush();
      // Freeze only debounce timers, after WASM initialization. No sleeps/network.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    afterEach(() => {
      vi.doUnmock("@/lib/db/driver.js");
      vi.restoreAllMocks();
      for (const handle of handles.splice(0).reverse()) handle.close();
      for (const [name, previous] of Object.entries(listeners || {})) {
        for (const listener of process.listeners(name)) {
          if (!previous.includes(listener)) process.removeListener(name, listener);
        }
      }
      vi.useRealTimers();
      delete global._dbAdapter;
      vi.resetModules();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
    });

    async function destination(overrides = {}) {
      return ok(await destinations.createWebhookDestination({
        name: "Fixture destination", kind: "generic",
        url: "https://hooks.example.com/secret-path?token=fixture-url-secret",
        signingSecret: "fixture-signing-secret", headers: { Authorization: "Bearer fixture-header-secret" },
        cooldownSeconds: 0, ...overrides,
      })).destination;
    }

    const rows = () => adapter.all("SELECT * FROM webhookDeliveries ORDER BY createdAt, id");
    const row = (id) => adapter.get("SELECT * FROM webhookDeliveries WHERE id = ?", [id]);
    const enqueue = (value = event(), now = NOW) => api.enqueueWebhookEvent(value, { now });
    const claim = (now = NOW) => api.claimNextWebhookDelivery({ now });
    const finish = (lease, result = { status: "delivered", lastStatus: 204 }, now = NOW) =>
      api.completeWebhookDelivery(lease, result, { now });

    function diskRows(sql = "SELECT * FROM webhookDeliveries ORDER BY createdAt, id", filename = file) {
      if (backend !== "sql.js") return adapter.all(sql);
      const snapshot = new SQL.Database(fs.readFileSync(filename));
      try {
        const result = snapshot.exec(sql)[0];
        return result ? result.values.map((values) => Object.fromEntries(result.columns.map((key, i) => [key, values[i]]))) : [];
      } finally { snapshot.close(); }
    }

    async function restart() {
      // Restore bytes captured before close: sql.js close itself persists dirty state.
      const committed = backend === "sql.js" ? fs.readFileSync(file) : null;
      adapter.close();
      handles.splice(handles.indexOf(adapter), 1);
      if (committed) fs.writeFileSync(file, committed);
      adapter = await openAdapter();
      await bind(adapter);
    }

    async function seed(count, changes = {}) {
      const template = rows()[0];
      const keys = Object.keys(template);
      const sql = `INSERT INTO webhookDeliveries (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
      adapter.transaction(() => {
        for (let i = 0; i < count; i += 1) {
          const eventId = crypto.randomUUID();
          const values = { ...template, id: crypto.randomUUID(), eventId, payload: JSON.stringify({ ...JSON.parse(template.payload), id: eventId }), ...changes };
          adapter.run(sql, keys.map((key) => values[key]));
        }
      });
      adapter.flush();
    }

    it("fans out one envelope to three subscribed destinations with independent completion", async () => {
      const targets = await Promise.all([destination(), destination(), destination()]);
      const value = event();
      const result = ok(await enqueue(value));
      expect(result.deliveryIds).toHaveLength(3);
      expect(new Set(result.deliveryIds).size).toBe(3);
      expect(rows().map((item) => item.destinationId).sort()).toEqual(targets.map((item) => item.id).sort());
      for (const item of diskRows()) {
        expect(item).toMatchObject({ eventId: value.id, destinationRevision: 1, status: "pending", attempts: 0, deliveryKind: "operational", suppressedCount: 0 });
        expect(JSON.parse(item.payload)).toEqual(value);
        expect(item.expiresAt).toBe(iso(NOW + DAY));
        expect(item.generation).toBeGreaterThanOrEqual(1);
      }
      const first = await claim();
      ok(await finish(first));
      const second = await claim();
      ok(await finish(second, { status: "retry", nextAttemptAt: iso(NOW + 5000), lastStatus: 503, lastErrorClass: "upstream_http" }));
      const third = await claim();
      ok(await finish(third, { status: "failed", lastStatus: 400, lastErrorClass: "upstream_http" }));
      expect(row(first.id).status).toBe("delivered");
      expect(row(second.id).status).toBe("retry");
      expect(row(third.id).status).toBe("failed");
    });

    it("filters enabled subscriptions, leaving transient events opt-in", async () => {
      const defaults = await destination();
      const transient = await destination({ events: ["account.unavailable", "token.refresh_failed"] });
      await destination({ enabled: false });
      ok(await enqueue());
      ok(await enqueue(event({ type: "account.unavailable", severity: "warning" })));
      ok(await enqueue(event({ type: "token.refresh_failed", severity: "warning", data: { provider: "cx", connectionId: "fixture", errorClass: "refresh_failed" } })));
      expect(rows()).toHaveLength(3);
      expect(rows().filter((item) => item.destinationId === defaults.id).map((item) => item.type)).toEqual(["request.failed"]);
      expect(rows().filter((item) => item.destinationId === transient.id).map((item) => item.type).sort()).toEqual(["account.unavailable", "token.refresh_failed"]);
    });

    it("deduplicates concurrent event/destination pairs without suppressing a new event at cooldown zero", async () => {
      await destination();
      const value = event();
      const results = await Promise.all(Array.from({ length: 5 }, () => enqueue(value)));
      results.forEach(ok);
      expect(rows()).toHaveLength(1);
      expect(results.reduce((sum, result) => sum + result.deliveryIds.length, 0)).toBe(1);
      const distinct = ok(await enqueue(event(), NOW));
      expect(distinct.deliveryIds).toHaveLength(1);
      expect(rows()).toHaveLength(2);
    });

    it("enforces the unique pair in SQLite even for a direct duplicate insert", async () => {
      await destination();
      ok(await enqueue());
      const existing = rows()[0];
      const keys = Object.keys(existing);
      expect(() => adapter.run(
        `INSERT INTO webhookDeliveries (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        keys.map((key) => key === "id" ? crypto.randomUUID() : existing[key]),
      )).toThrow();
      expect(rows()).toHaveLength(1);
    });

    it("durably suppresses 300-second repeats and puts the count only on the next eligible summary", async () => {
      await destination({ cooldownSeconds: 300 });
      const first = event();
      ok(await enqueue(first));
      ok(await enqueue(first, NOW + 1));
      for (const offset of [1000, 299_999]) {
        expect(ok(await enqueue(event(), NOW + offset))).toMatchObject({ deliveryIds: [], suppressedCount: 1 });
      }
      expect(rows()).toHaveLength(1);
      expect(rows()[0].suppressedCount).toBe(0);
      expect(diskRows("SELECT * FROM kv WHERE scope = 'webhookCooldown'")).toHaveLength(1);
      await restart();
      const next = ok(await enqueue(event(), NOW + 300_000));
      expect(row(next.deliveryIds[0]).suppressedCount).toBe(2);
      expect(rows()).toHaveLength(2);
      const later = ok(await enqueue(event(), NOW + 600_000));
      expect(row(later.deliveryIds[0]).suppressedCount).toBe(0);
    });

    it("keeps cooldown independent per destination and semantic fingerprint, not requestId", async () => {
      const slow = await destination({ cooldownSeconds: 300 });
      const fast = await destination();
      const value = event();
      ok(await enqueue(value));
      const repeat = ok(await enqueue(event(), NOW + 1000));
      expect(repeat.suppressedCount).toBe(1);
      expect(repeat.deliveryIds.map((id) => row(id).destinationId)).toEqual([fast.id]);
      const changed = ok(await enqueue(event({ data: { ...value.data, connectionId: "another-account" } }), NOW + 2000));
      expect(changed.deliveryIds.map((id) => row(id).destinationId).sort()).toEqual([slow.id, fast.id].sort());
    });

    it("atomically refuses a fanout exceeding 10000 nonterminal rows without consuming cooldown", async () => {
      await destination();
      ok(await enqueue());
      await seed(9998);
      await destination({ cooldownSeconds: 300 });
      const value = event();
      const rejected = await enqueue(value, NOW + 1000);
      expect(rejected).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: "outbox_full" })]) });
      expect(rows()).toHaveLength(9999);
      expect(rows().filter((item) => item.eventId === value.id)).toHaveLength(0);
      expect(rows().every((item) => item.status === "pending")).toBe(true);
      adapter.run("UPDATE webhookDeliveries SET status = 'delivered', finishedAt = ? WHERE id = ?", [iso(NOW), rows()[0].id]);
      const retried = ok(await enqueue(value, NOW + 1000));
      expect(retried.deliveryIds).toHaveLength(2);
      expect(rows()).toHaveLength(10000);
      expect(rows().filter((item) => item.eventId === value.id).every((item) => item.suppressedCount === 0)).toBe(true);
    }, 30_000);

    it("accepts row 10000, then prunes only the oldest terminal row before enqueueing 10001", async () => {
      await destination();
      ok(await enqueue());
      await seed(9998);
      const thousandth = ok(await enqueue());
      expect(thousandth.deliveryIds).toHaveLength(1);
      expect(rows()).toHaveLength(10000);
      const [oldest, newer] = rows();
      adapter.run("UPDATE webhookDeliveries SET status = 'failed', finishedAt = ? WHERE id = ?", [iso(NOW - 2000), oldest.id]);
      adapter.run("UPDATE webhookDeliveries SET status = 'cancelled', finishedAt = ? WHERE id = ?", [iso(NOW - 1000), newer.id]);
      ok(await enqueue());
      expect(rows()).toHaveLength(10000);
      expect(row(oldest.id)).toBeFalsy();
      expect(row(newer.id).status).toBe("cancelled");
      expect(rows().filter((item) => item.status === "pending")).toHaveLength(9999);
    }, 30_000);

    it("rolls back all fanout and cooldown writes when a later insert fails", async () => {
      const first = await destination({ cooldownSeconds: 300 });
      const second = await destination({ cooldownSeconds: 300 });
      adapter.run("UPDATE webhookDestinations SET createdAt = ? WHERE id = ?", [iso(NOW - 1000), first.id]);
      adapter.run("UPDATE webhookDestinations SET createdAt = ? WHERE id = ?", [iso(NOW), second.id]);
      adapter.exec(`CREATE TRIGGER fixture_fail_second BEFORE INSERT ON webhookDeliveries
        WHEN EXISTS (SELECT 1 FROM webhookDeliveries)
        BEGIN SELECT RAISE(ABORT, 'fixture_insert_failure'); END`);
      const result = await enqueue();
      expect(result).toMatchObject({ ok: false });
      expect(rows()).toEqual([]);
      expect(adapter.all("SELECT * FROM kv WHERE scope = 'webhookCooldown'")).toEqual([]);
      adapter.exec("DROP TRIGGER fixture_fail_second");
      expect(ok(await enqueue()).deliveryIds).toHaveLength(2);
    });

    it.each([
      ["private data", { data: { errorClass: "upstream_http", prompt: "fixture-private-input" } }],
      ["unknown event", { type: "unknown.event" }],
      ["internal delivery kind", { deliveryKind: "test" }],
      ["BigInt", { data: { errorClass: "upstream_http", model: 1n } }],
    ])("rejects malformed or unserializable event before any mutation: %s", async (_name, invalid) => {
      await destination({ cooldownSeconds: 300 });
      const result = await enqueue(event(invalid));
      expect(result).toMatchObject({ ok: false });
      expect(rows()).toEqual([]);
      expect(adapter.all("SELECT * FROM kv WHERE scope = 'webhookCooldown'")).toEqual([]);
    });

    it("expires pending and retry at 24h without resetting a valid inflight lease", async () => {
      await destination();
      ok(await enqueue());
      ok(await enqueue());
      ok(await enqueue());
      const leased = await claim(NOW + DAY - 1000);
      const remaining = rows().filter((item) => item.id !== leased.id);
      adapter.run("UPDATE webhookDeliveries SET status = 'retry', nextAttemptAt = ? WHERE id = ?", [iso(NOW + DAY + 5000), remaining[0].id]);
      ok(await api.pruneWebhookDeliveries({ now: NOW + DAY - 1 }));
      expect(rows().some((item) => item.status === "expired")).toBe(false);
      ok(await api.pruneWebhookDeliveries({ now: NOW + DAY }));
      for (const item of remaining) expect(row(item.id)).toMatchObject({ status: "expired", finishedAt: iso(NOW + DAY) });
      expect(row(leased.id)).toMatchObject({ status: "inflight", leaseToken: leased.leaseToken });
      expect(await claim(NOW + DAY)).toBeNull();
      expect(await claim(NOW + DAY + 30_000)).toBeNull();
      expect(row(leased.id).status).toBe("expired");
    });

    it("retains terminal rows for seven days and never prunes recent pending rows", async () => {
      await destination();
      for (let i = 0; i < 6; i += 1) ok(await enqueue());
      const terminal = rows().slice(0, 5);
      for (const [i, status] of ["delivered", "failed", "cancelled", "expired", "delivered"].entries()) {
        adapter.run("UPDATE webhookDeliveries SET status = ?, finishedAt = ? WHERE id = ?", [status, iso(NOW), terminal[i].id]);
      }
      const pending = rows().find((item) => !terminal.some((old) => old.id === item.id));
      adapter.run("UPDATE webhookDeliveries SET createdAt = ?, expiresAt = ? WHERE id = ?", [iso(NOW + 7 * DAY - 1000), iso(NOW + 8 * DAY), pending.id]);
      adapter.run("UPDATE webhookDeliveries SET finishedAt = ? WHERE id = ?", [iso(NOW + 1), terminal[4].id]);
      ok(await api.pruneWebhookDeliveries({ now: NOW + 7 * DAY - 1 }));
      expect(rows()).toHaveLength(6);
      ok(await api.pruneWebhookDeliveries({ now: NOW + 7 * DAY }));
      expect(rows().map((item) => item.id).sort()).toEqual([pending.id, terminal[4].id].sort());
      expect(diskRows()).toHaveLength(2);
    });

    it("claims for 30 seconds with one winner and leaves another destination eligible", async () => {
      await destination();
      await destination();
      ok(await enqueue());
      ok(await enqueue());
      const results = await Promise.all(Array.from({ length: 6 }, () => claim()));
      const winners = results.filter(Boolean);
      expect(winners).toHaveLength(2);
      expect(new Set(winners.map((item) => item.destinationId)).size).toBe(2);
      for (const leased of winners) {
        expect(leased.leaseToken).toBeTruthy();
        expect(row(leased.id)).toMatchObject({ status: "inflight", attempts: 1, leaseToken: leased.leaseToken, leaseUntil: iso(NOW + 30_000) });
        expect(diskRows().find((item) => item.id === leased.id).status).toBe("inflight");
      }
      expect(await claim(NOW + 29_999)).toBeNull();
    });

    it.skipIf(backend !== "bun:sqlite")("race: two native handles in one process cannot claim the same destination twice", async () => {
      await destination();
      ok(await enqueue());
      ok(await enqueue());
      const firstResolver = await bind(adapter, true);
      const firstApi = api;
      const second = await openAdapter();
      const secondResolver = await bind(second, true);
      expect(second).not.toBe(adapter);
      expect(second.raw).not.toBe(adapter.raw);
      expect(api).not.toBe(firstApi);
      const firstQueries = vi.spyOn(adapter, "all");
      const secondQueries = vi.spyOn(second, "all");
      const results = await Promise.all([
        firstApi.claimNextWebhookDelivery({ now: NOW }),
        api.claimNextWebhookDelivery({ now: NOW }),
      ]);
      for (const [resolver, queries, handle] of [
        [firstResolver, firstQueries, adapter], [secondResolver, secondQueries, second],
      ]) {
        expect(resolver).toHaveBeenCalledTimes(1);
        await expect(resolver.mock.results[0].value).resolves.toBe(handle);
        expect(queries.mock.calls.length).toBeGreaterThan(0);
        expect(queries.mock.contexts.every((context) => context === handle)).toBe(true);
      }
      expect(firstQueries.mock.results[0].value).toHaveLength(2);
      expect(secondQueries.mock.results[0].value).toEqual([]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(rows().filter((item) => item.status === "inflight")).toHaveLength(1);
      expect(rows().filter((item) => item.status === "pending")).toHaveLength(1);
    });

    it("recovers an expired lease after restart with a fresh token and rejects the old completion", async () => {
      await destination();
      ok(await enqueue());
      const old = await claim();
      await restart();
      expect(await claim(NOW + 29_999)).toBeNull();
      const recovered = await claim(NOW + 30_000);
      expect(recovered).toMatchObject({ id: old.id, attempts: 2, generation: old.generation });
      expect(recovered.leaseToken).not.toBe(old.leaseToken);
      expect(await finish(old, undefined, NOW + 30_000)).toMatchObject({ ok: true, applied: false });
      expect(row(old.id).status).toBe("inflight");
      expect(await finish(recovered, undefined, NOW + 30_000)).toMatchObject({ ok: true, applied: true });
    });

    it("recovers acknowledged pending work from disk before any debounce or clean shutdown", async () => {
      await destination();
      const queued = ok(await enqueue()).deliveryIds[0];
      expect(diskRows()[0]).toMatchObject({ id: queued, status: "pending" });
      await restart();
      expect(await claim()).toMatchObject({ id: queued, attempts: 1 });
    });

    it("only resolves credentials for the current live lease, never a forged or completed handle", async () => {
      const target = await destination();
      ok(await enqueue());
      const leased = await claim();
      expect(await api.getWebhookDeliveryDestination(leased, { now: NOW })).toMatchObject({
        id: target.id, revision: 1, signingSecret: "fixture-signing-secret",
        headers: { Authorization: "Bearer fixture-header-secret" },
      });
      for (const forged of [
        { ...leased, leaseToken: "forged" },
        { ...leased, destinationRevision: 2 },
        { ...leased, generation: leased.generation + 1 },
      ]) expect(await api.getWebhookDeliveryDestination(forged, { now: NOW })).toBeNull();
      ok(await finish(leased));
      expect(await api.getWebhookDeliveryDestination(leased, { now: NOW })).toBeNull();
    });

    it("rejects completion with wrong token, revision, generation or elapsed lease", async () => {
      await destination();
      ok(await enqueue());
      const leased = await claim();
      for (const stale of [
        { ...leased, leaseToken: "wrong-token" },
        { ...leased, destinationRevision: leased.destinationRevision + 1 },
        { ...leased, generation: leased.generation + 1 },
      ]) expect(await finish(stale)).toMatchObject({ ok: true, applied: false });
      expect(await finish(leased, undefined, NOW + 30_000)).toMatchObject({ ok: true, applied: false });
      expect(row(leased.id)).toMatchObject({ status: "inflight", leaseToken: leased.leaseToken });
    });

    it("persists retry schedule and does not reclaim before nextAttemptAt", async () => {
      await destination();
      ok(await enqueue());
      const leased = await claim();
      ok(await finish(leased, { status: "retry", nextAttemptAt: iso(NOW + 5000), lastStatus: 429, lastErrorClass: "upstream_http" }));
      await restart();
      expect(row(leased.id)).toMatchObject({ status: "retry", attempts: 1, leaseToken: null, leaseUntil: null, nextAttemptAt: iso(NOW + 5000) });
      expect(await claim(NOW + 4999)).toBeNull();
      expect(await claim(NOW + 5000)).toMatchObject({ id: leased.id, attempts: 2 });
    });

    it("rejects invalid completion state without discarding the live lease", async () => {
      await destination();
      ok(await enqueue());
      const leased = await claim();
      const before = row(leased.id);
      for (const result of [
        { status: "pending" },
        { status: "retry", nextAttemptAt: "invalid-date" },
        { status: "failed", lastErrorClass: "fixture-private-upstream-body" },
      ]) {
        expect(await finish(leased, result)).toMatchObject({ ok: false });
        expect(row(leased.id)).toEqual(before);
      }
    });

    it("never grants a send lease for corrupted stored JSON", async () => {
      await destination();
      ok(await enqueue());
      const id = rows()[0].id;
      adapter.run("UPDATE webhookDeliveries SET payload = ? WHERE id = ?", ["{not-json", id]);
      adapter.flush();
      expect(await claim()).toBeNull();
      expect(row(id).status).toBe("failed");
    });

    it("expires a retry beyond item expiry rather than making it eligible earlier", async () => {
      await destination();
      ok(await enqueue());
      const leased = await claim();
      ok(await finish(leased, { status: "retry", nextAttemptAt: iso(NOW + DAY + 1), lastStatus: 429, lastErrorClass: "upstream_http" }));
      expect(row(leased.id).status).toBe("expired");
      expect(await claim(NOW + 1000)).toBeNull();
    });

    it("does not authorize a ninth send after eight failed attempts", async () => {
      await destination();
      ok(await enqueue());
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const now = NOW + (attempt - 1) * 1000;
        const leased = await claim(now);
        expect(leased.attempts).toBe(attempt);
        ok(await finish(leased, { status: "retry", nextAttemptAt: iso(now + 1000), lastStatus: 503, lastErrorClass: "upstream_http" }, now));
      }
      expect(rows()[0]).toMatchObject({ status: "failed", attempts: 8 });
      expect(await claim(NOW + 8000)).toBeNull();
    });

    it("does not reset the attempt budget when the eighth inflight lease expires", async () => {
      await destination();
      ok(await enqueue());
      adapter.run("UPDATE webhookDeliveries SET attempts = 7 WHERE id = ?", [rows()[0].id]);
      const leased = await claim();
      expect(leased.attempts).toBe(8);
      await restart();
      expect(await claim(NOW + 30_000)).toBeNull();
      expect(row(leased.id)).toMatchObject({ attempts: 8, status: "failed" });
    });

    it.each([
      { enabled: false }, { url: "https://hooks.example.net/new-secret" },
      { kind: "slack", clearHeaders: true }, { headers: { "X-Tenant": "new" } },
      { signingSecret: "replacement-secret" }, { allowPrivateNetwork: true },
    ])("cancels old pending, retry and inflight deliveries on revocation %j", async (patch) => {
      const target = await destination();
      for (let i = 0; i < 3; i += 1) ok(await enqueue());
      const leased = await claim();
      const pending = rows().filter((item) => item.id !== leased.id);
      adapter.run("UPDATE webhookDeliveries SET status = 'retry' WHERE id = ?", [pending[0].id]);
      ok(await destinations.updateWebhookDestination(target.id, patch, { expectedRevision: 1 }));
      expect(await api.getWebhookDeliveryDestination(leased, { now: NOW })).toBeNull();
      expect(await claim(NOW + 1000)).toBeNull();
      expect(rows().every((item) => item.status === "cancelled")).toBe(true);
      expect(await finish(leased)).toMatchObject({ ok: true, applied: false });
      expect(diskRows().every((item) => item.status === "cancelled")).toBe(true);
    });

    it("delete revokes both delivery kinds while retaining nonsecret historical status", async () => {
      const target = await destination();
      ok(await enqueue());
      ok(await api.enqueueWebhookTest(target.id, { now: NOW }));
      const leased = await claim();
      ok(await destinations.deleteWebhookDestination(target.id, { expectedRevision: 1 }));
      expect(await api.getWebhookDeliveryDestination(leased, { now: NOW })).toBeNull();
      expect(await finish(leased)).toMatchObject({ ok: true, applied: false });
      expect(await claim(NOW + 1000)).toBeNull();
      expect(rows()).toHaveLength(2);
      expect(rows().every((item) => item.status === "cancelled")).toBe(true);
      expect(JSON.stringify(rows())).not.toContain("fixture-signing-secret");
    });

    it("subscription and cooldown edits apply to new events without cancelling queued incidents", async () => {
      const target = await destination();
      const queued = ok(await enqueue()).deliveryIds[0];
      ok(await destinations.updateWebhookDestination(target.id, {
        events: ["account.unavailable"], cooldownSeconds: 300,
      }, { expectedRevision: 1 }));
      expect(ok(await enqueue()).deliveryIds).toEqual([]);
      const leased = await claim();
      expect(leased).toMatchObject({ id: queued, destinationRevision: 2 });
      expect(await api.getWebhookDeliveryDestination(leased, { now: NOW })).toMatchObject({ id: target.id, revision: 2 });
    });

    it("B1 persists explicit test for disabled destination but not operational fanout", async () => {
      const target = await destination({ enabled: false, events: ["account.unavailable"] });
      expect(ok(await enqueue()).deliveryIds).toEqual([]);
      const tested = ok(await api.enqueueWebhookTest(target.id, { now: NOW }));
      expect(tested.deliveryIds).toHaveLength(1);
      expect(rows()[0]).toMatchObject({ deliveryKind: "test", destinationRevision: 1 });
      expect(JSON.parse(rows()[0].payload)).toMatchObject({ schema_version: 1, type: "request.failed" });
      await restart();
      const leased = await claim();
      expect(leased).toMatchObject({ id: tested.deliveryIds[0], deliveryKind: "test" });
      expect(await api.getWebhookDeliveryDestination(leased, { now: NOW })).toMatchObject({ id: target.id, enabled: false });
      ok(await finish(leased));
    });

    it("B1 disable cancels previously queued tests but allows a new explicit test", async () => {
      const target = await destination();
      const old = ok(await api.enqueueWebhookTest(target.id, { now: NOW })).deliveryIds[0];
      ok(await destinations.updateWebhookDestination(target.id, { enabled: false }, { expectedRevision: 1 }));
      expect(row(old).status).toBe("cancelled");
      const fresh = ok(await api.enqueueWebhookTest(target.id, { now: NOW + 1000 }));
      const leased = await claim(NOW + 1000);
      expect(leased).toMatchObject({ id: fresh.deliveryIds[0], deliveryKind: "test", destinationRevision: 2 });
    });

    it("B1 test cannot bypass missing destination or stale revision", async () => {
      expect(await api.enqueueWebhookTest("missing", { now: NOW })).toMatchObject({ ok: false });
      expect(rows()).toEqual([]);
      const target = await destination({ enabled: false });
      ok(await api.enqueueWebhookTest(target.id, { now: NOW }));
      const leased = await claim();
      ok(await destinations.updateWebhookDestination(target.id, { url: "https://hooks.example.net/replaced" }, { expectedRevision: 1 }));
      expect(await api.getWebhookDeliveryDestination(leased, { now: NOW })).toBeNull();
      expect(await finish(leased)).toMatchObject({ ok: true, applied: false });
      expect(await claim(NOW + 1000)).toBeNull();
    });

    it("generation reset clears queue/cooldown durably and prevents stale test completion", async () => {
      const target = await destination({ cooldownSeconds: 300 });
      ok(await enqueue());
      ok(await enqueue(event(), NOW + 1000));
      ok(await api.enqueueWebhookTest(target.id, { now: NOW }));
      let old = await claim();
      if (old.deliveryKind === "operational") {
        ok(await finish(old));
        old = await claim(NOW + 1000);
      }
      expect(old.deliveryKind).toBe("test");
      const reset = ok(await api.resetWebhookOutbox({ now: NOW + 2000 }));
      expect(reset.generation).toBe(old.generation + 1);
      expect(rows()).toEqual([]);
      expect(diskRows("SELECT * FROM kv WHERE scope = 'webhookCooldown'")).toEqual([]);
      expect(diskRows("SELECT value FROM _meta WHERE key = 'webhookGeneration'")).toEqual([{ value: String(reset.generation) }]);
      expect(await api.getWebhookDeliveryDestination(old, { now: NOW + 2000 })).toBeNull();
      expect(await finish(old, undefined, NOW + 2000)).toMatchObject({ ok: true, applied: false });
      await restart();
      const next = ok(await enqueue(event(), NOW + 3000));
      expect(row(next.deliveryIds[0])).toMatchObject({ generation: reset.generation, suppressedCount: 0 });
    });

    it("rejects an otherwise matching test lease when persistent generation changes", async () => {
      const target = await destination({ enabled: false });
      ok(await api.enqueueWebhookTest(target.id, { now: NOW }));
      const leased = await claim();
      adapter.run("UPDATE _meta SET value = ? WHERE key = 'webhookGeneration'", [String(leased.generation + 1)]);
      adapter.flush();
      expect(await api.getWebhookDeliveryDestination(leased, { now: NOW })).toBeNull();
      expect(await finish(leased)).toMatchObject({ ok: true, applied: false });
      expect(await claim(NOW + 30_000)).toBeNull();
    });

    it("explicit cancellation revokes the lease without altering another destination", async () => {
      await destination();
      await destination();
      ok(await enqueue());
      const leased = await claim();
      ok(await api.cancelWebhookDeliveries(leased.destinationId, { now: NOW }));
      expect(row(leased.id).status).toBe("cancelled");
      expect(rows().find((item) => item.destinationId !== leased.destinationId).status).not.toBe("cancelled");
      expect(await finish(leased)).toMatchObject({ ok: true, applied: false });
      expect(await api.getWebhookDeliveryDestination(leased, { now: NOW })).toBeNull();
      expect(diskRows().find((item) => item.id === leased.id).status).toBe("cancelled");
    });

    it("safe status listing filters and bounds results without leaking credentials or lease authority", async () => {
      const target = await destination();
      await destination();
      ok(await enqueue());
      ok(await enqueue());
      await claim();
      const listed = await api.listWebhookDeliveries({ destinationId: target.id, limit: 1 });
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ destinationId: target.id, deliveryKind: "operational" });
      for (const forbidden of ["fixture-url-secret", "secret-path", "fixture-signing-secret", "fixture-header-secret", "leaseToken"]) {
        expect(JSON.stringify(listed)).not.toContain(forbidden);
      }
    });

    it.each(["enqueue", "suppression", "claim", "completion", "cancel", "reset", "prune"])("flush failure prevents durable acknowledgement for %s", async (operation) => {
      const target = await destination({ cooldownSeconds: operation === "suppression" ? 300 : 0 });
      ok(await enqueue());
      let leased;
      if (operation === "completion") leased = await claim();
      const baseline = diskRows();
      const saved = `${file}.committed`;
      if (backend === "sql.js") {
        fs.renameSync(file, saved);
        fs.mkdirSync(file);
      } else {
        vi.spyOn(adapter, "flush").mockImplementation(() => { throw Object.assign(new Error("fixture_flush_failure"), { code: "EIO" }); });
      }
      try {
        const operations = {
          enqueue: () => enqueue(event(), NOW + 1000),
          suppression: () => enqueue(event(), NOW + 1000),
          claim: () => claim(),
          completion: () => finish(leased),
          cancel: () => api.cancelWebhookDeliveries(target.id, { now: NOW }),
          reset: () => api.resetWebhookOutbox({ now: NOW }),
          prune: () => api.pruneWebhookDeliveries({ now: NOW + DAY }),
        };
        await expect(operations[operation]()).rejects.toMatchObject({ code: expect.stringMatching(/^(EISDIR|EPERM|EACCES|EIO)$/) });
        if (backend === "sql.js") expect(diskRows(undefined, saved)).toEqual(baseline);
      } finally {
        if (backend === "sql.js") {
          fs.rmdirSync(file);
          fs.renameSync(saved, file);
        }
        vi.restoreAllMocks();
      }
    });

    it("flushes only after transaction release, so immediate disk readers see committed state", async () => {
      await destination();
      const transaction = adapter.transaction.bind(adapter);
      const flush = adapter.flush.bind(adapter);
      let depth = 0;
      vi.spyOn(adapter, "transaction").mockImplementation((fn) => {
        depth += 1;
        try { return transaction(fn); } finally { depth -= 1; }
      });
      vi.spyOn(adapter, "flush").mockImplementation(() => {
        expect(depth).toBe(0);
        return flush();
      });
      const result = ok(await enqueue());
      expect(diskRows().map((item) => item.id)).toEqual(result.deliveryIds);
      const leased = await claim();
      expect(diskRows()[0].leaseToken).toBe(leased.leaseToken);
      ok(await finish(leased));
      expect(diskRows()[0].status).toBe("delivered");
    });

    it("migration from version 3 preserves destinations and settings while creating a usable outbox", async () => {
      const target = await destination();
      adapter.run("INSERT OR REPLACE INTO settings (id, data) VALUES (1, ?)", [JSON.stringify({ fixtureMarker: "preserved" })]);
      adapter.exec("DROP TABLE IF EXISTS webhookDeliveries");
      adapter.run("UPDATE _meta SET value = '3' WHERE key IN ('schemaVersion', 'backupSchemaVersion')");
      adapter.run("DELETE FROM _meta WHERE key = 'webhookGeneration'");
      adapter.flush();
      await restart();
      expect((await destinations.getWebhookDestinationById(target.id)).id).toBe(target.id);
      expect(JSON.parse(adapter.get("SELECT data FROM settings WHERE id = 1").data)).toEqual({ fixtureMarker: "preserved" });
      const { latestVersion } = await import("@/lib/db/migrations/index.js");
      expect(Number(adapter.get("SELECT value FROM _meta WHERE key = 'schemaVersion'").value)).toBe(latestVersion());
      expect(latestVersion()).toBeGreaterThanOrEqual(4);
      expect(ok(await enqueue()).deliveryIds).toHaveLength(1);
      expect(await claim()).toMatchObject({ destinationId: target.id, deliveryKind: "operational" });
    });

    it("public DB barrel can enqueue and list the resulting status without dispatcher SQL", async () => {
      const db = await import("@/lib/db/index.js");
      await destination();
      const result = ok(await db.enqueueWebhookEvent(event(), { now: NOW }));
      expect((await db.listWebhookDeliveries({ limit: 20 })).map((item) => item.id)).toEqual(result.deliveryIds);
    });
  });
}
