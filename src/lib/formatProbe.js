/**
 * formatProbe.js — Detect whether an OpenAI-compatible upstream endpoint supports
 * the Chat Completions and/or Responses wire formats.
 *
 * Used by the provider detail "Test" flow and optionally by credential validation
 * when the formatProbeEnabled setting is on. Results are stored per-connection in
 * providerSpecificData.formatCapabilities so chatCore can route natively (skip
 * translation) when the upstream actually speaks Responses.
 *
 * Errors never throw to the caller — each probe returns its own success boolean,
 * and timeouts/network failures are treated as "not supported" (fail-safe toward
 * Chat translation, which 9router already handles).
 */

const PROBE_TIMEOUT_MS = 8000;

/**
 * Probe a single wire-format endpoint.
 * Returns `true` if the endpoint accepted the request shape (any 2xx/4xx other
 * than a definitive "wrong parameter" rejection), `false` otherwise.
 *
 * For Responses we treat `400` with `unknown parameter: input` (or references to
 * `messages`/`max_tokens`) as "Responses not supported" — the classic shape-mismatch
 * signal from a Chat-only OpenAI-compatible server.
 *
 * @param {string} url          - Full endpoint URL (e.g. https://host/v1/responses)
 * @param {object} headers      - Request headers incl. auth
 * @param {object} payload      - Body to send
 * @returns {Promise<boolean>}
 */
async function probeEndpoint(url, headers, payload) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Auth errors are ambiguous for capability — but if auth is rejected entirely
    // the whole validate would have failed already; treat 401/403 as "not probed".
    if (res.status === 401 || res.status === 403) return false;
    if (res.status >= 500) return false; // upstream error, not a format signal
    if (res.status === 404) return false; // endpoint missing

    // For Responses-shape: a 400 mentioning Chat-only fields means the upstream
    // does not understand the Responses request format.
    if (res.status === 400) {
      try {
        const text = await res.text();
        if (
          /unknown parameter\s*[:'"]?\s*(input|instructions)/i.test(text) ||
          /expected\s+.*(messages|max_tokens)/i.test(text)
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false; // timeout / network — fail toward Chat translation
  }
}

/**
 * Probe a connection's base URL for Chat + Responses support.
 *
 * @param {object} opts
 * @param {string}   opts.provider               - Provider id
 * @param {string}   opts.apiKey                 - Credential token (optional for noAuth)
 * @param {object}   [opts.providerSpecificData] - Connection data (may carry baseUrl for compatible nodes)
 * @param {string}   [opts.model]                - Model id to use in probe bodies
 * @param {string}   [opts.baseUrl]              - Direct base URL override (chat endpoint)
 * @param {object}   [opts.authHeaders]          - Prebuilt auth headers
 * @returns {Promise<{chat: boolean, responses: boolean, probed: boolean}>}
 *          `probed:false` means the probe was skipped (unknown base URL).
 */
export async function probeFormatCapabilities({ provider, apiKey, providerSpecificData = {}, model = "", baseUrl = "", authHeaders = {} }) {
  // Determine the Chat base URL. Allow direct override or compatible-node base.
  let chatBase = baseUrl;
  const compat = providerSpecificData?.baseUrl || providerSpecificData?.apiBaseUrl;
  if (!chatBase && compat) chatBase = compat;
  if (!chatBase) {
    return { chat: false, responses: false, probed: false };
  }
  chatBase = String(chatBase).replace(/\/$/, "");
  if (!/https?:\/\//i.test(chatBase)) {
    return { chat: false, responses: false, probed: false };
  }

  // Normalize to the full chat-completions endpoint if a bare host/base was given.
  const chatUrl = /\/chat\/completions$|\/messages$|\/chat$/.test(chatBase)
    ? chatBase
    : `${chatBase}/v1/chat/completions`;

  // Derive the responses endpoint from the same base.
  const responsesUrl = `${chatBase}/v1/responses`;

  const headers = { ...authHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const testModel = model || "gpt-4o";

  const [chat, responses] = await Promise.all([
    probeEndpoint(chatUrl, headers, {
      model: testModel,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    }),
    probeEndpoint(responsesUrl, headers, {
      model: testModel,
      input: "ping",
      max_output_tokens: 1,
      stream: false,
    }),
  ]);

  return { chat, responses, probed: true };
}
