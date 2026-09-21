// Pure helpers for the OrcaRouter live-catalog picker.
//
// Kept free of React so the capability/modality rules and the stale-selection
// rule can be tested directly: the picker must recompute its option list from a
// capability-scoped API call, and a model that the new slice no longer contains
// must be dropped rather than silently kept.

export const ORCA_PICKER_CAPABILITIES = [
  { value: "chat", label: "Chat" },
  { value: "embedding", label: "Embedding" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "rerank", label: "Rerank" },
];

/**
 * Only the chat slice can be narrowed by input modality. Asking a media slice
 * for `modality=image` would be meaningless, so it is not sent.
 */
export function supportsImageFilter(capability) {
  return capability === "chat";
}

/**
 * Query string for one entry point. Every option the picker renders comes from
 * this capability-scoped request — there is no hand-written model list.
 */
export function orcaCatalogQuery({ capability = "chat", imageOnly = false } = {}) {
  const params = new URLSearchParams({ capability });
  if (imageOnly && supportsImageFilter(capability)) params.set("modality", "image");
  return params.toString();
}

/**
 * Drop a selection the current slice no longer offers, so a model that is
 * incompatible with the new capability/modality cannot stay selected.
 */
export function pruneOrcaSelection(models, selected) {
  if (!selected) return null;
  const ids = new Set(
    (Array.isArray(models) ? models : [])
      .map((model) => model?.id)
      .filter((id) => typeof id === "string" && id)
  );
  return ids.has(selected) ? selected : null;
}

/**
 * Where the rendered list came from. `live` is authoritative; `fallback` is the
 * verified cold-start list the server substitutes when discovery fails, and it
 * must be labelled as degraded rather than presented as live discovery.
 */
export function orcaCatalogOrigin(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const source = payload?.source || null;
  return {
    models,
    source,
    degraded: payload?.degraded === true || source === "fallback",
    live: source === "live" && payload?.degraded !== true,
  };
}
