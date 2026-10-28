import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { toSafeDestination, validateDestinationInput } from "@/lib/webhooks/validation.js";
import { WEBHOOK_LIMITS } from "@/shared/constants/webhooks.js";
import { cancelWebhookDeliveriesSync, lockWebhookOutboxSync } from "./webhookDeliveriesRepo.js";

const failure = (errors) => ({ ok: false, errors });

export function rowToRaw(row) {
  if (!row) return null;
  const data = parseJson(row.data, {});
  const headers = data.headers && typeof data.headers === "object" && !Array.isArray(data.headers)
    ? { ...data.headers }
    : {};
  return {
    id: row.id,
    revision: Number(row.revision) || 1,
    name: data.name ?? "",
    kind: data.kind ?? null,
    url: data.url ?? null,
    enabled: row.enabled === 1 || row.enabled === true,
    events: Array.isArray(data.events) ? [...data.events] : [],
    allowPrivateNetwork: data.allowPrivateNetwork === true,
    cooldownSeconds: Number.isInteger(data.cooldownSeconds)
      ? data.cooldownSeconds
      : WEBHOOK_LIMITS.cooldownDefaultSeconds,
    signingSecret: typeof data.signingSecret === "string" && data.signingSecret.length > 0
      ? data.signingSecret
      : null,
    headers,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rawToConfig(raw) {
  const config = {
    name: raw.name,
    kind: raw.kind,
    url: raw.url,
    enabled: raw.enabled,
    events: raw.events,
    allowPrivateNetwork: raw.allowPrivateNetwork,
    cooldownSeconds: raw.cooldownSeconds,
  };
  if (raw.signingSecret) config.signingSecret = raw.signingSecret;
  if (Object.keys(raw.headers).length > 0) config.headers = raw.headers;
  return config;
}

function configToData(value) {
  const data = {
    name: value.name,
    kind: value.kind,
    url: value.url,
    events: value.events,
    allowPrivateNetwork: value.allowPrivateNetwork === true,
    cooldownSeconds: value.cooldownSeconds,
  };
  if (value.signingSecret) data.signingSecret = value.signingSecret;
  if (value.headers && Object.keys(value.headers).length > 0) data.headers = value.headers;
  return data;
}

function generateSigningSecret() {
  return `whsec_${crypto.randomBytes(32).toString("base64")}`;
}

function ensureSigningSecret(value) {
  if (value.kind !== "generic" || value.signingSecret) return value;
  return { ...value, signingSecret: generateSigningSecret() };
}

function rawFromValue(id, revision, value, createdAt, updatedAt) {
  return {
    id,
    revision,
    name: value.name,
    kind: value.kind,
    url: value.url,
    enabled: value.enabled !== false,
    events: Array.isArray(value.events) ? [...value.events] : [],
    allowPrivateNetwork: value.allowPrivateNetwork === true,
    cooldownSeconds: value.cooldownSeconds,
    signingSecret: value.signingSecret || null,
    headers: value.headers ? { ...value.headers } : {},
    createdAt,
    updatedAt,
  };
}

async function readRow(id) {
  const db = await getAdapter();
  return db.get(`SELECT * FROM webhookDestinations WHERE id = ?`, [id]);
}

export async function listWebhookDestinations() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM webhookDestinations ORDER BY createdAt ASC, id ASC`)
    .map((row) => toSafeDestination(rowToRaw(row)));
}

export async function getWebhookDestinationById(id) {
  const row = await readRow(id);
  return row ? toSafeDestination(rowToRaw(row)) : null;
}

export async function getWebhookDestinationRawById(id) {
  return rowToRaw(await readRow(id));
}

export async function exportWebhookDestinationsRaw() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM webhookDestinations ORDER BY createdAt ASC, id ASC`).map(rowToRaw);
}

export async function createWebhookDestination(input) {
  const checked = validateDestinationInput(input, { mode: "create" });
  if (!checked.ok) return failure(checked.errors);

  const db = await getAdapter();
  const now = new Date().toISOString();
  const value = ensureSigningSecret(checked.value);
  let outcome = null;

  db.transaction(() => {
    const countRow = db.get(`SELECT COUNT(*) AS c FROM webhookDestinations`);
    if (Number(countRow?.c ?? 0) >= WEBHOOK_LIMITS.maxDestinations) {
      outcome = failure([{ field: "destinations", code: "destination_limit" }]);
      return;
    }
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO webhookDestinations(id, revision, data, enabled, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, 1, stringifyJson(configToData(value)), value.enabled === false ? 0 : 1, now, now],
    );
    outcome = {
      ok: true,
      revision: 1,
      destination: toSafeDestination(rawFromValue(id, 1, value, now, now)),
    };
  });

  if (outcome.ok) db.flush();
  return outcome;
}

export async function updateWebhookDestination(id, patch, options = {}) {
  const checkedPatch = validateDestinationInput(patch, { mode: "patch" });
  if (!checkedPatch.ok) return failure(checkedPatch.errors);

  const db = await getAdapter();
  let outcome = null;

  db.transaction(() => {
    lockWebhookOutboxSync(db);
    const row = db.get(`SELECT * FROM webhookDestinations WHERE id = ?`, [id]);
    if (!row) {
      outcome = failure([{ field: "id", code: "not_found" }]);
      return;
    }
    const currentRevision = Number(row.revision) || 1;
    if (options.expectedRevision !== undefined
      && Number(options.expectedRevision) !== currentRevision) {
      outcome = failure([{ field: "revision", code: "revision_conflict" }]);
      return;
    }

    const { clearSigningSecret, clearHeaders, ...changes } = patch;
    const config = rawToConfig(rowToRaw(row));
    if (clearHeaders === true) delete config.headers;
    if (clearSigningSecret === true) delete config.signingSecret;
    Object.assign(config, changes);

    const checked = validateDestinationInput(config, { mode: "create" });
    if (!checked.ok) {
      outcome = failure(checked.errors);
      return;
    }

    const value = ensureSigningSecret(checked.value);
    const now = new Date().toISOString();
    const nextRevision = currentRevision + 1;
    const updated = db.run(
      `UPDATE webhookDestinations SET revision = ?, data = ?, enabled = ?, updatedAt = ? WHERE id = ? AND revision = ?`,
      [nextRevision, stringifyJson(configToData(value)), value.enabled === false ? 0 : 1, now, id, currentRevision],
    );
    if (Number(updated.changes) !== 1) {
      outcome = failure([{ field: "revision", code: "revision_conflict" }]);
      return;
    }
    const previous = rowToRaw(row);
    const securityChanged = ["url", "kind", "signingSecret", "allowPrivateNetwork"].some((key) => previous[key] !== (value[key] ?? null))
      || stringifyJson(previous.headers) !== stringifyJson(value.headers || {})
      || (previous.enabled && value.enabled === false);
    if (securityChanged) cancelWebhookDeliveriesSync(db, id, Date.parse(now));
    else {
      db.run(`UPDATE webhookDeliveries SET destinationRevision = ? WHERE destinationId = ? AND destinationRevision = ?
        AND status IN ('pending', 'retry')`, [nextRevision, id, currentRevision]);
    }
    outcome = {
      ok: true,
      revision: nextRevision,
      destination: toSafeDestination(rawFromValue(id, nextRevision, value, row.createdAt, now)),
    };
  });

  if (outcome.ok) db.flush();
  return outcome;
}

export async function deleteWebhookDestination(id, options = {}) {
  const db = await getAdapter();
  let outcome = null;

  db.transaction(() => {
    lockWebhookOutboxSync(db);
    const row = db.get(`SELECT * FROM webhookDestinations WHERE id = ?`, [id]);
    if (!row) {
      outcome = failure([{ field: "id", code: "not_found" }]);
      return;
    }
    const currentRevision = Number(row.revision) || 1;
    if (options.expectedRevision !== undefined
      && Number(options.expectedRevision) !== currentRevision) {
      outcome = failure([{ field: "revision", code: "revision_conflict" }]);
      return;
    }
    cancelWebhookDeliveriesSync(db, id, Date.now());
    const deleted = db.run(
      `DELETE FROM webhookDestinations WHERE id = ? AND revision = ?`,
      [id, currentRevision],
    );
    if (Number(deleted.changes) !== 1) {
      outcome = failure([{ field: "revision", code: "revision_conflict" }]);
      return;
    }
    outcome = { ok: true, id };
  });

  if (outcome.ok) db.flush();
  return outcome;
}
