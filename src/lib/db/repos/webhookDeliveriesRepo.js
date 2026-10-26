import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { rowToRaw } from "./webhooksRepo.js";
import { validateEventEnvelope, validatePayloadSize } from "@/lib/webhooks/validation.js";
import { WEBHOOK_ERROR_CLASSES } from "@/shared/constants/webhooks.js";

const DAY = 86_400_000;
const ACTIVE = "('pending', 'retry', 'inflight')";
const TERMINAL = "('delivered', 'failed', 'cancelled', 'expired')";
const failure = (field, code) => ({ ok: false, errors: [{ field, code }] });
const iso = (now) => new Date(now).toISOString();
const clock = ({ now = Date.now() } = {}) => {
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) throw new RangeError("Invalid webhook clock");
  return now;
};

// Acquire SQLite's write lock before any reads, including on deferred adapters.
export function lockWebhookOutboxSync(db) {
  db.run("UPDATE _meta SET value = value WHERE key = 'webhookGeneration'");
}

function generation(db) {
  const value = Number(db.get("SELECT value FROM _meta WHERE key = 'webhookGeneration'")?.value);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid webhook generation");
  return value;
}

function kv(db, key) {
  return parseJson(db.get("SELECT value FROM kv WHERE scope = 'webhookCooldown' AND key = ?", [key])?.value, null);
}

function putKv(db, key, value) {
  db.run("INSERT INTO kv(scope, key, value) VALUES('webhookCooldown', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value", [key, stringifyJson(value)]);
}

export function cancelWebhookDeliveriesSync(db, destinationId, now) {
  return Number(db.run(`UPDATE webhookDeliveries SET status = 'cancelled', finishedAt = ?, leaseToken = NULL, leaseUntil = NULL
    WHERE destinationId = ? AND status IN ${ACTIVE}`, [iso(now), destinationId]).changes);
}

// Caller owns transaction and post-commit flush, allowing atomic logical import.
export function resetWebhookOutboxSync(db) {
  lockWebhookOutboxSync(db);
  const next = generation(db) + 1;
  if (!Number.isSafeInteger(next)) throw new RangeError("Webhook generation exhausted");
  db.run("UPDATE _meta SET value = ? WHERE key = 'webhookGeneration'", [String(next)]);
  db.run("DELETE FROM webhookDeliveries WHERE generation IS NOT NULL");
  db.run("DELETE FROM kv WHERE scope = 'webhookCooldown'");
  return { ok: true, generation: next };
}

function pruneSync(db, now) {
  const time = iso(now);
  db.run(`UPDATE webhookDeliveries SET status = 'cancelled', finishedAt = ?, leaseToken = NULL, leaseUntil = NULL
    WHERE status IN ${ACTIVE} AND (generation <> ? OR NOT EXISTS (
      SELECT 1 FROM webhookDestinations d WHERE d.id = webhookDeliveries.destinationId
      AND d.revision = webhookDeliveries.destinationRevision AND (d.enabled = 1 OR webhookDeliveries.deliveryKind = 'test')))`, [time, generation(db)]);
  db.run(`UPDATE webhookDeliveries SET status = 'expired', finishedAt = ?, leaseToken = NULL, leaseUntil = NULL
    WHERE expiresAt <= ? AND (status IN ('pending', 'retry') OR (status = 'inflight' AND leaseUntil <= ?))`, [time, time, time]);
  db.run(`UPDATE webhookDeliveries SET status = 'failed', finishedAt = ?, leaseToken = NULL, leaseUntil = NULL
    WHERE attempts >= 8 AND (status IN ('pending', 'retry') OR (status = 'inflight' AND leaseUntil <= ?))`, [time, time]);
  db.run(`DELETE FROM webhookDeliveries WHERE status IN ${TERMINAL} AND finishedAt <= ?`, [iso(now - 7 * DAY)]);
}

function fingerprint(envelope) {
  return crypto.createHash("sha256").update(stringifyJson([
    envelope.type, ...["modality", "provider", "model", "connectionId", "errorClass", "statusCode", "partialResponse"].map((key) => envelope.data[key] ?? null),
  ])).digest("hex");
}

async function enqueue(envelope, now, testDestinationId = null) {
  const checked = validateEventEnvelope(envelope);
  if (!checked.ok) return checked;
  const sized = validatePayloadSize(checked.value);
  if (!sized.ok) return sized;
  const db = await getAdapter();
  let outcome;
  try {
    outcome = db.transaction(() => {
      lockWebhookOutboxSync(db);
      const currentGeneration = generation(db);
      const targets = db.all("SELECT * FROM webhookDestinations ORDER BY createdAt, id")
        .filter((target) => testDestinationId !== null ? target.id === testDestinationId : target.enabled === 1)
        .filter((target) => testDestinationId !== null || parseJson(target.data, {}).events?.includes(checked.value.type));
      if (testDestinationId !== null && targets.length === 0) return failure("id", "not_found");
      const hash = fingerprint(checked.value);
      const entries = targets.filter((target) => !db.get("SELECT id FROM webhookDeliveries WHERE eventId = ? AND destinationId = ?", [envelope.id, target.id]))
        .map((target) => {
          const key = `${target.id}:${hash}`;
          const state = kv(db, key);
          const seconds = parseJson(target.data, {}).cooldownSeconds ?? 300;
          const suppressed = testDestinationId === null && seconds > 0 && state && now < state.sentAt + seconds * 1000;
          return { target, key, state, suppressed };
        });
      pruneSync(db, now);
      const needed = entries.filter((entry) => !entry.suppressed).length;
      const count = Number(db.get("SELECT COUNT(*) AS c FROM webhookDeliveries").c);
      const excess = Math.max(0, count + needed - 10000);
      const disposable = db.all(`SELECT id FROM webhookDeliveries WHERE status IN ${TERMINAL} ORDER BY finishedAt, createdAt, id LIMIT ?`, [excess]);
      if (disposable.length < excess) {
        throw Object.assign(new Error("Webhook capacity reached"), { code: "outbox_full" });
      }
      for (const row of disposable) db.run("DELETE FROM webhookDeliveries WHERE id = ?", [row.id]);
      const result = { ok: true, deliveryIds: [], suppressedCount: 0 };
      for (const { target, key, state, suppressed } of entries) {
        if (suppressed) {
          putKv(db, key, { sentAt: state.sentAt, suppressedCount: (state.suppressedCount || 0) + 1 });
          result.suppressedCount += 1;
          continue;
        }
        const id = crypto.randomUUID();
        db.run(`INSERT INTO webhookDeliveries
          (id, eventId, destinationId, destinationRevision, generation, deliveryKind, type, fingerprint, payload, status, attempts, nextAttemptAt, createdAt, expiresAt, suppressedCount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
        [id, envelope.id, target.id, target.revision, currentGeneration, testDestinationId === null ? "operational" : "test", envelope.type,
          hash, stringifyJson(checked.value), iso(now), iso(now), iso(now + DAY), testDestinationId === null ? state?.suppressedCount || 0 : 0]);
        if (testDestinationId === null) putKv(db, key, { sentAt: now, suppressedCount: 0 });
        result.deliveryIds.push(id);
      }
      return result;
    });
  } catch (error) {
    return failure("outbox", error.code === "outbox_full" ? "outbox_full" : "storage_error");
  }
  db.flush();
  return outcome;
}

export async function enqueueWebhookEvent(envelope, options = {}) {
  return enqueue(envelope, clock(options));
}

export async function enqueueWebhookTest(destinationId, options = {}) {
  if (typeof destinationId !== "string" || !destinationId) return failure("id", "not_found");
  const now = clock(options);
  return enqueue({ id: crypto.randomUUID(), type: "request.failed", schema_version: 1,
    occurred_at: iso(now), severity: "error", data: { errorClass: "internal" } }, now, destinationId);
}

const LIVE = `id = ? AND destinationId = ? AND destinationRevision = ? AND generation = ? AND leaseToken = ?
  AND status = 'inflight' AND leaseUntil > ?
  AND generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'webhookGeneration')
  AND EXISTS (SELECT 1 FROM webhookDestinations d WHERE d.id = webhookDeliveries.destinationId
    AND d.revision = webhookDeliveries.destinationRevision AND (d.enabled = 1 OR webhookDeliveries.deliveryKind = 'test'))`;

function leaseParams(lease, now) {
  if (!lease || typeof lease.id !== "string" || typeof lease.destinationId !== "string"
    || typeof lease.leaseToken !== "string" || !Number.isSafeInteger(lease.destinationRevision)
    || !Number.isSafeInteger(lease.generation)) return null;
  return [lease.id, lease.destinationId, lease.destinationRevision, lease.generation, lease.leaseToken, iso(now)];
}

export async function claimNextWebhookDelivery(options = {}) {
  const now = clock(options);
  const time = iso(now);
  const db = await getAdapter();
  const leased = db.transaction(() => {
    lockWebhookOutboxSync(db);
    pruneSync(db, now);
    const candidates = db.all(`SELECT q.* FROM webhookDeliveries q
      JOIN webhookDestinations d ON d.id = q.destinationId AND d.revision = q.destinationRevision
      WHERE q.generation = ? AND (d.enabled = 1 OR q.deliveryKind = 'test') AND q.attempts < 8 AND q.expiresAt > ?
      AND ((q.status IN ('pending', 'retry') AND q.nextAttemptAt <= ?) OR (q.status = 'inflight' AND q.leaseUntil <= ?))
      AND NOT EXISTS (SELECT 1 FROM webhookDeliveries busy WHERE busy.destinationId = q.destinationId AND busy.status = 'inflight' AND busy.leaseUntil > ?)
      ORDER BY q.nextAttemptAt, q.createdAt, q.id`, [generation(db), time, time, time, time]);
    if (Number(db.get("SELECT COUNT(*) AS c FROM webhookDeliveries WHERE status = 'inflight' AND leaseUntil > ?", [time]).c) >= 2) return null;
    for (const candidate of candidates) {
      const sendKey = `send:${candidate.destinationId}`;
      const last = kv(db, sendKey);
      if (last && now < last.sentAt + 1000) continue;
      const payload = parseJson(candidate.payload, null);
      if (!validateEventEnvelope(payload).ok || !validatePayloadSize(candidate.payload).ok || payload.id !== candidate.eventId || payload.type !== candidate.type) {
        db.run("UPDATE webhookDeliveries SET status = 'failed', finishedAt = ?, leaseToken = NULL, leaseUntil = NULL, lastErrorClass = 'internal' WHERE id = ?", [time, candidate.id]);
        continue;
      }
      const token = crypto.randomUUID();
      const changed = db.run(`UPDATE webhookDeliveries SET status = 'inflight', attempts = attempts + 1, leaseToken = ?, leaseUntil = ?
        WHERE id = ? AND generation = ? AND destinationRevision = ? AND attempts = ?
        AND ((status IN ('pending', 'retry') AND nextAttemptAt <= ?) OR (status = 'inflight' AND leaseUntil <= ?))
        AND NOT EXISTS (SELECT 1 FROM webhookDeliveries busy WHERE busy.destinationId = webhookDeliveries.destinationId AND busy.status = 'inflight' AND busy.leaseUntil > ?)`,
      [token, iso(now + 30_000), candidate.id, candidate.generation, candidate.destinationRevision, candidate.attempts, time, time, time]);
      if (Number(changed.changes) !== 1) continue;
      putKv(db, sendKey, { sentAt: now });
      return { ...candidate, payload, status: "inflight", attempts: Number(candidate.attempts) + 1, leaseToken: token, leaseUntil: iso(now + 30_000) };
    }
    return null;
  });
  db.flush();
  return leased;
}

export async function getWebhookDeliveryDestination(lease, options = {}) {
  const params = leaseParams(lease, clock(options));
  if (!params) return null;
  const db = await getAdapter();
  const destination = db.get(`SELECT d.* FROM webhookDestinations d WHERE d.id = ? AND EXISTS
    (SELECT 1 FROM webhookDeliveries WHERE ${LIVE})`, [lease.destinationId, ...params]);
  return rowToRaw(destination);
}

function checkCompletion(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)
    || Object.keys(result).some((key) => !["status", "lastStatus", "lastErrorClass", "nextAttemptAt"].includes(key))
    || !["delivered", "failed", "retry"].includes(result.status)) return false;
  if (result.lastStatus != null && (!Number.isInteger(result.lastStatus) || result.lastStatus < 100 || result.lastStatus > 599)) return false;
  if (result.lastErrorClass != null && !WEBHOOK_ERROR_CLASSES.includes(result.lastErrorClass)) return false;
  return result.status !== "retry" || (typeof result.nextAttemptAt === "string" && Number.isFinite(Date.parse(result.nextAttemptAt)));
}

export async function completeWebhookDelivery(lease, result, options = {}) {
  const now = clock(options);
  if (!checkCompletion(result)) return failure("completion", "invalid_completion");
  const params = leaseParams(lease, now);
  if (!params) return { ok: true, applied: false };
  const db = await getAdapter();
  const outcome = db.transaction(() => {
    lockWebhookOutboxSync(db);
    const current = db.get(`SELECT * FROM webhookDeliveries WHERE ${LIVE}`, params);
    if (!current) return { ok: true, applied: false };
    let status = result.status;
    const next = status === "retry" ? iso(Math.max(now, Date.parse(result.nextAttemptAt))) : current.nextAttemptAt;
    if (status === "retry" && next >= current.expiresAt) status = "expired";
    else if (status === "retry" && current.attempts >= 8) status = "failed";
    const updated = db.run(`UPDATE webhookDeliveries SET status = ?, nextAttemptAt = ?, finishedAt = ?, lastStatus = ?, lastErrorClass = ?, leaseToken = NULL, leaseUntil = NULL WHERE ${LIVE}`,
      [status, next, status === "retry" ? null : iso(now), result.lastStatus ?? null, result.lastErrorClass ?? null, ...params]);
    return { ok: true, applied: Number(updated.changes) === 1 };
  });
  db.flush();
  return outcome;
}

export async function cancelWebhookDeliveries(destinationId, options = {}) {
  if (typeof destinationId !== "string" || !destinationId) return failure("id", "invalid_type");
  const now = clock(options);
  const db = await getAdapter();
  const cancelledCount = db.transaction(() => {
    lockWebhookOutboxSync(db);
    return cancelWebhookDeliveriesSync(db, destinationId, now);
  });
  db.flush();
  return { ok: true, cancelledCount };
}

export async function pruneWebhookDeliveries(options = {}) {
  const now = clock(options);
  const db = await getAdapter();
  db.transaction(() => { lockWebhookOutboxSync(db); pruneSync(db, now); });
  db.flush();
  return { ok: true };
}

export async function resetWebhookOutbox(options = {}) {
  clock(options);
  const db = await getAdapter();
  const outcome = db.transaction(() => resetWebhookOutboxSync(db));
  db.flush();
  return outcome;
}

export async function listWebhookDeliveries({ destinationId, limit = 20 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Invalid webhook delivery limit");
  if (destinationId !== undefined && typeof destinationId !== "string") throw new TypeError("Invalid webhook destination id");
  const db = await getAdapter();
  return db.all(`SELECT id, eventId, destinationId, destinationRevision, generation, deliveryKind, type, status, attempts,
    nextAttemptAt, createdAt, expiresAt, finishedAt, lastStatus, lastErrorClass, suppressedCount
    FROM webhookDeliveries ${destinationId === undefined ? "" : "WHERE destinationId = ?"} ORDER BY createdAt DESC, id DESC LIMIT ?`,
  destinationId === undefined ? [limit] : [destinationId, limit]).map((row) => ({
    ...row, lastErrorClass: WEBHOOK_ERROR_CLASSES.includes(row.lastErrorClass) ? row.lastErrorClass : null,
  }));
}

export async function getWebhookQueueHealth() {
  const db = await getAdapter();
  const queue = { total: 0, pending: 0, inflight: 0, retry: 0, delivered: 0, failed: 0, cancelled: 0, expired: 0 };
  for (const row of db.all("SELECT status, COUNT(*) AS count FROM webhookDeliveries GROUP BY status")) {
    const count = Number(row.count);
    queue.total += count;
    if (Object.hasOwn(queue, row.status) && row.status !== "total") queue[row.status] = count;
  }
  return queue;
}
