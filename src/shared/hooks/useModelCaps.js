"use client";

import { useState, useEffect, useCallback } from "react";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

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
function resolveCaps(byFull, byId, overrides, key) {
  if (!key) return null;
  if (byFull[key]) return byFull[key]; // built-ins: server already merged overrides
  const bare = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
  const provider = key.includes("/") ? key.slice(0, key.indexOf("/")) : null;
  // Provider-specific override wins over a cross-provider byId match
  // (e.g. custom "ollama/glm-5.2" must not inherit built-in glm-5.2 caps).
  const override = provider ? overrides[`${provider}|${bare}`] : null;
  if (override) {
    return pickCaps({ ...getCapabilitiesForModel(provider, bare), ...override });
  }
  if (byId[bare]) return byId[bare];
  return pickCaps(getCapabilitiesForModel(provider, bare));
}

export function useModelCaps() {
  const [byFull, setByFull] = useState(() => cache?.byFull || {});
  const [byId, setById] = useState(() => cache?.byId || {});
  const [overrides, setOverrides] = useState(() => cache?.overrides || {});

  useEffect(() => {
    let alive = true;
    const apply = (maps) => {
      setByFull(maps.byFull);
      setById(maps.byId);
      setOverrides(maps.overrides);
    };
    if (cache) {
      apply(cache);
    } else {
      loadModelCaps().then((maps) => { if (alive) apply(maps); });
    }
    const onChanged = () => {
      loadModelCaps().then((maps) => { if (alive) apply(maps); });
    };
    window.addEventListener(CAPS_CHANGED_EVENT, onChanged);
    return () => {
      alive = false;
      window.removeEventListener(CAPS_CHANGED_EVENT, onChanged);
    };
  }, []);

  const getCaps = useCallback(
    (key) => resolveCaps(byFull, byId, overrides, key),
    [byFull, byId, overrides],
  );

  return { getCaps };
}
