import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { errorResponse } from "open-sse/utils/error.js";
import { getProviderNodes } from "@/lib/db/repos/nodesRepo.js";
import { getProviderAlias } from "@/shared/constants/providers.js";
import * as log from "../utils/logger.js";

const VALID_MODES = new Set(["all", "allow", "deny"]);
const DEFAULT_MODEL_ACCESS = Object.freeze({ mode: "all", patterns: [] });
const PROVIDER_NODE_TYPES = new Set(["openai-compatible", "anthropic-compatible", "custom-embedding"]);

export function normalizeModelAccess(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { mode: DEFAULT_MODEL_ACCESS.mode, patterns: [] };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !VALID_MODES.has(value.mode) || !Array.isArray(value.patterns)
    || value.patterns.some((pattern) => typeof pattern !== "string")) {
    return { mode: DEFAULT_MODEL_ACCESS.mode, patterns: [] };
  }

  const seen = new Set();
  const patterns = [];
  for (const item of value.patterns) {
    const pattern = item.trim();
    const dedupeKey = pattern.toLowerCase();
    if (!pattern || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    patterns.push(pattern);
    if (patterns.length >= 200) break;
  }
  return { mode: value.mode, patterns };
}

export function matchesPattern(pattern, name) {
  if (typeof pattern !== "string" || typeof name !== "string") return false;
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\S]*");
  return new RegExp(`^${expression}$`, "i").test(name);
}

export function evaluateModelAccess(access, candidates, { topLevelAllowed = false } = {}) {
  const normalized = normalizeModelAccess(access);
  if (normalized.mode === "all") return { allowed: true };
  const values = Array.isArray(candidates) ? candidates : [];
  const matched = normalized.patterns.find((pattern) =>
    values.some((candidate) => matchesPattern(pattern, candidate))
  );

  if (normalized.mode === "deny") {
    return matched ? { allowed: false, matched } : { allowed: true };
  }
  if (topLevelAllowed || matched) {
    return { allowed: true, ...(matched ? { matched } : {}) };
  }
  return { allowed: false };
}

export async function buildModelCandidates(requestedModel, providerId, model) {
  const candidates = [];
  const seen = new Set();
  const add = (value) => {
    if (typeof value === "string" && value && !seen.has(value)) {
      seen.add(value);
      candidates.push(value);
    }
  };

  add(requestedModel);
  add(`${providerId}/${model}`);

  const nodes = await getProviderNodes();
  const node = nodes.find((entry) => entry.id === providerId && PROVIDER_NODE_TYPES.has(entry.type));
  const prefix = node ? node.prefix : getProviderAlias(providerId);
  if (prefix) add(`${prefix}/${model}`);

  return candidates;
}

export function filterModelsByAccess(access, models) {
  const normalized = normalizeModelAccess(access);
  if (normalized.mode === "all") return models;
  return models.filter((entry) => evaluateModelAccess(normalized, [entry.id]).allowed);
}

export function createModelAccessContext(key, requestedModel) {
  if (!key) return null;
  const access = normalizeModelAccess(key.modelAccess);
  if (access.mode === "all") return null;
  const topLevelAllowed = access.mode === "allow"
    && evaluateModelAccess(access, [requestedModel]).allowed;
  return { keyName: key.name || key.id || "unnamed", access, topLevelAllowed };
}

export function isTopLevelModelBlocked(context, modelStr) {
  return !!context
    && context.access.mode === "deny"
    && !evaluateModelAccess(context.access, [modelStr]).allowed;
}

export function modelAccessDeniedResponse(context, modelStr) {
  log.warn("AUTH", `API key "${context.keyName}" denied model "${modelStr}"`);
  return errorResponse(
    HTTP_STATUS.FORBIDDEN,
    `API key "${context.keyName}" is not allowed to use model "${modelStr}"`
  );
}

export async function enforceModelAccess(context, modelStr, providerId, model) {
  if (!context) return null;
  const candidates = await buildModelCandidates(modelStr, providerId, model);
  const result = evaluateModelAccess(context.access, candidates, {
    topLevelAllowed: context.topLevelAllowed,
  });
  return result.allowed ? null : modelAccessDeniedResponse(context, modelStr);
}
