import { getAdapter } from "../driver.js";
import { providerLabels } from "./usageReportSql.js";

// Aggregate in SQLite; never load connection credentials or free-text errors.
export async function getProviderSummary() {
  const db = await getAdapter();
  return db.all(`SELECT provider, COUNT(*) AS total,
    SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) AS active
    FROM providerConnections GROUP BY provider ORDER BY provider`);
}

export async function writeConnectionObservation(id, at, now, failure, percent, resetAt) {
  const db = await getAdapter();
  if (failure) db.run(`UPDATE providerConnections SET data=json_set(data,
    '$.observedErrorAt', ?, '$.lastErrorCategory', ?, '$.reportedResetAt', ?,
    '$.reportedQuotaPercent', ?, '$.reportedQuotaUntil', ?) WHERE id=?`,
    [at, failure.category, failure.rateLimitResetAt, percent, resetAt, id]);
  else db.run(`UPDATE providerConnections SET data=json_set(data, '$.lastSuccessAt', ?)
    WHERE id=? AND (
      json_extract(data,'$.lastSuccessAt') IS NULL OR json_extract(data,'$.lastSuccessAt') <= ?
      OR json_extract(data,'$.lastSuccessAt') < json_extract(data,'$.observedErrorAt')
      OR (json_extract(data,'$.lastError') IS NOT NULL AND json_extract(data,'$.lastSuccessAt') < json_extract(data,'$.lastErrorAt'))
    )`, [at, id, new Date(now - 60_000).toISOString()], { saveOnlyIfChanged: true });
}

export async function getProviderHealthRows(now) {
  const db = await getAdapter();
  // Rank only measured latencies. Legacy NULL samples count as requests, never as 0 ms.
  const stats = db.all(`WITH samples AS (
    SELECT connectionId, status, promptTokens+completionTokens AS tokens,
      CASE WHEN json_type(meta,'$.latencyMs') IN ('integer','real') THEN json_extract(meta,'$.latencyMs') END AS ms
    FROM usageHistory WHERE timestamp BETWEEN ? AND ? AND connectionId IS NOT NULL
  ), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY connectionId ORDER BY ms IS NULL, ms) AS n,
      count(ms) OVER (PARTITION BY connectionId) AS measured FROM samples
  ) SELECT connectionId, count(*) AS requests, avg(status IN ('ok','success')) AS successRate,
    avg(ms) AS avgLatencyMs, max(CASE WHEN n=(95*measured+99)/100 THEN ms END) AS p95LatencyMs,
    coalesce(sum(tokens),0) AS totalTokens FROM ranked GROUP BY connectionId`,
    [new Date(now - 86400000).toISOString(), new Date(now).toISOString()]);
  return { stats, providerName: providerLabels(db), rows: connectionHealthRows(db) };
}

export function connectionHealthRows(db) {
  return db.all("SELECT id,provider,isActive,data FROM providerConnections ORDER BY provider,priority,id");
}
