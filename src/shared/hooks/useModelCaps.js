"use client";

import { useState, useEffect, useCallback } from "react";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { ALIAS_TO_ID } from "@/shared/constants/providers";

// Module cache: one /api/models + /api/models/caps fetch shared by every useModelCaps instance.
let cache = null; // { byFull, byId, overrides } | null
let inflight = null;

const CAPS_CHANGED_EVENT = "modelCapsChanged";

/**
 * Drop the module cache and notify mounted hooks to refetch.
 * Call after any capabilities mutation (edit/reset/models.dev import).
 */
export function invalidateModelCapsCache() {
  cache = null;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CAPS_CHANGED_EVENT));
}

function buildMaps(models, overrides) {
  const byFull = {};
  const byId = {};
  for (const m of models || []) {
    if (!m.caps) continue;
    if (m.fullModel) byFull[m.fullModel] = m.caps;
    if (m.routedModel) byFull[m.routedModel] = m.caps;
    if (m.model) byId[m.model] = m.caps;
  }
  return { byFull, byId, overrides: overrides || {} };
}

function loadModelCaps() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = Promise.all([
    fetch("/api/models").then(async (res) => {
      if (!res.ok) throw new Error(`models ${res.status}`);
      return res.json();
    }),
    fetch("/api/models/caps").then(async (res) => {
      if (!res.ok) throw new Error(`caps ${res.status}`);
      return res.json();
    }),
  ])
    .then(([modelsData, capsData]) => {
      cache = buildMaps(modelsData.models, capsData.overrides);
      return cache;
    })
    .catch(() => {
      // Keep null so a later mount can retry
      return { byFull: {}, byId: {}, overrides: {} };
    })
    .finally(() => { inflight = null; });
  return inflight;
}

const pickCaps = (c) => ({
  vision: c.vision,
  search: c.search,
  reasoning: c.reasoning,
  tools: c.tools,
  pdf: c.pdf,
  imageOutput: c.imageOutput,
  contextWindow: c.contextWindow,
  maxOutput: c.maxOutput,
});

// Resolve caps from a "provider/model" string or a bare model id.
// The seat prefix is a UI alias (ocg, cmc, …); the capability tables are keyed
// by provider id (opencode-go, commandcode, …), so map it before the lookup —
// an unmapped alias falls through to the generic patterns and under-reports
// (e.g. any *claude*haiku* id reads as 200k regardless of the provider entry).
export function resolveCaps(byFull, byId, key, overrides = {}) {
  if (!key) return null;
  if (byFull[key]) return byFull[key]; // built-ins: server already merged overrides
  const bare = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
  const alias = key.includes("/") ? key.slice(0, key.indexOf("/")) : null;
  const provider = alias ? (ALIAS_TO_ID[alias] || alias) : null;
  const c = getCapabilitiesForModel(provider, bare);
  const override = alias ? overrides[`${alias}|${bare}`] || overrides[`${provider}|${bare}`] : null;
  if (override) return pickCaps({ ...c, ...override });
  if (byId[bare]) return byId[bare];
  return pickCaps(c);
}

export function useModelCaps() {
  const [byFull, setByFull] = useState(() => cache?.byFull || {});
  const [byId, setById] = useState(() => cache?.byId || {});
  const [overrides, setOverrides] = useState(() => cache?.overrides || {});

  useEffect(() => {
    let alive = true;
    const sync = (maps) => {
      if (alive) { setByFull(maps.byFull); setById(maps.byId); setOverrides(maps.overrides); }
    };
    loadModelCaps().then(sync);
    // Custom models change at runtime — drop the shared cache and refetch
    const invalidate = () => {
      cache = null;
      loadModelCaps().then(sync);
    };
    window.addEventListener("customModelChanged", invalidate);
    window.addEventListener(CAPS_CHANGED_EVENT, invalidate);
    return () => {
      alive = false;
      window.removeEventListener("customModelChanged", invalidate);
      window.removeEventListener(CAPS_CHANGED_EVENT, invalidate);
    };
  }, []);

  const getCaps = useCallback(
    (key) => resolveCaps(byFull, byId, key, overrides),
    [byFull, byId, overrides],
  );

  return { getCaps, overrides };
}
