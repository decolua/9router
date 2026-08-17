/**
 * Capacity Adapter — global fallback pools of models per input-modality capability
 * (vision / pdf / audioInput / videoInput).
 *
 * The pool models are appended as extra fallback candidates behind whatever models
 * were already going to be tried (a combo's members, or a single target model).
 * combo.js's existing reorderByCapabilities then floats a capable pool model to the
 * front only when none of the original models can handle the request — so this
 * never overrides a combo that already has a member covering the capability.
 */
import { getCapabilitiesForModel } from "../providers/capabilities.js";

const CAPABILITY_KEYS = ["vision", "pdf", "audioInput", "videoInput"];
const HARD_CAPS = new Set(CAPABILITY_KEYS);
const DEFAULT_FALLBACK_MODEL = "oc/mimo-v2.5-free";

// Normalize a capability entry to { enabled, roundRobin, models }. Backward-compat:
// accept the legacy array form [{model, enabled}] (treated as enabled, fallback).
function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => e?.model || e).filter(Boolean) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    };
  }
  return { enabled: false, roundRobin: false, models: [] };
}

// Resolve one capability's full config. Enabled pools with no models fall back
// to DEFAULT_FALLBACK_MODEL so the toggle is never a no-op.
export function getCapacityAdapterConfig(cap, settings) {
  const entry = normalizeCapEntry(settings?.capacityAdapter?.[cap]);
  if (entry.enabled && entry.models.length === 0) {
    return { ...entry, models: [DEFAULT_FALLBACK_MODEL] };
  }
  return entry;
}

// Flatten enabled models across all capability pools, in priority order, deduped.
export function getCapacityAdapterModels(settings) {
  const seen = new Set();
  const models = [];
  for (const cap of CAPABILITY_KEYS) {
    const { enabled, models: pool } = getCapacityAdapterConfig(cap, settings);
    if (!enabled) continue;
    for (const m of pool) {
      if (!seen.has(m)) {
        seen.add(m);
        models.push(m);
      }
    }
  }
  return models;
}

// Strategy for a capability: "round-robin" when enabled+roundRobin, else "fallback".
export function getCapacityAdapterStrategy(cap, settings) {
  const { enabled, roundRobin } = getCapacityAdapterConfig(cap, settings);
  return enabled && roundRobin ? "round-robin" : "fallback";
}

// Strategy from the request's required capabilities: picks the first capability
// whose adapter pool is enabled and can satisfy a hard requirement.
export function getActiveAdapterStrategy(requiredCapabilities, settings) {
  const hard = [...(requiredCapabilities || [])].filter((c) => HARD_CAPS.has(c));
  for (const cap of hard) {
    const { enabled, models } = getCapacityAdapterConfig(cap, settings);
    if (!enabled || models.length === 0) continue;
    return getCapacityAdapterStrategy(cap, settings);
  }
  return "fallback";
}

function modelSatisfies(modelStr, requiredHard) {
  const slash = modelStr.indexOf("/");
  const provider = slash > 0 ? modelStr.slice(0, slash) : "";
  const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;
  const caps = getCapabilitiesForModel(provider, model);
  return requiredHard.every((c) => caps[c] === true);
}

// Prepend capacity-adapter models as priority candidates when NONE of the
// original models (combo members, or the single target model) can satisfy the
// request's required capabilities. Adapter models go FIRST (priority); the
// original models follow as fallback. Leaves `models` untouched when the
// original list already covers it (combo.js's reorderByCapabilities handles
// that case via autoSwitch).
export function augmentModelsWithCapacityAdapter(models, requiredCapabilities, settings) {
  const hard = [...(requiredCapabilities || [])].filter((c) => HARD_CAPS.has(c));
  if (hard.length === 0 || !Array.isArray(models) || models.length === 0) return models;
  if (models.some((m) => modelSatisfies(m, hard))) return models;

  const pool = getCapacityAdapterModels(settings).filter((m) => !models.includes(m) && modelSatisfies(m, hard));
  if (pool.length === 0) return models;
  return [...pool, ...models];
}

const CHARS_PER_TOKEN = 4; // rough estimate; avoids pulling in a tokenizer dependency
const HEAD_KEEP = 6;      // messages after system kept verbatim before dropping the middle

function blockLength(content) {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce((sum, b) => sum + (typeof b?.text === "string" ? b.text.length : 50), 0);
  }
  return 0;
}

// Trim history to fit a (possibly smaller) context window by dropping the MIDDLE.
// Preserves: all system/instruction messages (head), and the trailing user run
// carrying the media the switch happened for (tail). Older middle turns between
// the head instructions and the current turn are dropped first.
export function stripHistoryForContext(body, contextWindow) {
  const key = Array.isArray(body.messages) ? "messages"
    : Array.isArray(body.input) ? "input"
    : Array.isArray(body.contents) ? "contents"
    : null;
  if (!key) return body;
  const arr = body[key];
  if (!arr || arr.length === 0) return body;

  const isSystem = (r) => r === "system" || r === "developer";
  const systemMsgs = arr.filter((m) => isSystem(m?.role));
  const rest = arr.filter((m) => !isSystem(m?.role));
  if (rest.length === 0) return body;

  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = rest.length - 1;
  while (i >= 0 && !isAssistant(rest[i]?.role)) i--;
  const tail = rest.slice(i + 1);          // current user turn (has media) — always kept
  const older = rest.slice(0, i + 1);      // everything before it
  if (older.length === 0) return body;

  const contentOf = (m) => m.content ?? m.parts;
  // Cap at 80% of the adapter model's context window — leaves room for the response.
  const budgetChars = (contextWindow || 200000) * 0.8 * CHARS_PER_TOKEN;

  // Prefer keeping the first HEAD_KEEP messages (initial instructions/context) verbatim;
  // only trim further if even that exceeds the adapter model's context window.
  const headKept = older.slice(0, HEAD_KEEP);
  let total = systemMsgs.concat(headKept, tail).reduce((s, m) => s + blockLength(contentOf(m)), 0);

  // If head + tail overflow, drop head turns from the end (closest to middle) first.
  let head = headKept;
  while (total > budgetChars && head.length > 0) {
    const dropped = head.pop();
    total -= blockLength(contentOf(dropped));
  }

  if (head.length === older.length) return body;
  return { ...body, [key]: [...systemMsgs, ...head, ...tail] };
}

// Wrap a handleSingleModel callback so calls to a capacity-adapter model strip
// history to fit its context window first. No-op passthrough when the pool is empty.
export function withCapacityAdapterStripping(handleSingleModel, adapterModels) {
  const adapterSet = new Set(adapterModels);
  if (adapterSet.size === 0) return handleSingleModel;
  return (body, modelStr, ...rest) => {
    if (adapterSet.has(modelStr)) {
      const slash = modelStr.indexOf("/");
      const provider = slash > 0 ? modelStr.slice(0, slash) : "";
      const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;
      const { contextWindow } = getCapabilitiesForModel(provider, model);
      body = stripHistoryForContext(body, contextWindow);
    }
    return handleSingleModel(body, modelStr, ...rest);
  };
}
