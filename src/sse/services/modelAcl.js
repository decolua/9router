/**
 * Model Access Control (ACL) service
 * Determines whether an API key / customer is permitted to access a requested model.
 */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegex(pattern) {
  const parts = pattern.split("*").map(escapeRegex);
  return new RegExp(`^${parts.join(".*")}$`, "i");
}

/**
 * Check if a model is permitted under the given allowedModels list.
 *
 * @param {string[]|string} allowedModels - List of allowed model identifiers or patterns (e.g. ['*'], ['deepseek'], ['qwen', 'deepseek'])
 * @param {string} requestedModel - The model requested by the client (e.g. 'deepseek-chat', 'deepseek/deepseek-chat', 'qwen-turbo')
 * @param {object|null} modelInfo - Optional parsed model info { provider, model }
 * @param {string[]|null} comboModels - Optional list of underlying models if requestedModel is a combo
 * @returns {boolean} True if allowed, false otherwise
 */
export function isModelAllowed(arg1, arg2, modelInfo = null, comboModels = null) {
  let allowedModels = arg1;
  let requestedModel = arg2;

  // Flexible argument order: supports (allowedModels, requestedModel) or (requestedModel, allowedModels)
  if (
    Array.isArray(arg2) ||
    (typeof arg2 === "string" && (arg2.startsWith("[") || arg2.includes(",") || arg2 === "*")) ||
    ((arg1 === null || arg1 === undefined || arg1 === "") && Array.isArray(arg2))
  ) {
    allowedModels = arg2;
    requestedModel = arg1;
  }

  if (!requestedModel || typeof requestedModel !== "string" || !requestedModel.trim()) {
    return false;
  }

  let list = allowedModels;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = list.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (!list || !Array.isArray(list) || list.length === 0) {
    return false;
  }

  if (list.includes("*")) {
    return true;
  }

  const req = requestedModel.toLowerCase().trim();
  const provider = (modelInfo?.provider || (req.includes("/") ? req.slice(0, req.indexOf("/")) : "")).toLowerCase().trim();
  const model = (modelInfo?.model || (req.includes("/") ? req.slice(req.indexOf("/") + 1) : req)).toLowerCase().trim();
  const fullModel = provider && model ? `${provider}/${model}` : "";

  // If requestedModel is a combo and all models in the combo are allowed
  if (comboModels && Array.isArray(comboModels) && comboModels.length > 0) {
    const allComboModelsAllowed = comboModels.every((m) => isModelAllowed(list, m));
    if (allComboModelsAllowed) return true;
  }

  for (const item of list) {
    if (typeof item !== "string") continue;
    const p = item.toLowerCase().trim();
    if (!p) continue;

    if (p === "*") return true;

    // 1. Direct match with requestedModel, model name, provider, or full provider/model
    const itemModel = p.includes("/") ? p.slice(p.indexOf("/") + 1) : p;
    const itemProvider = p.includes("/") ? p.slice(0, p.indexOf("/")) : "";
    const providerMatches = !itemProvider || !provider || itemProvider === provider;

    if (
      p === req ||
      p === model ||
      (fullModel && p === fullModel) ||
      (provider && p === provider) ||
      (providerMatches && (itemModel === model || itemModel === req))
    ) {
      return true;
    }

    // 2. Wildcard pattern matching (e.g. "deepseek*", "qwen/*", "*gpt*")
    if (p.includes("*")) {
      const re = patternToRegex(p);
      if (re.test(req) || (model && re.test(model)) || (fullModel && re.test(fullModel))) {
        return true;
      }
      continue;
    }

    // 3. Family / provider prefix matching (e.g. "deepseek" matches "deepseek-chat", "deepseek_v3", "qwen" matches "qwen-turbo", "qwen2.5", "qwen/qwen-plus")
    const matchPrefixWithBoundary = (target, prefix) => {
      if (!target.startsWith(prefix)) return false;
      const nextChar = target.slice(prefix.length, prefix.length + 1);
      return !nextChar || /[\/\-_.:0-9]/.test(nextChar);
    };

    if (matchPrefixWithBoundary(req, p) || (model && matchPrefixWithBoundary(model, p))) {
      return true;
    }

    if (provider && provider === p) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an API key record is permitted to use the requested model.
 *
 * @param {object|null} keyRecord - API key object with { allowedModels, isActive, expiresAt }
 * @param {string} requestedModel - Requested model string
 * @param {object|null} modelInfo - Optional parsed model info { provider, model }
 * @param {string[]|null} comboModels - Optional combo models list
 * @returns {{ allowed: boolean, status: number, error?: string, reason?: string, model?: string }}
 */
export function checkApiKeyModelAccess(keyRecord, requestedModel, modelInfo = null, comboModels = null) {
  if (!keyRecord) {
    return { allowed: false, status: 401, error: "API key is required", reason: "API key is required" };
  }

  if (keyRecord.isActive === false || keyRecord.enabled === false) {
    return { allowed: false, status: 401, error: "API key is inactive", reason: "API key is inactive" };
  }

  if (keyRecord.expiresAt) {
    const exp = new Date(keyRecord.expiresAt).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) {
      return { allowed: false, status: 401, error: "API key has expired", reason: "API key has expired" };
    }
  }

  const allowedModels = keyRecord.allowedModels || keyRecord.allowed_models || ["*"];
  const allowed = isModelAllowed(allowedModels, requestedModel, modelInfo, comboModels);

  if (!allowed) {
    const errorMsg = `Model '${requestedModel}' is not permitted for this API key`;
    return {
      allowed: false,
      status: 403,
      error: errorMsg,
      reason: errorMsg,
      model: requestedModel,
    };
  }

  return { allowed: true, status: 200 };
}

/**
 * Filter an array of model items based on allowedModels
 *
 * @param {Array<{ id: string }>} modelsList
 * @param {string[]|string} allowedModels
 * @returns {Array<{ id: string }>}
 */
export function filterAllowedModels(arg1, arg2) {
  let modelsList = arg1;
  let allowedModels = arg2;

  // Detect which argument is the list of model objects/items to filter
  // vs which argument is the permission rules list
  const isArg1ModelObjects = Array.isArray(arg1) && arg1.length > 0 && typeof arg1[0] === "object" && arg1[0] !== null;
  const isArg2ModelObjects = Array.isArray(arg2) && arg2.length > 0 && typeof arg2[0] === "object" && arg2[0] !== null;

  if (isArg2ModelObjects && !isArg1ModelObjects) {
    modelsList = arg2;
    allowedModels = arg1;
  } else if (!Array.isArray(arg1) && Array.isArray(arg2)) {
    modelsList = arg2;
    allowedModels = arg1;
  }

  if (!Array.isArray(modelsList)) return [];

  let list = allowedModels;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = list.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (!list || (Array.isArray(list) && list.includes("*"))) {
    return modelsList;
  }

  return modelsList.filter((m) => {
    const id = typeof m === "string" ? m : (m?.id || m?.model || m?.name);
    return isModelAllowed(list, id, null, m?.comboModels);
  });
}

export default {
  isModelAllowed,
  checkApiKeyModelAccess,
  filterAllowedModels,
};
