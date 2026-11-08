import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep guard/routes/repos real; stub token verification, host identity and egress to avoid host secrets/network.
const boundary = vi.hoisted(() => ({
  next: Symbol("next"),
  send: vi.fn(),
}));
vi.mock("next/server", () => ({ NextResponse: {
  next: () => boundary.next,
  json: (body, init) => Response.json(body, init),
} }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: async (token) => token === "fixture-dashboard-jwt",
  verifyDashboardPassword: () => { throw new Error("Webhook management must not reauthenticate"); },
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "fixture-cli-token" }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));
vi.mock("@/lib/webhooks/transport.js", () => ({ sendWebhook: boundary.send }));

const ORIGIN = "https://router.example.test";
const URL_SECRET = "https://hooks.example.test/private-hook-token?tenant=query-token";
const SIGNING_SECRET = "fixture-signing-secret-never-return";
const AUTH_SECRET = "Bearer fixture-authorization-never-return";
const RESERVED = ["webhooks", "webhookDestinations", "webhookDeliveries", "webhookUrls", "webhookSigningSecret",
  "webhookFutureKey", "webhook", "WEBHOOKURL", "WebhookCredentials", "webhookNested.value"];
const originalDataDir = process.env.DATA_DIR;
const input = (extra = {}) => ({ name: "Operations", kind: "generic", url: URL_SECRET,
  signingSecret: SIGNING_SECRET, headers: { Authorization: AUTH_SECRET, "X-Tenant": "fixture-header-value" }, ...extra });
const context = (id) => ({ params: Promise.resolve({ id }) });

function incoming(method, pathname, body, headers = {}) {
  const request = new Request(`${ORIGIN}${pathname}`, {
    method, headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  Object.defineProperties(request, {
    nextUrl: { value: new URL(request.url) },
    cookies: { value: { get: (key) => key === "auth_token" && request.headers.get("cookie") === "auth_token=fixture-dashboard-jwt"
      ? { value: "fixture-dashboard-jwt" } : undefined } },
  });
  return request;
}

function expectSecretSafe(value) {
  const text = JSON.stringify(value);
  for (const secret of [URL_SECRET, "/private-hook-token", "query-token", SIGNING_SECRET, AUTH_SECRET, "fixture-header-value",
    "replacement-token", "Bearer replacement", "replacement-signing-secret"]) {
    expect(text).not.toContain(secret);
  }
}

async function readResponse(response, status) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  const body = await response.json();
  expectSecretSafe(body);
  return body;
}

describe("webhook management API contract (real sql.js repository)", () => {
  let dir, adapter, destinations, outbox, settings, dispatcher, guard;
  let listeners;

  beforeEach(async () => {
    vi.resetModules();
    boundary.send.mockReset().mockRejectedValue(new Error("Unexpected webhook egress"));
    listeners = Object.fromEntries(["beforeExit", "SIGINT", "SIGTERM"].map((event) => [event, process.listeners(event)]));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-webhook-api-"));
    process.env.DATA_DIR = dir;
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    adapter = await createSqlJsAdapter(path.join(dir, "fixture.sqlite"));
    global._dbAdapter = { instance: adapter, initPromise: null, logged: true };
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    await runMigrationOnce(adapter);
    destinations = await import("@/lib/db/repos/webhooksRepo.js");
    outbox = await import("@/lib/db/repos/webhookDeliveriesRepo.js");
    settings = await import("@/lib/db/repos/settingsRepo.js");
    // Avoid importing the unrelated backup/startup barrel owned by task 13.
    vi.doMock("@/lib/localDb", () => ({ ...settings, ...destinations, ...outbox, validateApiKey: async () => false }));
    dispatcher = await import("@/lib/webhooks/dispatcher.js");
    guard = await import("@/dashboardGuard.js");
    await settings.updateSettings({ requireLogin: false });
    adapter.flush();
  });

  afterEach(() => {
    dispatcher?.stopWebhookDispatcher();
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/localDb");
    adapter?.close();
    delete global._dbAdapter;
    delete global._webhookDispatcher;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    for (const [event, previous] of Object.entries(listeners || {})) {
      for (const listener of process.listeners(event)) if (!previous.includes(listener)) process.removeListener(event, listener);
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function routes() {
    return {
      collection: await import("@/app/api/webhooks/route.js"),
      item: await import("@/app/api/webhooks/[id]/route.js"),
      test: await import("@/app/api/webhooks/[id]/test/route.js"),
      status: await import("@/app/api/webhooks/deliveries/route.js"),
    };
  }

  async function target(extra = {}) {
    const result = await destinations.createWebhookDestination(input(extra));
    expect(result.ok).toBe(true);
    adapter.flush();
    return result.destination;
  }

  const rows = () => adapter.all("SELECT * FROM webhookDeliveries ORDER BY createdAt, id");
  async function guarded(handler, request, ctx) {
    const result = await guard.proxy(request);
    return result === boundary.next ? handler(request, ctx) : result;
  }

  it("allowed: creates and lists only safe DTOs with write-only credentials", async () => {
    const { collection } = await routes();
    const created = await readResponse(await collection.POST(incoming("POST", "/api/webhooks", input())), 201);
    expect(created).toMatchObject({ ok: true, revision: 1, destination: {
      id: expect.any(String), revision: 1, name: "Operations", kind: "generic", enabled: true,
      events: ["request.failed"], allowPrivateNetwork: false, cooldownSeconds: 300,
      url: { scheme: "https", host: "hooks.example.test" }, urlConfigured: true,
      hasSigningSecret: true, headerCount: 2, headerNames: ["Authorization", "X-Tenant"],
    } });
    expect(created.destination).not.toHaveProperty("headers");
    expect(created.destination).not.toHaveProperty("signingSecret");
    const listed = await readResponse(await collection.GET(incoming("GET", "/api/webhooks")), 200);
    expect(listed).toEqual({ destinations: [created.destination] });
    expect(await destinations.getWebhookDestinationRawById(created.destination.id)).toMatchObject({
      url: URL_SECRET, signingSecret: SIGNING_SECRET, headers: { Authorization: AUTH_SECRET },
    });
  });

  it.each(["discord", "slack", "generic"])("allowed: %s is persisted through the existing validator", async (kind) => {
    const { collection } = await routes();
    const body = await readResponse(await collection.POST(incoming("POST", "/api/webhooks", {
      name: kind, kind, url: "https://hooks.example.test/new-token",
    })), 201);
    expect(body.destination).toMatchObject({ kind, revision: 1, hasSigningSecret: kind === "generic" });
    expect(await destinations.listWebhookDestinations()).toHaveLength(1);
  });

  it("allowed: PATCH omission preserves URL, headers and secret, explicit clear regenerates generic signing", async () => {
    const saved = await target();
    const { item } = await routes();
    const renamed = await readResponse(await item.PATCH(incoming("PATCH", `/api/webhooks/${saved.id}`, {
      name: "Renamed", expectedRevision: 1,
    }), context(saved.id)), 200);
    expect(renamed).toMatchObject({ ok: true, revision: 2, destination: { name: "Renamed", revision: 2 } });
    expect(await destinations.getWebhookDestinationRawById(saved.id)).toMatchObject({
      url: URL_SECRET, signingSecret: SIGNING_SECRET, headers: { Authorization: AUTH_SECRET },
    });
    await readResponse(await item.PATCH(incoming("PATCH", `/api/webhooks/${saved.id}`, {
      clearSigningSecret: true, clearHeaders: true, expectedRevision: 2,
    }), context(saved.id)), 200);
    const raw = await destinations.getWebhookDestinationRawById(saved.id);
    expect(raw.headers).toEqual({});
    expect(raw.signingSecret).toMatch(/^whsec_/);
    expect(raw.signingSecret).not.toBe(SIGNING_SECRET);
  });

  it.each([
    [null, "invalid_type"], [[], "invalid_type"], [{}, "required"],
    [input({ kind: "executable" }), "invalid_kind"],
    [input({ events: ["provider.down"] }), "unknown_event"],
    [input({ deliveryKind: "test" }), "internal_field"],
    [input({ headers: { Host: "internal" } }), "header_name_not_allowed"],
    [input({ headers: { Authorization: "bad\r\nInjected: yes" } }), "header_value_invalid"],
    [input({ url: "http://localhost:1234/hook" }), "http_requires_private_opt_in"],
    [input({ unexpected: true }), "unknown_key"],
  ])("denied: invalid create %j maps to 400/%s without a write", async (body, code) => {
    const { collection } = await routes();
    const response = await readResponse(await collection.POST(incoming("POST", "/api/webhooks", body)), 400);
    expect(response.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
    expect(await destinations.listWebhookDestinations()).toEqual([]);
  });

  it("denied: merged PATCH validates kind against retained headers without partial mutation", async () => {
    const saved = await target();
    const { item } = await routes();
    const body = await readResponse(await item.PATCH(incoming("PATCH", `/api/webhooks/${saved.id}`, {
      kind: "slack", expectedRevision: 1,
    }), context(saved.id)), 400);
    expect(body.errors).toContainEqual(expect.objectContaining({ code: "headers_not_supported" }));
    expect(await destinations.getWebhookDestinationById(saved.id)).toMatchObject({ kind: "generic", revision: 1 });
  });

  it("denied: validation never reflects attacker-controlled secret-bearing field names", async () => {
    const { collection } = await routes();
    const body = await readResponse(await collection.POST(incoming("POST", "/api/webhooks", input({
      [URL_SECRET]: AUTH_SECRET,
    }))), 400);
    expect(body.errors).toContainEqual(expect.objectContaining({ code: "unknown_key" }));
    expect(await destinations.listWebhookDestinations()).toEqual([]);
  });

  it.each([
    [true, {}, 401],
    [true, { cookie: "auth_token=fixture-dashboard-jwt" }, 201],
    [true, { "x-9r-cli-token": "fixture-cli-token" }, 201],
    [false, {}, 201],
  ])("allowed/denied: requireLogin=%s headers=%j yields %s without password reauth", async (requireLogin, headers, status) => {
    await settings.updateSettings({ requireLogin });
    const { collection } = await routes();
    await readResponse(await guarded(collection.POST, incoming("POST", "/api/webhooks", input(), headers)), status);
    expect(await destinations.listWebhookDestinations()).toHaveLength(status === 201 ? 1 : 0);
  });

  it.each([
    { origin: "https://attacker.example.test" },
    { origin: "null" },
    { origin: "not-an-origin" },
    { origin: "https://router.example.test.attacker.test" },
    { origin: "https://router.example.test:444" },
    { "sec-fetch-site": "cross-site" },
    { origin: "https://attacker.example.test", "x-forwarded-host": "attacker.example.test" },
  ])("denied: mutation rejects foreign Origin or cross-site metadata %j even with login off", async (headers) => {
    const saved = await target();
    const { collection, item, test } = await routes();
    const attempts = [
      () => collection.POST(incoming("POST", "/api/webhooks", input(), headers)),
      () => item.PATCH(incoming("PATCH", `/api/webhooks/${saved.id}`, { enabled: false }, headers), context(saved.id)),
      () => item.DELETE(incoming("DELETE", `/api/webhooks/${saved.id}`, {}, headers), context(saved.id)),
      () => test.POST(incoming("POST", `/api/webhooks/${saved.id}/test`, {}, headers), context(saved.id)),
    ];
    for (const attempt of attempts) await readResponse(await attempt(), 403);
    expect(await destinations.getWebhookDestinationById(saved.id)).toMatchObject({ enabled: true, revision: 1 });
    expect(await destinations.listWebhookDestinations()).toHaveLength(1);
    expect(rows()).toEqual([]);
    expect(boundary.send).not.toHaveBeenCalled();
  });

  it("allowed: originless non-browser JSON and CLI mutations retain existing access", async () => {
    const { collection } = await routes();
    const cli = incoming("POST", "/api/webhooks", input(), { "x-9r-cli-token": "fixture-cli-token" });
    cli.headers.delete("origin");
    const created = await readResponse(await guarded(collection.POST, cli), 201);
    expect(await destinations.getWebhookDestinationById(created.destination.id)).not.toBeNull();
    const nonBrowser = incoming("POST", "/api/webhooks", input({ name: "Non-browser" }));
    nonBrowser.headers.delete("origin");
    await readResponse(await collection.POST(nonBrowser), 201);
  });

  it("denied: a browser missing Origin cannot masquerade as an originless JSON client", async () => {
    const { collection } = await routes();
    const request = incoming("POST", "/api/webhooks", input(), { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" });
    request.headers.delete("origin");
    await readResponse(await collection.POST(request), 403);
    expect(await destinations.listWebhookDestinations()).toEqual([]);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonp", ""])(
    "denied: mutation rejects non-JSON media type %s before any write", async (contentType) => {
      const saved = await target();
      const { collection, item, test } = await routes();
      const headers = { "content-type": contentType };
      for (const [handler, method, pathname, body] of [
        [collection.POST, "POST", "/api/webhooks", input()],
        [item.PATCH, "PATCH", `/api/webhooks/${saved.id}`, { name: "Changed" }],
        [item.DELETE, "DELETE", `/api/webhooks/${saved.id}`, {}],
        [test.POST, "POST", `/api/webhooks/${saved.id}/test`, {}],
      ]) await readResponse(await handler(incoming(method, pathname, body, headers), context(saved.id)), 400);
      expect(await destinations.getWebhookDestinationById(saved.id)).toMatchObject({ revision: 1 });
      expect(rows()).toEqual([]);
    },
  );

  it("denied: malformed JSON is 400 rather than an exception or raw parser message", async () => {
    const { collection } = await routes();
    const body = await readResponse(await collection.POST(incoming("POST", "/api/webhooks", '{"url":"private-hook-token",')), 400);
    expect(body).toMatchObject({ ok: false, errors: [{ field: "body", code: "invalid_json" }] });
    expect(JSON.stringify(body)).not.toContain("private-hook-token");
    expect(await destinations.listWebhookDestinations()).toEqual([]);
  });

  it("allowed: exactly 32 KiB of JSON is accepted by the byte cap", async () => {
    const { collection } = await routes();
    const json = JSON.stringify(input());
    const padded = json + " ".repeat(32768 - Buffer.byteLength(json));
    expect(Buffer.byteLength(padded)).toBe(32768);
    await readResponse(await collection.POST(incoming("POST", "/api/webhooks", padded)), 201);
  });

  it.each([{}, { "content-length": "1" }])("denied: UTF-8 body overflow is 413 independent of Content-Length %j", async (headers) => {
    const saved = await target();
    const { collection, item, test } = await routes();
    const body = JSON.stringify({ name: "😀".repeat(9000) });
    expect(body.length).toBeLessThan(32768);
    expect(Buffer.byteLength(body)).toBeGreaterThan(32768);
    for (const [handler, method, pathname] of [
      [collection.POST, "POST", "/api/webhooks"],
      [item.PATCH, "PATCH", `/api/webhooks/${saved.id}`],
      [item.DELETE, "DELETE", `/api/webhooks/${saved.id}`],
      [test.POST, "POST", `/api/webhooks/${saved.id}/test`],
    ]) await readResponse(await handler(incoming(method, pathname, body, headers), context(saved.id)), 413);
    expect(await destinations.getWebhookDestinationById(saved.id)).toMatchObject({ revision: 1 });
    expect(rows()).toEqual([]);
  });

  it("denied: unknown-length chunked body is capped while reading and its reader is cancelled", async () => {
    const { collection } = await routes();
    let cancelled = false;
    const request = incoming("POST", "/api/webhooks");
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode(" ".repeat(8192))); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    Object.defineProperty(request, "body", { value: stream });
    await readResponse(await collection.POST(request), 413);
    expect(cancelled).toBe(true);
    expect(await destinations.listWebhookDestinations()).toEqual([]);
  });

  it("denied: oversized Content-Length is rejected without consuming the request stream", async () => {
    const { collection } = await routes();
    const request = incoming("POST", "/api/webhooks", input(), { "content-length": "32769" });
    const reader = vi.spyOn(request.body, "getReader");
    await readResponse(await collection.POST(request), 413);
    expect(reader).not.toHaveBeenCalled();
    expect(await destinations.listWebhookDestinations()).toEqual([]);
  });

  it("denied: missing destination returns 404 for PATCH, DELETE and explicit test", async () => {
    const { item, test } = await routes();
    for (const [handler, method, pathname, body] of [
      [item.PATCH, "PATCH", "/api/webhooks/missing", { name: "Absent" }],
      [item.DELETE, "DELETE", "/api/webhooks/missing", {}],
      [test.POST, "POST", "/api/webhooks/missing/test", {}],
    ]) {
      const result = await readResponse(await handler(incoming(method, pathname, body), context("missing")), 404);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "not_found" }));
    }
  });

  it.each([0, -1, 1.5, "1", null, true])("denied: invalid expectedRevision %j is rejected, not coerced", async (expectedRevision) => {
    const saved = await target();
    const { item } = await routes();
    for (const method of ["PATCH", "DELETE"]) {
      await readResponse(await item[method](incoming(method, `/api/webhooks/${saved.id}`, {
        ...(method === "PATCH" ? { name: "Not changed" } : {}), expectedRevision,
      }), context(saved.id)), 400);
    }
    expect(await destinations.getWebhookDestinationById(saved.id)).toMatchObject({ revision: 1 });
  });

  it("denied: optimistic conflict is 409 and cannot revoke queued work", async () => {
    const saved = await target();
    const queued = await outbox.enqueueWebhookTest(saved.id);
    const { item } = await routes();
    for (const method of ["PATCH", "DELETE"]) {
      const body = await readResponse(await item[method](incoming(method, `/api/webhooks/${saved.id}`, {
        ...(method === "PATCH" ? { enabled: false } : {}), expectedRevision: 99,
      }), context(saved.id)), 409);
      expect(body.errors).toContainEqual(expect.objectContaining({ code: "revision_conflict" }));
    }
    expect(await destinations.getWebhookDestinationById(saved.id)).toMatchObject({ revision: 1, enabled: true });
    expect(rows()).toMatchObject([{ id: queued.deliveryIds[0], status: "pending" }]);
  });

  it("denied: destination capacity maps to 409 without exposing stored credentials", async () => {
    for (let index = 0; index < 20; index++) await target({ name: `Destination ${index}` });
    const { collection } = await routes();
    const body = await readResponse(await collection.POST(incoming("POST", "/api/webhooks", input())), 409);
    expect(body.errors).toContainEqual(expect.objectContaining({ code: "destination_limit" }));
    expect(await destinations.listWebhookDestinations()).toHaveLength(20);
  });

  it("denied: DELETE accepts only revision metadata, not arbitrary destination input", async () => {
    const saved = await target();
    const { item } = await routes();
    await readResponse(await item.DELETE(incoming("DELETE", `/api/webhooks/${saved.id}`, {
      expectedRevision: 1, deliveryKind: "test",
    }), context(saved.id)), 400);
    expect(await destinations.getWebhookDestinationById(saved.id)).not.toBeNull();
  });

  it("allowed: saved disabled destination test returns 202 with a persisted synthetic test row, not delivered", async () => {
    const saved = await target({ enabled: false, events: ["token.refresh_failed"] });
    const { test, status } = await routes();
    const accepted = await readResponse(await test.POST(incoming("POST", `/api/webhooks/${saved.id}/test`, {}), context(saved.id)), 202);
    expect(accepted).toEqual({ ok: true, deliveryId: expect.any(String) });
    expect(rows()).toMatchObject([{
      id: accepted.deliveryId, destinationId: saved.id, destinationRevision: 1,
      deliveryKind: "test", status: "pending", attempts: 0,
    }]);
    const payload = JSON.parse(rows()[0].payload);
    expect(payload).toEqual({ id: rows()[0].eventId, type: "request.failed", schema_version: 1,
      occurred_at: expect.any(String), severity: "error", data: { errorClass: "internal" } });
    expectSecretSafe(payload);
    const { default: initSqlJs } = await import("sql.js");
    const SQL = await initSqlJs();
    const reopened = new SQL.Database(fs.readFileSync(path.join(dir, "fixture.sqlite")));
    try {
      expect(reopened.exec("SELECT id, deliveryKind, status FROM webhookDeliveries")[0].values).toEqual([
        [accepted.deliveryId, "test", "pending"],
      ]);
    } finally { reopened.close(); }
    expect(boundary.send).not.toHaveBeenCalled();
    const pending = await readResponse(await status.GET(incoming("GET", "/api/webhooks/deliveries")), 200);
    expect(pending.deliveries).toMatchObject([{ id: accepted.deliveryId, deliveryKind: "test", status: "pending" }]);
  });

  it.each([
    { url: "https://attacker.example.test/arbitrary" },
    { headers: { Authorization: AUTH_SECRET } },
    { payload: { prompt: "untrusted request data" } },
    { deliveryKind: "operational" },
    { destinationId: "another-destination" },
  ])("denied: test endpoint rejects arbitrary overrides %j without enqueue or egress", async (body) => {
    const saved = await target();
    const { test } = await routes();
    await readResponse(await test.POST(incoming("POST", `/api/webhooks/${saved.id}/test`, body), context(saved.id)), 400);
    expect(rows()).toEqual([]);
    expect(boundary.send).not.toHaveBeenCalled();
  });

  it("denied: test query cannot override the saved URL", async () => {
    const saved = await target();
    const { test } = await routes();
    await readResponse(await test.POST(incoming("POST", `/api/webhooks/${saved.id}/test?url=https://attacker.example.test`, {}), context(saved.id)), 400);
    expect(rows()).toEqual([]);
    expect(boundary.send).not.toHaveBeenCalled();
  });

  it("allowed: test rows obey the dispatcher gap and status changes only after transport acknowledgement", async () => {
    const saved = await target({ enabled: false });
    const { test, status } = await routes();
    const first = await readResponse(await test.POST(incoming("POST", `/api/webhooks/${saved.id}/test`, {}), context(saved.id)), 202);
    const second = await readResponse(await test.POST(incoming("POST", `/api/webhooks/${saved.id}/test`, {}), context(saved.id)), 202);
    let now = Date.now();
    const journal = [];
    let acknowledge;
    boundary.send.mockImplementation((request) => {
      journal.push({ url: request.url, payload: JSON.parse(request.body) });
      return new Promise((resolve) => { acknowledge = resolve; });
    });
    const controller = dispatcher.createWebhookDispatcher({ now: () => now, send: boundary.send, logger: { warn() {} } });
    const ticking = controller.tick();
    for (let step = 0; step < 50 && !acknowledge; step++) await Promise.resolve();
    expect(journal).toHaveLength(1);
    expect(journal[0].url).toBe(URL_SECRET);
    const beforeAck = await readResponse(await status.GET(incoming("GET", "/api/webhooks/deliveries")), 200);
    expect(beforeAck.deliveries.map((row) => row.status).sort()).toEqual(["inflight", "pending"]);
    acknowledge({ status: 204, headers: {} });
    await ticking;
    const afterAck = await readResponse(await status.GET(incoming("GET", "/api/webhooks/deliveries")), 200);
    expect(afterAck.deliveries.map((row) => row.status).sort()).toEqual(["delivered", "pending"]);
    await controller.tick();
    expect(journal).toHaveLength(1);
    now += 1000;
    boundary.send.mockResolvedValue({ status: 204, headers: {} });
    await controller.tick();
    const delivered = await readResponse(await status.GET(incoming("GET", "/api/webhooks/deliveries")), 200);
    expect(delivered.deliveries.map((row) => row.id).sort()).toEqual([first.deliveryId, second.deliveryId].sort());
    expect(delivered.deliveries.every((row) => row.status === "delivered")).toBe(true);
    expect(boundary.send).toHaveBeenCalledTimes(2);
  });

  it("denied: outbox capacity is 429 with safe degraded counters rather than a false 202", async () => {
    const saved = await target();
    const queued = await outbox.enqueueWebhookTest(saved.id);
    const seed = rows()[0];
    adapter.transaction(() => {
      for (let index = 1; index < 10000; index++) {
        adapter.run(`INSERT INTO webhookDeliveries
          (id,eventId,destinationId,destinationRevision,generation,deliveryKind,type,fingerprint,payload,status,attempts,nextAttemptAt,createdAt,expiresAt,suppressedCount)
          VALUES(?,?,?,?,?,'test',?,?,?,'pending',0,?,?,?,0)`,
        [`capacity-${index}`, `capacity-event-${index}`, saved.id, 1, seed.generation,
          seed.type, seed.fingerprint, seed.payload, seed.nextAttemptAt, seed.createdAt, seed.expiresAt]);
      }
    });
    adapter.flush();
    const { test, status } = await routes();
    const rejected = await readResponse(await test.POST(incoming("POST", `/api/webhooks/${saved.id}/test`, {}), context(saved.id)), 429);
    expect(rejected.errors).toContainEqual(expect.objectContaining({ code: "outbox_full" }));
    expect(rows()).toHaveLength(10000);
    expect(rows().some((row) => row.id === queued.deliveryIds[0])).toBe(true);
    expect(boundary.send).not.toHaveBeenCalled();
    const health = await readResponse(await status.GET(incoming("GET", "/api/webhooks/deliveries?limit=1")), 200);
    expect(health.deliveries).toHaveLength(1);
    expect(health.health).toMatchObject({ queue: { total: 10000, pending: 10000 },
      degraded: { enqueueFailures: 1, lastErrorClass: "outbox_full" } });
  }, 30000);

  it("allowed: status defaults to 20, filters by destination and reports test versus operational without payloads", async () => {
    const saved = await target({ cooldownSeconds: 0 });
    const other = await target({ name: "Other", enabled: false });
    for (let index = 0; index < 22; index++) await outbox.enqueueWebhookTest(saved.id);
    await outbox.enqueueWebhookTest(other.id);
    await outbox.enqueueWebhookEvent({ id: "12121212-1212-4212-8212-121212121212", type: "request.failed",
      schema_version: 1, occurred_at: new Date().toISOString(), severity: "error", data: { errorClass: "upstream_http" } });
    const { status } = await routes();
    const standard = await readResponse(await status.GET(incoming("GET", "/api/webhooks/deliveries")), 200);
    expect(standard.deliveries).toHaveLength(20);
    expect(standard.health).toMatchObject({ queue: { total: 24, pending: 24 }, degraded: { enqueueFailures: 0 } });
    const filtered = await readResponse(await status.GET(incoming("GET", `/api/webhooks/deliveries?destinationId=${saved.id}&limit=100`)), 200);
    expect(filtered.deliveries).toHaveLength(23);
    expect(filtered.deliveries.every((row) => row.destinationId === saved.id)).toBe(true);
    expect(new Set(filtered.deliveries.map((row) => row.deliveryKind))).toEqual(new Set(["test", "operational"]));
    for (const row of filtered.deliveries) {
      for (const key of ["payload", "leaseToken", "headers", "signingSecret", "url", "lastError", "responseBody"]) {
        expect(row).not.toHaveProperty(key);
      }
    }
  });

  it.each(["0", "101", "-1", "1.5", "1e2", "2garbage", "", "NaN", "20&limit=1"])(
    "denied: invalid or duplicate delivery limit %s is 400", async (limit) => {
      const { status } = await routes();
      await readResponse(await status.GET(incoming("GET", `/api/webhooks/deliveries?limit=${limit}`)), 400);
    },
  );

  it("allowed: status drops legacy raw lastErrorClass and never echoes upstream text", async () => {
    const saved = await target();
    await outbox.enqueueWebhookTest(saved.id);
    adapter.run("UPDATE webhookDeliveries SET lastErrorClass = ? WHERE destinationId = ?", [URL_SECRET + AUTH_SECRET, saved.id]);
    const { status } = await routes();
    const result = await readResponse(await status.GET(incoming("GET", "/api/webhooks/deliveries")), 200);
    expect(result.deliveries[0].lastErrorClass).toBeNull();
  });

  it("allowed: an unknown destination filter returns an empty history rather than leaking unrelated rows", async () => {
    const saved = await target();
    await outbox.enqueueWebhookTest(saved.id);
    const { status } = await routes();
    const result = await readResponse(await status.GET(incoming("GET", "/api/webhooks/deliveries?destinationId=missing&limit=1")), 200);
    expect(result.deliveries).toEqual([]);
    expect(result.health.queue).toMatchObject({ total: 1, pending: 1 });
  });

  it.each([
    ["disable", { enabled: false }],
    ["url", { url: "https://hooks.example.test/replacement-token" }],
    ["kind", { kind: "slack", clearHeaders: true }],
    ["headers", { headers: { Authorization: "Bearer replacement" } }],
    ["signing", { signingSecret: "replacement-signing-secret" }],
    ["network", { allowPrivateNetwork: true }],
    ["delete", null],
  ])("allowed: %s commits transactional revocation before best-effort abort", async (mode, patch) => {
    const saved = await target();
    await outbox.enqueueWebhookTest(saved.id);
    const lease = await outbox.claimNextWebhookDelivery();
    expect(lease).toMatchObject({ destinationId: saved.id });
    const observations = [];
    global._webhookDispatcher = { tick() {}, stop() {}, abortDestination(id) {
      observations.push({ id, rows: rows(), destination: adapter.get("SELECT revision FROM webhookDestinations WHERE id = ?", [id]) });
      throw new Error(URL_SECRET + AUTH_SECRET);
    } };
    const { item } = await routes();
    const method = mode === "delete" ? "DELETE" : "PATCH";
    const result = await readResponse(await item[method](incoming(method, `/api/webhooks/${saved.id}`, {
      ...patch, expectedRevision: 1,
    }), context(saved.id)), 200);
    expect(result.ok).toBe(true);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ id: saved.id, rows: [{ id: lease.id, status: "cancelled", leaseToken: null }] });
    if (mode === "delete") expect(observations[0].destination).toBeUndefined();
    else expect(observations[0].destination).toEqual({ revision: 2 });
    expect((await outbox.completeWebhookDelivery(lease, { status: "delivered", lastStatus: 204 })).applied).toBe(false);
  });

  it("denied: failed repo mutation never aborts or cancels persisted work", async () => {
    const saved = await target();
    await outbox.enqueueWebhookTest(saved.id);
    const abort = vi.fn();
    global._webhookDispatcher = { tick() {}, stop() {}, abortDestination: abort };
    const { item } = await routes();
    await readResponse(await item.PATCH(incoming("PATCH", `/api/webhooks/${saved.id}`, {
      enabled: false, expectedRevision: 99,
    }), context(saved.id)), 409);
    expect(abort).not.toHaveBeenCalled();
    expect(rows()[0].status).toBe("pending");
  });

  it("allowed: disable cancels old tests but a newly explicit disabled test remains eligible", async () => {
    const saved = await target();
    const old = await outbox.enqueueWebhookTest(saved.id);
    const { item, test } = await routes();
    await readResponse(await item.PATCH(incoming("PATCH", `/api/webhooks/${saved.id}`, { enabled: false }), context(saved.id)), 200);
    const fresh = await readResponse(await test.POST(incoming("POST", `/api/webhooks/${saved.id}/test`, {}), context(saved.id)), 202);
    boundary.send.mockResolvedValue({ status: 204, headers: {} });
    const controller = dispatcher.createWebhookDispatcher({ send: boundary.send });
    await controller.tick();
    expect(rows().find((row) => row.id === old.deliveryIds[0]).status).toBe("cancelled");
    expect(rows().find((row) => row.id === fresh.deliveryId)).toMatchObject({ deliveryKind: "test", status: "delivered", destinationRevision: 2 });
    expect(boundary.send).toHaveBeenCalledTimes(1);
  });

  it("allowed: subscription/cooldown edits preserve pending deliveries instead of revoking sockets", async () => {
    const saved = await target();
    const queued = await outbox.enqueueWebhookTest(saved.id);
    const abort = vi.fn();
    global._webhookDispatcher = { tick() {}, stop() {}, abortDestination: abort };
    const { item } = await routes();
    await readResponse(await item.PATCH(incoming("PATCH", `/api/webhooks/${saved.id}`, {
      name: "Renamed", events: ["token.refresh_failed"], cooldownSeconds: 15,
    }), context(saved.id)), 200);
    expect(rows()).toMatchObject([{ id: queued.deliveryIds[0], status: "pending", destinationRevision: 2 }]);
    expect(abort).not.toHaveBeenCalled();
  });

  it("denied: storage exceptions are sanitized for CRUD, test and status", async () => {
    const saved = await target();
    const { collection, item, test, status } = await routes();
    const fail = () => { throw new Error(`${URL_SECRET} ${AUTH_SECRET} ${SIGNING_SECRET} SQL-private-message`); };
    vi.spyOn(adapter, "transaction").mockImplementation(fail);
    vi.spyOn(adapter, "all").mockImplementation(fail);
    const logs = ["log", "warn", "error"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    for (const attempt of [
      () => collection.GET(incoming("GET", "/api/webhooks")),
      () => collection.POST(incoming("POST", "/api/webhooks", input())),
      () => item.PATCH(incoming("PATCH", `/api/webhooks/${saved.id}`, { enabled: false }), context(saved.id)),
      () => item.DELETE(incoming("DELETE", `/api/webhooks/${saved.id}`, {}), context(saved.id)),
      () => test.POST(incoming("POST", `/api/webhooks/${saved.id}/test`, {}), context(saved.id)),
      () => status.GET(incoming("GET", "/api/webhooks/deliveries")),
    ]) {
      const body = await readResponse(await attempt(), 500);
      expect(body).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "storage_error" })] });
      expect(JSON.stringify(body)).not.toContain("SQL-private-message");
      expect(body).not.toHaveProperty("stack");
    }
    for (const log of logs) for (const call of log.mock.calls) {
      expectSecretSafe(call.map((entry) => entry instanceof Error ? { message: entry.message, stack: entry.stack } : entry));
    }
  });

  it("denied: flush failure cannot acknowledge a test as accepted and records degradation", async () => {
    const saved = await target();
    const { test, status } = await routes();
    const flush = vi.spyOn(adapter, "flush").mockImplementationOnce(() => { throw new Error(URL_SECRET + SIGNING_SECRET); });
    const body = await readResponse(await test.POST(incoming("POST", `/api/webhooks/${saved.id}/test`, {}), context(saved.id)), 500);
    expect(body.errors).toContainEqual(expect.objectContaining({ code: "storage_error" }));
    expect(body).not.toHaveProperty("deliveryId");
    flush.mockRestore();
    expect(boundary.send).not.toHaveBeenCalled();
    const health = await readResponse(await status.GET(incoming("GET", "/api/webhooks/deliveries")), 200);
    expect(health.health.degraded).toMatchObject({ enqueueFailures: 1, lastErrorClass: "storage_error" });
  });

  it.each(RESERVED)("denied: generic settings reject reserved prefix key %s before any mixed write", async (key) => {
    const route = await import("@/app/api/settings/route.js");
    const before = await settings.getSettings();
    const result = await readResponse(await route.PATCH(incoming("PATCH", "/api/settings", {
      [key]: { url: URL_SECRET, signingSecret: SIGNING_SECRET }, requireLogin: true,
    })), 400);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "reserved_webhook_key" }));
    const after = await settings.getSettings();
    expect(after.requireLogin).toBe(before.requireLogin);
    expect(after).not.toHaveProperty(key);
    expect(await destinations.listWebhookDestinations()).toEqual([]);
  });

  it("allowed: settings GET and PATCH omit legacy reserved keys without deleting their stored values", async () => {
    await settings.updateSettings(Object.fromEntries(RESERVED.map((key) => [key, { url: URL_SECRET, signingSecret: SIGNING_SECRET }])));
    const route = await import("@/app/api/settings/route.js");
    for (const response of [
      await route.GET(),
      await route.PATCH(incoming("PATCH", "/api/settings", { stickyRoundRobinLimit: 4 })),
    ]) {
      const safe = await readResponse(response, 200);
      for (const key of RESERVED) expect(safe).not.toHaveProperty(key);
    }
    const stored = await settings.getSettings();
    expect(stored.stickyRoundRobinLimit).toBe(4);
    expect(stored.webhooks).toMatchObject({ url: URL_SECRET });
  });
});
