/**
 * Alibaba Token Plan live model catalog.
 *
 * The subscription's catalog moves independently of this repo, so /v1/models
 * prefers this fetch and falls back to the static registry list.
 *
 * Alibaba returns every capability from one OpenAI-shaped /models response with
 * no kind field, so IDs are classified here and anything this gateway cannot
 * execute is withheld instead of advertised as a broken route.
 */
import crypto from "crypto";

import { PROVIDERS, PROVIDER_MODELS } from "../providers/index.js";

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, { expiresAt: number, models: { id: string, name: string, kind: string }[] }>} */
const catalogCache = new Map();

function cacheKey(apiKey) {
  return crypto.createHash("sha256").update(String(apiKey)).digest("hex");
}

function modelsUrl() {
  return PROVIDERS["alitp-intl"]?.validateUrl || null;
}

/**
 * Map a Token Plan model ID to the service kind this gateway can route it as.
 * Returns null for models with no executable HTTP path here.
 *
 * @param {string} modelId
 * @returns {"llm" | "image" | "tts" | null}
 */
export function classifyTokenPlanModel(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  if (!id) return null;
  // WebSocket/WebRTC speech-to-speech — no WebSocket surface in this gateway.
  if (id.includes("-realtime")) return null;
  // Async video job APIs — no video executor for this provider.
  if (id.startsWith("happyhorse") || /-(?:t2v|i2v|video)\b/.test(id) || id.includes("-video-")) return null;
  if (id.includes("-tts")) return "tts";
  // DashScope ASR is WebSocket/file-job based; no STT executor for this provider.
  if (id.includes("-asr") || id.includes("-stt")) return null;
  if (id.includes("-image")) return "image";
  return "llm";
}

function staticNameFor(modelId) {
  const models = PROVIDER_MODELS["alitp-intl"] || [];
  return models.find((model) => model.id === modelId)?.name || modelId;
}

async function fetchTokenPlanCatalog(apiKey, signal) {
  const url = modelsUrl();
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  signal?.addEventListener?.("abort", () => controller.abort(), { once: true });

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = new Error(`Alibaba Token Plan /models returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const entries = Array.isArray(payload?.data) ? payload.data : [];

  const models = [];
  const seen = new Set();
  for (const entry of entries) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const kind = classifyTokenPlanModel(id);
    if (!kind) continue;
    seen.add(id);
    models.push({ id, name: entry.name || staticNameFor(id), kind });
  }
  return models;
}

/**
 * Resolve the live Token Plan catalog for the authenticated subscription.
 * Returns null on any failure so callers fall back to the static registry.
 *
 * @param {{ apiKey?: string, accessToken?: string }} credentials
 * @param {{ log?: object, signal?: AbortSignal, forceRefresh?: boolean }} [options]
 */
export async function resolveAlibabaTokenPlanModels(credentials, options = {}) {
  const apiKey = credentials?.apiKey || credentials?.accessToken;
  if (!apiKey) {
    options.log?.debug?.("ALITP_MODELS", "No Token Plan API key; skipping live fetch");
    return null;
  }

  const key = cacheKey(apiKey);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached?.expiresAt > now) return { models: cached.models };
  }

  try {
    const models = await fetchTokenPlanCatalog(apiKey, options.signal);
    if (!models?.length) return null;
    catalogCache.set(key, { expiresAt: now + CACHE_TTL_MS, models });
    return { models };
  } catch (error) {
    options.log?.warn?.("ALITP_MODELS", `Live model fetch failed: ${error?.message || error}`);
    return null;
  }
}

export function clearAlibabaTokenPlanModelCache() {
  catalogCache.clear();
}
