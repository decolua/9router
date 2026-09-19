import { NextResponse } from "next/server";
import { getUsageHistory, getRequestDetails } from "@/lib/usageDb";
import { getProviderConnections, getSettings } from "@/lib/db/index.js";
import { getAllCircuitBreakerStatuses } from "open-sse/utils/circuitBreaker.js";
import { catalogStatus, getConnectionCatalog } from "@/lib/modelSync/connectionCatalog.js";
import { MODEL_LOCK_PREFIX, MODEL_LOCK_ALL } from "open-sse/services/accountFallback.js";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

/**
 * GET /api/health/providers — read-only provider × model health matrix (T3.5).
 *
 * OmniRoute's `monitoring/providerHealthMatrix.ts` cut to the magro scope agreed
 * in docs/orchestration/OMNIROUTE-DIFF.md §T-E: aggregate what this app already
 * records and show it. Two things from the source are deliberately NOT ported:
 * its synthetic per-provider `score`, and `providerHealthAutopilot` (repair
 * actions). Nothing here has a side effect — the interactive recovery paths stay
 * the ones the dashboard already has (`/api/models/availability` clear-cooldown,
 * the F24c breaker reset).
 *
 * Evidence model, "missing data never called paid" applied to health:
 *   requests     usageHistory rows in range  (the success path writes these)
 *   observed     requestDetails rows in range — the ONLY place an outcome and a
 *                duration exist. usageHistory records no error rows and has no
 *                latency column, so a successRate read off it alone would always
 *                print a synthetic 100%: exactly the fake-green this forbids.
 *   successRate  null unless observed > 0
 *   avgLatencyMs null unless at least one positive duration sample exists
 *   status       "unknown" when there is no evidence in either direction — a
 *                provider with no traffic is never reported as down.
 * A tripped breaker is the one no-traffic case that IS evidence (it can only
 * exist because real upstream failures happened), so it outranks "unknown". It
 * lives in memory since process start and is not range-scoped, which `sources`
 * states so the UI cannot imply the failures fell inside the window.
 *
 * Catalogue status is reported per connection as information only: a never
 * synced or stale catalogue is not an outage and never drags the verdict.
 *
 * Query: ?range=1h|24h|7d (default 24h), ?provider=<id>
 *
 * Auth: the liveness route `GET /api/health` (left untouched) is in the guard's
 * public allow-list, and `dashboardGuard.isPublicApi()` also matches allow-list
 * entries as `${p}/` prefixes — so every CHILD of /api/health passes the
 * deny-by-default branch with no credentials. Rather than widen exposure of
 * provider/model traffic, this route authenticates itself the way the guard
 * would: dashboard JWT cookie, or the `requireLogin === false` local mode that
 * opens every other /api route. Fixing the guard's prefix match belongs to F21'
 * (it owns dashboardGuard.js) and is reported upward, not done here.
 */

export const dynamic = "force-dynamic";

const RANGES = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};
const DEFAULT_RANGE = "24h";

/** requestDetails is a capped ring; read a bounded page, never a full scan. */
const MAX_OUTCOME_ROWS = 500;
/** Guard rail for a pathological 7d window on a busy gateway. */
const MAX_TRAFFIC_ROWS = 20_000;
/** Popover-sized model list per provider. */
const MAX_MODELS_PER_PROVIDER = 40;

// The only judgement in this file: categorical thresholds on observed counts.
// No weighting and no blending — the raw numbers ship in the payload too.
const MIN_SAMPLES_FOR_RATE = 5;
const DOWN_SUCCESS_RATE = 0.5;
const DEGRADED_SUCCESS_RATE = 0.95;

const SEVERITY = { unknown: 0, ok: 1, cooldown: 2, degraded: 3, down: 4 };
const BREAKER_SEVERITY = { DEGRADED: 1, HALF_OPEN: 2, OPEN: 3 };
const CATALOG_SEVERITY = { ok: 0, "never-synced": 1, stale: 2, error: 3 };
const OK_BREAKER = "CLOSED";

const CELL_SEP = "\u0000";
const cellKey = (provider, model) => `${provider}${CELL_SEP}${model}`;

function round2(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Latest of several ISO strings (invalid entries ignored). */
function latestIso(list) {
  return list.filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}

/** ISO string only while the deadline is still in the future. */
function futureIso(value, now) {
  if (!value) return null;
  const t = Date.parse(String(value));
  if (!Number.isFinite(t) || t <= now) return null;
  return new Date(t).toISOString();
}

function epochToIso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * F24c's segment-boundary rule (`resetCircuitBreakersByPrefix`): a key belongs
 * to an account when it IS the account key or continues it on a ":" boundary.
 * A plain startsWith would let `p:conn-1` also claim `p:conn-10:*`.
 */
function belongsToAccount(name, provider, connectionId) {
  if (typeof name !== "string" || !name) return false;
  const account = `${provider}:${connectionId}`;
  return name === account || name.startsWith(`${account}:`);
}

/**
 * Breaker keys are `provider:connectionId:model` and only the first two ":" are
 * structural (a model id may itself contain one: `gemini-2.5-flash:free`), so
 * the model is everything after the SECOND separator, and the provider
 * everything before the first.
 */
function providerOfBreaker(name) {
  const first = name.indexOf(":");
  return first === -1 ? name : name.slice(0, first);
}

function modelOfBreaker(name) {
  const first = name.indexOf(":");
  if (first === -1) return null;
  const second = name.indexOf(":", first + 1);
  if (second === -1) return null;
  return name.slice(second + 1) || null;
}

/** Worst state wins; counts describe the worst-state set only (F24d's rule). */
function breakerDigest(records) {
  let worst = null;
  for (const r of records) {
    if (!r.state || r.state === OK_BREAKER) continue;
    if (!worst || (BREAKER_SEVERITY[r.state] || 1) > (BREAKER_SEVERITY[worst.state] || 1)) worst = r;
  }
  if (!worst) return null;
  const worstSet = records.filter((r) => r.state === worst.state);
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const failureTimes = worstSet
    .map((r) => (Number.isFinite(r.lastFailureTime) ? r.lastFailureTime : null))
    .filter((t) => t !== null);
  return {
    state: worst.state,
    failureCount: worstSet.reduce((sum, r) => sum + num(r.failureCount), 0),
    retryAfterMs: worstSet.reduce((max, r) => Math.max(max, num(r.retryAfterMs)), 0),
    lastFailureAt: failureTimes.length ? new Date(Math.max(...failureTimes)).toISOString() : null,
    models: [...new Set(worstSet.map((r) => modelOfBreaker(r.name)).filter(Boolean))],
  };
}

/**
 * Categorical verdict from observed evidence. Returns [status, reasons[]].
 * Order matters: positive failure evidence first, then cooldowns, then rates,
 * then success, and only then the no-evidence case.
 */
function classify(ev) {
  const rate = ev.observed > 0 ? ev.succeeded / ev.observed : null;

  if (ev.breakerState === "OPEN") return ["down", ["circuit:OPEN"]];
  if (rate !== null && ev.observed >= MIN_SAMPLES_FOR_RATE && rate < DOWN_SUCCESS_RATE) {
    return ["down", [`successRate:${round2(rate)}`, `samples:${ev.observed}`]];
  }
  if (ev.breakerState === "HALF_OPEN" || ev.breakerState === "DEGRADED") {
    return ["degraded", [`circuit:${ev.breakerState}`]];
  }
  if (ev.lockUntil || ev.cooldownUntil) {
    return ["cooldown", [ev.lockModel ? `lock:${ev.lockModel}` : "cooldown"]];
  }
  if (rate !== null && rate < DEGRADED_SUCCESS_RATE) {
    return ["degraded", [`successRate:${round2(rate)}`, `errors:${ev.failed}`]];
  }
  if (ev.requests > 0 || ev.succeeded > 0) {
    const reasons = [];
    if (rate !== null) reasons.push(`successRate:${round2(rate)}`);
    reasons.push(ev.requests > 0 ? `traffic:${ev.requests}` : `observed:${ev.observed}`);
    return ["ok", reasons];
  }
  return ["unknown", ["no-evidence"]];
}

const emptyTraffic = () => ({ requests: 0, cost: 0, lastUsedAt: null });
const emptyOutcomes = () => ({
  observed: 0,
  succeeded: 0,
  failed: 0,
  latencySum: 0,
  latencySamples: 0,
  lastErrorAt: null,
  lastSeenAt: null,
});

function bumpTraffic(bucket, row) {
  bucket.requests++;
  bucket.cost += Number(row.cost) || 0;
  bucket.lastUsedAt = maxIso(bucket.lastUsedAt, row.timestamp);
}

function bumpOutcomes(bucket, row) {
  bucket.observed++;
  bucket.lastSeenAt = maxIso(bucket.lastSeenAt, row.timestamp);
  const status = typeof row.status === "string" ? row.status.toLowerCase() : "";
  if (status === "success" || status === "ok") {
    bucket.succeeded++;
  } else if (status.startsWith("error") || status === "failed") {
    bucket.failed++;
    bucket.lastErrorAt = maxIso(bucket.lastErrorAt, row.timestamp);
  }
  const total = Number(row?.latency?.total);
  if (Number.isFinite(total) && total > 0) {
    bucket.latencySum += total;
    bucket.latencySamples++;
  }
}

const rateOf = (o) => (o.observed > 0 ? round2(o.succeeded / o.observed) : null);
const latencyOf = (o) => (o.latencySamples > 0 ? Math.round(o.latencySum / o.latencySamples) : null);

function assembleCell(provider, model, traffic, outcomes, ev) {
  const [status, reasons] = classify({
    requests: traffic.requests,
    observed: outcomes.observed,
    succeeded: outcomes.succeeded,
    failed: outcomes.failed,
    breakerState: ev.breakerState,
    lockUntil: ev.lockUntil,
    cooldownUntil: ev.cooldownUntil,
    lockModel: ev.lockModel,
  });
  return {
    model,
    status,
    reasons,
    requests: traffic.requests,
    observed: outcomes.observed,
    succeeded: outcomes.succeeded,
    failed: outcomes.failed,
    successRate: rateOf(outcomes),
    avgLatencyMs: latencyOf(outcomes),
    latencySamples: outcomes.latencySamples,
    lastUsedAt: traffic.lastUsedAt || outcomes.lastSeenAt || null,
    lastErrorAt: maxIso(outcomes.lastErrorAt, ev.lastFailureAt),
    cost: round2(traffic.cost || 0),
    breakerState: ev.breakerState || null,
    breakerRetryAfterMs: ev.breakerRetryAfterMs || 0,
    lockUntil: ev.lockUntil || null,
    cooldownUntil: ev.cooldownUntil || null,
  };
}

/**
 * requestDetails (the only outcome + latency source) is opt-in: the repo reads
 * `enableObservability` (default false) or ENABLE_REQUEST_LOGS /
 * OBSERVABILITY_ENABLED. Same precedence, read here so the payload can say WHY
 * observed/successRate/avgLatency are empty instead of leaving the UI to guess.
 */
function outcomesRecordingEnabled(settings) {
  const envLogs = process.env.ENABLE_REQUEST_LOGS;
  if (envLogs !== undefined) return String(envLogs).toLowerCase() === "true";
  if (typeof settings?.enableObservability === "boolean") return settings.enableObservability;
  return process.env.OBSERVABILITY_ENABLED !== "false";
}

async function authorize(request, settings) {
  try {
    const token = request.cookies?.get?.("auth_token")?.value;
    if (token && (await verifyDashboardAuthToken(token))) return true;
  } catch {
    // a broken cookie is a denial, not a 500 — fall through
  }
  // unreadable settings keeps the route locked (fail closed)
  return Boolean(settings && settings.requireLogin === false);
}

export async function GET(request) {
  try {
    const settings = await getSettings().catch(() => null);
    if (!(await authorize(request, settings))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range") || DEFAULT_RANGE;
    if (!RANGES[range]) {
      return NextResponse.json(
        { error: `Invalid range, use ${Object.keys(RANGES).join("|")}` },
        { status: 400 },
      );
    }
    const providerFilter = (searchParams.get("provider") || "").trim() || null;

    const now = Date.now();
    const windowStart = new Date(now - RANGES[range]).toISOString();
    const since = { startDate: windowStart };
    if (providerFilter) since.provider = providerFilter;

    // A health view that 500s because one source is unreadable is useless —
    // each source degrades on its own and the failure is reported verbatim.
    const readFailures = [];
    const guard = (label, promise, fallback) =>
      Promise.resolve(promise).then(
        (value) => (value === undefined || value === null ? fallback : value),
        (error) => {
          readFailures.push(`${label}: ${String(error?.message || error).slice(0, 160)}`);
          return fallback;
        },
      );

    const [connections, usageRows, detailPage, breakerStatuses] = await Promise.all([
      guard("providerConnections", getProviderConnections(providerFilter ? { provider: providerFilter } : {}), []),
      guard("usageHistory", getUsageHistory(since), []),
      guard("requestDetails", getRequestDetails({ ...since, pageSize: MAX_OUTCOME_ROWS, page: 1 }), null),
      guard("circuitBreakers", Promise.resolve(getAllCircuitBreakerStatuses()), []),
    ]);

    // ── traffic: durable per provider+model counts (usageHistory) ──────────
    const trafficTruncated = usageRows.length > MAX_TRAFFIC_ROWS;
    const trafficRows = trafficTruncated ? usageRows.slice(-MAX_TRAFFIC_ROWS) : usageRows;
    const trafficCell = new Map();
    const trafficProv = new Map();
    for (const row of trafficRows) {
      const provider = row.provider || "unknown";
      const model = row.model || "unknown";
      const key = cellKey(provider, model);
      if (!trafficCell.has(key)) trafficCell.set(key, emptyTraffic());
      bumpTraffic(trafficCell.get(key), row);
      if (!trafficProv.has(provider)) trafficProv.set(provider, emptyTraffic());
      bumpTraffic(trafficProv.get(provider), row);
    }

    // ── outcomes: status + latency (requestDetails) ────────────────────────
    const detailRows = Array.isArray(detailPage?.details) ? detailPage.details : [];
    const outcomeTotal = detailPage?.pagination?.totalItems || 0;
    const outcomesCell = new Map();
    const outcomesProv = new Map();
    for (const row of detailRows) {
      const provider = row.provider || "unknown";
      const model = row.model || "unknown";
      const key = cellKey(provider, model);
      if (!outcomesCell.has(key)) outcomesCell.set(key, emptyOutcomes());
      bumpOutcomes(outcomesCell.get(key), row);
      if (!outcomesProv.has(provider)) outcomesProv.set(provider, emptyOutcomes());
      bumpOutcomes(outcomesProv.get(provider), row);
    }

    // ── breakers, attributed by account through the F24c boundary rule ─────
    const records = (Array.isArray(breakerStatuses) ? breakerStatuses : [])
      .filter((s) => s && typeof s.name === "string" && s.name)
      .map((s) => ({ ...s }));
    const consumed = new Set();
    const connsByProvider = new Map();
    const recordsByProvider = new Map();

    for (const conn of connections || []) {
      const provider = conn.provider || "unknown";
      const mine = records.filter((r) => belongsToAccount(r.name, provider, conn.id));
      for (const r of mine) consumed.add(r);
      if (!recordsByProvider.has(provider)) recordsByProvider.set(provider, []);
      recordsByProvider.get(provider).push(...mine);

      let lockModel = null;
      let lockUntil = null;
      for (const [field, value] of Object.entries(conn)) {
        if (!field.startsWith(MODEL_LOCK_PREFIX) || !value) continue;
        const until = futureIso(value, now);
        if (!until) continue;
        if (!lockUntil || Date.parse(until) > Date.parse(lockUntil)) {
          lockUntil = until;
          lockModel = field === MODEL_LOCK_ALL ? "__all" : field.slice(MODEL_LOCK_PREFIX.length);
        }
      }

      if (!connsByProvider.has(provider)) connsByProvider.set(provider, []);
      connsByProvider.get(provider).push({
        id: conn.id,
        name: conn.name || conn.email || conn.id,
        isActive: conn.isActive !== false,
        testStatus: conn.testStatus || null,
        cooldownUntil: futureIso(conn.rateLimitedUntil || conn.unavailableUntil, now),
        lockUntil,
        lockModel,
        breaker: breakerDigest(mine),
        catalogStatus: catalogStatus(conn),
        catalog: (() => {
          const cat = getConnectionCatalog(conn);
          return {
            modelCount: cat.models.length,
            lastSuccessAt: cat.lastSuccessAt || null,
            lastError: cat.lastError ? String(cat.lastError).slice(0, 200) : null,
          };
        })(),
      });
    }

    // Breakers whose connection is gone (deleted account), or that were keyed
    // without one: still evidence, attributed to their provider segment.
    const orphanByProvider = new Map();
    for (const r of records) {
      if (consumed.has(r)) continue;
      const provider = providerOfBreaker(r.name);
      if (!orphanByProvider.has(provider)) orphanByProvider.set(provider, []);
      orphanByProvider.get(provider).push(r);
    }

    // ── assemble ──────────────────────────────────────────────────────────
    const providerIds = new Set([
      ...connsByProvider.keys(),
      ...trafficProv.keys(),
      ...outcomesProv.keys(),
      ...orphanByProvider.keys(),
    ]);
    // the filter must hold for every source, including breakers of a connection
    // that no longer exists (they land in orphanByProvider by name)
    if (providerFilter) {
      for (const id of [...providerIds]) if (id !== providerFilter) providerIds.delete(id);
    }

    const providers = [];
    for (const provider of providerIds) {
      const conns = connsByProvider.get(provider) || [];
      const providerRecords = (recordsByProvider.get(provider) || []).concat(orphanByProvider.get(provider) || []);
      const providerBreaker = breakerDigest(providerRecords);
      // worst non-CLOSED breaker per model, across this provider's accounts
      const breakerByModel = new Map();
      for (const r of providerRecords) {
        if (!r.state || r.state === OK_BREAKER) continue;
        const model = modelOfBreaker(r.name);
        if (!model) continue;
        const prev = breakerByModel.get(model);
        if (!prev || (BREAKER_SEVERITY[r.state] || 1) > (BREAKER_SEVERITY[prev.state] || 1)) {
          breakerByModel.set(model, r);
        }
      }

      const modelNames = new Set();
      for (const key of trafficCell.keys()) {
        if (key.split(CELL_SEP)[0] === provider) modelNames.add(key.split(CELL_SEP)[1]);
      }
      for (const key of outcomesCell.keys()) {
        if (key.split(CELL_SEP)[0] === provider) modelNames.add(key.split(CELL_SEP)[1]);
      }
      for (const model of breakerByModel.keys()) modelNames.add(model);
      for (const c of conns) {
        if (c.lockModel && c.lockModel !== "__all") modelNames.add(c.lockModel);
      }

      const cells = [...modelNames].map((model) => {
        const key = cellKey(provider, model);
        const breaker = breakerByModel.get(model) || null;
        const lock = conns.find((c) => c.lockModel === model || c.lockModel === "__all") || null;
        return assembleCell(
          provider,
          model,
          trafficCell.get(key) || emptyTraffic(),
          outcomesCell.get(key) || emptyOutcomes(),
          {
            breakerState: breaker?.state || null,
            breakerRetryAfterMs: breaker ? Number(breaker.retryAfterMs) || 0 : 0,
            lastFailureAt: breaker ? epochToIso(breaker.lastFailureTime) : null,
            lockUntil: lock?.lockUntil || null,
            cooldownUntil: lock?.cooldownUntil || null,
            lockModel: lock?.lockModel || null,
          },
        );
      }).sort(
        (a, b) =>
          SEVERITY[b.status] - SEVERITY[a.status] ||
          b.requests - a.requests ||
          String(a.model).localeCompare(String(b.model)),
      );

      const traffic = trafficProv.get(provider) || emptyTraffic();
      const outcomes = outcomesProv.get(provider) || emptyOutcomes();
      const lock = conns
        .filter((c) => c.lockUntil || c.cooldownUntil)
        .sort((a, b) => Date.parse(b.lockUntil || b.cooldownUntil) - Date.parse(a.lockUntil || a.cooldownUntil))[0];
      const [status, reasons] = classify({
        requests: traffic.requests,
        observed: outcomes.observed,
        succeeded: outcomes.succeeded,
        failed: outcomes.failed,
        breakerState: providerBreaker?.state || null,
        lockUntil: lock?.lockUntil || null,
        cooldownUntil: lock?.cooldownUntil || null,
        lockModel: lock?.lockModel || null,
      });

      providers.push({
        provider,
        status,
        reasons,
        requests: traffic.requests,
        observed: outcomes.observed,
        succeeded: outcomes.succeeded,
        failed: outcomes.failed,
        successRate: rateOf(outcomes),
        avgLatencyMs: latencyOf(outcomes),
        latencySamples: outcomes.latencySamples,
        lastUsedAt: traffic.lastUsedAt || outcomes.lastSeenAt || null,
        lastErrorAt: maxIso(
          outcomes.lastErrorAt,
          latestIso([providerBreaker?.lastFailureAt, ...conns.map((c) => c.breaker?.lastFailureAt)]),
        ),
        cost: round2(traffic.cost || 0),
        breaker: providerBreaker,
        cooldownUntil: lock?.cooldownUntil || null,
        lockUntil: lock?.lockUntil || null,
        connectionCount: conns.length,
        connections: conns.map((c) => ({
          id: c.id,
          name: c.name,
          isActive: c.isActive,
          testStatus: c.testStatus,
          cooldownUntil: c.cooldownUntil,
          lockUntil: c.lockUntil,
          lockModel: c.lockModel,
          breaker: c.breaker,
          catalogStatus: c.catalogStatus,
          catalogModels: c.catalog.modelCount,
          catalogLastSuccessAt: c.catalog.lastSuccessAt,
          catalogLastError: c.catalog.lastError,
        })),
        catalog: {
          worst: conns.length
            ? conns.map((c) => c.catalogStatus).sort((a, b) => CATALOG_SEVERITY[b] - CATALOG_SEVERITY[a])[0]
            : "never-synced",
          synced: conns.filter((c) => c.catalogStatus === "ok").length,
          models: conns.reduce((max, c) => Math.max(max, c.catalog.modelCount), 0),
          lastSuccessAt: latestIso(conns.map((c) => c.catalog.lastSuccessAt)),
        },
        models: cells.slice(0, MAX_MODELS_PER_PROVIDER),
        modelsTotal: cells.length,
        modelsTruncated: cells.length > MAX_MODELS_PER_PROVIDER,
      });
    }

    providers.sort(
      (a, b) =>
        SEVERITY[b.status] - SEVERITY[a.status] ||
        b.requests - a.requests ||
        String(a.provider).localeCompare(String(b.provider)),
    );

    return NextResponse.json({
      range,
      windowStart,
      generatedAt: new Date(now).toISOString(),
      status: latestStatus(providers.map((p) => p.status)),
      thresholds: {
        minSamplesForRate: MIN_SAMPLES_FOR_RATE,
        downSuccessRate: DOWN_SUCCESS_RATE,
        degradedSuccessRate: DEGRADED_SUCCESS_RATE,
        statuses: ["ok", "cooldown", "degraded", "down", "unknown"],
      },
      sources: {
        requests: "usageHistory rows in range (written by the success path)",
        outcomes: `requestDetails rows in range, newest first (status + latency; capped ring, at most ${MAX_OUTCOME_ROWS} read)`,
        outcomesRecorded: outcomesRecordingEnabled(settings),
        outcomesNote: outcomesRecordingEnabled(settings)
          ? null
          : "requestDetails recording is off (settings.enableObservability=false), so observed/successRate/avgLatencyMs are empty for every provider — an absence of samples, not a healthy fleet",
        breaker: "in-memory circuit breaker registry — since process start, NOT range-scoped",
        cooldowns: "connection rateLimitedUntil / unavailableUntil / modelLock_* fields",
        catalog: "modelSync/connectionCatalog status per connection (informational, never health)",
        noScore: "categorical thresholds on observed counts only — no blended score is computed",
        readFailures,
      },
      sampling: {
        trafficRows: trafficRows.length,
        trafficRowCap: MAX_TRAFFIC_ROWS,
        trafficTruncated,
        outcomeRows: detailRows.length,
        outcomeRowsAvailable: outcomeTotal,
        outcomesTruncated: outcomeTotal > detailRows.length,
      },
      totals: {
        providers: providers.length,
        models: providers.reduce((sum, p) => sum + p.modelsTotal, 0),
        requests: providers.reduce((sum, p) => sum + p.requests, 0),
        observed: providers.reduce((sum, p) => sum + p.observed, 0),
        withIssues: providers.filter((p) => SEVERITY[p.status] >= SEVERITY.degraded).length,
        unknown: providers.filter((p) => p.status === "unknown").length,
      },
      providers,
    });
  } catch (error) {
    console.error("[API] Failed to build provider health matrix:", error);
    return NextResponse.json({ error: "Failed to build health matrix" }, { status: 500 });
  }
}

function latestStatus(statuses) {
  let worst = null;
  for (const s of statuses) {
    if (!worst || SEVERITY[s] > SEVERITY[worst]) worst = s;
  }
  return worst || "unknown";
}
