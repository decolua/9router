// Gemini 4 long decode over REST — generateContent / streamGenerateContent on the Gemini
// API and the Cloud Code envelope Antigravity uses. One request ("hop") returns at most
// 64K tokens; when the model still has max_output_tokens budget, the candidate ends with
// finishReason "CONTINUATION" plus a continuationToken, and the caller must re-send the
// identical request carrying that token until any other finish reason. Google's SDKs run
// this loop for their callers (automatic_continuation); a REST gateway has to run it.
// https://aistudio.google.com/docs/long-decode?generate-content=true
//
// Rules applied here (from the doc): same request every hop, never append partial output
// to contents, send only the latest token, join all hops' parts into one model turn, and
// report usage as the sum of every hop (what the SDK reports).

import { getCapabilitiesForModel } from "../providers/capabilities.js";

export const GEMINI_HOP_OUTPUT_TOKENS = 65536;
export const GEMINI_LONG_DECODE_MAX_OUTPUT = 1048576;
export const GEMINI_FINISH_CONTINUATION = "CONTINUATION";
const GEMINI_FINISH_MAX_TOKENS = "MAX_TOKENS";
// 1M / 64K = 16 hops; the cap only guards against a runaway upstream.
const MAX_HOPS = 20;

export function supportsGeminiLongDecode(provider, model) {
  return getCapabilitiesForModel(provider, model)?.longDecode === true;
}

// Long decode only runs when the caller asked for more than a single hop can return.
export function wantsGeminiLongDecode(provider, model, generationConfig) {
  return Number(generationConfig?.maxOutputTokens) > GEMINI_HOP_OUTPUT_TOKENS
    && supportsGeminiLongDecode(provider, model);
}

// Antigravity wraps the Gemini response as { response: {...} }; the Gemini API does not.
function unwrap(obj) {
  if (obj && typeof obj === "object" && !obj.candidates && obj.response && typeof obj.response === "object") {
    return obj.response;
  }
  return obj;
}

function readContinuation(resp) {
  const cand = resp?.candidates?.[0];
  const isContinuation = cand?.finishReason === GEMINI_FINISH_CONTINUATION;
  const token = isContinuation ? (cand?.continuationToken || resp?.continuationToken || null) : null;
  return { cand, token };
}

// Sum numeric usage fields across hops (SDK semantics); non-numeric fields keep the latest.
export function addGeminiUsage(total, usage) {
  if (!usage || typeof usage !== "object") return total;
  const out = { ...total };
  for (const [key, value] of Object.entries(usage)) {
    out[key] = typeof value === "number" ? (typeof out[key] === "number" ? out[key] : 0) + value : value;
  }
  return out;
}

function rebuiltHeaders(source) {
  const headers = new Headers(source || {});
  // The body is re-serialized (and fetch already decoded it), so these no longer apply.
  headers.delete("content-length");
  headers.delete("content-encoding");
  return headers;
}

async function safeNextHop(nextHop, token, log) {
  try {
    const response = await nextHop(token);
    if (response?.ok) return response;
    const detail = response ? await response.text().catch(() => "") : "";
    log?.warn?.("LONG_DECODE", `continuation hop failed: ${response?.status} ${detail.slice(0, 200)}`);
  } catch (error) {
    log?.warn?.("LONG_DECODE", `continuation hop error: ${error?.message || error}`);
  }
  return null;
}

/**
 * Non-streaming: run every hop and return one combined generateContent response.
 * A failed later hop ends the turn as MAX_TOKENS so clients see a truncated finish.
 */
export async function continueGeminiJson(firstResponse, nextHop, { log } = {}) {
  const init = { status: firstResponse.status, statusText: firstResponse.statusText, headers: rebuiltHeaders(firstResponse.headers) };
  const text = await firstResponse.text();
  let root;
  try { root = JSON.parse(text); } catch { return new Response(text, init); }
  const first = unwrap(root);
  let { cand, token } = readContinuation(first);
  const parts = [...(cand?.content?.parts || [])];
  const role = cand?.content?.role || "model";
  let usage = addGeminiUsage({}, first?.usageMetadata);
  let last = first;
  let hops = 1;

  while (token && hops < MAX_HOPS) {
    const response = await safeNextHop(nextHop, token, log);
    if (!response) break;
    let next;
    try { next = unwrap(await response.json()); } catch (error) {
      log?.warn?.("LONG_DECODE", `continuation hop returned invalid JSON: ${error?.message || error}`);
      break;
    }
    hops++;
    ({ cand, token } = readContinuation(next));
    parts.push(...(cand?.content?.parts || []));
    usage = addGeminiUsage(usage, next?.usageMetadata);
    last = next;
  }
  if (hops > 1) log?.info?.("LONG_DECODE", `joined ${hops} hops`);

  const lastCand = last?.candidates?.[0] || {};
  const finalCand = { ...lastCand, content: { ...(lastCand.content || {}), role, parts } };
  if (finalCand.finishReason === GEMINI_FINISH_CONTINUATION) finalCand.finishReason = GEMINI_FINISH_MAX_TOKENS;
  const merged = { ...last, candidates: [finalCand, ...(last?.candidates?.slice(1) || [])] };
  if (Object.keys(usage).length) merged.usageMetadata = usage;
  const body = root === first ? merged : { ...root, response: merged };
  return new Response(JSON.stringify(body), init);
}

/**
 * Streaming: pipe each hop's SSE events through, hide the intermediate CONTINUATION
 * finish (so translators keep the turn open), start the next hop when one ends, and
 * offset each hop's cumulative usageMetadata by the totals of the hops before it.
 * Mid-hop checkpoint tokens are dropped: their chunks are already forwarded to the
 * client, so a gateway cannot rewind to them after a drop.
 */
export function continueGeminiStream(firstResponse, nextHop, { log, signal } = {}) {
  const encoder = new TextEncoder();
  let reader = firstResponse.body.getReader();
  let decoder = new TextDecoder();
  let buffer = "";
  let pendingToken = null;
  let usageBase = {};
  let hopUsage = null;
  let wrapped = false;
  let hops = 1;

  const transformLine = (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data:")) return `${line}\n`;
    let obj;
    try { obj = JSON.parse(line.slice(5).trimStart()); } catch { return `${line}\n`; }
    if (!obj || typeof obj !== "object") return `${line}\n`;
    const resp = unwrap(obj);
    if (resp !== obj) wrapped = true;

    const { cand, token } = readContinuation(resp);
    if (token) {
      pendingToken = token;
      delete cand.finishReason;
    } else if (cand?.finishReason === GEMINI_FINISH_CONTINUATION) {
      cand.finishReason = GEMINI_FINISH_MAX_TOKENS;
    }
    if (cand) delete cand.continuationToken;
    if (resp && typeof resp === "object") delete resp.continuationToken;
    if (resp?.usageMetadata) {
      hopUsage = resp.usageMetadata;
      resp.usageMetadata = addGeminiUsage(usageBase, resp.usageMetadata);
    }
    return `data: ${JSON.stringify(obj)}\n`;
  };

  // A turn that stopped before the model finished (hop failed / cap / aborted) ends as MAX_TOKENS.
  const truncatedFinish = () => {
    const resp = { candidates: [{ finishReason: GEMINI_FINISH_MAX_TOKENS, index: 0 }] };
    const usage = addGeminiUsage(usageBase, hopUsage);
    if (Object.keys(usage).length) resp.usageMetadata = usage;
    return `data: ${JSON.stringify(wrapped ? { response: resp } : resp)}\n\n`;
  };

  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        const { value, done } = await reader.read();
        if (!done) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          if (lines.length) {
            controller.enqueue(encoder.encode(lines.map(transformLine).join("")));
            return;
          }
          continue;
        }

        buffer += decoder.decode();
        if (buffer) {
          controller.enqueue(encoder.encode(transformLine(buffer)));
          buffer = "";
        }
        if (!pendingToken) {
          if (hops > 1) log?.info?.("LONG_DECODE", `streamed ${hops} hops`);
          controller.close();
          return;
        }

        const token = pendingToken;
        pendingToken = null;
        const next = hops < MAX_HOPS && !signal?.aborted ? await safeNextHop(nextHop, token, log) : null;
        if (!next?.body) {
          controller.enqueue(encoder.encode(truncatedFinish()));
          controller.close();
          return;
        }
        usageBase = addGeminiUsage(usageBase, hopUsage);
        hopUsage = null;
        reader = next.body.getReader();
        decoder = new TextDecoder();
        hops++;
      }
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {});
    },
  });
}

/**
 * Executor hook: given a successful hop-1 result, return a result whose response runs
 * the remaining hops. `nextHop(token)` must re-send the identical request with the token.
 */
export async function withGeminiLongDecode(result, { stream, nextHop, signal, log }) {
  const { response } = result;
  if (stream) {
    const body = continueGeminiStream(response, nextHop, { log, signal });
    return {
      ...result,
      response: new Response(body, { status: response.status, statusText: response.statusText, headers: rebuiltHeaders(response.headers) }),
    };
  }
  return { ...result, response: await continueGeminiJson(response, nextHop, { log }) };
}
