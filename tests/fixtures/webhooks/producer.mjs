// Child-process fixture for tests/unit/webhook-integration.e2e.test.js.
//
// Every mode owns its own SQLite connection to DATA_DIR. The parent only reads
// stdout and sends signals, so crash recovery is observed across real process
// boundaries. Hanging modes print one fixture line and then wait for SIGKILL.
const PREFIX = "FIXTURE:";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixtureConfig() {
  const raw = process.env.WEBHOOK_FIXTURE;
  if (!raw) throw new Error("WEBHOOK_FIXTURE is required");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("WEBHOOK_FIXTURE must be an object");
  return parsed;
}

function emit(payload) {
  process.stdout.write(`${PREFIX}${JSON.stringify(payload)}\n`);
}

function stayAlive() {
  setInterval(() => {}, 1 << 30);
}

async function load() {
  if (!process.env.DATA_DIR) throw new Error("DATA_DIR is required");
  const { getAdapter } = await import("../../../src/lib/db/driver.js");
  const db = await getAdapter();
  const destinations = await import("../../../src/lib/db/repos/webhooksRepo.js");
  const outbox = await import("../../../src/lib/db/repos/webhookDeliveriesRepo.js");
  return { db, destinations, outbox };
}

function envelope(eventId, now, config = {}) {
  return {
    id: eventId,
    type: config.type || "request.failed",
    schema_version: 1,
    occurred_at: new Date(now).toISOString(),
    severity: "error",
    data: {
      requestId: config.requestId || `fixture-request-${eventId}`,
      modality: config.modality || "chat",
      provider: "cx",
      model: "fixture-model",
      errorClass: "upstream_http",
      statusCode: 503,
      partialResponse: false,
    },
  };
}

async function main() {
  const config = fixtureConfig();
  const mode = config.mode;

  if (mode === "prepare") {
    const { db, destinations } = await load();
    const created = await destinations.createWebhookDestination({
      name: config.name || "Fixture receiver",
      kind: "generic",
      url: config.url,
      enabled: config.enabled !== false,
      events: Array.isArray(config.events) ? config.events : ["request.failed"],
      allowPrivateNetwork: true,
      cooldownSeconds: 0,
      signingSecret: config.signingSecret || "fixture-signing-secret-not-for-production",
    });
    if (!created.ok) throw new Error(`create destination failed: ${JSON.stringify(created.errors)}`);
    emit({
      mode,
      driver: db.driver,
      destinationId: created.destination.id,
      revision: created.destination.revision,
    });
    db.close();
    return;
  }

  if (mode === "enqueue") {
    const { db, outbox } = await load();
    const result = await outbox.enqueueWebhookEvent(envelope(config.eventId, config.now, config), { now: config.now });
    db.flush();
    emit({ mode, driver: db.driver, result });
    if (config.hang === true) {
      emit({ mode, ready: true });
      stayAlive();
      return;
    }
    db.close();
    return;
  }

  if (mode === "enqueue-test") {
    const { db, outbox } = await load();
    const result = await outbox.enqueueWebhookTest(config.destinationId, { now: config.now });
    db.flush();
    emit({ mode, driver: db.driver, result });
    db.close();
    return;
  }

  if (mode === "disable" || mode === "rename") {
    const { db, destinations } = await load();
    const patch = mode === "disable" ? { enabled: false } : { name: config.value || "Renamed destination" };
    const result = await destinations.updateWebhookDestination(config.destinationId, patch);
    db.flush();
    emit({ mode, driver: db.driver, result });
    db.close();
    return;
  }

  if (mode === "reset") {
    const { db, outbox } = await load();
    const result = await outbox.resetWebhookOutbox({ now: config.now });
    db.flush();
    emit({ mode, driver: db.driver, result });
    db.close();
    return;
  }

  if (mode === "claim") {
    const { db, outbox } = await load();
    const lease = await outbox.claimNextWebhookDelivery({ now: config.now });
    emit({ mode, driver: db.driver, lease });
    db.close();
    return;
  }

  if (mode === "deliver" || mode === "deliver-partial") {
    const { db, outbox } = await load();
    const { deliverWebhookLease, buildDestinationRequest } = await import("../../../src/lib/webhooks/dispatcher.js");
    const { sendWebhook } = await import("../../../src/lib/webhooks/transport.js");
    const clock = Number.isFinite(config.now) ? config.now : Date.now();
    const now = () => clock;
    if (mode === "deliver-partial") {
      const lease = await outbox.claimNextWebhookDelivery({ now: clock });
      if (!lease) throw new Error("no due delivery to send");
      const destination = await outbox.getWebhookDeliveryDestination(lease, { now: clock });
      if (!destination) throw new Error("claimed destination is not live");
      const request = buildDestinationRequest(
        { ...destination, suppressedCount: lease.suppressedCount },
        lease.payload,
        clock,
      );
      const response = await sendWebhook(request);
      emit({
        mode, driver: db.driver, eventId: lease.eventId, deliveryId: lease.id,
        leaseToken: lease.leaseToken, status: response.status,
      });
      // Deliberately no completeWebhookDelivery(): the parent kills this process.
      emit({ mode, ready: true });
      stayAlive();
      return;
    }
    const outcomes = [];
    const limit = Number.isInteger(config.max) ? config.max : 10;
    for (let index = 0; index < limit; index += 1) {
      const lease = await outbox.claimNextWebhookDelivery({ now: clock });
      if (!lease) break;
      const result = await deliverWebhookLease(lease, { now });
      outcomes.push({ eventId: lease.eventId, deliveryId: lease.id, deliveryKind: lease.deliveryKind, ...result });
    }
    db.flush();
    emit({ mode, driver: db.driver, outcomes });
    db.close();
    return;
  }

  if (mode === "deliver-lease") {
    const { db } = await load();
    const { deliverWebhookLease } = await import("../../../src/lib/webhooks/dispatcher.js");
    const clock = Number.isFinite(config.now) ? config.now : Date.now();
    const result = await deliverWebhookLease(config.lease, { now: () => clock });
    db.flush();
    emit({ mode, driver: db.driver, result });
    db.close();
    return;
  }

  if (mode === "emit-failure") {
    const { db } = await load();
    const events = await import("../../../src/lib/webhooks/events.js");
    const dispatcher = await import("../../../src/lib/webhooks/dispatcher.js");
    const controller = dispatcher.createWebhookDispatcher({ intervalMs: 3_600_000 });
    controller.start();
    try {
      const finalized = events.runWithWebhookContext(
        { requestId: config.requestId || "fixture-routing-request", modality: "chat" },
        () => {
          events.markWebhookAdmitted();
          return events.finalizeWebhookRequest({
            outcome: "failed",
            modality: "chat",
            statusCode: 503,
            errorClass: "upstream_http",
            partialResponse: false,
          });
        },
      );
      let row = null;
      for (let index = 0; index < 200 && !row; index += 1) {
        row = db.get("SELECT id, eventId, type, deliveryKind, status, nextAttemptAt FROM webhookDeliveries ORDER BY createdAt DESC, id DESC LIMIT 1");
        if (!row) await delay(10);
      }
      db.flush();
      emit({ mode, driver: db.driver, finalized, row });
    } finally {
      controller.stop();
    }
    db.close();
    return;
  }

  if (mode === "inspect") {
    const { db } = await load();
    const rows = db.all(`SELECT id, eventId, destinationId, destinationRevision, generation,
      deliveryKind, type, status, attempts, lastStatus, lastErrorClass
      FROM webhookDeliveries ORDER BY createdAt, id`);
    emit({ mode, driver: db.driver, rows });
    db.close();
    return;
  }

  throw new Error(`unknown fixture mode: ${mode}`);
}

main().catch((error) => {
  process.stderr.write(`FIXTURE_ERROR:${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
