import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import {
  classifyHealth,
  isRetryableHealth,
} from "./health.js";

export const CONTROL_CENTER_FILE = path.join(DATA_DIR, "model-control-center.json");

const EMPTY = {
  v: 1,
  syncedAt: null,
  testedAt: null,
  providers: {},
  summary: {
    providers: 0,
    connections: 0,
    models: 0,
    healthy: 0,
    failed: 0,
    retryable: 0,
    timeout: 0,
    unavailable: 0,
    restricted: 0,
    rateLimited: 0,
    upstreamError: 0,
    probeIncompatible: 0,
    unsupported: 0,
    pending: 0,
    changed: 0,
    stale: 0,
  },
};

export function summarizeProviders(providers = {}) {
  let connections = 0;
  let models = 0;
  let healthy = 0;
  let failed = 0;
  let retryable = 0;
  let timeout = 0;
  let unavailable = 0;
  let restricted = 0;
  let rateLimited = 0;
  let upstreamError = 0;
  let probeIncompatible = 0;
  let unsupported = 0;
  let pending = 0;
  let changed = 0;
  let stale = 0;

  for (const provider of Object.values(providers)) {
    connections += provider.connectionCount || 0;
    for (const model of Object.values(provider.models || {})) {
      models += 1;
      if (model.stale) stale += 1;
      if (model.changed) changed += 1;
      const category = classifyHealth(model.health);

      if (category === "ok") {
        healthy += 1;
      } else if (category === "unsupported") {
        unsupported += 1;
      } else if (category === "pending") {
        pending += 1;
      } else {
        failed += 1;

        if (isRetryableHealth(model.health)) {
          retryable += 1;
        }

        if (category === "timeout") timeout += 1;
        if (category === "unavailable") unavailable += 1;
        if (category === "restricted") restricted += 1;
        if (category === "rate_limited") rateLimited += 1;
        if (category === "upstream_error") upstreamError += 1;
        if (category === "probe_incompatible") probeIncompatible += 1;
      }
    }
  }

  return {
    providers: Object.keys(providers).length,
    connections,
    models,
    healthy,
    failed,
    retryable,
    timeout,
    unavailable,
    restricted,
    rateLimited,
    upstreamError,
    probeIncompatible,
    unsupported,
    pending,
    changed,
    stale,
  };
}

export function readControlCenter() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONTROL_CENTER_FILE, "utf8"));
    const providers = parsed?.providers && typeof parsed.providers === "object"
      ? parsed.providers
      : {};
    return {
      ...EMPTY,
      ...parsed,
      providers,
      summary: summarizeProviders(providers),
    };
  } catch {
    return { ...EMPTY, providers: {}, summary: { ...EMPTY.summary } };
  }
}

export function writeControlCenter(next) {
  const payload = {
    ...EMPTY,
    ...next,
    v: 1,
    providers: next?.providers || {},
  };
  payload.summary = summarizeProviders(payload.providers);

  fs.mkdirSync(path.dirname(CONTROL_CENTER_FILE), { recursive: true });
  const tmp = `${CONTROL_CENTER_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, CONTROL_CENTER_FILE);
  return payload;
}
