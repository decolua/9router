import { randomUUID } from "node:crypto";
import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { COLORS } from "../../utils/stream.js";
import { canonicalizeUsage } from "../../utils/usageTracking.js";

const OPTIONAL_PARAMS = [
  "temperature", "top_p", "top_k",
  "max_tokens", "max_completion_tokens",
  "thinking", "reasoning", "enable_thinking",
  "presence_penalty", "frequency_penalty",
  "seed", "stop", "tools", "tool_choice",
  "response_format", "prediction", "store", "metadata",
  "n", "logprobs", "top_logprobs", "logit_bias",
  "user", "parallel_tool_calls"
];

export function extractRequestConfig(body, stream) {
  const config = { messages: body.messages || [], model: body.model, stream };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = body[param];
  }
  return config;
}

export function extractUsageFromResponse(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return null;

  // Claude format
  // Note: OpenAI Responses usage ({input_tokens, input_tokens_details:{cached_tokens}})
  // also matches this branch. Its prompt is cache-INCLUSIVE and its cache rides in
  // input_tokens_details, so emit it as cached_tokens — the convention
  // canonicalizeUsage() passes through without folding. Reading it here keeps
  // cache accounting correct for /v1/responses and codex traffic.
  if (responseBody.usage?.input_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      cached_tokens: responseBody.usage.cached_tokens ?? responseBody.usage.input_tokens_details?.cached_tokens,
      cache_read_input_tokens: responseBody.usage.cache_read_input_tokens,
      cache_creation_input_tokens: responseBody.usage.cache_creation_input_tokens
    };
  }

  // OpenAI format
  if (responseBody.usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.prompt_tokens || 0,
      completion_tokens: responseBody.usage.completion_tokens || 0,
      cached_tokens: responseBody.usage.cached_tokens ?? responseBody.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: responseBody.usage.completion_tokens_details?.reasoning_tokens
    };
  }

  // Gemini format. Antigravity / gemini-cli wrap the payload in { response: {...} }.
  const usageMetadata = responseBody.usageMetadata || responseBody.response?.usageMetadata;
  if (usageMetadata) {
    return {
      prompt_tokens: usageMetadata.promptTokenCount || 0,
      completion_tokens: usageMetadata.candidatesTokenCount || 0,
      cached_tokens: usageMetadata.cachedContentTokenCount || 0,
      reasoning_tokens: usageMetadata.thoughtsTokenCount || 0
    };
  }

  return null;
}

export function buildRequestDetail(base, overrides = {}) {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    pxpipe: base.pxpipe || undefined,
    status: base.status || "success",
    ...overrides
  };
}

// Build the "done" summary: duration, ttft, in/out tokens with cache breakdown
export function formatDoneLine({ usage, latency }) {
  const u = usage || {};
  const inTok = u.prompt_tokens ?? u.input_tokens ?? 0;
  const outTok = u.completion_tokens ?? u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? u.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheCreate = u.cache_creation_input_tokens ?? 0;
  let inStr = `IN ${inTok}`;
  if (cacheRead || cacheCreate) {
    const parts = [];
    if (cacheRead) parts.push(`↻${cacheRead}`);
    if (cacheCreate) parts.push(`+${cacheCreate}`);
    inStr += ` (CACHE ${parts.join(" ")})`;
  }
  const ttftStr = latency?.ttft ? ` · TTFT ${latency.ttft}ms` : "";
  return `DONE ${latency?.total ?? 0}ms${ttftStr} · ${inStr} · OUT ${outTok}`;
}

// ── Combo attribution registry (D13/CB2) ───────────────────────────────────
// The three writers (streaming / non-streaming / sse-to-json) all receive the
// per-attempt `usageEventId` chatCore minted, but none of them knows the combo
// the member belongs to. Rather than widen three signatures, chatCore attaches
// the combo identity to the event id it generated and the writer picks it up
// when that exact event is persisted. Entries are consumed on write; the sweep
// only exists so an event that never produces a row (aborted stream, 0-token
// response) cannot grow the map forever.
const _usageEventMeta = new Map();
const EVENT_META_TTL_MS = 10 * 60 * 1000;
const EVENT_META_MAX = 5000;

export function attachUsageEventMeta(usageEventId, meta) {
  if (!usageEventId || typeof usageEventId !== "string" || !meta || typeof meta !== "object") return;
  try {
    const now = Date.now();
    // `>=` and not `>`: the sweep runs BEFORE the insert, so the map size never
    // exceeds the cap even momentarily (a `>` test allowed cap+1).
    if (_usageEventMeta.size >= EVENT_META_MAX) {
      for (const [id, entry] of _usageEventMeta) {
        if (now - entry.at > EVENT_META_TTL_MS) _usageEventMeta.delete(id);
      }
      while (_usageEventMeta.size >= EVENT_META_MAX) _usageEventMeta.delete(_usageEventMeta.keys().next().value);
    }
    _usageEventMeta.set(usageEventId, { meta, at: now });
  } catch { /* attribution is never worth a failed request */ }
}

/** Diagnostic accessor: how many combo attributions are currently parked.
 *  Exported so the memory bound (D13/CB2 review) can be asserted, not assumed. */
export function usageEventMetaDepth() {
  return _usageEventMeta.size;
}

/** Cap the registry is written against — kept next to the accessor on purpose. */
export const USAGE_EVENT_META_MAX = EVENT_META_MAX;

function consumeUsageEventMeta(usageEventId) {
  if (!usageEventId) return null;
  const entry = _usageEventMeta.get(usageEventId);
  if (!entry) return null;
  _usageEventMeta.delete(usageEventId);
  if (Date.now() - entry.at > EVENT_META_TTL_MS) return null;
  return entry.meta;
}

/**
 * Explicit failure line for one combo member attempt (D13 / CB2).
 *
 * A member that answered with an error never reaches `saveUsageStats`: there
 * are no tokens, so the normal path early-returns by design. Combo success
 * rates still need that attempt, so this is a SEPARATE, deliberate write — the
 * normal path is not loosened. Zero tokens, its own `usageEventId` (never the
 * winner's), and the combo identity in `meta`.
 *
 * Fail-open like every other usage writer: a throw here must not change the
 * response the client sees nor stop the combo from falling through.
 */
export function saveComboAttemptFailure({ comboName, member, provider, model, attempt, status, error, connectionId, apiKey, endpoint } = {}) {
  try {
    if (!comboName || !member) return;
    saveUsageStats({
      provider: provider || "unknown",
      model: model || "unknown",
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      connectionId,
      apiKey,
      endpoint,
      label: "COMBO USAGE",
      silent: true,
      allowZeroUsage: true,
      statusOverride: failureStatusOf(status, error),
      metaExtra: { combo: comboName, member, attempt, endpoint: endpoint || null },
    });
  } catch (err) {
    // Reporting gap, never a client-visible error — but leave one warn (message only, no stack).
    console.warn(`[combo] combo failure-event write swallowed combo=${comboName || "?"} member=${member || "?"} err=${String(err?.message || err)}`);
  }
}

/** `error:<httpStatus>` for an answered attempt, `error:<code>`/`error:threw` for a throw. */
export function failureStatusOf(status, error) {
  const toCode = (v) => (v === null || v === undefined || v === "" ? null
    : (Number.isFinite(Number(v)) ? Number(v) : null));
  const code = toCode(status) ?? toCode(error?.statusCode) ?? toCode(error?.status);
  if (code !== null) return `error:${code}`;
  const text = `${error?.name || ""} ${error?.message || ""}`.toLowerCase();
  if (text.includes("timeout") || text.includes("abort") || text.includes("etimedout")
    || text.includes("timed out") || text.includes("deadpool") || text.includes("socket hang up")) {
    return "error:timeout";
  }
  return "error:threw";
}

export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, label = "USAGE", silent = false, usageEventId, allowZeroUsage = false, statusOverride = null, metaExtra = null }) {
  const hasTokens = tokens && typeof tokens === "object";
  // An explicit failure event has no tokens by definition; every other caller
  // keeps the historical "no billable tokens → no row" gate.
  if (!hasTokens && !allowZeroUsage) return;

  const inTokens = hasTokens ? (tokens.input_tokens ?? tokens.prompt_tokens ?? 0) : 0;
  const outTokens = hasTokens ? (tokens.output_tokens ?? tokens.completion_tokens ?? 0) : 0;

  if (!allowZeroUsage && inTokens === 0 && outTokens === 0) return;

  if (!silent) {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
    console.log(`${COLORS.green}[${time}] 📊 [${label}] ${(provider || "unknown").toUpperCase()} | in=${inTokens} | out=${outTokens}${accountSuffix}${COLORS.reset}`);
  }

  // Canonicalize to one storage convention (prompt_tokens cache-inclusive) so
  // cached/cache-creation tokens survive to cost calc + stats. See canonicalizeUsage.
  // A failure event carries no upstream usage at all: it stays at zero tokens,
  // which is exactly why the aggregation guards skip it.
  const normalized = (hasTokens && canonicalizeUsage(tokens)) || {
    prompt_tokens: hasTokens ? (tokens.prompt_tokens ?? tokens.input_tokens ?? 0) : 0,
    completion_tokens: hasTokens ? (tokens.completion_tokens ?? tokens.output_tokens ?? 0) : 0
  };

  const eventId = usageEventId || randomUUID();
  // Attribution attached for THIS event (combo identity of a winning member),
  // or passed inline by an explicit failure write. Never invented here.
  const attached = consumeUsageEventMeta(eventId);
  const meta = metaExtra || attached || null;

  saveRequestUsage({
    usageEventId: eventId,
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null,
    ...(statusOverride ? { status: statusOverride } : {}),
    ...(meta ? { meta } : {}),
  }).catch((err) => console.warn(`[usage] usage row write failed provider=${provider} model=${model} err=${String(err?.message || err)}`));
}
