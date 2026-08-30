import {
  getRecentRequestDetailsBatch,
} from "../db/repos/requestDetailsRepo.js";

import {
  summarizeRoutingHistory,
} from "./routingSignals.js";

function identityKey(
  provider,
  model,
) {
  return `${provider}\0${model}`;
}

export function indexRoutingTelemetry(
  details = [],
  {
    nowMs = Date.now(),
  } = {},
) {
  const buckets = new Map();

  const rows =
    Array.isArray(details)
      ? details
      : [];

  for (const row of rows) {
    const provider =
      String(
        row?.provider || "",
      ).trim();

    const model =
      String(
        row?.model || "",
      ).trim();

    if (
      !provider
      || !model
    ) {
      continue;
    }

    const key =
      identityKey(
        provider,
        model,
      );

    if (!buckets.has(key)) {
      buckets.set(
        key,
        {
          provider,
          model,
          rows: [],
        },
      );
    }

    buckets
      .get(key)
      .rows
      .push(row);
  }

  const index = new Map();

  for (
    const [
      key,
      bucket,
    ] of buckets
  ) {
    const history =
      summarizeRoutingHistory(
        bucket.rows,
        {
          nowMs,
        },
      );

    index.set(
      key,
      {
        provider:
          bucket.provider,

        model:
          bucket.model,

        samples:
          bucket.rows.length,

        reliability:
          history.reliability,

        latency:
          history.latency,

        freshness:
          history.freshness,
      },
    );
  }

  return index;
}

export function getRoutingTelemetry(
  index,
  {
    providers = [],
    model,
  } = {},
) {
  if (
    !(index instanceof Map)
    || !model
  ) {
    return null;
  }

  const providerList =
    Array.isArray(providers)
      ? providers
      : [providers];

  for (
    const provider
    of providerList
  ) {
    if (!provider) {
      continue;
    }

    const found =
      index.get(
        identityKey(
          provider,
          model,
        ),
      );

    if (found) {
      return found;
    }
  }

  return null;
}

export async function buildRoutingTelemetryBatch({
  limit = 200,
  nowMs = Date.now(),
} = {}) {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        Number(limit) || 200,
        1000,
      ),
    );

  let details = [];

  try {
    details =
      await getRecentRequestDetailsBatch(
        safeLimit,
      );
  } catch {
    // Observability is optional.
    // Missing telemetry remains neutral.
    details = [];
  }

  return {
    v: 1,

    generatedAt:
      new Date(nowMs)
        .toISOString(),

    rowsRead:
      details.length,

    limit:
      safeLimit,

    historyIndex:
      indexRoutingTelemetry(
        details,
        {
          nowMs,
        },
      ),

    authority: {
      routingChanged: false,

      selectorIntegrated: false,

      telemetryIsRoutingAuthority:
        false,
    },
  };
}
