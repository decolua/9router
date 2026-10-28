// Task 13 RED only. Parent executes in the approved offline sandbox.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.parse("2026-10-18T10:00:00.000Z");
const originalDataDir = process.env.DATA_DIR;
const backends = ["sql.js", ...(process.versions.bun ? ["bun:sqlite"] : [])];
const signals = ["SIGINT", "SIGTERM", "beforeExit", "exit"];
const config = (overrides = {}) => Object.fromEntries(Object.entries({
  name: "Dummy destination",
  kind: "generic",
  url: "https://hooks.example.com/dummy-path?token=dummy-url-token",
  enabled: true,
  events: ["request.failed"],
  allowPrivateNetwork: false,
  cooldownSeconds: 300,
  signingSecret: "dummy-signing-secret",
  headers: { Authorization: "Bearer dummy-header-token" },
  ...overrides,
}).filter(([, value]) => value !== undefined));
const envelope = () => ({
  id: crypto.randomUUID(), type: "request.failed", schema_version: 1,
  occurred_at: new Date(NOW).toISOString(), severity: "error",
  data: { provider: "cx", model: "dummy-model", errorClass: "upstream_http", statusCode: 503 },
});
const ok = (result) => {
  expect(result).toMatchObject({ ok: true });
  return result;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

for (const backend of backends) {
  describe(`webhook backup restore (${backend})`, () => {
    let dir, file, adapter, factory, db, dispatcher, listeners;
    let clock, releases, work, defaultRequests, originalAppSingleton;
    const handles = [];

    async function open(filePath = file) {
      if (!factory) {
        const adapterModule = backend === "sql.js"
          ? await import("@/lib/db/adapters/sqljsAdapter.js")
          : await import("@/lib/db/adapters/bunSqliteAdapter.js");
        factory = adapterModule.createSqlJsAdapter || adapterModule.createBunSqliteAdapter;
      }
      const handle = await factory(filePath);
      handles.push(handle);
      return handle;
    }

    async function bind() {
      vi.resetModules();
      global._dbAdapter = { instance: adapter, initPromise: null, logged: true };
      const { runMigrationOnce } = await import("@/lib/db/migrate.js");
      await runMigrationOnce(adapter);
      db = await import("@/lib/db/index.js");
      dispatcher = await import("@/lib/webhooks/dispatcher.js");
    }

    const generation = () => Number(adapter.get("SELECT value FROM _meta WHERE key = 'webhookGeneration'").value);
    const queue = () => adapter.all("SELECT * FROM webhookDeliveries ORDER BY id");
    const cooldown = () => adapter.all("SELECT * FROM kv WHERE scope = 'webhookCooldown' ORDER BY key");
    function wholeDb() {
      return Object.fromEntries(adapter.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map(({ name }) => [name, adapter.all(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
    }

    async function seed() {
      const destination = ok(await db.createWebhookDestination(config())).destination;
      await db.updateSettings({ requireLogin: false, dummyRestoreMarker: "original" });
      await db.setModelAlias("dummy-alias", "cx/original");
      const event = envelope();
      const queued = ok(await db.enqueueWebhookEvent(event, { now: NOW }));
      expect(queued.deliveryIds).toHaveLength(1);
      expect(cooldown().length).toBeGreaterThan(0);
      adapter.flush();
      return { destination, event, deliveryId: queued.deliveryIds[0] };
    }

    async function replacement(destination) {
      return {
        ...await db.exportDb(),
        settings: { requireLogin: false, dummyRestoreMarker: "restored" },
        modelAliases: { "dummy-alias": "cx/restored" },
        webhooks: [{
          ...await db.getWebhookDestinationRawById(destination.id),
          name: "Restored dummy", url: "https://hooks.example.com/restored-dummy",
          signingSecret: "restored-dummy-secret", headers: { "X-Dummy": "restored-header" },
        }],
      };
    }

    function start(send = async () => ({ status: 204, headers: {} })) {
      return dispatcher.startWebhookDispatcher({ now: () => clock, send, random: () => 0.5 });
    }

    beforeEach(async () => {
      vi.resetModules();
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-webhook-backup-"));
      file = path.join(dir, "data.sqlite");
      process.env.DATA_DIR = dir;
      listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
      originalAppSingleton = global.__appSingleton;
      clock = NOW;
      releases = [];
      work = [];
      defaultRequests = [];
      vi.doMock("@/lib/webhooks/transport.js", () => ({
        sendWebhook: async (request) => { defaultRequests.push(request); return { status: 204, headers: {} }; },
      }));
      factory = null;
      delete global._webhookDispatcher;
      adapter = await open();
      await bind();
      adapter.flush();
    });

    afterEach(async () => {
      dispatcher?.stopWebhookDispatcher();
      for (const release of releases) release();
      await Promise.allSettled(work);
      vi.restoreAllMocks();
      vi.useRealTimers();
      for (const moduleName of ["@/lib/webhooks/transport.js", "@/lib/localDb", "@/lib/tunnel", "@/mitm/manager",
        "@/lib/mitmAliasCache", "@/lib/mcp/stdioSseBridge", "@/sse/services/backgroundTokenRefresh.js",
        "@/lib/appUpdater", "next/headers"]) vi.doUnmock(moduleName);
      for (const handle of handles.splice(0)) { try { handle.close(); } catch { /* already closed */ } }
      for (const [signal, before] of listeners) {
        for (const listener of process.listeners(signal)) {
          if (!before.has(listener)) process.removeListener(signal, listener);
        }
      }
      delete global._dbAdapter;
      delete global._webhookDispatcher;
      if (originalAppSingleton === undefined) delete global.__appSingleton;
      else global.__appSingleton = originalAppSingleton;
      fs.rmSync(dir, { recursive: true, force: true });
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
    });

    it("exports complete dummy credentials but never delivery or cooldown state", async () => {
      const { destination, deliveryId, event } = await seed();
      const exported = await db.exportDb();
      expect(exported.webhooks).toEqual([await db.getWebhookDestinationRawById(destination.id)]);
      expect(exported.webhooks[0]).toMatchObject(config());
      for (const key of ["webhookDeliveries", "deliveries", "webhookCooldown", "cooldown", "webhookGeneration"]) {
        expect(exported).not.toHaveProperty(key);
      }
      const text = JSON.stringify(exported);
      expect(text).not.toContain(deliveryId);
      expect(text).not.toContain(event.id);
      expect(text).not.toContain("suppressedCount");
      expect(text).not.toContain("leaseToken");
    });

    it("restores all three destination kinds including disabled credentials without replay", async () => {
      const { destination } = await seed();
      ok(await db.createWebhookDestination(config({ name: "Discord dummy", kind: "discord", headers: undefined })));
      ok(await db.createWebhookDestination(config({ name: "Slack dummy", kind: "slack", headers: undefined, enabled: false })));
      const originals = await db.exportWebhookDestinationsRaw();
      const payload = { ...await db.exportDb(), webhooks: originals };
      const beforeGeneration = generation();
      await db.deleteWebhookDestination(destination.id);
      await db.importDb(payload);
      expect(await db.exportWebhookDestinationsRaw()).toEqual(originals);
      expect(generation()).toBe(beforeGeneration + 1);
      expect(queue()).toEqual([]);
      expect(cooldown()).toEqual([]);
      const sends = [];
      const controller = start(async (request) => { sends.push(request); return { status: 204, headers: {} }; });
      await controller.tick();
      expect(sends).toEqual([]);
    });

    it.each(["absent", "empty"])("restores legacy/empty webhooks (%s) by clearing destination config and queue", async (mode) => {
      await seed();
      const payload = { ...await db.exportDb() };
      if (mode === "absent") delete payload.webhooks;
      else payload.webhooks = [];
      const beforeGeneration = generation();
      await db.importDb(payload);
      expect(await db.listWebhookDestinations()).toEqual([]);
      expect(queue()).toEqual([]);
      expect(cooldown()).toEqual([]);
      expect(generation()).toBe(beforeGeneration + 1);
    });

    it.each([
      ["null", () => null],
      ["object", () => ({})],
      ["bad later destination", (raw) => [raw, { ...raw, id: crypto.randomUUID(), url: "file:///dummy" }]],
      ["duplicate ids", (raw) => [raw, { ...raw }]],
      ["capacity overflow", (raw) => Array.from({ length: 21 }, () => ({ ...raw, id: crypto.randomUUID() }))],
      ["internal delivery kind", (raw) => [{ ...raw, deliveryKind: "test" }]],
    ])("rejects malformed restore %s before any database mutation", async (_name, malformed) => {
      const { destination } = await seed();
      const payload = await replacement(destination);
      payload.webhooks = malformed(payload.webhooks[0]);
      const before = wholeDb();
      const run = vi.spyOn(adapter, "run");
      const exec = vi.spyOn(adapter, "exec");
      const flush = vi.spyOn(adapter, "flush");
      await expect(db.importDb(payload)).rejects.toThrow();
      expect(wholeDb()).toEqual(before);
      expect(run).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalled();
      expect(flush).not.toHaveBeenCalled();
    });

    it("validates a malformed non-webhook section before resetting any valid webhook state", async () => {
      const { destination } = await seed();
      const payload = await replacement(destination);
      payload.apiKeys = [{ id: "dummy-invalid-key", key: "dummy-key", access: { mode: "invalid" } }];
      const before = wholeDb();
      const run = vi.spyOn(adapter, "run");
      await expect(db.importDb(payload)).rejects.toThrow();
      expect(wholeDb()).toEqual(before);
      expect(run).not.toHaveBeenCalled();
    });

    it("restores generation, queue reset and config in one synchronous transaction with one postcommit flush", async () => {
      const { destination } = await seed();
      const payload = await replacement(destination);
      const beforeGeneration = generation();
      const controller = start();
      const transaction = adapter.transaction.bind(adapter);
      const flush = adapter.flush.bind(adapter);
      let depth = 0;
      let snapshots = 0;
      let flushes = 0;
      vi.spyOn(adapter, "transaction").mockImplementation((callback) => transaction(() => {
        depth += 1;
        try {
          expect(controller.isPaused()).toBe(true);
          const result = callback();
          expect(result?.then).toBeUndefined();
          if (generation() === beforeGeneration + 1) {
            snapshots += 1;
            expect(depth).toBe(1);
            expect(queue()).toEqual([]);
            expect(cooldown()).toEqual([]);
            const row = adapter.get("SELECT * FROM webhookDestinations WHERE id = ?", [destination.id]);
            expect(JSON.parse(row.data)).toMatchObject({ name: "Restored dummy", signingSecret: "restored-dummy-secret" });
            expect(JSON.parse(adapter.get("SELECT data FROM settings WHERE id = 1").data).dummyRestoreMarker).toBe("restored");
          }
          return result;
        } finally { depth -= 1; }
      }));
      vi.spyOn(adapter, "flush").mockImplementation(() => {
        expect(depth).toBe(0);
        expect(snapshots).toBe(1);
        flushes += 1;
        return flush();
      });
      await db.importDb(payload);
      expect(snapshots).toBe(1);
      expect(flushes).toBe(1);
      expect(controller.isPaused()).toBe(false);
    });

    it("rolls back the whole database when destination insertion fails after destructive reset", async () => {
      const { destination } = await seed();
      const payload = await replacement(destination);
      adapter.exec(`CREATE TRIGGER dummy_restore_failure BEFORE INSERT ON webhookDestinations
        BEGIN SELECT RAISE(ABORT, 'dummy restore insertion failure'); END`);
      adapter.flush();
      const before = wholeDb();
      const flush = vi.spyOn(adapter, "flush");
      await expect(db.importDb(payload)).rejects.toThrow("dummy restore insertion failure");
      expect(wholeDb()).toEqual(before);
      expect(flush).not.toHaveBeenCalled();
    });

    it("persists restore before acknowledgement without relying on adapter close", async () => {
      const { destination } = await seed();
      const payload = await replacement(destination);
      const beforeGeneration = generation();
      await db.importDb(payload);
      const persisted = await open(file);
      expect(Number(persisted.get("SELECT value FROM _meta WHERE key = 'webhookGeneration'").value)).toBe(beforeGeneration + 1);
      expect(persisted.all("SELECT * FROM webhookDeliveries")).toEqual([]);
      expect(persisted.all("SELECT * FROM kv WHERE scope = 'webhookCooldown'")).toEqual([]);
      expect(JSON.parse(persisted.get("SELECT data FROM webhookDestinations WHERE id = ?", [destination.id]).data))
        .toMatchObject({ name: "Restored dummy", signingSecret: "restored-dummy-secret" });
    });

    it("does not acknowledge restore when the postcommit persistence flush fails", async () => {
      const { destination } = await seed();
      const payload = await replacement(destination);
      const failure = Object.assign(new Error("dummy persistence failure"), { code: "EIO" });
      vi.spyOn(adapter, "flush").mockImplementation(() => { throw failure; });
      await expect(db.importDb(payload)).rejects.toBe(failure);
    });

    it("race: aborts in-flight work on restore and rejects late success from the old generation", async () => {
      const { destination, deliveryId } = await seed();
      const payload = await replacement(destination);
      const arrived = deferred();
      const reply = deferred();
      const journal = [];
      let signal;
      releases.push(() => reply.resolve({ status: 204, headers: {} }));
      const controller = start((request) => {
        journal.push(request.body);
        signal = request.signal;
        arrived.resolve();
        return reply.promise;
      });
      const tick = controller.tick();
      work.push(tick);
      await arrived.promise;
      const lease = adapter.get("SELECT * FROM webhookDeliveries WHERE id = ?", [deliveryId]);
      expect(lease.status).toBe("inflight");
      const completed = [];
      const realComplete = (await import("@/lib/db/repos/webhookDeliveriesRepo.js")).completeWebhookDelivery;
      const beforeGeneration = generation();
      await db.importDb(payload);
      expect(signal.aborted).toBe(true);
      expect(generation()).toBe(beforeGeneration + 1);
      expect(queue()).toEqual([]);
      completed.push(await realComplete(lease, { status: "delivered", lastStatus: 204 }, { now: NOW + 1 }));
      expect(completed).toEqual([{ ok: true, applied: false }]);
      reply.resolve({ status: 204, headers: {} });
      expect(await tick).toMatchObject({ applied: 0 });
      const resumed = dispatcher.getWebhookDispatcher();
      expect(resumed?.isRunning()).toBe(true);
      expect(resumed.isPaused()).toBe(false);
      await resumed.tick();
      expect(journal).toHaveLength(1);
      expect(queue()).toEqual([]);
      const fresh = ok(await db.enqueueWebhookEvent(envelope(), { now: NOW }));
      expect(fresh.deliveryIds).toHaveLength(1);
    });

    it("race: a transaction failure resumes the existing dispatcher without losing queued work", async () => {
      const { destination, deliveryId } = await seed();
      const payload = await replacement(destination);
      adapter.exec(`CREATE TRIGGER dummy_restore_failure BEFORE INSERT ON webhookDestinations
        BEGIN SELECT RAISE(ABORT, 'dummy restore insertion failure'); END`);
      adapter.flush();
      const before = wholeDb();
      const sends = [];
      start(async (request) => { sends.push(request.body); return { status: 204, headers: {} }; });
      await expect(db.importDb(payload)).rejects.toThrow("dummy restore insertion failure");
      expect(wholeDb()).toEqual(before);
      const resumed = dispatcher.getWebhookDispatcher();
      expect(resumed?.isRunning()).toBe(true);
      expect(resumed.isPaused()).toBe(false);
      await resumed.tick();
      expect(sends).toHaveLength(1);
      expect(adapter.get("SELECT status FROM webhookDeliveries WHERE id = ?", [deliveryId]).status).toBe("delivered");
    });

    it("normal restart keeps the durable queue and generation and resumes the pending delivery", async () => {
      const { deliveryId } = await seed();
      const beforeGeneration = generation();
      start();
      dispatcher.stopWebhookDispatcher();
      adapter.close();
      handles.splice(handles.indexOf(adapter), 1);
      adapter = await open();
      await bind();
      expect(generation()).toBe(beforeGeneration);
      expect(queue()).toHaveLength(1);
      const sends = [];
      await start(async (request) => { sends.push(request.body); return { status: 204, headers: {} }; }).tick();
      expect(sends).toHaveLength(1);
      expect(adapter.get("SELECT status FROM webhookDeliveries WHERE id = ?", [deliveryId]).status).toBe("delivered");
    });

    it("stop returns without draining a stuck send and leaves the lease recoverable after restart", async () => {
      const { deliveryId } = await seed();
      const arrived = deferred();
      const reply = deferred();
      let signal;
      releases.push(() => reply.resolve({ status: 204, headers: {} }));
      const controller = start((request) => { signal = request.signal; arrived.resolve(); return reply.promise; });
      const tick = controller.tick();
      work.push(tick);
      await arrived.promise;
      expect(dispatcher.stopWebhookDispatcher()).toBe(true);
      expect(signal.aborted).toBe(true);
      expect(controller.isRunning()).toBe(false);
      expect(adapter.get("SELECT status FROM webhookDeliveries WHERE id = ?", [deliveryId]).status).toBe("inflight");
      clock += 30_001;
      expect(await start().tick()).toMatchObject({ delivered: 1, applied: 1 });
      reply.resolve({ status: 204, headers: {} });
      expect(await tick).toMatchObject({ applied: 0 });
      expect(adapter.get("SELECT attempts FROM webhookDeliveries WHERE id = ?", [deliveryId]).attempts).toBe(2);
    });

    if (backend === "bun:sqlite") {
      it("automatic backupDbLite preserves credentials and unrelated kv but excludes deliveries and cooldown", async () => {
        const { destination } = await seed();
        const before = wholeDb();
        const backupDir = path.join(dir, "backup");
        fs.mkdirSync(backupDir);
        const { backupDbLite } = await import("@/lib/db/backup.js");
        const saved = await open(backupDbLite(adapter, backupDir));
        expect(saved.all("SELECT * FROM webhookDestinations")).toEqual(before.webhookDestinations);
        expect(saved.all("SELECT * FROM settings")).toEqual(before.settings);
        expect(saved.get("SELECT value FROM kv WHERE scope = 'modelAliases' AND key = 'dummy-alias'").value).toBe('"cx/original"');
        expect(saved.all("SELECT * FROM kv WHERE scope = 'webhookCooldown'")).toEqual([]);
        const deliveryTable = saved.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'webhookDeliveries'");
        if (deliveryTable) expect(saved.all("SELECT * FROM webhookDeliveries")).toEqual([]);
        expect(saved.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'requestDetails'") == null).toBe(true);
        expect(JSON.parse(saved.get("SELECT data FROM webhookDestinations WHERE id = ?", [destination.id]).data))
          .toMatchObject({ signingSecret: "dummy-signing-secret", headers: { Authorization: "Bearer dummy-header-token" } });
        expect(wholeDb()).toEqual(before);
      });
    }

    async function loadBootstrap() {
      vi.doMock("@/lib/localDb", () => ({
        cleanupProviderConnections: async () => {}, getSettings: db.getSettings,
        updateSettings: db.updateSettings, getApiKeys: async () => [],
      }));
      vi.doMock("@/lib/tunnel", () => ({
        enableTunnel: vi.fn(), enableTailscale: vi.fn(), isTunnelManuallyDisabled: () => false,
        isTunnelReconnecting: () => false, isTailscaleReconnecting: () => false,
        getTunnelService: vi.fn(), getTailscaleService: vi.fn(), setTunnelUnexpectedExitCallback: vi.fn(),
        killCloudflared: vi.fn(), isCloudflaredRunning: () => false, ensureCloudflared: vi.fn(),
        isTailscaleRunning: () => false, isTailscaleRunningStrict: () => false,
        isDaemonAlive: () => false, startFunnel: vi.fn(), checkInternet: async () => false,
        RESTART_COOLDOWN_MS: 60_000, NETWORK_SETTLE_MS: 1000,
        WATCHDOG_INTERVAL_MS: 60_000, NETWORK_CHECK_INTERVAL_MS: 60_000, VIRTUAL_IFACE_REGEX: /^dummy$/,
      }));
      vi.doMock("@/mitm/manager", () => ({
        getMitmStatus: vi.fn(), startMitm: vi.fn(), loadEncryptedPassword: vi.fn(), initDbHooks: vi.fn(),
        restoreToolDNS: vi.fn(), removeAllDNSEntriesSync: vi.fn(),
      }));
      vi.doMock("@/lib/mitmAliasCache", () => ({ syncToJson: vi.fn() }));
      vi.doMock("@/lib/mcp/stdioSseBridge", () => ({ killAllBridges: vi.fn() }));
      vi.doMock("@/sse/services/backgroundTokenRefresh.js", () => ({ startBackgroundTokenRefresh: vi.fn() }));
      delete global.__appSingleton;
      return import("@/shared/services/initializeApp.js");
    }

    it("startup is idempotent across repeated initialization and HMR and dispatches the existing queue", async () => {
      const { deliveryId } = await seed();
      const beforeGeneration = generation();
      const { initializeApp } = await loadBootstrap();
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      await initializeApp();
      await initializeApp();
      await vi.advanceTimersByTimeAsync(4000);
      const controller = dispatcher.getWebhookDispatcher();
      expect(controller?.isRunning()).toBe(true);
      expect(defaultRequests).toHaveLength(1);
      expect(adapter.get("SELECT status FROM webhookDeliveries WHERE id = ?", [deliveryId]).status).toBe("delivered");
      expect(generation()).toBe(beforeGeneration);
      const timers = vi.getTimerCount();
      vi.resetModules();
      const reloaded = await import("@/shared/services/initializeApp.js");
      await reloaded.initializeApp();
      await vi.advanceTimersByTimeAsync(4000);
      expect(dispatcher.getWebhookDispatcher()).toBe(controller);
      expect(vi.getTimerCount()).toBe(timers);
      expect(defaultRequests).toHaveLength(1);
    });

    it.each(["SIGINT", "SIGTERM"])("startup %s cleanup aborts webhook work before process exit", async (signalName) => {
      await seed();
      const arrived = deferred();
      let sendSignal;
      const controller = start((request) => new Promise((_resolve, reject) => {
        sendSignal = request.signal;
        sendSignal.addEventListener("abort", () => reject(Object.assign(new Error("dummy abort"), { code: "WEBHOOK_ABORTED" })), { once: true });
        arrived.resolve();
      }));
      work.push(controller.tick());
      await arrived.promise;
      const { initializeApp } = await loadBootstrap();
      const registered = new Map();
      const originalOn = process.on.bind(process);
      vi.spyOn(process, "on").mockImplementation((name, callback) => {
        if (signals.includes(name)) { registered.set(name, callback); return process; }
        return originalOn(name, callback);
      });
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      await initializeApp();
      await vi.advanceTimersByTimeAsync(3000);
      expect(dispatcher.getWebhookDispatcher()).toBe(controller);
      expect(controller.isRunning()).toBe(true);
      const snapshots = [];
      vi.spyOn(process, "exit").mockImplementation(() => {
        snapshots.push({ running: controller.isRunning(), rows: queue().length });
      });
      expect(registered.get(signalName)).toBeTypeOf("function");
      await registered.get(signalName)();
      await vi.advanceTimersByTimeAsync(1000);
      expect(snapshots).toEqual([{ running: false, rows: 1 }]);
      expect(sendSignal.aborted).toBe(true);
      expect(defaultRequests).toEqual([]);
    });

    it.each(["shutdown", "version/shutdown"])("explicit %s stops webhook work before its bounded exit timer", async (route) => {
      await seed();
      const controller = start();
      const oldNodeEnv = process.env.NODE_ENV;
      const oldSecret = process.env.SHUTDOWN_SECRET;
      process.env.NODE_ENV = "test";
      process.env.SHUTDOWN_SECRET = "dummy-shutdown-secret";
      vi.doMock("next/headers", () => ({
        headers: () => new Headers({ authorization: "Bearer dummy-shutdown-secret" }),
      }));
      vi.doMock("@/lib/appUpdater", () => ({ killAppProcesses: async () => {} }));
      const exitStates = [];
      vi.spyOn(process, "exit").mockImplementation(() => {
        exitStates.push({ running: controller.isRunning(), rows: queue().length });
      });
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      try {
        const routeModule = route === "shutdown"
          ? await import("@/app/api/shutdown/route.js")
          : await import("@/app/api/version/shutdown/route.js");
        const response = await routeModule.POST();
        expect(response.status).toBe(200);
        await vi.advanceTimersByTimeAsync(1000);
        expect(exitStates).toEqual([{ running: false, rows: 1 }]);
      } finally {
        if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = oldNodeEnv;
        if (oldSecret === undefined) delete process.env.SHUTDOWN_SECRET;
        else process.env.SHUTDOWN_SECRET = oldSecret;
      }
    });
  });
}
