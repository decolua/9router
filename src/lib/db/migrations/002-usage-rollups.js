// 002: usage rollup tables — pre-aggregated usage stats that replace the
// usageDaily JSON blob as the read path's source of truth. Backfills from
// usageHistory in pure SQL (no JS row materialization) so existing data is
// available immediately; saveRequestUsage keeps the tables incremental from
// here on. Running it against a DB whose rollups are already current would
// double-count — the version gate in migrate.js ensures it runs exactly once.
import { TABLES, buildCreateTableSql } from "../schema.js";

// Shared column projection: dateKey/hour in LOCAL time (same clock the JS
// write path uses via getLocalDateKey), token sums with the same fallbacks
// as aggregateEntryToDay.
const TOKEN_COLS = `
  SUM(promptTokens),
  SUM(completionTokens),
  SUM(COALESCE(json_extract(tokens, '$.cached_tokens'), json_extract(tokens, '$.cache_read_input_tokens'), 0)),
  SUM(COALESCE(json_extract(tokens, '$.reasoning_tokens'), 0)),
  SUM(cost)`;

// One grouped INSERT per dimension. Every arm carries a WHERE clause —
// INSERT ... SELECT ... ON CONFLICT needs it to parse unambiguously.
const ARMS = [
  // model is a sub-key only under provider/combo (dashboard nests per-model there)
  { dim: "provider", expr: `COALESCE(provider, '') AS dimKey, COALESCE(model, '') AS model`, where: "WHERE provider IS NOT NULL" },
  { dim: "model", expr: `COALESCE(model, '') || '|' || COALESCE(provider, '') AS dimKey, COALESCE(model, '') AS model`, where: "WHERE model IS NOT NULL" },
  { dim: "combo", expr: `json_extract(meta, '$.requestedModel') AS dimKey, COALESCE(model, '') AS model`, where: "WHERE json_extract(meta, '$.requestedModel') IS NOT NULL" },
  { dim: "account", expr: `connectionId AS dimKey, '' AS model`, where: "WHERE connectionId IS NOT NULL" },
  { dim: "apiKey", expr: `COALESCE(apiKey, 'local-no-key') AS dimKey, '' AS model`, where: "WHERE true" },
  { dim: "endpoint", expr: `COALESCE(endpoint, 'Unknown') AS dimKey, '' AS model`, where: "WHERE true" },
];

const UPSERT_SET = `
  ON CONFLICT(dateKey, hour, dimension, dimKey, model) DO UPDATE SET
    requests = requests + excluded.requests,
    promptTokens = promptTokens + excluded.promptTokens,
    completionTokens = completionTokens + excluded.completionTokens,
    cachedTokens = cachedTokens + excluded.cachedTokens,
    reasoningTokens = reasoningTokens + excluded.reasoningTokens,
    cost = cost + excluded.cost,
    lastUsed = CASE WHEN excluded.lastUsed > usageRollupHourly.lastUsed THEN excluded.lastUsed ELSE usageRollupHourly.lastUsed END`;

const migration = {
  version: 2,
  name: "usage-rollups",
  up(db) {
    db.exec(buildCreateTableSql("usageRollupHourly", TABLES.usageRollupHourly));
    db.exec(buildCreateTableSql("usageRollupDaily", TABLES.usageRollupDaily));

    for (const arm of ARMS) {
      db.exec(`
        INSERT INTO usageRollupHourly(dateKey, hour, dimension, dimKey, model, requests, promptTokens, completionTokens, cachedTokens, reasoningTokens, cost, lastUsed)
        SELECT strftime('%Y-%m-%d', timestamp, 'localtime'),
               CAST(strftime('%H', timestamp, 'localtime') AS INTEGER),
               '${arm.dim}',
               ${arm.expr},
               COUNT(*),
               ${TOKEN_COLS},
               MAX(timestamp)
        FROM usageHistory
        ${arm.where}
        GROUP BY 1, 2, 3, 4, 5
        ${UPSERT_SET}`);
    }

    // Compact hourly → daily (the >24h read path reads daily rows only)
    db.exec(`
      INSERT INTO usageRollupDaily(dateKey, dimension, dimKey, model, requests, promptTokens, completionTokens, cachedTokens, reasoningTokens, cost, lastUsed)
      SELECT dateKey, dimension, dimKey, model, SUM(requests), SUM(promptTokens), SUM(completionTokens), SUM(cachedTokens), SUM(reasoningTokens), SUM(cost), MAX(lastUsed)
      FROM usageRollupHourly
      WHERE true
      GROUP BY 1, 2, 3, 4
      ON CONFLICT(dateKey, dimension, dimKey, model) DO UPDATE SET
        requests = requests + excluded.requests,
        promptTokens = promptTokens + excluded.promptTokens,
        completionTokens = completionTokens + excluded.completionTokens,
        cachedTokens = cachedTokens + excluded.cachedTokens,
        reasoningTokens = reasoningTokens + excluded.reasoningTokens,
        cost = cost + excluded.cost,
        lastUsed = CASE WHEN excluded.lastUsed > usageRollupDaily.lastUsed THEN excluded.lastUsed ELSE usageRollupDaily.lastUsed END`);
  },
};

export default migration;
