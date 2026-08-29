import { getAdapter } from "../driver.js";

const PERIOD_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "60d": 60 * 24 * 60 * 60 * 1000,
};
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 5000;
const MAX_IDENTITIES_PER_KEY = 64;
const MAX_PENDING_IDENTITIES = 6400;
const MAX_OUTPUT_ROWS = 2000;

// ponytail: evidence retains 64 identities per API key for 60 days; upgrade to
// a durable event stream when complete client history becomes necessary.
if (!globalThis._apiKeyClientActivityBuffer) {
  globalThis._apiKeyClientActivityBuffer = {
    keys: new Map(),
    pendingIdentities: 0,
    timer: null,
    flushing: null,
    lastFlushAt: 0,
    lastWarningAt: 0,
  };
}
const buffer = globalThis._apiKeyClientActivityBuffer;
if (!Number.isFinite(buffer.lastFlushAt)) buffer.lastFlushAt = 0;

function getPeriodStart(period, now) {
  if (period === "all") return null;
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  return new Date(now.getTime() - (PERIOD_MS[period] || PERIOD_MS["24h"])).toISOString();
}

function warnFlushFailure() {
  const now = Date.now();
  if (now - buffer.lastWarningAt < FLUSH_INTERVAL_MS) return;
  buffer.lastWarningAt = now;
  console.warn("[AUTH] API key client activity flush failed; inference continues");
}

function scheduleFlush() {
  if (buffer.timer || buffer.pendingIdentities === 0) return;
  buffer.timer = setTimeout(() => {
    buffer.timer = null;
    void flushApiKeyClientActivity().catch(warnFlushFailure);
  }, FLUSH_INTERVAL_MS);
  buffer.timer.unref?.();
}

function maintainDurableRows(db, now) {
  const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
  db.run(`DELETE FROM apiKeyClients WHERE lastSeen < ?`, [cutoff]);
  db.run(
    `DELETE FROM apiKeyClients
     WHERE rowid IN (
       SELECT rowid FROM (
         SELECT rowid,
                ROW_NUMBER() OVER (
                  PARTITION BY apiKeyId
                  ORDER BY lastSeen DESC, fingerprint ASC
                ) AS rowNumber
         FROM apiKeyClients
       ) ranked
       WHERE rowNumber > ?
     )`,
    [MAX_IDENTITIES_PER_KEY],
  );
}

async function createKeyBuffer(apiKeyId) {
  const keyBuffer = {
    active: false,
    durableFingerprints: null,
    newFingerprints: 0,
    entries: new Map(),
    loading: null,
  };
  buffer.keys.set(apiKeyId, keyBuffer);
  keyBuffer.loading = (async () => {
    const db = await getAdapter();
    keyBuffer.active = Boolean(db.get(
      `SELECT 1 FROM apiKeys WHERE id = ? AND isActive = 1`,
      [apiKeyId],
    ));
    if (!keyBuffer.active) {
      keyBuffer.durableFingerprints = new Set();
      return;
    }
    const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
    const rows = db.all(
      `SELECT fingerprint FROM apiKeyClients
       WHERE apiKeyId = ? AND lastSeen >= ?
       ORDER BY lastSeen DESC, fingerprint ASC
       LIMIT ?`,
      [apiKeyId, cutoff, MAX_IDENTITIES_PER_KEY],
    );
    keyBuffer.durableFingerprints = new Set(rows.map((row) => row.fingerprint));
  })();
  await keyBuffer.loading;
  return keyBuffer;
}

export async function recordApiKeyClientRequest(apiKeyId, identity, endpoint = null) {
  if (!apiKeyId || !identity?.fingerprint) return null;
  if (buffer.flushing) await buffer.flushing;

  let keyBuffer = buffer.keys.get(apiKeyId);
  if (!keyBuffer) {
    if (
      buffer.pendingIdentities >= MAX_PENDING_IDENTITIES
      || buffer.keys.size >= MAX_PENDING_IDENTITIES
    ) return null;
    keyBuffer = await createKeyBuffer(apiKeyId);
    if (buffer.keys.get(apiKeyId) !== keyBuffer || !keyBuffer.active) {
      buffer.keys.delete(apiKeyId);
      return null;
    }
  } else if (keyBuffer.loading) {
    await keyBuffer.loading;
  }

  const existing = keyBuffer.entries.get(identity.fingerprint);
  const now = new Date().toISOString();
  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    existing.lastEndpoint = endpoint;
    Object.assign(existing.identity, identity);
    return { apiKeyId, fingerprint: identity.fingerprint };
  }

  const isDurable = keyBuffer.durableFingerprints.has(identity.fingerprint);
  if (
    keyBuffer.entries.size >= MAX_IDENTITIES_PER_KEY
    || buffer.pendingIdentities >= MAX_PENDING_IDENTITIES
    || (!isDurable
      && keyBuffer.durableFingerprints.size + keyBuffer.newFingerprints >= MAX_IDENTITIES_PER_KEY)
  ) {
    if (keyBuffer.entries.size === 0) buffer.keys.delete(apiKeyId);
    return null;
  }

  keyBuffer.entries.set(identity.fingerprint, {
    identity: { ...identity },
    firstSeen: now,
    lastSeen: now,
    lastEndpoint: endpoint,
    count: 1,
  });
  if (!isDurable) keyBuffer.newFingerprints += 1;
  buffer.pendingIdentities += 1;
  scheduleFlush();
  return { apiKeyId, fingerprint: identity.fingerprint };
}

export async function flushApiKeyClientActivity() {
  if (buffer.flushing) return buffer.flushing;
  buffer.flushing = (async () => {
    if (Date.now() - buffer.lastFlushAt < FLUSH_INTERVAL_MS) return;
    const db = await getAdapter();
    await Promise.all([...buffer.keys.values()].map((keyBuffer) => keyBuffer.loading));
    if (buffer.pendingIdentities === 0) return;

    if (buffer.timer) clearTimeout(buffer.timer);
    buffer.timer = null;
    db.transaction(() => {
      maintainDurableRows(db, new Date());
      for (const [apiKeyId, keyBuffer] of buffer.keys) {
        for (const entry of keyBuffer.entries.values()) {
          const identity = entry.identity;
          db.run(
            `INSERT INTO apiKeyClients(
               apiKeyId, fingerprint, clientLabel, clientFamily, maskedNetwork, ipSource,
               firstSeen, lastSeen, lastEndpoint, requestCount
             ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(apiKeyId, fingerprint) DO UPDATE SET
               clientLabel = excluded.clientLabel,
               clientFamily = excluded.clientFamily,
               maskedNetwork = excluded.maskedNetwork,
               ipSource = excluded.ipSource,
               lastSeen = excluded.lastSeen,
               lastEndpoint = excluded.lastEndpoint,
               requestCount = apiKeyClients.requestCount + excluded.requestCount`,
            [
              apiKeyId,
              identity.fingerprint,
              identity.clientLabel || null,
              identity.clientFamily || null,
              identity.maskedNetwork || null,
              identity.ipSource || null,
              entry.firstSeen,
              entry.lastSeen,
              entry.lastEndpoint,
              entry.count,
            ],
          );
        }
      }
    });
    buffer.lastFlushAt = Date.now();
    buffer.keys = new Map();
    buffer.pendingIdentities = 0;
  })();

  try {
    return await buffer.flushing;
  } finally {
    buffer.flushing = null;
    scheduleFlush();
  }
}

export function clearPendingApiKeyClientActivity(apiKeyId) {
  const keyBuffer = buffer.keys.get(apiKeyId);
  if (!keyBuffer) return;
  buffer.pendingIdentities -= keyBuffer.entries.size;
  buffer.keys.delete(apiKeyId);
  if (buffer.pendingIdentities === 0 && buffer.timer) {
    clearTimeout(buffer.timer);
    buffer.timer = null;
  }
}

export function clearAllPendingApiKeyClientActivity() {
  if (buffer.timer) clearTimeout(buffer.timer);
  buffer.keys = new Map();
  buffer.pendingIdentities = 0;
  buffer.timer = null;
  buffer.lastFlushAt = 0;
}

export async function getApiKeyClientActivity(period = "24h", now = new Date()) {
  const db = await getAdapter();
  db.transaction(() => maintainDurableRows(db, now));

  const periodStart = getPeriodStart(period, now);
  const params = periodStart ? [periodStart, MAX_OUTPUT_ROWS + 1] : [MAX_OUTPUT_ROWS + 1];
  const where = periodStart ? "WHERE c.lastSeen >= ?" : "";
  const selectedClients = db.all(
    `SELECT c.*, k.name AS keyName
     FROM apiKeyClients c
     JOIN apiKeys k ON k.id = c.apiKeyId
     ${where}
     ORDER BY c.lastSeen DESC, c.fingerprint ASC
     LIMIT ?`,
    params,
  );
  const truncated = selectedClients.length > MAX_OUTPUT_ROWS;
  const clients = selectedClients.slice(0, MAX_OUTPUT_ROWS);

  const selectedWhere = periodStart ? "WHERE lastSeen >= ?" : "";
  const usageWhere = periodStart ? "u.timestamp >= ? AND" : "";
  const usageParams = periodStart ? [periodStart, periodStart] : [];
  const usageRows = db.all(
    `WITH selected AS (
       SELECT apiKeyId, fingerprint
       FROM apiKeyClients
       ${selectedWhere}
       ORDER BY lastSeen DESC, fingerprint ASC
       LIMIT ${MAX_OUTPUT_ROWS}
     )
     SELECT
       json_extract(u.meta, '$.apiKeyId') AS apiKeyId,
       json_extract(u.meta, '$.apiKeyClientFingerprint') AS fingerprint,
       COUNT(*) AS requests,
       COALESCE(SUM(u.promptTokens), 0) AS promptTokens,
       COALESCE(SUM(u.completionTokens), 0) AS completionTokens,
       COALESCE(SUM(json_extract(u.tokens, '$.reasoning_tokens')), 0) AS reasoningTokens
     FROM usageHistory u
     JOIN selected s
       ON s.apiKeyId = json_extract(u.meta, '$.apiKeyId')
      AND s.fingerprint = json_extract(u.meta, '$.apiKeyClientFingerprint')
     WHERE ${usageWhere} json_extract(u.meta, '$.apiKeyClientFingerprint') IS NOT NULL
     GROUP BY apiKeyId, fingerprint`,
    usageParams,
  );
  const usageMap = new Map(usageRows.map((row) => [
    `${row.apiKeyId}|${row.fingerprint}`,
    row,
  ]));
  const activeSince = now.getTime() - ACTIVE_WINDOW_MS;
  const summaries = {};

  const rows = clients.map((client) => {
    const usage = usageMap.get(`${client.apiKeyId}|${client.fingerprint}`) || {};
    const active = new Date(client.lastSeen).getTime() >= activeSince;
    const summary = summaries[client.apiKeyId] ||= {
      apiKeyId: client.apiKeyId,
      keyName: client.keyName || "Unnamed key",
      distinctClients: 0,
      activeClients: 0,
      risk: "normal",
    };
    summary.distinctClients += 1;
    if (active) summary.activeClients += 1;

    return {
      apiKeyId: client.apiKeyId,
      fingerprint: client.fingerprint.slice(0, 8),
      keyName: client.keyName || "Unnamed key",
      clientLabel: client.clientLabel || client.clientFamily || "Unknown client",
      clientFamily: client.clientFamily || "unknown",
      maskedNetwork: client.maskedNetwork || "Unknown",
      ipSource: client.ipSource || "unknown",
      firstSeen: client.firstSeen,
      lastSeen: client.lastSeen,
      lastEndpoint: client.lastEndpoint,
      seenRequests: Number(client.requestCount || 0),
      successfulRequests: Number(usage.requests || 0),
      promptTokens: Number(usage.promptTokens || 0),
      completionTokens: Number(usage.completionTokens || 0),
      reasoningTokens: Number(usage.reasoningTokens || 0),
      active,
    };
  });

  for (const summary of Object.values(summaries)) {
    if (summary.activeClients > 1) summary.risk = "review";
  }

  return { clients: rows, summaries: Object.values(summaries), truncated };
}
