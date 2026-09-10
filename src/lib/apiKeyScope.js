// API key scope engine — pure functions, no I/O. NEW file, part of the
// additive API-key-scoping feature: nothing here is imported by any
// pre-existing code path, so deleting this file (and its siblings
// scopeConnectionFilter.js, scopeModelsFilter.js, middleware/scopeAuth.js)
// leaves the rest of the app behaving exactly as before.
//
// Scope shape (stored as JSON in apiKeys.scope, nullable):
//   {
//     providers: string[] | null,  // provider ids/aliases; null/absent = all providers
//     models: string[] | null,     // "provider/model" ids; null/absent/[] = all models of allowed providers
//   }
//
// Semantics are AND across axes: a request must pass the providers check
// AND the models check. The practical default (provider selected, models
// left empty) is "all models of that provider" — see providerModels/README
// in the dashboard picker for why models defaults to empty-means-all while
// providers defaults to null-means-all (asymmetric on purpose: an explicit
// empty `providers: []` is a deliberate "deny everything" lockdown, while an
// explicit empty `models: []` under a selected provider means "no narrowing
// applied yet", i.e. the whole provider).
import { resolveProviderId } from "@/shared/constants/providers.js";

export function isScopeUnrestricted(scope) {
  return !scope || typeof scope !== "object";
}

function normalizeProviderId(idOrAlias) {
  if (!idOrAlias || typeof idOrAlias !== "string") return idOrAlias;
  return resolveProviderId(idOrAlias);
}

/** Providers axis only. */
export function isProviderAllowed(scope, providerIdOrAlias) {
  if (isScopeUnrestricted(scope)) return true;
  const providers = scope.providers;
  if (!Array.isArray(providers)) return true;
  const target = normalizeProviderId(providerIdOrAlias);
  return providers.some((p) => normalizeProviderId(p) === target);
}

/** Providers AND models axes for a single (provider, model) pair. */
export function isModelAllowed(scope, providerIdOrAlias, modelId) {
  if (!isProviderAllowed(scope, providerIdOrAlias)) return false;
  if (isScopeUnrestricted(scope)) return true;
  const models = scope.models;
  if (!Array.isArray(models) || models.length === 0) return true;
  const target = normalizeProviderId(providerIdOrAlias);
  return models.some((entry) => {
    if (typeof entry !== "string" || !entry.includes("/")) return false;
    const idx = entry.indexOf("/");
    const entryProvider = normalizeProviderId(entry.slice(0, idx));
    const entryModel = entry.slice(idx + 1);
    return entryProvider === target && entryModel === modelId;
  });
}

/** Convenience for catalog entries shaped like "{alias}/{modelId}" (as emitted by /v1/models). */
export function isFullModelIdAllowed(scope, fullModelId) {
  if (isScopeUnrestricted(scope)) return true;
  if (typeof fullModelId !== "string" || !fullModelId.includes("/")) {
    // No provider prefix (e.g. a combo name) — can't be axis-checked, so a
    // scoped key never sees it. Least-privilege default for an ambiguous id.
    return false;
  }
  const idx = fullModelId.indexOf("/");
  return isModelAllowed(scope, fullModelId.slice(0, idx), fullModelId.slice(idx + 1));
}

/** Validate/normalize a scope object coming from the dashboard API before persisting it. */
export function normalizeScopeInput(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const out = {};
  if (Array.isArray(raw.providers)) {
    out.providers = raw.providers.filter((p) => typeof p === "string" && p.trim() !== "");
  }
  if (Array.isArray(raw.models)) {
    out.models = raw.models.filter((m) => typeof m === "string" && m.includes("/"));
  }
  // An object with neither axis set is equivalent to unrestricted — store as null
  // so back-compat code paths (which only special-case null) treat it identically.
  if (!("providers" in out) && !("models" in out)) return null;
  return out;
}
