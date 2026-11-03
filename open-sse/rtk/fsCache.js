// Raw Filesystem Token Cache for 9Router
// Supports two independent token-saving cache layers on raw disk:
//   1. Block/Context Compression Cache (`blocks/`): caches compressed tool_result
//      and context blocks by SHA-256 hash so multi-turn conversations reuse
//      deterministic compressed blocks instantly without re-compressing or
//      breaking upstream prefix prompt caches (e.g. Anthropic cache_control).
//   2. Full Response Cache (`responses/`): caches complete LLM responses (both
//      JSON and SSE stream payloads) by canonical request hash so identical
//      requests are served from disk with 0 upstream token usage.
//
// Fail-open contract: any filesystem error is caught and returns null/false so
// normal routing never breaks.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../utils/sseConstants.js";

const APP_NAME = "9router";
const CACHE_SCHEMA_VERSION = 1;
export const DEFAULT_FS_CACHE_TTL_HOURS = 24;
export const DEFAULT_FS_CACHE_MAX_SIZE_MB = 500;
const MIN_BLOCK_CACHE_CHARS = 128;

// Volatile per-request fields excluded when computing the canonical response cache key
const VOLATILE_BODY_KEYS = new Set([
  "requestId",
  "request_id",
  "conversationId",
  "conversation_id",
  "sessionId",
  "session_id",
  "user",
  "metadata",
  "prompt_cache_key",
  "_toolNameMap",
  "_customToolNames",
  "encrypted_content",
  "reasoning_encrypted_content",
]);

function resolveBaseDataDir() {
  if (process.env.TOKEN_CACHE_DIR) return process.env.TOKEN_CACHE_DIR;
  const configured = process.env.DATA_DIR;
  if (configured && !(process.platform === "win32" && /^\//.test(configured))) {
    return path.join(configured, "token-cache");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, APP_NAME, "token-cache");
  }
  return path.join(os.homedir(), `.${APP_NAME}`, "token-cache");
}

export function getTokenCacheDir() {
  return resolveBaseDataDir();
}

function getSubDir(sub) {
  return path.join(resolveBaseDataDir(), sub);
}

function getStatsFilePath() {
  return path.join(resolveBaseDataDir(), "stats.json");
}

function ensureDirSync(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input || ""), "utf8").digest("hex");
}

function shardedFilePath(sub, hash) {
  const shard = String(hash).slice(0, 2) || "00";
  return path.join(getSubDir(sub), shard, `${hash}.json`);
}

function atomicWriteJsonSync(filePath, payload) {
  try {
    const dir = path.dirname(filePath);
    if (!ensureDirSync(dir)) return false;
    const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch {
    return false;
  }
}

function readJsonSync(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DEFAULT_STATS = {
  blockHits: 0,
  blockMisses: 0,
  blockBytesSaved: 0,
  responseHits: 0,
  responseMisses: 0,
  responseTokensSaved: 0,
  updatedAt: null,
};

function readStatsSync() {
  const data = readJsonSync(getStatsFilePath());
  if (!data || typeof data !== "object") return { ...DEFAULT_STATS };
  return {
    blockHits: Number(data.blockHits) || 0,
    blockMisses: Number(data.blockMisses) || 0,
    blockBytesSaved: Number(data.blockBytesSaved) || 0,
    responseHits: Number(data.responseHits) || 0,
    responseMisses: Number(data.responseMisses) || 0,
    responseTokensSaved: Number(data.responseTokensSaved) || 0,
    updatedAt: data.updatedAt || null,
  };
}

function updateStatsSync(mutator) {
  try {
    const current = readStatsSync();
    mutator(current);
    current.updatedAt = new Date().toISOString();
    atomicWriteJsonSync(getStatsFilePath(), current);
  } catch {
    // fail-open
  }
}

export function normalizeTtlMs(ttlHours) {
  const hours = Number(ttlHours);
  const validHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_FS_CACHE_TTL_HOURS;
  return Math.round(validHours * 3600 * 1000);
}

export function normalizeMaxSizeBytes(maxSizeMb) {
  const mb = Number(maxSizeMb);
  const validMb = Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_FS_CACHE_MAX_SIZE_MB;
  return Math.round(validMb * 1024 * 1024);
}

// ============================================================================
// 1. BLOCK / CONTEXT COMPRESSION CACHE (`blocks/`)
// ============================================================================

export function buildBlockCacheKey(namespace, rawText, extra = "") {
  return sha256Hex(`v${CACHE_SCHEMA_VERSION}:block:${namespace}:${extra}:${rawText}`);
}

/**
 * Look up a compressed text block on raw filesystem.
 * Returns `{ content, savedBytes, meta }` on HIT, or `null` on MISS/expired.
 */
export function getBlockCacheSync(namespace, rawText, { ttlMs = DEFAULT_FS_CACHE_TTL_HOURS * 3600 * 1000, extra = "" } = {}) {
  try {
    if (typeof rawText !== "string" || rawText.length < MIN_BLOCK_CACHE_CHARS) return null;
    const hash = buildBlockCacheKey(namespace, rawText, extra);
    const filePath = shardedFilePath("blocks", hash);
    const entry = readJsonSync(filePath);
    if (!entry || entry.v !== CACHE_SCHEMA_VERSION || typeof entry.content !== "string") {
      updateStatsSync((s) => { s.blockMisses += 1; });
      return null;
    }
    const age = Date.now() - (Number(entry.createdAt) || 0);
    if (ttlMs > 0 && age > ttlMs) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      updateStatsSync((s) => { s.blockMisses += 1; });
      return null;
    }
    const savedBytes = Math.max(0, rawText.length - entry.content.length);
    updateStatsSync((s) => {
      s.blockHits += 1;
      s.blockBytesSaved += savedBytes;
    });
    return {
      content: entry.content,
      savedBytes,
      meta: entry.meta || {},
    };
  } catch {
    return null;
  }
}

/**
 * Store a compressed text block on raw filesystem.
 */
export function setBlockCacheSync(namespace, rawText, compressedText, { meta = {}, extra = "", maxSizeBytes = DEFAULT_FS_CACHE_MAX_SIZE_MB * 1024 * 1024 } = {}) {
  try {
    if (typeof rawText !== "string" || typeof compressedText !== "string") return false;
    if (rawText.length < MIN_BLOCK_CACHE_CHARS) return false;
    if (!compressedText || compressedText.length >= rawText.length) return false;

    const hash = buildBlockCacheKey(namespace, rawText, extra);
    const filePath = shardedFilePath("blocks", hash);
    const savedBytes = rawText.length - compressedText.length;
    const ok = atomicWriteJsonSync(filePath, {
      v: CACHE_SCHEMA_VERSION,
      namespace,
      createdAt: Date.now(),
      originalBytes: rawText.length,
      compressedBytes: compressedText.length,
      savedBytes,
      meta,
      content: compressedText,
    });
    if (ok) maybeSchedulePrune(maxSizeBytes);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Generic context-block cache pass for multi-turn messages when Block Cache is enabled.
 * Even when Headroom proxy is slow or offline, any message/tool block previously
 * compressed by Headroom or RTK is restored deterministically from the raw filesystem.
 */
export function applyCachedBlocksToMessages(messages, { namespace = "headroom", extra = "", ttlMs } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { hits: 0, savedBytes: 0, allCached: false };
  }
  let hits = 0;
  let eligible = 0;
  let savedBytes = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    if (typeof msg.content === "string" && msg.content.length >= MIN_BLOCK_CACHE_CHARS) {
      eligible++;
      const cached = getBlockCacheSync(namespace, msg.content, { ttlMs, extra: `${extra}:${msg.role || ""}` });
      if (cached && cached.content.length < msg.content.length) {
        msg.content = cached.content;
        hits++;
        savedBytes += cached.savedBytes;
      }
    }
  }

  return {
    hits,
    eligible,
    savedBytes,
    allCached: eligible > 0 && hits === eligible,
  };
}

/**
 * Persist newly compressed message blocks from Headroom into the raw filesystem block cache.
 */
export function storeCompressedMessageBlocks(beforeMessages, afterMessages, { namespace = "headroom", extra = "", maxSizeBytes } = {}) {
  if (!Array.isArray(beforeMessages) || !Array.isArray(afterMessages)) return 0;
  if (beforeMessages.length !== afterMessages.length) return 0;
  let stored = 0;
  for (let i = 0; i < beforeMessages.length; i++) {
    const beforeText = typeof beforeMessages[i]?.content === "string" ? beforeMessages[i].content : null;
    const afterText = typeof afterMessages[i]?.content === "string" ? afterMessages[i].content : null;
    if (!beforeText || !afterText) continue;
    if (beforeText.length >= MIN_BLOCK_CACHE_CHARS && afterText.length > 0 && afterText.length < beforeText.length) {
      const ok = setBlockCacheSync(namespace, beforeText, afterText, {
        extra: `${extra}:${beforeMessages[i]?.role || ""}`,
        meta: { role: beforeMessages[i]?.role || "unknown" },
        maxSizeBytes,
      });
      if (ok) stored++;
    }
  }
  return stored;
}

// ============================================================================
// 2. FULL RESPONSE CACHE (`responses/`)
// ============================================================================

function canonicalizeValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      if (VOLATILE_BODY_KEYS.has(k)) continue;
      if (value[k] === undefined) continue;
      out[k] = canonicalizeValue(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * Build a deterministic SHA-256 key for a chat request.
 */
export function buildResponseCacheKey({ provider, model, sourceFormat, stream, body }) {
  try {
    const canonicalBody = canonicalizeValue(body || {});
    const envelope = {
      v: CACHE_SCHEMA_VERSION,
      provider: String(provider || ""),
      model: String(model || ""),
      sourceFormat: String(sourceFormat || ""),
      stream: Boolean(stream),
      body: canonicalBody,
    };
    return sha256Hex(JSON.stringify(envelope));
  } catch {
    return null;
  }
}

function estimateSavedTokens(entry) {
  const u = entry?.usage;
  if (u && typeof u === "object") {
    const total = Number(u.total_tokens)
      || (Number(u.prompt_tokens || u.input_tokens || 0) + Number(u.completion_tokens || u.output_tokens || 0));
    if (total > 0) return total;
  }
  return Math.max(1, Math.round((entry?.bodyText?.length || 0) / 4));
}

/**
 * Look up a cached full response from the raw filesystem.
 */
export function getResponseCacheSync(cacheKey, { ttlMs = DEFAULT_FS_CACHE_TTL_HOURS * 3600 * 1000 } = {}) {
  try {
    if (!cacheKey) return null;
    const filePath = shardedFilePath("responses", cacheKey);
    const entry = readJsonSync(filePath);
    if (!entry || entry.v !== CACHE_SCHEMA_VERSION || typeof entry.bodyText !== "string" || !entry.bodyText) {
      updateStatsSync((s) => { s.responseMisses += 1; });
      return null;
    }
    const age = Date.now() - (Number(entry.createdAt) || 0);
    if (ttlMs > 0 && age > ttlMs) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      updateStatsSync((s) => { s.responseMisses += 1; });
      return null;
    }
    const savedTokens = estimateSavedTokens(entry);
    updateStatsSync((s) => {
      s.responseHits += 1;
      s.responseTokensSaved += savedTokens;
    });
    return { ...entry, savedTokens };
  } catch {
    return null;
  }
}

/**
 * Persist a full response (non-streaming JSON or completed SSE stream) to raw filesystem.
 */
export function setResponseCacheSync(cacheKey, { provider, model, sourceFormat, stream, contentType, bodyText, usage = null }, { maxSizeBytes = DEFAULT_FS_CACHE_MAX_SIZE_MB * 1024 * 1024 } = {}) {
  try {
    if (!cacheKey || typeof bodyText !== "string" || !bodyText.trim()) return false;
    const filePath = shardedFilePath("responses", cacheKey);
    const ok = atomicWriteJsonSync(filePath, {
      v: CACHE_SCHEMA_VERSION,
      createdAt: Date.now(),
      provider: String(provider || ""),
      model: String(model || ""),
      sourceFormat: String(sourceFormat || ""),
      stream: Boolean(stream),
      contentType: contentType || (stream ? "text/event-stream" : "application/json"),
      bodyText,
      usage: usage || null,
    });
    if (ok) maybeSchedulePrune(maxSizeBytes);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Build a client-facing HTTP `Response` from a cached response entry.
 */
export function createResponseFromCache(entry) {
  if (entry.stream) {
    const encoded = new TextEncoder().encode(entry.bodyText);
    const replayStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    });
    return new Response(replayStream, {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        "X-9Router-Cache": "HIT",
      },
    });
  }

  return new Response(entry.bodyText, {
    status: 200,
    headers: {
      "Content-Type": entry.contentType || "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-9Router-Cache": "HIT",
    },
  });
}

/**
 * Wrap an outgoing SSE ReadableStream so chunks pass through to the client with zero delay
 * while accumulating the complete SSE stream text to write to the raw filesystem cache on completion.
 */
export function wrapStreamForResponseCache(readableStream, { cacheKey, provider, model, sourceFormat, getUsage, maxSizeBytes } = {}) {
  if (!readableStream || !cacheKey) return readableStream;

  const reader = readableStream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks = [];
  let abortedOrErrored = false;

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const tail = decoder.decode();
          if (tail) chunks.push(tail);
          controller.close();

          if (!abortedOrErrored && chunks.length > 0) {
            const fullSseText = chunks.join("");
            // Avoid caching streams that terminated with an explicit error frame
            const hasStreamError = fullSseText.includes("event: error\n") || fullSseText.includes('"type":"error"');
            if (!hasStreamError && fullSseText.trim().length > 0) {
              const usage = typeof getUsage === "function" ? getUsage() : null;
              setResponseCacheSync(
                cacheKey,
                {
                  provider,
                  model,
                  sourceFormat,
                  stream: true,
                  contentType: "text/event-stream",
                  bodyText: fullSseText,
                  usage,
                },
                { maxSizeBytes }
              );
            }
          }
          return;
        }

        if (value) {
          chunks.push(decoder.decode(value, { stream: true }));
        }
        controller.enqueue(value);
      } catch (err) {
        abortedOrErrored = true;
        controller.error(err);
      }
    },
    cancel(reason) {
      abortedOrErrored = true;
      return reader.cancel(reason);
    },
  });
}

// ============================================================================
// 3. DISK INSPECTION, STATS & EVICTION
// ============================================================================

function listCacheFilesSync(sub) {
  const root = getSubDir(sub);
  const files = [];
  try {
    if (!fs.existsSync(root)) return files;
    const shards = fs.readdirSync(root, { withFileTypes: true });
    for (const shard of shards) {
      if (!shard.isDirectory()) continue;
      const shardDir = path.join(root, shard.name);
      const entries = fs.readdirSync(shardDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const fullPath = path.join(shardDir, entry.name);
        try {
          const st = fs.statSync(fullPath);
          files.push({ path: fullPath, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          // ignore transient unlink
        }
      }
    }
  } catch {
    // ignore
  }
  return files;
}

let lastPruneCheckAt = 0;

function maybeSchedulePrune(maxSizeBytes) {
  const now = Date.now();
  if (now - lastPruneCheckAt < 30_000) return;
  lastPruneCheckAt = now;
  setTimeout(() => {
    try {
      pruneFsCacheSync({ maxSizeBytes });
    } catch {
      // ignore
    }
  }, 0).unref?.();
}

export function pruneFsCacheSync({ ttlMs = 0, maxSizeBytes = DEFAULT_FS_CACHE_MAX_SIZE_MB * 1024 * 1024 } = {}) {
  const allFiles = [...listCacheFilesSync("blocks"), ...listCacheFilesSync("responses")];
  const now = Date.now();
  let removed = 0;

  const remaining = [];
  for (const file of allFiles) {
    if (ttlMs > 0 && now - file.mtimeMs > ttlMs) {
      try {
        fs.unlinkSync(file.path);
        removed++;
      } catch { /* ignore */ }
    } else {
      remaining.push(file);
    }
  }

  let totalBytes = remaining.reduce((sum, f) => sum + f.size, 0);
  if (maxSizeBytes > 0 && totalBytes > maxSizeBytes) {
    // Oldest mtime first (LRU/FIFO eviction)
    remaining.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of remaining) {
      if (totalBytes <= maxSizeBytes) break;
      try {
        fs.unlinkSync(file.path);
        totalBytes -= file.size;
        removed++;
      } catch { /* ignore */ }
    }
  }

  return { removed, totalBytes };
}

export function getFsCacheStatus() {
  const stats = readStatsSync();
  const blockFiles = listCacheFilesSync("blocks");
  const responseFiles = listCacheFilesSync("responses");
  const blockSizeBytes = blockFiles.reduce((acc, f) => acc + f.size, 0);
  const responseSizeBytes = responseFiles.reduce((acc, f) => acc + f.size, 0);

  return {
    cacheDir: getTokenCacheDir(),
    blocks: {
      entries: blockFiles.length,
      sizeBytes: blockSizeBytes,
      hits: stats.blockHits,
      misses: stats.blockMisses,
      bytesSaved: stats.blockBytesSaved,
      estTokensSaved: Math.round(stats.blockBytesSaved / 4),
    },
    responses: {
      entries: responseFiles.length,
      sizeBytes: responseSizeBytes,
      hits: stats.responseHits,
      misses: stats.responseMisses,
      tokensSaved: stats.responseTokensSaved,
    },
    totalEntries: blockFiles.length + responseFiles.length,
    totalSizeBytes: blockSizeBytes + responseSizeBytes,
    updatedAt: stats.updatedAt,
  };
}

export function clearFsCacheSync(scope = "all") {
  try {
    const clearSub = (sub) => {
      const dir = getSubDir(sub);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };

    if (scope === "blocks" || scope === "all") {
      clearSub("blocks");
    }
    if (scope === "responses" || scope === "all") {
      clearSub("responses");
    }

    updateStatsSync((s) => {
      if (scope === "blocks" || scope === "all") {
        s.blockHits = 0;
        s.blockMisses = 0;
        s.blockBytesSaved = 0;
      }
      if (scope === "responses" || scope === "all") {
        s.responseHits = 0;
        s.responseMisses = 0;
        s.responseTokensSaved = 0;
      }
    });
  } catch {
    // fail-open
  }
  return getFsCacheStatus();
}

