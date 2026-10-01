// Scope enforcement middleware — NEW file. Wraps a /v1/* route handler
// without modifying it: reads the request's API key, looks up its scope
// (keys with scope=NULL — the default — are completely unaffected and this
// resolves to a no-op), and returns 403 before the real handler ever runs
// if the requested provider/model falls outside scope. On any parsing
// ambiguity it fails open (calls the handler) rather than risk blocking a
// legitimate request — the real handler's own validation still applies.
import { extractApiKey } from "@/sse/services/auth.js";
import { getApiKeyScopeByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { isModelAccessAllowed } from "@/lib/scopeConnectionFilter.js";
import { getModelInfo, getComboModels } from "@/sse/services/model.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

async function readJsonModel(request, useProviderField) {
  try {
    const body = await request.clone().json();
    if (!body || typeof body !== "object") return null;
    const value = useProviderField ? (body.provider || body.model) : body.model;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function readFormModel(request) {
  try {
    const form = await request.clone().formData();
    const value = form.get("model");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

// Resolves the requested model string to one or more {provider, model}
// targets. Combos expand to every member model (a combo's internal fallback
// can pick any of them, so ALL members must be in scope). Search/fetch pass
// pseudoModelId since "provider IS the model" for those endpoints.
async function resolveTargets(modelStr, pseudoModelId) {
  if (!modelStr) return null;
  if (pseudoModelId) {
    return [{ provider: modelStr, model: pseudoModelId }];
  }
  try {
    const comboModels = await getComboModels(modelStr);
    if (comboModels && comboModels.length > 0) {
      const targets = [];
      for (const member of comboModels) {
        const info = await getModelInfo(member);
        if (info?.provider) targets.push({ provider: info.provider, model: info.model });
      }
      return targets.length ? targets : null;
    }
  } catch {
    // not a combo — fall through to direct model resolution
  }
  try {
    const info = await getModelInfo(modelStr);
    if (info?.provider) return [{ provider: info.provider, model: info.model }];
  } catch {
    // unresolvable — let the real handler surface its own error
  }
  return null;
}

async function checkScopeDenial(request, bodyMode, pseudoModelId) {
  try {
    const apiKey = extractApiKey(request);
    if (!apiKey) return null;

    const scope = await getApiKeyScopeByKey(apiKey);
    if (!scope) return null;

    const modelStr = bodyMode === "form"
      ? await readFormModel(request)
      : await readJsonModel(request, bodyMode === "json-provider");

    const targets = await resolveTargets(modelStr, pseudoModelId);
    if (!targets) return null;

    const denied = targets.find((t) => !isModelAccessAllowed(scope, t.provider, t.model));
    if (!denied) return null;

    return errorResponse(
      HTTP_STATUS.FORBIDDEN,
      `API key scope does not permit access to ${denied.provider}/${denied.model}`
    );
  } catch {
    return null;
  }
}

/**
 * @param {Function} handler - the existing, unmodified route handler (request, ...rest) => Response
 * @param {{ bodyMode?: "json"|"json-provider"|"form", pseudoModelId?: string }} options
 *   bodyMode "json": model comes from JSON body.model
 *   bodyMode "json-provider": model comes from JSON body.provider ?? body.model (search/fetch)
 *   bodyMode "form": model comes from a multipart form field named "model"
 *   pseudoModelId: for provider-IS-the-model endpoints (search/fetch), the fixed model id to check ("search"/"fetch")
 */
export function withScopeAuth(handler, options = {}) {
  const { bodyMode = "json", pseudoModelId = null } = options;
  return async function scopedHandler(request, ...rest) {
    const denial = await checkScopeDenial(request, bodyMode, pseudoModelId);
    if (denial) return denial;
    return handler(request, ...rest);
  };
}
