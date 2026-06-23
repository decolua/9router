import type { JsonValue } from "open-sse/types/executor.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";

const pricingKv = makeKv("pricing");
const CACHE_TTL_MS = 5000;

let cache: { value: Record<string, unknown> | null; expiresAt: number } = { value: null, expiresAt: 0 };

function invalidate() {
  cache = { value: null, expiresAt: 0 };
}

async function getUserPricing() {
  return await pricingKv.getAll();
}

export async function getPricing() {
  const now = Date.now();
  if (cache.value && cache.expiresAt > now) return cache.value;

  const userPricing = await getUserPricing();
  // Dynamic import: open-sse/providers/pricing.js is a peer ESM package not in this build graph
  const { PROVIDER_PRICING } = await import("open-sse/providers/pricing.js") as { PROVIDER_PRICING: Record<string, Record<string, unknown>> };
  const merged: Record<string, Record<string, unknown>> = {};

  for (const [provider, models] of Object.entries(PROVIDER_PRICING)) {
    merged[provider] = { ...models };
    const up = userPricing[provider];
    if (up && typeof up === "object" && !Array.isArray(up)) {
      for (const [model, pricing] of Object.entries(up as Record<string, unknown>)) {
        const existing = merged[provider][model];
        merged[provider][model] = (existing && typeof existing === "object")
          ? { ...(existing as Record<string, unknown>), ...(pricing as Record<string, unknown>) }
          : pricing;
      }
    }
  }

  for (const [provider, models] of Object.entries(userPricing)) {
    if (!merged[provider]) {
      merged[provider] = { ...(models as Record<string, unknown>) };
    } else {
      for (const [model, pricing] of Object.entries(models as Record<string, unknown>)) {
        if (!merged[provider][model]) merged[provider][model] = pricing;
      }
    }
  }

  cache = { value: merged, expiresAt: now + CACHE_TTL_MS };
  return merged;
}

export async function getPricingForModel(provider: string | null | undefined, model: string | null | undefined) {
  if (!model) return null;
  const userPricing = await getUserPricing();
  if (provider) {
    const provMap = userPricing[provider];
    if (provMap && typeof provMap === "object" && !Array.isArray(provMap)) {
      const entry = (provMap as Record<string, unknown>)[model];
      if (entry) return entry;
    }
  }
  // Dynamic import: open-sse/providers/pricing.js is a peer ESM package not in this build graph
  const { getPricingForModel: resolveConst } = await import("open-sse/providers/pricing.js") as {
    getPricingForModel: (provider: string | null | undefined, model: string) => unknown
  };
  return resolveConst(provider, model);
}

// Atomic merge inside transaction (per-provider read-modify-write)
export async function updatePricing(pricingData: Record<string, Record<string, unknown>>) {
  const db = await getAdapter();
  db.transaction(() => {
    for (const [provider, models] of Object.entries(pricingData)) {
      const row = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]) as Record<string, unknown> | undefined;
      const current = row ? ((parseJson(row["value"] as string | null, {}) as Record<string, unknown>) ?? {}) : {};
      const merged = { ...current };
      for (const [model, pricing] of Object.entries(models)) {
        merged[model] = pricing;
      }
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(merged as JsonValue)]
      );
    }
  });
  invalidate();
  return await getUserPricing();
}

export async function resetPricing(provider: string | null | undefined, model?: string | null) {
  if (!provider) return await getUserPricing();
  const db = await getAdapter();
  db.transaction(() => {
    if (!model) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
      return;
    }
    const row = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]) as Record<string, unknown> | undefined;
    const current = row ? ((parseJson(row["value"] as string | null, {}) as Record<string, unknown>) ?? {}) : {};
    delete current[model];
    if (Object.keys(current).length === 0) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(current as JsonValue)]
      );
    }
  });
  invalidate();
  return await getUserPricing();
}

export async function resetAllPricing() {
  await pricingKv.clear();
  invalidate();
  return {};
}
