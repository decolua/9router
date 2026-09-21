"use client";

import { useCallback, useEffect, useState } from "react";
import { orcaCatalogOrigin } from "@/shared/utils/orcaCatalogPicker";

const EMPTY_ORCA_CATALOG = { models: [], source: null, degraded: false, loaded: false };

/**
 * OrcaRouter's catalog is capability-scoped and can degrade, so it gets its own
 * hook: the server already returns the verified seed when live discovery fails,
 * and `source` tells the panel whether to label the list as a fallback.
 *
 * Every consumer (the shared model modal, the anchored picker) reads the same
 * endpoint, so the key stays on the server and the filtering rules stay in one
 * place.
 */
export function useOrcaRouterCatalog(isOpen, connectionIds, capability, modality) {
  const [state, setState] = useState(EMPTY_ORCA_CATALOG);
  const [nonce, setNonce] = useState(0);
  const idsKey = (connectionIds ?? []).join("|");

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    let cancelled = false;

    if (!isOpen || ids.length === 0) {
      // Deferred on purpose: resetting synchronously inside an effect body would
      // schedule a cascading render, and the cancelled guard keeps a stale reset
      // from clobbering a newer run.
      queueMicrotask(() => { if (!cancelled) setState(EMPTY_ORCA_CATALOG); });
      return () => { cancelled = true; };
    }

    Promise.all(ids.map(async (connectionId) => {
      const params = new URLSearchParams({ capability });
      // Multimodal entry points ask the same catalog for a stricter subset.
      if (modality) params.set("modality", modality);
      const response = await fetch(`/api/providers/${connectionId}/models?${params}`, { cache: "no-store" });
      if (!response.ok) return null;
      return response.json();
    }))
      .then((results) => {
        if (cancelled) return;
        const live = results.filter(Boolean);
        const seen = new Set();
        const models = live
          .flatMap((result) => orcaCatalogOrigin(result).models)
          .filter((model) => {
            if (!model?.id || seen.has(model.id)) return false;
            seen.add(model.id);
            return true;
          });
        setState({
          models,
          source: live[0]?.source || null,
          degraded: live.some((result) => orcaCatalogOrigin(result).degraded),
          loaded: true,
        });
      })
      .catch((error) => {
        console.warn("Unable to load OrcaRouter catalog for selector:", error);
        // `degraded` without `loaded` means the request itself failed: the panel
        // must not claim the catalog legitimately matched nothing.
        if (!cancelled) setState({ models: [], source: null, degraded: true, loaded: false });
      });

    return () => { cancelled = true; };
  }, [isOpen, idsKey, capability, modality, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, live: state.source === "live" && !state.degraded, refresh };
}

export default useOrcaRouterCatalog;
