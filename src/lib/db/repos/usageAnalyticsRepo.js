import { getAdapter } from "../driver.js";
import { connectionName, publicText } from "../../usage/reportFields.js";
import { category, failed, keyDirectory, latency, numeric, providerLabels, reportFilter, tokens } from "./usageReportSql.js";

const optionalTokens = paths => "sum(coalesce(" + paths.map(p => numeric("tokens", p)).join(",") + "))";
const measures = `count(*) AS requests, sum(${tokens}) AS tokens, coalesce(sum(cost),0) AS cost, avg(${failed}) AS errorRate`;
const ranked = " ORDER BY requests DESC, 1 LIMIT 20";

function usageAnalytics(db, range) {
  function readReport() {
    const keys = keyDirectory(db);
    const providerName = providerLabels(db);
    const { where, params } = reportFilter(range, keys);
    const history = " FROM usageHistory WHERE " + where;
    const all = sql => db.all(sql, params);
    const one = sql => db.get(sql, params);
    const totals = one(`SELECT count(*) AS requests, count(*) - total(${failed}) AS success,
      coalesce(sum(${failed}),0) AS failed, coalesce(sum(promptTokens),0) AS inputTokens,
      coalesce(sum(completionTokens),0) AS outputTokens,
      ${optionalTokens(["cached_tokens","cache_read_input_tokens","prompt_tokens_details.cached_tokens","input_tokens_details.cached_tokens"])} AS cachedTokens,
      ${optionalTokens(["reasoning_tokens","completion_tokens_details.reasoning_tokens","output_tokens_details.reasoning_tokens"])} AS reasoningTokens,
      coalesce(sum(cost),0) AS estimatedCost, count(CASE WHEN json_type(meta,'$.usageReported')='false' THEN 1 END) AS usageUnreported` + history);
    // Nearest rank: ceil(percent * measured / 100); unmeasured rows never enter the window.
    const latencyMs = one(`WITH samples AS (SELECT ${latency} AS ms ${history}), ordered AS (
      SELECT ms, row_number() OVER (ORDER BY ms) AS n, count(*) OVER () AS measured FROM samples WHERE ms IS NOT NULL)
      SELECT avg(ms) AS avg, ${[50,95,99].map(p => `max(CASE WHEN n=(${p}*measured+99)/100 THEN ms END) AS p${p}`).join(",")} FROM ordered`);

    const breakdowns = {};
    for (const field of ["provider", "model"]) {
      breakdowns[field] = all(`SELECT ${field} AS name, ${measures} ${history} GROUP BY ${field}` + ranked)
        .map(row => ({ ...row, name: field === "provider" ? providerName(row.name) : publicText(row.name) }));
    }
    const connectionGroups = " GROUP BY provider,connectionId";
    const labelConnection = ({ provider, connectionId, ...rest }) => ({ name: connectionName(providerName(provider), connectionId), ...rest });
    breakdowns.connection = all(`SELECT provider, connectionId, ${measures} ${history} ${connectionGroups}
      ORDER BY requests DESC,provider,connectionId LIMIT 20`).map(labelConnection);

    // Aggregate in SQLite before joining the small directory; rotated keys count as one identity.
    const directory = [...keys].map(([ref, key]) => [ref, key.id, key.name, key.project]);
    breakdowns.apiKey = db.all(`WITH directory AS MATERIALIZED (SELECT json_extract(value,'$[0]') ref,
      json_extract(value,'$[1]') id,json_extract(value,'$[2]') name,json_extract(value,'$[3]') project FROM json_each(?)),
      groups AS (SELECT apiKey, count(*) n, sum(${tokens}) t, sum(cost) c, sum(${failed}) f ${history} GROUP BY apiKey)
      SELECT d.id,d.name,d.project,sum(n) requests,sum(t) tokens,coalesce(sum(c),0) cost,1.0*sum(f)/sum(n) errorRate
      FROM groups g LEFT JOIN directory d ON d.ref=g.apiKey GROUP BY d.id,d.name,d.project` + ranked, [JSON.stringify(directory), ...params]);

    const bucket = range.bucketSeconds;
    const timeSeries = db.all(`SELECT strftime('%Y-%m-%dT%H:%M:%SZ', unixepoch(timestamp) - ((unixepoch(timestamp) % ? + ?) % ?), 'unixepoch') AS timestamp,
      count(*) AS requests, sum(${failed}) AS failed, sum(${tokens}) AS tokens, coalesce(sum(cost),0) AS cost
      ${history} GROUP BY 1 ORDER BY 1`, [bucket, bucket, bucket, ...params]);
    const heatmap = all(`SELECT CAST(strftime('%w',timestamp) AS INTEGER) AS day,
      CAST(strftime('%H',timestamp) AS INTEGER) AS hour,count(*) AS requests ${history} GROUP BY 1,2 ORDER BY 1,2`);

    const errors = all(`WITH counts AS MATERIALIZED (SELECT provider,connectionId,coalesce(${category},'unknown') category,
      count(*) n ${history} AND connectionId IS NOT NULL AND ${failed}=1 GROUP BY provider,connectionId,3),
      top AS (SELECT provider,connectionId,sum(n) failed FROM counts ${connectionGroups} ORDER BY failed DESC,provider,connectionId LIMIT 20)
      SELECT top.*,json_group_object(counts.category,n) categories FROM top JOIN counts ON counts.provider IS top.provider
      AND counts.connectionId=top.connectionId GROUP BY top.provider,top.connectionId ORDER BY failed DESC,top.provider,top.connectionId`)
      .map(({ categories, ...row }) => ({ ...labelConnection(row), categories: JSON.parse(categories) }));

    const tariffs = all(`SELECT DISTINCT json_extract(meta,'$.pricing.source') source,
      json_extract(meta,'$.pricing.version') version, json_extract(meta,'$.pricing.updatedAt') updatedAt
      ${history} AND json_extract(meta,'$.pricing.source') IN ('user','default') AND json_extract(meta,'$.pricing.matched') IS NOT 0 ORDER BY 1,2,3`)
      .filter(r => [r.version, r.updatedAt].every(v => v == null || v === "legacy" || /^\d{4}-\d\d-\d\d(?:T[\d:.]+Z)?$/.test(v)));
    return { range, totals, latencyMs, costsEstimated: true, tariffs, breakdowns, timeSeries, heatmap, errorConnections: errors };
  }
  // sql.js has one synchronous connection; its transaction wrapper schedules a full DB export even for reads.
  return db.driver === "sql.js" ? readReport() : db.transaction(readReport);
}

function openExport(db, range, limit) {
  const keys = keyDirectory(db);
  const providerName = providerLabels(db);
  const { where, params } = reportFilter(range, keys);
  // Count and capture append boundary in the same read. No long-lived SQLite transaction on slow downloads.
  const { n, first, last } = db.get(`SELECT count(*) n,min(id) first,max(id) last FROM
    (SELECT id FROM usageHistory WHERE ${where} LIMIT ?)`, [...params, limit + 1]);
  const page = (after, pageSize) => db.all(`SELECT id,timestamp,requestId,provider,model,apiKey,connectionId,endpoint,status,
        promptTokens inputTokens,completionTokens outputTokens,cost,${latency} latencyMs,
        ${numeric("meta","attempts")} attempts,${numeric("meta","fallbacks")} fallbacks,${category} errorCategory
        FROM usageHistory NOT INDEXED WHERE id>? AND id<=? AND ${where} ORDER BY id LIMIT ?`, [after,last,...params,pageSize]);
  return { keys, providerName, n, first, last, page };
}

// Bind one connection for the report, including later pulls of an export stream.
export function createUsageReports(db) {
  return {
    analytics: range => usageAnalytics(db, range),
    openExport: (range, limit) => openExport(db, range, limit),
  };
}

export async function getUsageReports() {
  return createUsageReports(await getAdapter());
}
