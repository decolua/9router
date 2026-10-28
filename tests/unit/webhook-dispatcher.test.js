/**
 * Task 8 RED contract: bounded durable dispatcher.
 *
 * These tests intentionally import a module that does not exist yet:
 *   src/lib/webhooks/dispatcher.js
 *
 * Locked minimal API (documented here for GREEN):
 *
 *   // HMR-safe singleton (state on global._webhookDispatcher):
 *   startWebhookDispatcher(options?) -> controller   // idempotent; one timer
 *   stopWebhookDispatcher() -> boolean               // clears timer, aborts in-flight
 *   pauseWebhookDispatcher() -> boolean
 *   resumeWebhookDispatcher() -> boolean
 *   getWebhookDispatcher() -> controller | null
 *
 *   // Isolated controller (tests / embedding):
 *   createWebhookDispatcher(options?) -> controller
 *     options = {
 *       intervalMs = 1000,
 *       now = () => Date.now(),      // epoch ms, fully injectable
 *       random = () => Math.random(),// full-jitter source in [0, 1)
 *       send = sendWebhook,          // src/lib/webhooks/transport.js
 *       logger? = console,           // local diagnostics only, never an alert
 *     }
 *     controller = {
 *       start() -> boolean,          // true only for the first call
 *       stop() -> boolean,           // clears timer + aborts in-flight (recoverable)
 *       pause() -> boolean,
 *       resume() -> boolean,
 *       isRunning() -> boolean,
 *       isPaused() -> boolean,
 *       inflightCount() -> number,
 *       tick() -> Promise<{ busy?, paused?, claimed, delivered, retried, failed, applied }>,
 *     }
 *
 *   // One already-claimed lease (repos do the lease/generation checks):
 *   deliverWebhookLease(lease, { now?, random?, send?, signal? } = {})
 *     -> Promise<{ sent, applied, outcome?, reason? }>
 *
 *   // Pure policy helpers:
 *   retryDelayMs(attempt, random) -> number   // full jitter, capped at 3600s
 *   buildDestinationRequest(destination, event, now, signal?)
 *     -> { url, body, headers, allowPrivateNetwork, acknowledgementKind?, signal? }
 *
 * Ownership split (do not duplicate):
 *   - webhookDeliveriesRepo owns claim/completion/lease/generation/revocation.
 *   - dispatcher owns timer/lifecycle, adapter+transport request building,
 *     response classification, retry timing (Retry-After + jitter), and the
 *     events.js sink -> enqueueWebhookEvent wiring.
 *
 * Honest acknowledgement: events.js `emitted:true` only means "handed to the
 * synchronous sink". The sink starts an async enqueue and must never resolve a
 * durability claim into the request path; enqueue failure is local-only and
 * MUST NOT create a recursive delivery-failed webhook.
 *
 * No real network: transport is always injected. No sleeps: the injected clock
 * drives due/retry/lease math. Fake timers are used only for lifecycle cases.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.parse("2026-10-18T10:00:00.000Z");
const iso = (time) => new Date(time).toISOString();
const backends = ["sql.js", ...(process.versions.bun ? ["bun:sqlite"] : [])];
const originalDataDir = process.env.DATA_DIR;

const ok = (result) => {
  expect(result).toMatchObject({ ok: true });
  return result;
};

const requestFailed = (overrides = {}) => ({
  id: crypto.randomUUID(),
  type: "request.failed",
  schema_version: 1,
  occurred_at: iso(NOW),
  severity: "error",
  data: {
    requestId: crypto.randomUUID(),
    provider: "cx",
    model: "fixture-model",
    errorClass: "upstream_http",
    statusCode: 503,
  },
  ...overrides,
});

// Generic destinations deliver on any 2xx; Discord/Slack need an explicit ack.
const ackAwareSend = vi.fn(async (request) => (request.acknowledgementKind
  ? { status: 200, headers: {}, acknowledged: true }
  : { status: 204, headers: {} }));

const header = (request, name) => {
  const target = name.toLowerCase();
  const key = Object.keys(request.headers).find((candidate) => candidate.toLowerCase() === target);
  return key === undefined ? undefined : request.headers[key];
};

for (const backend of backends) {
  describe(`webhook dispatcher (${backend})`, () => {
    let dir;
    let file;
    let adapter;
    let factory;
    let destinations;
    let outbox;
    let events;
    let dispatcher;
    let clockNow;
    let controllers;
    let listeners;

    const handles = [];

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

    async function bind() {
      vi.resetModules();
      global._dbAdapter = { instance: adapter, initPromise: null, logged: true };
      const { runMigrationOnce } = await import("@/lib/db/migrate.js");
      await runMigrationOnce(adapter);
      destinations = await import("@/lib/db/repos/webhooksRepo.js");
      outbox = await import("@/lib/db/repos/webhookDeliveriesRepo.js");
      events = await import("@/lib/webhooks/events.js");
      dispatcher = await import("@/lib/webhooks/dispatcher.js");
    }

    const now = () => clockNow;

    function controllerWith(overrides = {}) {
      const controller = dispatcher.createWebhookDispatcher({
        intervalMs: 1000,
        now,
        random: () => 0.5,
        send: ackAwareSend,
        logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
        ...overrides,
      });
      controllers.push(controller);
      return controller;
    }

    async function destination(overrides = {}) {
      const input = {
        name: "Fixture destination",
        kind: "generic",
        url: "https://hooks.example.com/secret-path?token=fixture-url-secret",
        signingSecret: "fixture-signing-secret",
        headers: { Authorization: "Bearer fixture-header-secret" },
        cooldownSeconds: 0,
        ...overrides,
      };
      for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
      const created = ok(await destinations.createWebhookDestination(input)).destination;
      // create() intentionally does not flush; make the row stable before timers.
      adapter.flush();
      return created;
    }

    const rows = () => adapter.all("SELECT * FROM webhookDeliveries ORDER BY createdAt, id");
    const row = (id) => adapter.get("SELECT * FROM webhookDeliveries WHERE id = ?", [id]);
    const enqueue = (value = requestFailed(), at = NOW) => outbox.enqueueWebhookEvent(value, { now: at });
    const claim = (at = NOW) => outbox.claimNextWebhookDelivery({ now: at });
    const tick = async (at = clockNow, controller = null) => {
      clockNow = at;
      return (controller || controllerWith()).tick();
    };

    const settle = () => new Promise((resolve) => setImmediate(resolve));

    // Capacity fixture: only the enqueue path that returns outbox_full is
    // exercised, so sink failure handling stays faithful to production.
    async function seed(count) {
      const template = rows()[0];
      const keys = Object.keys(template);
      adapter.transaction(() => {
        for (let i = 0; i < count; i += 1) {
          const eventId = crypto.randomUUID();
          const values = {
            ...template,
            id: crypto.randomUUID(),
            eventId,
            payload: JSON.stringify({ ...JSON.parse(template.payload), id: eventId }),
          };
          adapter.run(
            `INSERT INTO webhookDeliveries (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
            keys.map((key) => values[key]),
          );
        }
      });
      adapter.flush();
    }

    beforeEach(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-webhook-dispatcher-"));
      process.env.DATA_DIR = dir;
      fs.mkdirSync(path.join(dir, "db"));
      file = path.join(dir, "db", "data.sqlite");
      listeners = Object.fromEntries(
        ["beforeExit", "SIGINT", "SIGTERM"].map((name) => [name, process.listeners(name)]),
      );
      factory = null;
      adapter = await openAdapter();
      await bind();
      adapter.flush();
      clockNow = NOW;
      controllers = [];
      delete global._webhookDispatcher;
      ackAwareSend.mockClear();
    });

    afterEach(() => {
      for (const controller of controllers.splice(0)) {
        try { controller.stop(); } catch { /* stop is best-effort */ }
      }
      events?.setWebhookSink(null);
      vi.useRealTimers();
      vi.restoreAllMocks();
      delete global._webhookDispatcher;
      for (const handle of handles.splice(0).reverse()) handle.close();
      for (const [name, previous] of Object.entries(listeners || {})) {
        for (const listener of process.listeners(name)) {
          if (!previous.includes(listener)) process.removeListener(name, listener);
        }
      }
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
    });

    describe("webhook dispatcher: delivery happy path", () => {
      it("delivery claims a due row, builds the adapter request from the persisted envelope, and completes delivered", async () => {
        const target = await destination();
        const value = requestFailed();
        const queued = ok(await enqueue(value)).deliveryIds[0];
        const controller = controllerWith();

        const result = await tick(NOW, controller);

        expect(result).toMatchObject({ claimed: 1, delivered: 1, applied: 1 });
        expect(ackAwareSend).toHaveBeenCalledTimes(1);
        const request = ackAwareSend.mock.calls[0][0];
        expect(request.url).toBe("https://hooks.example.com/secret-path?token=fixture-url-secret");
        expect(request.allowPrivateNetwork).toBe(false);
        expect(request.acknowledgementKind).toBeUndefined();
        expect(header(request, "content-type")).toBe("application/json");
        expect(header(request, "authorization")).toBe("Bearer fixture-header-secret");
        expect(header(request, "webhook-id")).toBe(value.id);
        expect(header(request, "webhook-timestamp")).toBe(String(Math.floor(NOW / 1000)));
        expect(header(request, "webhook-signature")).toMatch(/^v1,[A-Za-z0-9+/]+=*$/);
        const body = JSON.parse(request.body);
        expect(body).toMatchObject({ id: value.id, type: "request.failed", schema_version: 1 });
        expect(body.data).toMatchObject({ provider: "cx", model: "fixture-model", statusCode: 503 });
        expect(request.body).not.toContain("fixture-header-secret");
        expect(request.body).not.toContain("fixture-signing-secret");

        expect(row(queued)).toMatchObject({
          status: "delivered",
          attempts: 1,
          lastStatus: 204,
          destinationId: target.id,
          deliveryKind: "operational",
        });
      });

      it("delivery appends the Discord wait query and sends the ack-aware request", async () => {
        await destination({ kind: "discord", url: "https://discord.example.com/api/webhooks/1/token", headers: undefined, signingSecret: undefined });
        ok(await enqueue());
        const controller = controllerWith();

        await tick(NOW, controller);

        const request = ackAwareSend.mock.calls[0][0];
        expect(request.acknowledgementKind).toBe("discord");
        const url = new URL(request.url);
        expect(url.searchParams.get("wait")).toBe("true");
        const body = JSON.parse(request.body);
        expect(body.allowed_mentions).toEqual({ parse: [] });
        expect(body.content).toContain("[error] request.failed");
        expect(rows()[0]).toMatchObject({ status: "delivered", lastStatus: 200 });
      });

      it("delivery builds Slack text without signing headers", async () => {
        await destination({ kind: "slack", url: "https://hooks.slack.com/services/fixture", headers: undefined, signingSecret: undefined });
        ok(await enqueue());
        const controller = controllerWith();

        await tick(NOW, controller);

        const request = ackAwareSend.mock.calls[0][0];
        expect(request.acknowledgementKind).toBe("slack");
        expect(header(request, "webhook-signature")).toBeUndefined();
        expect(JSON.parse(request.body).text).toContain("[error] request.failed");
        expect(rows()[0]).toMatchObject({ status: "delivered", lastStatus: 200 });
      });

      it("delivery adds the suppressed-count note to Discord text only", async () => {
        await destination({
          kind: "discord", url: "https://discord.example.com/api/webhooks/1/token",
          headers: undefined, signingSecret: undefined,
        });
        ok(await enqueue());
        adapter.run("UPDATE webhookDeliveries SET suppressedCount = 3");
        adapter.flush();

        await tick(NOW, controllerWith());

        const body = JSON.parse(ackAwareSend.mock.calls[0][0].body);
        expect(body.embeds[0].description).toContain("3 earlier alerts suppressed by cooldown");
        expect(rows()[0].status).toBe("delivered");
      });

      it("delivery adds the suppressed-count note to Slack text only", async () => {
        await destination({
          kind: "slack", url: "https://hooks.slack.com/services/fixture",
          headers: undefined, signingSecret: undefined,
        });
        ok(await enqueue());
        adapter.run("UPDATE webhookDeliveries SET suppressedCount = 1");
        adapter.flush();

        await tick(NOW, controllerWith());

        const body = JSON.parse(ackAwareSend.mock.calls[0][0].body);
        expect(body.text).toContain("1 earlier alert suppressed by cooldown");
      });

      it("delivery keeps the generic body as the exact canonical envelope", async () => {
        await destination();
        ok(await enqueue());
        adapter.run("UPDATE webhookDeliveries SET suppressedCount = 4");
        adapter.flush();

        await tick(NOW, controllerWith());

        const body = ackAwareSend.mock.calls[0][0].body;
        expect(JSON.parse(body)).toEqual(JSON.parse(rows()[0].payload));
        expect(body).not.toContain("suppressed");
      });

      it("delivery sends at most one row per destination and enforces the one-second send gap", async () => {
        await destination();
        ok(await enqueue(requestFailed()));
        ok(await enqueue(requestFailed()));
        expect(rows()).toHaveLength(2);
        const controller = controllerWith();

        const firstTick = await tick(NOW, controller);
        expect(firstTick).toMatchObject({ claimed: 1, delivered: 1 });
        expect(ackAwareSend).toHaveBeenCalledTimes(1);
        expect(rows().filter((item) => item.status === "delivered")).toHaveLength(1);

        // Same clock: the second row in the same destination is spaced out.
        expect(await tick(NOW, controller)).toMatchObject({ claimed: 0 });
        expect(ackAwareSend).toHaveBeenCalledTimes(1);

        expect(await tick(NOW + 1000, controller)).toMatchObject({ claimed: 1, delivered: 1 });
        expect(ackAwareSend).toHaveBeenCalledTimes(2);
        expect(rows().every((item) => item.status === "delivered")).toBe(true);
      });

      it("delivery never claims more than two global rows in one poll", async () => {
        await destination({ url: "https://first.example.com/hook" });
        await destination({ url: "https://second.example.com/hook" });
        await destination({ url: "https://third.example.com/hook" });
        ok(await enqueue(requestFailed()));
        expect(rows()).toHaveLength(3);
        const controller = controllerWith();

        const firstTick = await tick(NOW, controller);
        expect(firstTick).toMatchObject({ claimed: 2, delivered: 2 });
        expect(ackAwareSend).toHaveBeenCalledTimes(2);
        expect(new Set(ackAwareSend.mock.calls.map(([request]) => request.url)).size).toBe(2);
        expect(rows().filter((item) => item.status === "pending")).toHaveLength(1);

        // The third distinct destination is still eligible in the next poll.
        expect(await tick(NOW, controller)).toMatchObject({ claimed: 1, delivered: 1 });
        expect(ackAwareSend).toHaveBeenCalledTimes(3);
        expect(rows().every((item) => item.status === "delivered")).toBe(true);
      });

      it("delivery ignores a concurrent tick instead of claiming a third global row", async () => {
        await destination();
        ok(await enqueue());
        let release;
        const send = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        const controller = controllerWith({ send });

        const running = controller.tick();
        await settle();
        const concurrent = await controller.tick();
        expect(concurrent.busy).toBe(true);
        expect(send).toHaveBeenCalledTimes(1);

        release({ status: 204, headers: {} });
        await running;
        expect(rows()[0].status).toBe("delivered");
      });
    });

    describe("webhook dispatcher: retry policy", () => {
      it("retry applies deterministic full jitter on a 5xx", async () => {
        await destination();
        ok(await enqueue());
        const send = vi.fn(async () => ({ status: 503, headers: {} }));
        const controller = controllerWith({ send, random: () => 0.5 });

        await tick(NOW, controller);

        // attempt 1 base = 5s, jittered by 0.5 -> 2500ms
        expect(row(rows()[0].id)).toMatchObject({
          status: "retry",
          attempts: 1,
          lastStatus: 503,
          lastErrorClass: "upstream_http",
          nextAttemptAt: iso(NOW + 2500),
        });
        expect(await tick(NOW + 2499, controller)).toMatchObject({ claimed: 0 });
        expect(send).toHaveBeenCalledTimes(1);
        await tick(NOW + 2500, controller);
        expect(send).toHaveBeenCalledTimes(2);
      });

      it("retry honors Retry-After seconds without ever retrying earlier", async () => {
        await destination();
        ok(await enqueue());
        const send = vi.fn(async () => ({ status: 429, headers: { "retry-after": "30" } }));
        const controller = controllerWith({ send, random: () => 0.5 });

        await tick(NOW, controller);

        expect(row(rows()[0].id)).toMatchObject({
          status: "retry",
          lastStatus: 429,
          lastErrorClass: "upstream_http",
          nextAttemptAt: iso(NOW + 30_000),
        });
        expect(await tick(NOW + 29_999, controller)).toMatchObject({ claimed: 0 });
        await tick(NOW + 30_000, controller);
        expect(send).toHaveBeenCalledTimes(2);
      });

      it("retry honors an HTTP-date Retry-After relative to the injected clock", async () => {
        await destination();
        ok(await enqueue());
        const at = new Date(NOW + 45_000).toUTCString();
        const send = vi.fn(async () => ({ status: 429, headers: { "retry-after": at } }));
        const controller = controllerWith({ send, random: () => 0 });

        await tick(NOW, controller);

        expect(row(rows()[0].id).nextAttemptAt).toBe(iso(NOW + 45_000));
      });

      it("retry expires instead of clamping a Retry-After beyond the 24h item deadline", async () => {
        await destination();
        ok(await enqueue());
        const send = vi.fn(async () => ({ status: 429, headers: { "retry-after": "999999" } }));
        const controller = controllerWith({ send });

        await tick(NOW, controller);

        expect(row(rows()[0].id)).toMatchObject({
          status: "expired",
          lastStatus: 429,
          finishedAt: iso(NOW),
        });
        expect(await tick(NOW + 1_000_000, controller)).toMatchObject({ claimed: 0 });
        expect(send).toHaveBeenCalledTimes(1);
      });

      it("retry expires an unrepresentable Retry-After without throwing after send", async () => {
        await destination();
        ok(await enqueue());
        const send = vi.fn(async () => ({ status: 429, headers: { "retry-after": "9007199254740991" } }));
        const controller = controllerWith({ send });

        const summary = await tick(NOW, controller);

        expect(send).toHaveBeenCalledTimes(1);
        expect(summary).toMatchObject({ failed: 1, retried: 0 });
        expect(row(rows()[0].id)).toMatchObject({
          status: "expired",
          lastStatus: 429,
          lastErrorClass: "upstream_http",
        });
        expect(await tick(NOW + 1_000_000, controller)).toMatchObject({ claimed: 0 });
        expect(send).toHaveBeenCalledTimes(1);
      });

      it("retry treats 408, timeout and network failures as retryable and 400/3xx/invalid ack as terminal", async () => {
        const timeout = Object.assign(new Error("deadline"), { code: "WEBHOOK_TIMEOUT" });
        const network = Object.assign(new Error("network"), { code: "WEBHOOK_NETWORK" });
        const cases = [
          ["408", async () => ({ status: 408, headers: {} }), "upstream_timeout", "retry", {}],
          ["timeout", async () => { throw timeout; }, "upstream_timeout", "retry", {}],
          ["network", async () => { throw network; }, "upstream_network", "retry", {}],
          ["400", async () => ({ status: 400, headers: {} }), "upstream_http", "failed", {}],
          ["302", async () => ({ status: 302, headers: {} }), "upstream_http", "failed", {}],
          ["policy", async () => { throw Object.assign(new Error("policy"), { code: "WEBHOOK_POLICY" }); }, "internal", "failed", {}],
          ["invalid ack", async () => ({ status: 200, headers: {}, acknowledged: false }), "internal", "failed", {
            kind: "discord",
            url: "https://discord.example.com/api/webhooks/9/token",
            headers: undefined,
            signingSecret: undefined,
          }],
        ];

        for (const [index, [name, send, errorClass, status, overrides]] of cases.entries()) {
          adapter.transaction(() => {
            adapter.run("DELETE FROM webhookDeliveries");
            adapter.run("DELETE FROM webhookDestinations");
          });
          adapter.flush();
          await destination(overrides);
          ok(await enqueue());
          const controller = controllerWith({ send: vi.fn(send), random: () => 0.5 });
          await tick(NOW + index * 2000, controller);
          expect(row(rows()[0].id), name).toMatchObject({ status, lastErrorClass: errorClass });
        }
      });

      it("retry stops after eight attempts and leaves no further claim", async () => {
        await destination();
        ok(await enqueue());
        const send = vi.fn(async () => ({ status: 503, headers: {} }));
        const controller = controllerWith({ send, random: () => 0 });

        for (let attempt = 1; attempt <= 8; attempt += 1) {
          const summary = await tick(NOW + attempt * 1000, controller);
          expect(send, `attempt ${attempt}`).toHaveBeenCalledTimes(attempt);
          const stored = rows()[0];
          expect(stored.attempts).toBe(attempt);
          if (attempt < 8) {
            expect(stored.status).toBe("retry");
            expect(summary).toMatchObject({ retried: 1, failed: 0 });
          } else {
            expect(stored.status).toBe("failed");
            expect(summary).toMatchObject({ failed: 1, retried: 0 });
          }
        }

        await tick(NOW + 60_000, controller);
        expect(send).toHaveBeenCalledTimes(8);
        expect(rows()[0]).toMatchObject({ status: "failed", attempts: 8 });
      });

      it("retry keeps the webhook id stable while refreshing the generic timestamp and signature", async () => {
        await destination();
        ok(await enqueue());
        const send = vi.fn(async () => ({ status: 503, headers: {} }));
        const controller = controllerWith({ send, random: () => 0 });

        await tick(NOW, controller);
        await tick(NOW + 60_000, controller);

        const [first, second] = send.mock.calls.map(([request]) => request);
        expect(header(second, "webhook-id")).toBe(header(first, "webhook-id"));
        expect(header(second, "webhook-timestamp")).not.toBe(header(first, "webhook-timestamp"));
        expect(header(second, "webhook-signature")).not.toBe(header(first, "webhook-signature"));
      });
    });

    describe("webhook dispatcher: lifecycle", () => {
      it("repeated start creates one timer, pause stops polling, resume continues, stop clears the timer", async () => {
        await destination();
        adapter.flush();
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        const baseline = vi.getTimerCount();
        const controller = controllerWith();

        expect(controller.start()).toBe(true);
        expect(controller.start()).toBe(false);
        expect(vi.getTimerCount()).toBe(baseline + 1);

        ok(await enqueue());
        clockNow = NOW + 1000;
        await vi.advanceTimersByTimeAsync(1000);
        await settle();
        expect(ackAwareSend).toHaveBeenCalledTimes(1);

        expect(controller.pause()).toBe(true);
        expect(controller.isPaused()).toBe(true);
        ok(await enqueue());
        clockNow = NOW + 3000;
        await vi.advanceTimersByTimeAsync(2000);
        await settle();
        expect(ackAwareSend).toHaveBeenCalledTimes(1);
        expect(await controller.tick()).toMatchObject({ paused: true, claimed: 0 });

        expect(controller.resume()).toBe(true);
        clockNow = NOW + 4000;
        await vi.advanceTimersByTimeAsync(1000);
        await settle();
        expect(ackAwareSend).toHaveBeenCalledTimes(2);
        // Deliveries never create their own timers.
        expect(vi.getTimerCount()).toBe(baseline + 1);

        expect(controller.stop()).toBe(true);
        expect(controller.isRunning()).toBe(false);
        expect(vi.getTimerCount()).toBe(baseline);
      });

      it("a stop while the claim is resolving sends nothing and leaves the lease recoverable", async () => {
        await destination();
        const queued = ok(await enqueue()).deliveryIds[0];
        let controller;
        let stopped = false;
        controller = controllerWith({
          now: () => {
            if (!stopped) {
              stopped = true;
              controller.stop();
            }
            return NOW;
          },
        });
        controller.start();

        const summary = await controller.tick();

        expect(summary).toMatchObject({ claimed: 0 });
        expect(ackAwareSend).not.toHaveBeenCalled();
        expect(row(queued)).toMatchObject({ status: "inflight", attempts: 1 });
        expect(await claim(NOW + 30_000)).toMatchObject({ id: queued, attempts: 2 });
      });

      it("a pause while the claim is resolving sends nothing and leaves the lease recoverable", async () => {
        await destination();
        const queued = ok(await enqueue()).deliveryIds[0];
        let controller;
        let paused = false;
        controller = controllerWith({
          now: () => {
            if (!paused) {
              paused = true;
              controller.pause();
            }
            return NOW;
          },
        });
        controller.start();

        const summary = await controller.tick();

        expect(summary).toMatchObject({ claimed: 0 });
        expect(controller.isPaused()).toBe(true);
        expect(ackAwareSend).not.toHaveBeenCalled();
        expect(row(queued)).toMatchObject({ status: "inflight", attempts: 1 });
        expect(await claim(NOW + 30_000)).toMatchObject({ id: queued, attempts: 2 });
      });

      it("stop aborts an in-flight send and leaves the lease recoverable after restart", async () => {
        await destination();
        adapter.flush();
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        const send = vi.fn((request) => new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { code: "WEBHOOK_ABORTED" }));
          }, { once: true });
        }));
        const controller = controllerWith({ send });
        controller.start();
        const queued = ok(await enqueue()).deliveryIds[0];

        await vi.advanceTimersByTimeAsync(1000);
        await settle();
        expect(send).toHaveBeenCalledTimes(1);
        expect(row(queued).status).toBe("inflight");
        const originalToken = row(queued).leaseToken;
        expect(originalToken).toBeTruthy();
        expect(controller.inflightCount()).toBe(1);

        controller.stop();
        await settle();

        expect(controller.inflightCount()).toBe(0);
        expect(row(queued)).toMatchObject({ status: "inflight", attempts: 1, leaseToken: originalToken });
        expect(await claim(NOW + 29_999)).toBeNull();
        const recovered = await claim(NOW + 30_000);
        expect(recovered).toMatchObject({ id: queued, attempts: 2 });
        expect(recovered.leaseToken).not.toBe(originalToken);
      });

      it("a pending row survives stop and is resumed by the next start", async () => {
        await destination();
        const queued = ok(await enqueue()).deliveryIds[0];
        const first = controllerWith();
        first.start();
        first.stop();
        expect(rows()[0]).toMatchObject({ id: queued, status: "pending" });

        const restarted = controllerWith();
        await tick(NOW, restarted);

        expect(ackAwareSend).toHaveBeenCalledTimes(1);
        expect(row(queued).status).toBe("delivered");
      });

      it("stop is idempotent and a stopped controller can start again as one timer", async () => {
        adapter.flush();
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        const controller = controllerWith();
        const baseline = vi.getTimerCount();

        expect(controller.stop()).toBe(false);
        expect(controller.start()).toBe(true);
        expect(vi.getTimerCount()).toBe(baseline + 1);
        expect(controller.stop()).toBe(true);
        expect(vi.getTimerCount()).toBe(baseline);
        expect(controller.start()).toBe(true);
        expect(vi.getTimerCount()).toBe(baseline + 1);
      });

      it("singleton start is one shared controller that survives a module reload", async () => {
        adapter.flush();
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        const baseline = vi.getTimerCount();
        const first = dispatcher.startWebhookDispatcher({ intervalMs: 1000, now, random: () => 0.5, send: ackAwareSend });
        expect(vi.getTimerCount()).toBe(baseline + 1);
        expect(dispatcher.startWebhookDispatcher({ send: ackAwareSend })).toBe(first);
        expect(vi.getTimerCount()).toBe(baseline + 1);
        expect(dispatcher.getWebhookDispatcher()).toBe(first);

        vi.resetModules();
        const reloaded = await import("@/lib/webhooks/dispatcher.js");
        expect(reloaded.getWebhookDispatcher()).toBe(first);
        expect(reloaded.startWebhookDispatcher({ send: ackAwareSend })).toBe(first);
        expect(vi.getTimerCount()).toBe(baseline + 1);

        reloaded.stopWebhookDispatcher();
        expect(vi.getTimerCount()).toBe(baseline);
        expect(reloaded.getWebhookDispatcher()).toBeNull();
      });
    });

    describe("webhook dispatcher: revocation and stale work", () => {
      it("disabling a destination immediately before send produces zero requests", async () => {
        const target = await destination();
        const queued = ok(await enqueue()).deliveryIds[0];
        ok(await destinations.updateWebhookDestination(target.id, { enabled: false }));
        const controller = controllerWith();

        await tick(NOW, controller);

        expect(ackAwareSend).not.toHaveBeenCalled();
        expect(row(queued).status).toBe("cancelled");
      });

      it("deleting a destination before send produces zero requests", async () => {
        const target = await destination();
        const queued = ok(await enqueue()).deliveryIds[0];
        ok(await destinations.deleteWebhookDestination(target.id));
        const controller = controllerWith();

        await tick(NOW, controller);

        expect(ackAwareSend).not.toHaveBeenCalled();
        expect(row(queued).status).toBe("cancelled");
      });

      it("stale generation before send is blocked", async () => {
        await destination();
        ok(await enqueue());
        const lease = await claim(NOW);
        ok(await outbox.resetWebhookOutbox({ now: NOW }));
        const send = vi.fn(async () => ({ status: 204, headers: {} }));

        const result = await dispatcher.deliverWebhookLease(lease, { now, random: () => 0.5, send });

        expect(result).toMatchObject({ sent: false, applied: false });
        expect(send).not.toHaveBeenCalled();
      });

      it("stale destination revision before send is blocked", async () => {
        const target = await destination();
        ok(await enqueue());
        const lease = await claim(NOW);
        ok(await destinations.updateWebhookDestination(target.id, { name: "renamed" }));
        const send = vi.fn(async () => ({ status: 204, headers: {} }));

        const result = await dispatcher.deliverWebhookLease(lease, { now, random: () => 0.5, send });

        expect(result).toMatchObject({ sent: false, applied: false });
        expect(send).not.toHaveBeenCalled();
        expect(row(lease.id).status).toBe("inflight");
      });

      it("stale success is ignored when the revision changes before completion", async () => {
        const target = await destination();
        ok(await enqueue());
        const lease = await claim(NOW);
        const send = vi.fn(async () => {
          ok(await destinations.updateWebhookDestination(target.id, { name: "renamed-during-send" }));
          return { status: 204, headers: {} };
        });

        const result = await dispatcher.deliverWebhookLease(lease, { now, random: () => 0.5, send });

        expect(result).toMatchObject({ sent: true, applied: false });
        expect(row(lease.id).status).toBe("inflight");
        expect(row(lease.id).lastStatus).toBeNull();
      });

      it("stale generation before completion is rejected", async () => {
        await destination();
        ok(await enqueue());
        const lease = await claim(NOW);
        const send = vi.fn(async () => {
          ok(await outbox.resetWebhookOutbox({ now: NOW }));
          return { status: 204, headers: {} };
        });

        const result = await dispatcher.deliverWebhookLease(lease, { now, random: () => 0.5, send });

        expect(result).toMatchObject({ sent: true, applied: false });
        expect(row(lease.id)).toBeFalsy();
      });

      it("an already aborted signal prevents send even when the sender ignores abort", async () => {
        await destination();
        ok(await enqueue());
        const lease = await claim(NOW);
        const abort = new AbortController();
        abort.abort();
        const send = vi.fn(async () => ({ status: 204, headers: {} }));

        const result = await dispatcher.deliverWebhookLease(lease, {
          now, random: () => 0.5, send, signal: abort.signal,
        });

        expect(result).toMatchObject({ sent: false, applied: false, outcome: "aborted" });
        expect(send).not.toHaveBeenCalled();
        expect(row(lease.id).status).toBe("inflight");
        expect(await claim(NOW + 30_000)).toMatchObject({ id: lease.id, attempts: 2 });
      });

      it("abortDestination aborts only the matching destination and leaves its lease recoverable", async () => {
        const first = await destination({ url: "https://first.example.com/hook" });
        const second = await destination({ url: "https://second.example.com/hook" });
        ok(await enqueue());
        const firstRow = rows().find((item) => item.destinationId === first.id);
        const secondRow = rows().find((item) => item.destinationId === second.id);
        const pending = new Map();
        const send = vi.fn((request) => new Promise((resolve, reject) => {
          const key = request.url.includes("first.example.com") ? "first" : "second";
          pending.set(key, { resolve });
          request.signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { code: "WEBHOOK_ABORTED" }));
          }, { once: true });
        }));
        const controller = controllerWith({ send });

        const running = controller.tick();
        await settle();
        expect(send).toHaveBeenCalledTimes(2);
        expect(controller.abortDestination(first.id)).toBe(1);
        await settle();
        expect(controller.abortDestination("unknown")).toBe(0);
        pending.get("second").resolve({ status: 204, headers: {} });
        await running;

        expect(row(firstRow.id).status).toBe("inflight");
        expect(row(secondRow.id).status).toBe("delivered");
        expect(await claim(NOW + 30_000)).toMatchObject({ id: firstRow.id, attempts: 2 });
      });

      it("a delivery failure never recurses into another webhook alert", async () => {
        await destination();
        const sink = vi.fn();
        events.setWebhookSink(sink);
        ok(await enqueue());
        const send = vi.fn(async () => { throw Object.assign(new Error("network"), { code: "WEBHOOK_NETWORK" }); });
        const controller = controllerWith({ send });

        await tick(NOW, controller);

        expect(send).toHaveBeenCalledTimes(1);
        expect(sink).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toMatchObject({ status: "retry", lastErrorClass: "upstream_network" });
      });
    });

    describe("webhook dispatcher: B1 test exception", () => {
      it("disabled operational deliveries are blocked but a newly explicit test is allowed", async () => {
        const target = await destination({ enabled: false });
        const blocked = ok(await enqueue());
        expect(blocked.deliveryIds).toEqual([]);
        expect(rows()).toHaveLength(0);

        const tested = ok(await outbox.enqueueWebhookTest(target.id, { now: NOW }));
        expect(tested.deliveryIds).toHaveLength(1);
        const controller = controllerWith();

        await tick(NOW, controller);

        expect(ackAwareSend).toHaveBeenCalledTimes(1);
        expect(row(tested.deliveryIds[0])).toMatchObject({
          status: "delivered",
          deliveryKind: "test",
          destinationId: target.id,
        });
      });

      it("a test delivery queued before disable is revoked with the destination", async () => {
        const target = await destination();
        const queued = ok(await outbox.enqueueWebhookTest(target.id, { now: NOW })).deliveryIds[0];
        ok(await destinations.updateWebhookDestination(target.id, { enabled: false }));
        const controller = controllerWith();

        await tick(NOW, controller);

        expect(ackAwareSend).not.toHaveBeenCalled();
        expect(row(queued).status).toBe("cancelled");
      });

      it("a test delivery with a stale revision or generation is not sent", async () => {
        const target = await destination();
        const queued = ok(await outbox.enqueueWebhookTest(target.id, { now: NOW })).deliveryIds[0];
        ok(await destinations.updateWebhookDestination(
          target.id,
          { url: "https://hooks.example.com/rotated" },
        ));
        const controller = controllerWith();
        await tick(NOW, controller);
        expect(ackAwareSend).not.toHaveBeenCalled();
        expect(row(queued).status).toBe("cancelled");

        const second = await destination();
        const current = ok(await outbox.enqueueWebhookTest(second.id, { now: NOW })).deliveryIds[0];
        ok(await outbox.resetWebhookOutbox({ now: NOW }));
        await tick(NOW, controller);
        expect(ackAwareSend).not.toHaveBeenCalled();
        expect(row(current)).toBeFalsy();
      });
    });

    describe("webhook dispatcher: sink wiring and durability acknowledgement", () => {
      it("start wires the events sink to the durable outbox without claiming synchronous durability", async () => {
        await destination();
        const controller = controllerWith();
        controller.start();
        controller.pause();

        const emitted = events.runWithWebhookContext({ requestId: "req-fixture", modality: "chat" }, () => {
          events.markWebhookAdmitted();
          return events.finalizeWebhookRequest({ outcome: "failed", statusCode: 502, errorClass: "upstream_http" });
        });

        expect(emitted).toMatchObject({ emitted: true });
        // events.js only handed the envelope to the sink; enqueue is still pending.
        expect(rows()).toHaveLength(0);
        await settle();
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toMatchObject({ status: "pending", deliveryKind: "operational", type: "request.failed" });

        controller.stop();
        const afterStop = events.runWithWebhookContext({ requestId: "req-after", modality: "chat" }, () => {
          events.markWebhookAdmitted();
          return events.finalizeWebhookRequest({ outcome: "failed", statusCode: 500, errorClass: "upstream_http" });
        });
        expect(afterStop).toMatchObject({ emitted: false, reason: "no_sink" });
      });

      it("an outbox_full enqueue is swallowed by the sink and never becomes a recursive alert", async () => {
        await destination();
        ok(await enqueue());
        await seed(9999);
        expect(rows()).toHaveLength(10_000);
        const rejections = [];
        const onRejection = (error) => rejections.push(error);
        process.on("unhandledRejection", onRejection);

        try {
          const controller = controllerWith();
          controller.start();
          controller.pause();
          const emitted = events.runWithWebhookContext({ requestId: "req-full", modality: "chat" }, () => {
            events.markWebhookAdmitted();
            return events.finalizeWebhookRequest({ outcome: "failed", statusCode: 502, errorClass: "upstream_http" });
          });

          expect(emitted).toMatchObject({ emitted: true });
          await settle();
          expect(rows()).toHaveLength(10_000);
          expect(rejections).toEqual([]);
          controller.stop();
        } finally {
          process.removeListener("unhandledRejection", onRejection);
        }
      }, 30_000);
    });

    describe("webhook dispatcher: pure policy helpers", () => {
      it("retryDelayMs returns full-jitter values inside each exponential window", () => {
        expect(dispatcher.retryDelayMs(1, () => 0)).toBe(0);
        expect(dispatcher.retryDelayMs(1, () => 0.5)).toBe(2500);
        expect(dispatcher.retryDelayMs(3, () => 0.5)).toBe(10_000);
        expect(dispatcher.retryDelayMs(3, () => 0.999)).toBeLessThan(20_000);
        expect(dispatcher.retryDelayMs(0, () => 0)).toBe(0);
      });

      it("retryDelayMs caps the jittered delay at 3600 seconds", () => {
        expect(dispatcher.retryDelayMs(11, () => 0.999)).toBe(3_600_000);
        expect(dispatcher.retryDelayMs(20, () => 1)).toBe(3_600_000);
      });

      it("buildDestinationRequest keeps the persisted URL, merged headers and adapter body separate from async send", async () => {
        const created = await destination();
        const target = await destinations.getWebhookDestinationRawById(created.id);
        const event = requestFailed();
        const request = dispatcher.buildDestinationRequest(target, event, NOW);

        expect(request.url).toBe(target.url);
        expect(request.allowPrivateNetwork).toBe(false);
        expect(request.acknowledgementKind).toBeUndefined();
        expect(header(request, "authorization")).toBe("Bearer fixture-header-secret");
        expect(JSON.parse(request.body).id).toBe(event.id);
        expect(request.signal).toBeUndefined();
      });
    });
  });
}
