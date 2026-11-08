import { buildModelsList } from "@/app/api/v1/models/route.js";
import { getProviderConnections } from "@/lib/localDb";
import { ALIAS_TO_ID } from "@/shared/constants/providers";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { getUsageHistory } from "@/lib/db/repos/usageRepo.js";
import { getRequestDetails } from "@/lib/db/repos/requestDetailsRepo.js";
import { getActiveModelLocks } from "@/app/api/models/availability/route.js";

const LLM_KIND = "llm";
const VALID_PERIODS = new Set(["24h", "7d"]);
const PERIOD_MS = { "24h": 86400000, "7d": 604800000 };

function periodToStartDate(period) {
  const now = Date.now();
  return new Date(now - PERIOD_MS[period]).toISOString();
}

// Build usage stats per model from usageHistory rows in the period.
// ponytail: rows are keyed by the bare model tail (usageHistory stores the raw
// upstream model, the catalog publishes `alias/model`), so two providers serving
// the same model id share one usage bucket. Upgrade path: key on
// `${model}|${provider}` and resolve alias→provider id via ALIAS_TO_PROVIDER_ID.
function buildUsageMap(rows) {
  const usageByTail = new Map();

  for (const row of rows) {
    const modelId = row.model || "";
    const promptTokens = row.tokens?.prompt_tokens ?? row.tokens?.input_tokens ?? 0;
    const completionTokens = row.tokens?.completion_tokens ?? row.tokens?.output_tokens ?? 0;
    const cost = row.cost || 0;
    const isError = !!row.status && row.status !== "ok";

    const tail = modelId.includes("/") ? modelId.split("/").pop() : modelId;
    if (!tail) continue;

    if (!usageByTail.has(tail)) {
      usageByTail.set(tail, { requests: 0, errors: 0, promptTokens: 0, completionTokens: 0, cost: 0 });
    }
    const u = usageByTail.get(tail);
    u.requests += 1;
    if (isError) u.errors += 1;
    u.promptTokens += promptTokens;
    u.completionTokens += completionTokens;
    u.cost += cost;
  }

  return usageByTail;
}

// Build average latency per model from requestDetails.
// Returns a map keyed by tail, value = avg latency ms (or null if no data).
async function buildLatencyMap(startDate) {
  const { details } = await getRequestDetails({
    startDate,
    page: 1,
    pageSize: 200, // retention cap is 200
  });

  const sums = new Map();
  const counts = new Map();

  for (const d of details) {
    const latency = d?.latency?.total;
    if (!Number.isFinite(latency) || latency <= 0) continue;

    const modelId = d?.model || "";
    const tail = modelId.includes("/") ? modelId.split("/").pop() : modelId;
    if (!tail) continue;

    sums.set(tail, (sums.get(tail) || 0) + latency);
    counts.set(tail, (counts.get(tail) || 0) + 1);
  }

  const result = new Map();
  for (const [tail, sum] of sums) {
    const count = counts.get(tail) || 1;
    result.set(tail, Math.round(sum / count));
  }
  return result;
}

// Build combo membership map from combos table.
// Returns { combosByModel: Map<tail, string[]>, primaryByModel: Map<tail, boolean> }
// A model is "primary" for a combo if it appears as the first seat in that combo.
function buildComboMaps(combos) {
  const combosByModel = new Map();
  const primaryByModel = new Map();

  for (const combo of combos) {
    const seats = Array.isArray(combo?.models) ? combo.models : [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i];
      if (typeof seat !== "string") continue;
      const slash = seat.indexOf("/");
      if (slash <= 0) continue; // nested combo or bare name, not a catalog model id
      const tail = seat.slice(slash + 1);

      if (!combosByModel.has(tail)) combosByModel.set(tail, []);
      combosByModel.get(tail).push(combo.name);

      if (i === 0 && !primaryByModel.has(tail)) {
        primaryByModel.set(tail, true);
      }
    }
  }

  return { combosByModel, primaryByModel };
}

// Build health/availability from providerConnections — same data
// /api/models/availability already exposes (active modelLock_* rows plus
// connection-level testStatus), reused rather than re-implemented.
// Keys: `${providerId}|${model}` for a per-model cooldown, `${providerId}|*` for
// the connection-level status; resolveHealth() prefers the more specific one.
// ponytail: a connection configured with an explicit providerSpecificData.prefix
// publishes a catalog alias that ALIAS_TO_ID does not map, so its model falls
// back to the connection-level entry. Upgrade path: expose the prefix→id map the
// catalog itself uses (ALIAS_TO_PROVIDER_ID in /v1/models/route.js).
function buildHealthMap(connections) {
  const health = new Map();

  const entryFor = (conn, overrides = {}) => ({
    available: true,
    status: "active",
    backoffLevel: conn.backoffLevel || 0,
    rateLimitedUntil: null,
    lastError: conn.lastError || null,
    lastErrorAt: conn.lastErrorAt || null,
    ...overrides,
  });

  for (const conn of connections) {
    if (!conn?.provider) continue;
    const providerKey = `${conn.provider}|*`;

    if (conn.testStatus === "unavailable") {
      // An unavailable connection outranks a previously recorded healthy one.
      const current = health.get(providerKey);
      if (!current || current.status === "active") {
        health.set(providerKey, entryFor(conn, {
          available: false,
          status: "unavailable",
          lastError: conn.lastError || null,
          lastErrorAt: conn.lastErrorAt || null,
        }));
      }
    } else if (!health.has(providerKey)) {
      health.set(providerKey, entryFor(conn));
    }

    for (const lock of getActiveModelLocks(conn)) {
      if (lock.model === "__all") continue; // lock on every model → stays a connection-level signal
      const key = `${conn.provider}|${lock.model}`;
      const existing = health.get(key);
      if (!existing || (lock.until || 0) > (existing.rateLimitedUntil || 0)) {
        health.set(key, entryFor(conn, {
          available: false,
          status: "cooldown",
          rateLimitedUntil: lock.until,
        }));
      }
    }
  }

  return health;
}

function resolveHealth(tail, provider, healthMap) {
  const modelKey = provider ? `${provider}|${tail}` : null;
  if (modelKey && healthMap.has(modelKey)) return healthMap.get(modelKey);

  const providerKey = provider ? `${provider}|*` : null;
  if (providerKey && healthMap.has(providerKey)) return healthMap.get(providerKey);

  // Default: healthy, no backoff.
  return {
    available: true,
    status: "active",
    backoffLevel: 0,
    rateLimitedUntil: null,
    lastError: null,
    lastErrorAt: null,
  };
}

// Resolve usage for a tail from the usage map.
function resolveUsage(tail, usageMap) {
  return usageMap.get(tail) || { requests: 0, errors: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
}

// Resolve avg latency for a tail.
function resolveLatency(tail, latencyMap) {
  return latencyMap.get(tail) ?? null;
}

export async function GET(request) {
  try {
    const searchParams = request?.nextUrl?.searchParams;
    const period = (searchParams?.get("period") || "24h").toLowerCase();

    if (!VALID_PERIODS.has(period)) {
      return Response.json(
        { error: { message: `Invalid period "${period}". Valid: ${[...VALID_PERIODS].join(", ")}`, type: "invalid_request_error" } },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const startDate = periodToStartDate(period);

    // 1. Catalog (LLM models only, same as /v1/models default)
    const catalog = await buildModelsList([LLM_KIND]);

    // 2. Availability / health
    const connections = await getProviderConnections({ isActive: true });
    const healthMap = buildHealthMap(connections);

    // 3. Usage stats
    const usageRows = await getUsageHistory({ startDate });
    const usageMap = buildUsageMap(usageRows);

    // 4. Latency (optional, only when data exists)
    const latencyMap = await buildLatencyMap(startDate);

    // 5. Combo routing
    const combos = await getCombos();
    const { combosByModel, primaryByModel } = buildComboMaps(combos);

    // 6. Merge into response shape
    const generatedAt = new Date().toISOString();

    const data = catalog.map((model) => {
      const tail = model.id?.includes("/") ? model.id.split("/").pop() : model.id;
      const alias = model.owned_by || "";
      // Connections and lock keys are keyed by provider id; the catalog publishes
      // the UI alias. ALIAS_TO_ID closes the gap for the common case (an explicit
      // conn.providerSpecificData.prefix falls back to the alias — see ponytail
      // note on buildHealthMap).
      const providerId = ALIAS_TO_ID[alias] || alias;

      const health = resolveHealth(tail, providerId, healthMap);
      const usage = resolveUsage(tail, usageMap);
      const avgLatencyMs = resolveLatency(tail, latencyMap);

      return {
        id: model.id,
        owned_by: model.owned_by,
        kind: model.kind || LLM_KIND,
        available: health.available,
        health: {
          status: health.status,
          backoffLevel: health.backoffLevel,
          rateLimitedUntil: health.rateLimitedUntil,
          lastError: health.lastError,
          lastErrorAt: health.lastErrorAt,
        },
        usage: {
          requests: usage.requests,
          errors: usage.errors,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          cost: usage.cost,
          avgLatencyMs,
        },
        routing: {
          combos: combosByModel.get(tail) || [],
          primary: primaryByModel.get(tail) === true,
        },
        capabilities: model.capabilities || {},
        context_length: model.context_length || 0,
      };
    });

    return Response.json({
      object: "router.models",
      generatedAt,
      period,
      data,
    }, { headers: { "Access-Control-Allow-Origin": "*" } });

  } catch (error) {
    console.error("[router/models] Error:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}