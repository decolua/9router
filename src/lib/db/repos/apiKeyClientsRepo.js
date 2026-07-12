import { getAdapter } from "../driver.js";

const PERIOD_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "60d": 60 * 24 * 60 * 60 * 1000,
};
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

function getPeriodStart(period, now) {
  if (period === "all") return null;
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  return new Date(now.getTime() - (PERIOD_MS[period] || PERIOD_MS["24h"])).toISOString();
}

export async function recordApiKeyClientRequest(apiKey, identity, endpoint = null) {
  if (!apiKey || !identity?.fingerprint) return null;
  const db = await getAdapter();
  const key = db.get(`SELECT id FROM apiKeys WHERE key = ? AND isActive = 1`, [apiKey]);
  if (!key) return null;

  const now = new Date().toISOString();
  db.run(
    `INSERT INTO apiKeyClients(
       apiKeyId, fingerprint, clientLabel, clientFamily, maskedNetwork, ipSource,
       firstSeen, lastSeen, lastEndpoint, requestCount
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(apiKeyId, fingerprint) DO UPDATE SET
       clientLabel = excluded.clientLabel,
       clientFamily = excluded.clientFamily,
       maskedNetwork = excluded.maskedNetwork,
       ipSource = excluded.ipSource,
       lastSeen = excluded.lastSeen,
       lastEndpoint = excluded.lastEndpoint,
       requestCount = apiKeyClients.requestCount + 1`,
    [
      key.id,
      identity.fingerprint,
      identity.clientLabel || null,
      identity.clientFamily || null,
      identity.maskedNetwork || null,
      identity.ipSource || null,
      now,
      now,
      endpoint,
    ],
  );

  return { apiKeyId: key.id, fingerprint: identity.fingerprint };
}

export async function getApiKeyClientActivity(period = "24h", now = new Date()) {
  const db = await getAdapter();
  const periodStart = getPeriodStart(period, now);
  const params = periodStart ? [periodStart] : [];
  const where = periodStart ? "WHERE c.lastSeen >= ?" : "";
  const clients = db.all(
    `SELECT c.*, k.name AS keyName
     FROM apiKeyClients c
     JOIN apiKeys k ON k.id = c.apiKeyId
     ${where}
     ORDER BY k.name COLLATE NOCASE, c.lastSeen DESC`,
    params,
  );

  const usageWhere = periodStart ? "timestamp >= ? AND" : "";
  const usageRows = db.all(
    `SELECT
       json_extract(meta, '$.apiKeyId') AS apiKeyId,
       json_extract(meta, '$.apiKeyClientFingerprint') AS fingerprint,
       COUNT(*) AS requests,
       COALESCE(SUM(promptTokens), 0) AS promptTokens,
       COALESCE(SUM(completionTokens), 0) AS completionTokens,
       COALESCE(SUM(json_extract(tokens, '$.reasoning_tokens')), 0) AS reasoningTokens
     FROM usageHistory
     WHERE ${usageWhere} json_extract(meta, '$.apiKeyClientFingerprint') IS NOT NULL
     GROUP BY apiKeyId, fingerprint`,
    params,
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
      requests: Number(usage.requests || 0),
      promptTokens: Number(usage.promptTokens || 0),
      completionTokens: Number(usage.completionTokens || 0),
      reasoningTokens: Number(usage.reasoningTokens || 0),
      active,
    };
  });

  for (const summary of Object.values(summaries)) {
    if (summary.activeClients > 1) summary.risk = "review";
  }

  return { clients: rows, summaries: Object.values(summaries) };
}
