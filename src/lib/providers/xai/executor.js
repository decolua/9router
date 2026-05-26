/**
 * xAI (Grok) Inference Executor
 *
 * Source of truth: router-for-me/CLIProxyAPI internal/runtime/executor/xai_executor.go
 *
 * xAI's Responses endpoint is always-SSE: regardless of the inbound `stream`
 * flag, xAI streams back `response.*` events. For non-stream callers we collect
 * events and synthesize a `response.completed` payload by aggregating the
 * `response.output_item.done` events plus final usage/metadata.
 */

import { XAI_CONFIG, XAI_API_BASE } from "../../oauth/constants/xai.js";
import { XaiService } from "../../oauth/services/xai.js";

const XAI_RESPONSES_URL = `${XAI_API_BASE}/responses`;

/**
 * Build the request headers for an xAI inference call.
 *
 * @param {object} ctx
 * @param {string} ctx.token  Bearer secret (OAuth access_token OR API key)
 * @param {string} [ctx.idempotencyKey] Forward incoming Idempotency-Key
 */
export function buildXaiHeaders({ token, idempotencyKey } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

/**
 * Parse a single SSE chunk string into discrete events.
 * Returns an array of { event, data } where data is the raw JSON string
 * (caller decides whether to JSON.parse based on event type).
 *
 * SSE framing rules per https://html.spec.whatwg.org/#server-sent-events:
 *   - Events are separated by a blank line (\n\n)
 *   - Lines starting with "event:" set the event name (default "message")
 *   - Lines starting with "data:" are concatenated with newlines
 *   - Other fields (id, retry, comments) are ignored here
 */
export function parseSseBlock(block) {
  const events = [];
  if (!block) return events;
  const frames = block.split(/\r?\n\r?\n/);
  for (const frame of frames) {
    if (!frame.trim()) continue;
    let eventName = "message";
    const dataLines = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith(":")) continue; // SSE comment
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) continue;
    events.push({ event: eventName, data: dataLines.join("\n") });
  }
  return events;
}

/**
 * Async generator that decodes a fetch Response body into SSE events.
 *
 * Buffers across chunks because SSE frames can split mid-buffer.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @yields { event: string, data: string }
 */
export async function* iterateSseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Split off complete frames (terminated by \n\n)
      let idx;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const frame = buffer.slice(0, idx);
        // Advance past the matched delimiter
        const sep = buffer.slice(idx).match(/\r?\n\r?\n/)[0];
        buffer = buffer.slice(idx + sep.length);
        for (const ev of parseSseBlock(frame)) yield ev;
      }
    }
    // Flush any trailing event (no terminating blank line)
    if (buffer.trim()) {
      for (const ev of parseSseBlock(buffer)) yield ev;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
}

/**
 * Collect an xAI SSE stream into a synthesized `response.completed` payload.
 *
 * Tracks each `response.output_item.done` (final state of one output item)
 * and any `response.completed` event from upstream. If upstream emits a
 * native `response.completed`, we use it verbatim. Otherwise we synthesize:
 *   {
 *     id, object: "response", status: "completed",
 *     output: [...output_items in arrival order],
 *     usage: <last seen usage>, model, created_at,
 *     ...metadata last seen in response.created
 *   }
 *
 * @param {ReadableStream<Uint8Array>} body
 * @returns {Promise<object>}
 */
export async function collectSseToCompleted(body) {
  let nativeCompleted = null;
  let header = null;          // from response.created / response.in_progress
  const outputItems = [];     // in arrival order
  let usage = null;
  let lastError = null;

  for await (const ev of iterateSseEvents(body)) {
    if (!ev.data || ev.data === "[DONE]") continue;
    let payload;
    try {
      payload = JSON.parse(ev.data);
    } catch {
      continue;
    }

    switch (ev.event) {
      case "response.created":
      case "response.in_progress":
        if (payload?.response) header = payload.response;
        break;
      case "response.output_item.done":
        if (payload?.item) outputItems.push(payload.item);
        break;
      case "response.completed":
        nativeCompleted = payload?.response || payload;
        if (payload?.response?.usage) usage = payload.response.usage;
        break;
      case "response.usage":
        if (payload?.usage) usage = payload.usage;
        break;
      case "response.error":
      case "error":
        lastError = payload?.error || payload;
        break;
      default:
        // ignore unknown events
        break;
    }
  }

  if (lastError) {
    const err = new Error(lastError.message || "xAI stream error");
    err.code = lastError.code || lastError.type;
    err.status = lastError.status || 502;
    err.details = lastError;
    throw err;
  }

  if (nativeCompleted) {
    if (!nativeCompleted.output && outputItems.length) {
      nativeCompleted.output = outputItems;
    }
    if (!nativeCompleted.usage && usage) nativeCompleted.usage = usage;
    return nativeCompleted;
  }

  // Synthesize
  const synthesized = {
    id: header?.id || null,
    object: "response",
    created_at: header?.created_at || Math.floor(Date.now() / 1000),
    status: "completed",
    model: header?.model || null,
    output: outputItems,
    usage: usage || null,
  };
  if (header?.metadata) synthesized.metadata = header.metadata;
  if (header?.previous_response_id) synthesized.previous_response_id = header.previous_response_id;
  if (header?.reasoning) synthesized.reasoning = header.reasoning;
  return synthesized;
}

/**
 * Resolve the Bearer token for an xAI account record.
 * Mirrors CLIProxyAPI: OAuth uses access_token, API key uses the literal key
 * — both are sent as `Authorization: Bearer <secret>`.
 *
 * @param {object} account  { authType, accessToken, refreshToken, apiKey, ... }
 * @returns {string}
 */
export function resolveXaiBearer(account) {
  if (!account) throw new Error("xAI account not provided");
  if (account.authType === "apikey" || account.apiKey) {
    return account.apiKey;
  }
  if (account.accessToken) return account.accessToken;
  throw new Error("xAI account has no usable credential");
}

/**
 * Perform a refresh-and-retry on a single 401 from xAI.
 *
 * Returns { account, refreshed } — the (possibly updated) account record
 * plus a flag indicating whether a refresh actually happened. Callers should
 * persist the new tokens via their connection store.
 *
 * @param {object} account
 * @param {object} [opts]
 * @param {(updated: object) => Promise<void>} [opts.persist]  Optional persistence hook
 */
export async function refreshXaiAccount(account, opts = {}) {
  if (account?.authType === "apikey" || !account?.refreshToken) {
    return { account, refreshed: false };
  }
  const svc = new XaiService();
  const tokenEndpoint = account.providerSpecificData?.tokenEndpoint;
  const tokens = await svc.refreshAccessToken(account.refreshToken, tokenEndpoint);
  const providerSpecificData = {
    ...(account.providerSpecificData || {}),
    authKind: "oauth",
    baseUrl: XAI_CONFIG.apiBaseUrl,
    lastRefresh: new Date().toISOString(),
  };
  if (tokenEndpoint) providerSpecificData.tokenEndpoint = tokenEndpoint;
  if (tokens.id_token) providerSpecificData.idToken = tokens.id_token;
  const updated = {
    ...account,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || account.refreshToken,
    providerSpecificData,
    expiresIn: tokens.expires_in,
    expiresAt: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : account.expiresAt,
  };
  if (typeof opts.persist === "function") {
    try { await opts.persist(updated); } catch { /* swallow — caller can retry */ }
  }
  return { account: updated, refreshed: true };
}

/**
 * Internal: POST a body to /responses, with single 401→refresh→retry.
 *
 * Returns the raw fetch Response (caller chooses to stream-pipe or collect).
 */
async function postResponses({ body, account, signal, idempotencyKey, persist }) {
  let active = account;
  let bearer = resolveXaiBearer(active);
  let res = await fetch(XAI_RESPONSES_URL, {
    method: "POST",
    headers: buildXaiHeaders({ token: bearer, idempotencyKey }),
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401 && active?.authType !== "apikey") {
    try {
      const { account: refreshed, refreshed: didRefresh } = await refreshXaiAccount(active, { persist });
      if (didRefresh) {
        active = refreshed;
        bearer = resolveXaiBearer(active);
        // Drain prior response body to free socket
        try { await res.body?.cancel?.(); } catch { /* noop */ }
        res = await fetch(XAI_RESPONSES_URL, {
          method: "POST",
          headers: buildXaiHeaders({ token: bearer, idempotencyKey }),
          body: JSON.stringify(body),
          signal,
        });
      }
    } catch (err) {
      // refresh failed — surface upstream 401 as needs_reauth
      const e = new Error("xAI refresh failed: " + (err?.message || String(err)));
      e.status = 401;
      e.code = "needs_reauth";
      throw e;
    }
  }

  return { res, account: active };
}

export const __XAI_TEST__ = {
  XAI_RESPONSES_URL,
  postResponses,
};

/**
 * Execute an xAI Responses request.
 *
 * @param {object} opts
 * @param {object} opts.request   xAI Responses-shaped JSON body
 * @param {object} opts.account   account record (OAuth or API key)
 * @param {boolean} [opts.stream] whether the caller wants SSE pass-through
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.idempotencyKey]
 * @param {(updated: object) => Promise<void>} [opts.persist]
 * @returns {Promise<{ stream?: ReadableStream<Uint8Array>, completed?: object, account: object, status: number }>}
 */
export async function executeResponses(opts) {
  const { request, account, stream = false, signal, idempotencyKey, persist } = opts;
  const { res, account: active } = await postResponses({
    body: request, account, signal, idempotencyKey, persist,
  });

  if (!res.ok && res.status !== 200) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`xAI /responses failed: ${res.status} ${errBody.slice(0, 500)}`);
    err.status = res.status;
    err.body = errBody;
    if (res.status === 401) err.code = "needs_reauth";
    throw err;
  }

  if (stream) {
    return { stream: res.body, account: active, status: res.status };
  }
  const completed = await collectSseToCompleted(res.body);
  return { completed, account: active, status: res.status };
}
