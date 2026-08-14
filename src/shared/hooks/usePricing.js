"use client";

import { useState, useEffect, useCallback } from "react";

// Module cache: one /api/pricing fetch shared by every usePricing instance.
let cache = null; // { provider: { model: { input, output, ... } } } | null
let inflight = null;

const PRICING_CHANGED_EVENT = "pricingChanged";

/**
 * Drop the module cache and notify mounted hooks to refetch.
 * Call after any pricing mutation (edit/reset/models.dev import).
 */
export function invalidatePricingCache() {
  cache = null;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PRICING_CHANGED_EVENT));
}

function loadPricing() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/pricing")
    .then(async (res) => {
      if (!res.ok) throw new Error(`pricing ${res.status}`);
      return res.json();
    })
    .then((data) => {
      cache = data || {};
      return cache;
    })
    .catch(() => ({}))
    .finally(() => { inflight = null; });
  return inflight;
}

export function usePricing() {
  const [pricing, setPricing] = useState(() => cache || {});

  useEffect(() => {
    let alive = true;
    const apply = (data) => { if (alive) setPricing(data); };
    if (cache) {
      apply(cache);
    } else {
      loadPricing().then(apply);
    }
    const onChanged = () => {
      loadPricing().then(apply);
    };
    window.addEventListener(PRICING_CHANGED_EVENT, onChanged);
    return () => {
      alive = false;
      window.removeEventListener(PRICING_CHANGED_EVENT, onChanged);
    };
  }, []);

  // providerKey: provider alias or id (merged pricing may be keyed by either)
  const getPricing = useCallback(
    (providerKey, modelId) => (providerKey && modelId ? pricing[providerKey]?.[modelId] || null : null),
    [pricing]
  );

  return { getPricing };
}
