import { getModelInfo } from "../services/model.js";
import { getProviderCredentials } from "../services/auth.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { getModelMeta } from "open-sse/config/providerModels.js";
import {
  DEFAULT_SYSTEMONE_ROUTER_MODEL,
  DEFAULT_SYSTEMONE_TIMEOUT_MS,
  extractPromptState,
  buildChoiceCriteria,
  parseSystemOneRouteAnswer,
} from "open-sse/services/systemoneRouter.js";

// Cloudflare Clef restricts choice option ids to letters, digits, '_', '.' and '-'.
// Combo members are full model ids (with '/' and ':'), so remap them to m0, m1...
// for these providers and translate the answer back before combo ordering.
const SAFE_OPTION_ID_PROVIDERS = new Set(["cloudflare-ai"]);

/**
 * Dispatch an in-process System One decision evaluation for a combo request.
 * Resolves the configured router model's provider and credentials, sends the choice
 * query with a short timeout, and returns the parsed routing decision.
 *
 * Never throws: on missing credentials, timeout, or upstream failure, returns null
 * so combo dispatch fails open to standard model ordering.
 *
 * @param {object} opts
 * @param {object} opts.body - Client request body
 * @param {string[]} opts.models - Combo model candidate array
 * @param {string} [opts.routerModel] - System One router model (defaults to oc/jev-1.13-free)
 * @param {object} [opts.log] - Logger
 * @param {number} [opts.timeoutMs=DEFAULT_SYSTEMONE_TIMEOUT_MS] - Hard ceiling for router evaluation
 * @returns {Promise<{ choice: string, confidence: number|null, probabilities: Record<string, number>|null } | null>}
 */
export async function resolveSmartChoice({
  body,
  models,
  routerModel = DEFAULT_SYSTEMONE_ROUTER_MODEL,
  log,
  timeoutMs = DEFAULT_SYSTEMONE_TIMEOUT_MS,
}) {
  if (!Array.isArray(models) || models.length <= 1) return null;

  const targetModel = (typeof routerModel === "string" && routerModel.trim())
    ? routerModel.trim()
    : DEFAULT_SYSTEMONE_ROUTER_MODEL;

  const state = extractPromptState(body);
  if (!state) {
    log?.debug?.("COMBO", "smart-router: empty prompt state, skipping classification");
    return null;
  }

  try {
    const modelInfo = await getModelInfo(targetModel);
    if (!modelInfo?.provider) {
      log?.warn?.("COMBO", `smart-router: unrecognized router model "${targetModel}"`);
      return null;
    }

    const { provider, model } = modelInfo;

    // Get model metadata to check payloadShape (Clairic uses "fields" instead of "questions")
    const modelMeta = getModelMeta(provider, model);
    const payloadShape = modelMeta?.payloadShape || "questions";

    // Cloudflare Clef rejects option ids containing '/' or ':'; combo members are
    // full model ids. Remap to m0, m1... and keep a reverse map for the answer.
    let optionToModel = null;
    let criteria = buildChoiceCriteria(models);
    if (SAFE_OPTION_ID_PROVIDERS.has(provider)) {
      optionToModel = new Map();
      criteria = {};
      models.forEach((candidate, i) => {
        const optionId = `m${i}`;
        criteria[optionId] = candidate;
        optionToModel.set(optionId, candidate);
      });
    }
    if (Object.keys(criteria).length === 0) return null;

    const credentials = await getProviderCredentials(provider, new Set(), model);
    if (!credentials || credentials.allRateLimited) {
      log?.warn?.("COMBO", `smart-router: no credentials available for router provider "${provider}"`);
      return null;
    }

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Build payload based on payloadShape: "fields" for Clairic, "questions" for Clef
    const systemoneBody = {
      model,
      state,
    };
    if (payloadShape === "fields") {
      systemoneBody.fields = {
        route: {
          type: "choice",
          instructions: "Which of these configured models is the most appropriate for this request?",
          criteria,
        },
      };
    } else {
      systemoneBody.questions = {
        route: {
          type: "choice",
          instructions: "Which of these configured models is the most appropriate for this request?",
          criteria,
        },
      };
    }

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`System One router timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const corePromise = handleSystemoneCore({
      body: systemoneBody,
      modelInfo: { provider, model, payloadShape },
      credentials: refreshedCredentials,
      log,
      onRequestSuccess: () => {},
    });

    let result;
    try {
      result = await Promise.race([corePromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!result?.success || !result.response) {
      log?.warn?.("COMBO", `smart-router: evaluation failed (${result?.status || "error"})`);
      return null;
    }

    const json = await result.response.json();
    let route = parseSystemOneRouteAnswer(json);
    if (!route || !route.choice) {
      log?.warn?.("COMBO", "smart-router: response missing valid route choice");
      return null;
    }

    // Translate Clef's m0/m1... option ids back to the combo's model ids so
    // orderModelsByChoice() can float the winner to the front.
    if (optionToModel) {
      const originalChoice = optionToModel.get(route.choice);
      if (!originalChoice) {
        log?.warn?.("COMBO", `smart-router: unknown option id "${route.choice}"`);
        return null;
      }
      const probabilities = route.probabilities
        ? Object.fromEntries(Object.entries(route.probabilities).map(([key, value]) => [optionToModel.get(key) || key, value]))
        : null;
      route = { ...route, choice: originalChoice, probabilities };
    }

    return route;
  } catch (err) {
    log?.warn?.("COMBO", `smart-router: evaluation aborted (${err?.message || String(err)})`);
    return null;
  }
}
