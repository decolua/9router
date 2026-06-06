const DEFAULT_PROXY_URL = "http://localhost:8787";
const PROBE_TTL_MS = 30_000;
const COMPRESS_TIMEOUT_MS = 5_000;

let compressFn = null;
let compressLoaded = false;
const probeCache = { reachable: false, ts: 0 };

async function loadCompress() {
  if (compressLoaded) return compressFn;
  compressLoaded = true;
  try {
    const mod = await import("headroom-ai");
    compressFn = mod.compress ?? mod.default?.compress ?? null;
  } catch {
    compressFn = null;
  }
  return compressFn;
}

async function probeProxy() {
  const now = Date.now();
  if (now - probeCache.ts < PROBE_TTL_MS) return probeCache.reachable;
  const baseUrl = process.env.HEADROOM_BASE_URL || DEFAULT_PROXY_URL;
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    probeCache.reachable = res.ok;
  } catch {
    probeCache.reachable = false;
  }
  probeCache.ts = now;
  return probeCache.reachable;
}

function invalidateProbe() {
  probeCache.ts = 0;
}

// Returns the index of the last message/item carrying a cache_control marker.
function findCacheFloor(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i];
    if (!item) continue;
    if (item.cache_control) return i;
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.cache_control) return i;
      }
    }
  }
  return -1;
}

// Run headroom on a tail of Chat Completions messages[].
async function compressTail(tail, model, compress) {
  const before = JSON.stringify(tail).length;
  const result = await Promise.race([
    compress(tail, { model }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("headroom timeout")), COMPRESS_TIMEOUT_MS)
    ),
  ]);
  if (!result?.messages) return null;
  const after = JSON.stringify(result.messages).length;
  return { compressed: result.messages, before, after, saved: before - after };
}

// Compress body.messages (Chat Completions / Claude format).
async function compressMessagesBody(body, model, compress) {
  const messages = body.messages;
  const cacheFloor = findCacheFloor(messages);
  const head = messages.slice(0, cacheFloor + 1);
  const tail = messages.slice(cacheFloor + 1);
  if (tail.length < 2) return null;

  try {
    const r = await compressTail(tail, model, compress);
    if (!r) return null;
    body.messages = [...head, ...r.compressed];
    return { before: r.before, after: r.after, saved: r.saved };
  } catch {
    invalidateProbe();
    return null;
  }
}

// Compress body.input (OpenAI Responses API format).
// Strategy:
//   1. Find the cache floor in the input array (do not touch items at or before it).
//   2. Extract user/assistant message items from the compressible tail into a
//      temporary messages[] and send them to headroom.
//   3. If headroom removes N messages from the front, slice the input tail so that
//      the first N message items (and everything before the next message after them)
//      are dropped — this keeps interleaved function_call / function_call_output
//      items correctly paired with the messages that follow them.
async function compressInputBody(body, model, compress) {
  const input = body.input;
  const cacheFloor = findCacheFloor(input);

  const headItems = input.slice(0, cacheFloor + 1);
  const tailItems = input.slice(cacheFloor + 1);

  // Build a Chat Completions messages array from the message items in the tail.
  const msgIndices = []; // positions inside tailItems
  const messages = [];
  for (let i = 0; i < tailItems.length; i++) {
    const item = tailItems[i];
    const role = item?.role;
    if (item?.type === "message" && (role === "user" || role === "assistant" || role === "developer")) {
      const text = Array.isArray(item.content)
        ? item.content.map(c => c.text || c.input_text || c.output_text || "").filter(Boolean).join("")
        : (typeof item.content === "string" ? item.content : "");
      if (text) {
        msgIndices.push(i);
        messages.push({ role: role === "developer" ? "system" : role, content: text });
      }
    }
  }

  if (messages.length < 2) return null;

  try {
    const r = await compressTail(messages, model, compress);
    if (!r || r.saved <= 0) return null;

    const removedCount = messages.length - r.compressed.length;
    if (removedCount <= 0) return null;

    // Drop the first `removedCount` message items from tailItems and everything
    // before the next message item that follows the last dropped one.
    const lastDroppedTailIdx = msgIndices[removedCount - 1];
    // Find the next message item after the last dropped one.
    let keepFromTailIdx = tailItems.length; // default: keep nothing (shouldn't happen)
    for (let i = lastDroppedTailIdx + 1; i < tailItems.length; i++) {
      const item = tailItems[i];
      const role = item?.role;
      if (item?.type === "message" && (role === "user" || role === "assistant" || role === "developer")) {
        keepFromTailIdx = i;
        break;
      }
    }

    body.input = [...headItems, ...tailItems.slice(keepFromTailIdx)];
    return { before: r.before, after: r.after, saved: r.saved };
  } catch {
    invalidateProbe();
    return null;
  }
}

/**
 * Compress conversation history via headroom proxy.
 * Handles both Chat Completions (body.messages) and Responses API (body.input) formats.
 * Only content AFTER the last cache_control boundary is sent to headroom —
 * the cached prefix is left byte-identical so KV cache entries are not invalidated.
 * Returns { before, after, saved } on success, null if skipped/unavailable.
 */
export async function compressWithHeadroom(body, model) {
  const hasMessages = Array.isArray(body.messages) && body.messages.length >= 2;
  const hasInput = Array.isArray(body.input) && body.input.length >= 2;
  if (!hasMessages && !hasInput) return null;

  const compress = await loadCompress();
  if (!compress) return null;
  if (!(await probeProxy())) return null;

  return hasMessages
    ? compressMessagesBody(body, model, compress)
    : compressInputBody(body, model, compress);
}

export async function getHeadroomStatus() {
  const baseUrl = process.env.HEADROOM_BASE_URL || DEFAULT_PROXY_URL;
  const installed = !!(await loadCompress());
  const reachable = installed ? await probeProxy() : false;
  return { installed, reachable, proxyUrl: baseUrl };
}
