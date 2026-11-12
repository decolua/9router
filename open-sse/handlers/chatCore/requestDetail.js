import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { COLORS } from "../../utils/stream.js";
import { canonicalizeUsage, estimateUsage } from "../../utils/usageTracking.js";

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

  // Ollama format: prompt_eval_count/eval_count at top level (not nested under usage).
  // prompt_eval_cached_count is a cache-read subset of prompt_eval_count (cache-INCLUSIVE).
  // Guarded exactly like the streaming extractor (extractUsage() in
  // utils/usageTracking.js): done === true AND a NUMERIC prompt_eval_count —
  // a string count ("11") must fall through to null, not be summed
  // (DF-9ROUTER-26). eval_count may be absent on /api/generate-style bodies.
  if (responseBody.done === true && typeof responseBody.prompt_eval_count === "number") {
    const prompt = responseBody.prompt_eval_count;
    const completion = typeof responseBody.eval_count === "number" ? responseBody.eval_count : 0;
    const cached = responseBody.prompt_eval_cached_count || 0;
    return {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      cached_tokens: cached
    };
  }

  return null;
}

/**
 * Character count of the assistant text carried by an upstream body — the input
 * the token estimator needs for the "upstream stayed silent" case. Covers the
 * same provider shapes `extractUsageFromResponse()` knows: Ollama native
 * (`message.content` for /api/chat, `response` for /api/generate), OpenAI chat
 * (`choices[].message.content`), Claude (`content[].text`) and Gemini
 * (`candidates[].content.parts[].text`, including the `{response:{…}}` wrapper).
 *
 * Deliberately approximate: the value only feeds `estimateUsage()`, and anything
 * derived from it is stored marked `estimated: true`.
 */
export function responseContentLength(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return 0;
  const text = (v) => (typeof v === "string" ? v.length : 0);

  let total = 0;
  total += text(responseBody.message?.content);
  total += text(responseBody.response);
  total += text(responseBody.choices?.[0]?.message?.content);
  for (const block of Array.isArray(responseBody.content) ? responseBody.content : []) {
    if (block?.type === "text") total += text(block.text);
  }
  const candidates = responseBody.candidates || responseBody.response?.candidates;
  for (const part of candidates?.[0]?.content?.parts || []) {
    total += text(part?.text);
  }
  return total;
}

/**
 * The usage a completion should be RECORDED with:
 *   - the upstream's own counts when it reported any (always preferred),
 *   - an ESTIMATE when the upstream stayed silent but the completion produced
 *     content (`estimateUsage()` marks it `estimated: true` so nothing reads it
 *     as provider-reported),
 *   - null when there is neither — an empty response must never invent traffic.
 *
 * One implementation of that decision, shared by the caller that logs it and the
 * one that stores it, so the "📊 DONE" line and the DB row can never disagree.
 */
export function resolveUsage({ tokens, body, contentLength }) {
  const inTokens = tokens?.input_tokens ?? tokens?.prompt_tokens ?? 0;
  const outTokens = tokens?.output_tokens ?? tokens?.completion_tokens ?? 0;
  if (inTokens !== 0 || outTokens !== 0) return tokens;
  if (!(contentLength > 0) || !body) return tokens || null;
  return estimateUsage(body, contentLength);
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
  // An upstream that reported no counts leaves us with an estimate: say so, so a
  // reader never takes a guessed number for a provider-reported one.
  const estStr = u.estimated ? " · (estimated)" : "";
  return `DONE ${latency?.total ?? 0}ms${ttftStr} · ${inStr} · OUT ${outTok}${estStr}`;
}

export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, label = "USAGE", silent = false, body = null, contentLength = 0 }) {
  // An upstream that reports no token counts (native Ollama, some
  // OpenAI-compatible shims) costs us the whole record if we stop at "no
  // tokens": fall back to an estimate when the completion produced content.
  // resolveUsage() is a no-op for the empty-response case, so the guards below
  // still drop a request that produced neither counts nor content.
  const effective = (body && contentLength > 0) ? resolveUsage({ tokens, body, contentLength }) : tokens;

  if (!effective || typeof effective !== "object") return;

  const inTokens = effective.input_tokens ?? effective.prompt_tokens ?? 0;
  const outTokens = effective.output_tokens ?? effective.completion_tokens ?? 0;

  // A successful request whose tokens resolve to 0/0 is DROPPED by the DB layer's
  // own guard, so the row silently never lands and usageHistory / usage stats stay
  // empty for real served traffic (DF-9ROUTER-33). Never let that be silent: name
  // the provider and model so the accounting hole is visible in the server log.
  if (inTokens === 0 && outTokens === 0) {
    console.warn(`[USAGE] dropped all-zero usage record · ${provider || "unknown"}/${model || "unknown"}${connectionId ? ` | account=${connectionId.slice(0, 8)}...` : ""}${body ? ` | contentLength=${contentLength}` : ""}`);
    return;
  }

  if (!silent) {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
    const estSuffix = effective.estimated ? " (estimated)" : "";
    console.log(`${COLORS.green}[${time}] 📊 [${label}] ${provider.toUpperCase()} | in=${inTokens} | out=${outTokens}${estSuffix}${accountSuffix}${COLORS.reset}`);
  }

  // Canonicalize to one storage convention (prompt_tokens cache-inclusive) so
  // cached/cache-creation tokens survive to cost calc + stats. See canonicalizeUsage.
  const normalized = canonicalizeUsage(effective) || {
    prompt_tokens: effective.prompt_tokens ?? effective.input_tokens ?? 0,
    completion_tokens: effective.completion_tokens ?? effective.output_tokens ?? 0
  };

  // canonicalizeUsage re-shapes into the storage convention and drops the flag;
  // an estimated record must stay labelled as one in the DB (tokens.estimated),
  // and the row's meta must carry the EXPLICIT verdict either way —
  // `estimated: false` for upstream-reported counts — so a reader of the
  // usageHistory row can separate measured from estimated without inferring it
  // from the numbers (DF-9ROUTER-39: non-stream rows presented a local
  // estimate as if it were upstream truth).
  normalized.estimated = Boolean(effective.estimated);

  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    meta: { estimated: Boolean(effective.estimated) },
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null
  }).catch(() => {});
}
