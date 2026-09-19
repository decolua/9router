/**
 * Usage accounting for the NON-chat modalities (images, videos, tts, stt,
 * search, web fetch) — audit T1.8 F4.
 *
 * Chat persists through open-sse/handlers/chatCore/requestDetail.js
 * (`saveUsageStats` → `saveRequestUsage`); embeddings had its own inline call.
 * Every other modality used to write nothing at all, so paid upstream
 * consumption (images, video jobs, speech, transcription, search queries)
 * was invisible to usageDb, /api/usage/* and the dashboard.
 *
 * This module is the shared recorder those handlers call. It reuses the
 * existing persistence API and event shape verbatim — cost is NOT passed
 * because `persistUsageEvent` derives it through
 * getPricingForModel(provider, model) (src/lib/db/repos/usageRepo.js), so any
 * pricing the repo already knows is applied automatically.
 *
 * Token policy:
 *  - real upstream usage wins whenever the response exposes it;
 *  - otherwise the request-side TEXT tokens are estimated at the same ~4
 *    chars/token convention as open-sse/utils/usageTracking.js
 *    estimateInputTokens();
 *  - an event with nothing countable is skipped rather than written as zeros
 *    (same rule saveUsageStats follows for chat).
 *
 * Accounting is FAIL-OPEN: every path here swallows its own errors. A broken
 * recorder must never change or break the response a client receives.
 */
import { randomUUID } from "node:crypto";
import { saveRequestUsage } from "@/lib/usageDb.js";

// Rough average across tokenizers — same constant the chat estimator uses.
const CHARS_PER_TOKEN = 4;
// Above this, the JSON body is not parsed (a 4 MB base64 image payload would
// cost more than the accounting is worth); the usage member is sliced out
// textually instead.
const JSON_PARSE_MAX_CHARS = 1024 * 1024;

/** Estimate TEXT tokens from a string. Non-text input (bytes, null) → 0. */
export function estimateTextTokens(text) {
  if (typeof text !== "string" || !text.length) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Normalize the usage shapes upstreams actually send (OpenAI
 * prompt/completion, OpenAI images/Responses input/output, Claude-style) into
 * the canonical storage pair. Returns null when nothing countable is present.
 */
export function canonicalTokens(usage) {
  if (!usage || typeof usage !== "object") return null;
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens);
  const promptTokens = Number.isFinite(prompt) && prompt > 0 ? prompt : 0;
  const completionTokens = Number.isFinite(completion) && completion > 0 ? completion : 0;
  if (!promptTokens && !completionTokens) return null;
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens };
}

/** Slice the JSON object that starts at `start` (index of its `{`), string-aware. */
function sliceJsonObject(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Read a `usage` member out of a JSON body WITHOUT parsing the whole body
 * (image/audio responses carry MBs of base64 next to it). Used as the
 * large-payload fallback of readUpstreamTokens.
 */
function usageFromJsonText(text) {
  if (!text) return null;
  const keyAt = text.search(/"usage"\s*:\s*\{/);
  if (keyAt < 0) return null;
  const braceAt = text.indexOf("{", keyAt);
  const slice = sliceJsonObject(text, braceAt);
  if (!slice) return null;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/**
 * Clone a still-unread JSON response and pull tokens out of its payload.
 *
 * The clone MUST be taken synchronously (before the caller hands the response
 * on, e.g. when a wrapper rebuilds the Response around `response.body`), so
 * this is called first and only its result is awaited. Non-JSON responses
 * (binary audio/images, SSE streams) are skipped: reading those would tee a
 * live stream for no gain.
 *
 * @param {Response} response
 * @param {(payload: any) => object|null} [fromPayload] extracts canonical tokens
 *        from the parsed body; defaults to the OpenAI `usage` member.
 * @returns {Promise<object|null>} canonical tokens, or null
 */
export function readUpstreamTokens(response, fromPayload = (payload) => canonicalTokens(payload?.usage)) {
  let clone;
  try {
    const contentType = response?.headers?.get?.("content-type") || "";
    if (!response?.clone || !contentType.includes("json")) return Promise.resolve(null);
    clone = response.clone();
  } catch {
    return Promise.resolve(null);
  }
  return clone
    .text()
    .then((text) => {
      const raw = text || "";
      let payload = null;
      if (raw.length <= JSON_PARSE_MAX_CHARS) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = null;
        }
      }
      if (payload && typeof payload === "object") return fromPayload(payload);
      // Body too big (or unparseable) for a full parse: still honour a flat
      // `usage` member, which is where providers put the numbers.
      return canonicalTokens(usageFromJsonText(raw));
    })
    .catch(() => null);
}

/**
 * Persist one modality usage event, fire-and-forget.
 *
 * @param {object} ctx
 * @param {string} ctx.provider     routed provider id (cost lookup key)
 * @param {string} ctx.model        routed model id, or the provider id for
 *                                  capabilities where the provider IS the model
 * @param {string} ctx.endpoint     request pathname, e.g. "/v1/images/generations"
 * @param {string} [ctx.connectionId]
 * @param {string} [ctx.apiKey]     client key, as chat records it
 * @param {{prompt_tokens:number,completion_tokens:number}} [ctx.tokens] request-side estimate
 * @param {Response} [ctx.response] upstream response to peek for real usage
 * @param {(payload: any) => object|null} [ctx.fromPayload] how to read tokens
 *        out of the peeked JSON body (defaults to its `usage` member)
 */
export function recordModalityUsage({ provider, model, endpoint, connectionId, apiKey, tokens, response, fromPayload }) {
  const usageEventId = randomUUID();
  // Started synchronously so the response clone lands before the caller returns.
  const upstream = readUpstreamTokens(response, fromPayload);

  Promise.resolve(upstream)
    .then((realTokens) => {
      const final = realTokens || tokens;
      if (!final || (final.prompt_tokens <= 0 && final.completion_tokens <= 0)) return;
      return saveRequestUsage({
        usageEventId,
        provider: provider || "unknown",
        model: model || "unknown",
        tokens: { prompt_tokens: final.prompt_tokens || 0, completion_tokens: final.completion_tokens || 0 },
        timestamp: new Date().toISOString(),
        connectionId: connectionId || undefined,
        apiKey: apiKey || undefined,
        endpoint: endpoint || null,
        status: "success",
      });
    })
    // A failed write is a reporting gap, never a client-visible error.
    .catch(() => {});
}
