import { getExecutor } from "../executors/index.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// PROVIDERS[id] IS the transport object (built by buildTransport), so cfg.baseUrl
// and cfg.format are top-level. Claude-compatible providers serve /messages; the
// count_tokens endpoint is the sibling /messages/count_tokens. Returns null when
// the provider isn't Claude-compatible (no /messages baseUrl).
export function deriveCountTokensUrl(cfg) {
  const rec = isRecord(cfg) ? cfg : undefined;
  const base = typeof rec?.baseUrl === "string" ? rec.baseUrl : undefined;
  const fmt = rec?.format;
  if (base && (fmt === "claude" || /\/messages$/.test(base))) {
    return /\/messages$/.test(base) ? `${base}/count_tokens` : `${base}/messages/count_tokens`;
  }
  return null;
}

// Heuristic estimate (~4 chars/token) — the fallback when no native endpoint.
export function estimateTokens(body) {
  const b = isRecord(body) ? body : {};
  const messages = Array.isArray(b.messages) ? b.messages : [];
  let totalChars = 0;
  if (typeof b.system === "string") totalChars += b.system.length;
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (isRecord(part) && part.type === "text" && part.text) totalChars += part.text.length;
      }
    }
  }
  return Math.max(1, Math.ceil(totalChars / 4));
}

/**
 * Core count_tokens handler. Calls the provider's native /messages/count_tokens
 * when the upstream is Claude-compatible; otherwise falls back to the heuristic
 * estimate, flagged approximate:true.
 *
 * @param {object} options
 * @param {object} options.body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} [options.credentials]
 * @param {object} [options.log]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleCountTokensCore({
  body,
  modelInfo,
  credentials = null,
  log = null,
}) {
  const { provider, model } = modelInfo;
  const cfg = PROVIDERS[provider];
  const url = deriveCountTokensUrl(cfg);

  // No native endpoint → heuristic estimate.
  if (!url) {
    return {
      success: true,
      status: 200,
      response: Response.json({ input_tokens: estimateTokens(body), approximate: true }),
    };
  }

  const executor = getExecutor(provider);
  const headers = executor.buildHeaders(credentials || {}, false);
  log?.debug?.("COUNT-TOKENS", `${provider} | ${model} | ${url}`);

  try {
    const res = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model }),
    });
    if (res.ok) {
      const json = await res.json();
      return {
        success: true,
        status: 200,
        response: Response.json({ input_tokens: Number(json.input_tokens) || estimateTokens(body) }),
      };
    }
    log?.debug?.("COUNT-TOKENS", `native failed (${res.status}), falling back to estimate`);
  } catch (err) {
    log?.debug?.("COUNT-TOKENS", `native threw: ${err?.message}, falling back to estimate`);
  }

  return {
    success: true,
    status: 200,
    response: Response.json({ input_tokens: estimateTokens(body), approximate: true }),
  };
}
