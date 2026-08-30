import {
  getRequestDetails,
} from "../db/repos/requestDetailsRepo.js";

import {
  getPricingForModel,
} from "../db/repos/pricingRepo.js";

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function timestampInfo(value, nowMs) {
  if (!value) {
    return {
      known: false,
      observedAt: null,
      ageMs: null,
    };
  }

  const parsed = new Date(value).getTime();

  if (!Number.isFinite(parsed)) {
    return {
      known: false,
      observedAt: null,
      ageMs: null,
    };
  }

  return {
    known: true,
    observedAt: new Date(parsed).toISOString(),
    ageMs: Math.max(0, nowMs - parsed),
  };
}

function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const sorted = [...values]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (sorted.length === 0) return null;

  const index = Math.min(
    sorted.length - 1,
    Math.max(
      0,
      Math.ceil(sorted.length * fraction) - 1,
    ),
  );

  return sorted[index];
}

export function normalizeQuotaSignal(
  quota = null,
  {
    nowMs = Date.now(),
    exact = false,
    source = null,
  } = {},
) {
  if (!quota || typeof quota !== "object") {
    return {
      known: false,
      exact: false,
      source,
      remainingPercentage: null,
      resetAt: null,
      resetAgeMs: null,
      exhausted: false,
      authoritativeBlock: false,
    };
  }

  const remainingPercentage =
    finiteNumber(quota.remainingPercentage);

  const resetInfo = timestampInfo(
    quota.resetAt,
    nowMs,
  );

  const resetAt = resetInfo.observedAt;

  const resetIsFuture =
    resetAt !== null
    && new Date(resetAt).getTime() > nowMs;

  const exhausted =
    remainingPercentage !== null
    && remainingPercentage <= 0
    && resetIsFuture;

  return {
    known:
      remainingPercentage !== null
      || resetAt !== null,

    exact: exact === true,
    source,

    remainingPercentage,
    resetAt,

    resetAgeMs:
      resetAt
        ? new Date(resetAt).getTime() - nowMs
        : null,

    exhausted,

    // C.0 contract:
    // quota is hard authority only when the caller
    // explicitly marks the upstream observation exact.
    authoritativeBlock:
      exact === true && exhausted,
  };
}

export function summarizeRoutingHistory(
  details = [],
  {
    nowMs = Date.now(),
  } = {},
) {
  const rows = Array.isArray(details)
    ? details
    : [];

  const totals = [];
  const ttfts = [];

  let successSamples = 0;
  let failureSamples = 0;

  let newestTimestamp = null;
  let newestMs = null;

  for (const row of rows) {
    const total =
      finiteNumber(row?.latency?.total);

    const ttft =
      finiteNumber(row?.latency?.ttft);

    if (total !== null && total >= 0) {
      totals.push(total);
    }

    if (ttft !== null && ttft > 0) {
      ttfts.push(ttft);
    }

    const status = String(
      row?.status || "",
    ).toLowerCase();

    if (
      status === "success"
      || status === "ok"
    ) {
      successSamples += 1;
    } else if (status) {
      failureSamples += 1;
    }

    const ts = row?.timestamp
      ? new Date(row.timestamp).getTime()
      : NaN;

    if (
      Number.isFinite(ts)
      && (
        newestMs === null
        || ts > newestMs
      )
    ) {
      newestMs = ts;
      newestTimestamp =
        new Date(ts).toISOString();
    }
  }

  const classifiedSamples =
    successSamples + failureSamples;

  return {
    samples: rows.length,

    reliability: {
      // Observation only.
      // requestDetails may be disabled or pruned,
      // therefore this is never routing authority.
      known: classifiedSamples > 0,
      authority: false,
      successSamples,
      failureSamples,

      successRate:
        classifiedSamples > 0
          ? successSamples / classifiedSamples
          : null,
    },

    latency: {
      known:
        totals.length > 0
        || ttfts.length > 0,

      authority: false,

      totalSamples: totals.length,
      ttftSamples: ttfts.length,

      totalMedianMs:
        percentile(totals, 0.5),

      totalP95Ms:
        percentile(totals, 0.95),

      ttftMedianMs:
        percentile(ttfts, 0.5),

      ttftP95Ms:
        percentile(ttfts, 0.95),
    },

    freshness: {
      newestObservedAt: newestTimestamp,

      newestAgeMs:
        newestMs === null
          ? null
          : Math.max(0, nowMs - newestMs),

      // C.1 deliberately does not classify
      // fresh/stale. C.2 owns scoring windows.
      classified: false,
    },
  };
}

export function normalizeHealthSignal(
  health = null,
  {
    nowMs = Date.now(),
  } = {},
) {
  const tested = timestampInfo(
    health?.testedAt,
    nowMs,
  );

  return {
    known:
      Boolean(
        health?.category
        || health?.status
        || health?.testedAt,
      ),

    // Phase A/C.0 contract:
    // probe health is signal, not authority.
    authority: false,

    category:
      health?.category || "pending",

    status:
      health?.status || null,

    statusCode:
      finiteNumber(
        health?.statusCode,
      ),

    probeLatencyMs:
      finiteNumber(
        health?.latencyMs,
      ),

    testedAt:
      tested.observedAt,

    ageMs:
      tested.ageMs,
  };
}

export function normalizePricingSignal(
  pricing = null,
) {
  if (!pricing || typeof pricing !== "object") {
    return {
      known: false,
      authority: false,
      inputPer1M: null,
      outputPer1M: null,
      cachedPer1M: null,
      reasoningPer1M: null,
      cacheCreationPer1M: null,
    };
  }

  return {
    known: true,

    // Price is a preference/scoring input only.
    authority: false,

    inputPer1M:
      finiteNumber(pricing.input),

    outputPer1M:
      finiteNumber(pricing.output),

    cachedPer1M:
      finiteNumber(pricing.cached),

    reasoningPer1M:
      finiteNumber(pricing.reasoning),

    cacheCreationPer1M:
      finiteNumber(pricing.cache_creation),
  };
}

export function normalizeAuthoritySignal(
  effectiveModel = null,
) {
  const reasons =
    Array.isArray(effectiveModel?.reasons)
      ? [...effectiveModel.reasons]
      : [];

  return {
    operatorPolicy:
      effectiveModel?.operatorPolicy || null,

    operatorDisabled:
      effectiveModel?.operatorDisabled === true,

    effectiveEligible:
      effectiveModel?.effectivePreview !== false,

    reasons,

    // This adapter reports authority state.
    // It does not create new authority.
    source: "phase-b-effective-model-set",
  };
}

export function normalizeRoutingSignals({
  provider,
  model,
  connectionId = null,
  effectiveModel = null,
  requestDetails = [],
  pricing = null,
  quota = null,
  quotaExact = false,
  quotaSource = null,
  nowMs = Date.now(),
} = {}) {
  const history =
    summarizeRoutingHistory(
      requestDetails,
      { nowMs },
    );

  return {
    v: 1,

    identity: {
      provider: provider || null,
      model: model || null,
      connectionId:
        connectionId || null,
    },

    authority:
      normalizeAuthoritySignal(
        effectiveModel,
      ),

    health:
      normalizeHealthSignal(
        effectiveModel?.health,
        { nowMs },
      ),

    quota:
      normalizeQuotaSignal(
        quota,
        {
          nowMs,
          exact: quotaExact,
          source: quotaSource,
        },
      ),

    latency:
      history.latency,

    reliability:
      history.reliability,

    cost:
      normalizePricingSignal(
        pricing,
      ),

    freshness: {
      history:
        history.freshness,

      health: {
        observedAt:
          effectiveModel?.health
            ?.testedAt || null,

        ageMs:
          normalizeHealthSignal(
            effectiveModel?.health,
            { nowMs },
          ).ageMs,
      },
    },

    routing: {
      changed: false,
      score: null,
      rank: null,
    },
  };
}

export async function buildRoutingSignals({
  provider,
  model,
  connectionId = null,
  effectiveModel = null,
  quota = null,
  quotaExact = false,
  quotaSource = null,
  historyLimit = 50,
  nowMs = Date.now(),
} = {}) {
  if (!provider || !model) {
    throw new Error(
      "provider and model are required",
    );
  }

  const safeLimit = Math.max(
    1,
    Math.min(
      Number(historyLimit) || 50,
      200,
    ),
  );

  let requestDetails = [];

  try {
    const history =
      await getRequestDetails({
        provider,
        model,
        ...(connectionId
          ? { connectionId }
          : {}),
        page: 1,
        pageSize: safeLimit,
      });

    requestDetails =
      history?.details || [];
  } catch {
    // Observability is optional.
    // Missing telemetry must remain neutral.
    requestDetails = [];
  }

  let pricing = null;

  try {
    pricing =
      await getPricingForModel(
        provider,
        model,
      );
  } catch {
    // Missing pricing must remain neutral.
    pricing = null;
  }

  return normalizeRoutingSignals({
    provider,
    model,
    connectionId,
    effectiveModel,
    requestDetails,
    pricing,
    quota,
    quotaExact,
    quotaSource,
    nowMs,
  });
}
