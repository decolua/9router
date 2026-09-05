"use client";

import { useState, useEffect, useCallback } from "react";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// Module cache: one /api/models fetch shared by every useModelCaps instance.
let cache = null; // { byFull, byId } | null
let inflight = null;

// Compatible providers are stored under a generated node id (e.g.
// "openai-compatible-chat-<uuid>") but are addressed by a user-defined display
// prefix (e.g. "unl-jembatanai"). Custom-model caps must be indexed by BOTH so a
// prefix-keyed model string ("unl-jembatanai/claude-sonnet-5") matches the row that
// /api/models/custom returns keyed by the node id.
function buildNodePrefixMap(nodes) {
  const byId = {};
  const idToPrefix = {};
  for (const n of nodes || []) {
    if (!n?.id) continue;
    byId[n.id] = n;
    idToPrefix[n.id] = n.prefix || n.id;
    if (n.prefix) byId[n.prefix] = n;
  }
  return { byId, idToPrefix };
}

function buildMaps(models, customModels, nodes) {
  const { byId: nodeById } = buildNodePrefixMap(nodes);
  const byFull = {};
  const byId = {};
  for (const m of models || []) {
    if (!m.caps) continue;
    if (m.fullModel) byFull[m.fullModel] = m.caps;
    if (m.routedModel) byFull[m.routedModel] = m.caps;
    if (m.model) byId[m.model] = m.caps;
  }
  // User-added custom models carry their own declared caps (vision/reasoning/…).
  // /api/models only lists built-ins, so without this a custom combo member
  // resolves to registry-default caps and its badges are wrong/empty.
  for (const m of customModels || []) {
    if (!m?.caps || !m?.providerAlias || !m?.id) continue;
    const node = nodeById[m.providerAlias];
    const display = node?.prefix || m.providerAlias;
    byFull[`${m.providerAlias}/${m.id}`] = m.caps;
    if (display && display !== m.providerAlias) byFull[`${display}/${m.id}`] = m.caps;
    if (!byId[m.id]) byId[m.id] = m.caps;
  }
  // Map display prefix -> node id so the pattern fallback guard applies for
  // prefix-keyed model strings (the provider string the combo stores).
  const providerResolver = (prefix) => {
    if (!prefix) return null;
    const node = nodeById[prefix];
    return node ? node.id : prefix;
  };
  return { byFull, byId, providerResolver };
}

function loadModelCaps() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = Promise.all([
    fetch("/api/models").then((r) => (r.ok ? r.json() : { models: [] })).catch(() => ({ models: [] })),
    fetch("/api/models/custom", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { models: [] })).catch(() => ({ models: [] })),
    fetch("/api/provider-nodes", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { nodes: [] })).catch(() => ({ nodes: [] })),
  ])
    .then(([data, customData, nodesData]) => {
      cache = buildMaps(data.models, customData.models, nodesData.nodes);
      return cache;
    })
    .catch(() => {
      // Keep null so a later mount can retry
      return { byFull: {}, byId: {}, providerResolver: (p) => p };
    })
    .finally(() => { inflight = null; });
  return inflight;
}

// Resolve caps from a "provider/model" string or a bare model id.
// `resolveProvider` maps a user display prefix to its node id so the custom-node
// guard in getCapabilitiesForModel applies (custom nodes must not inherit the
// base-model pattern caps of a different provider).
function resolveCaps(byFull, byId, key, resolveProvider) {
  if (!key) return null;
  if (byFull[key]) return byFull[key];
  const bare = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
  if (byId[bare]) return byId[bare];
  const provider = resolveProvider(key.includes("/") ? key.slice(0, key.indexOf("/")) : null);
  const c = getCapabilitiesForModel(provider, bare);
  return {
    vision: c.vision,
    search: c.search,
    reasoning: c.reasoning,
    contextWindow: c.contextWindow,
    maxOutput: c.maxOutput,
  };
}

export function useModelCaps() {
  const [byFull, setByFull] = useState(() => cache?.byFull || {});
  const [byId, setById] = useState(() => cache?.byId || {});
  const [resolveProvider, setResolveProvider] = useState(() => cache?.providerResolver || ((p) => p));

  useEffect(() => {
    let alive = true;
    const load = () => {
      loadModelCaps().then((maps) => {
        if (alive) {
          setByFull(maps.byFull);
          setById(maps.byId);
          setResolveProvider(() => maps.providerResolver || ((p) => p));
        }
      });
    };
    // cache-hit is already seeded by the useState initializers; only fetch on miss
    if (!cache) load();
    // Adding/removing a custom model (with new caps) should refresh badges
    // without a full reload — the providers page fires this on change.
    const onCustomModelChanged = () => { cache = null; load(); };
    if (typeof window !== "undefined") window.addEventListener("customModelChanged", onCustomModelChanged);
    return () => {
      alive = false;
      if (typeof window !== "undefined") window.removeEventListener("customModelChanged", onCustomModelChanged);
    };
  }, []);

  const getCaps = useCallback(
    (key) => resolveCaps(byFull, byId, key, resolveProvider),
    [byFull, byId, resolveProvider],
  );

  return { getCaps };
}
