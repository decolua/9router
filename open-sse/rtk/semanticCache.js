/**
 * Semantic / Exact Prompt Caching Helper for 9Router
 * Caches and returns responses for exact duplicate non-streaming prompt requests.
 */

import crypto from "crypto";

const responseCache = new Map();
// Basic TTL of 3 hours for cache entries to avoid memory leak
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

function hashObject(obj) {
  try {
    return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
  } catch {
    return null;
  }
}

export function checkSemanticCache(body, model) {
  if (!body || body.stream) return null; // We only cache complete non-streaming responses
  
  // Exclude tool_choice forced calls or payloads that lack clear stable input
  if (body.tool_choice && body.tool_choice !== "auto") return null;

  const keyData = {
    model,
    messages: body.messages || body.input || body.contents || [],
    system: body.system,
    tools: body.tools,
  };

  const hashKey = hashObject(keyData);
  if (!hashKey) return null;

  const cached = responseCache.get(hashKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.response;
  }

  // Cleanup expired entries when reading
  if (cached) responseCache.delete(hashKey);
  return null;
}

export function saveToSemanticCache(body, model, responseBody) {
  if (!body || body.stream || !responseBody) return;
  if (body.tool_choice && body.tool_choice !== "auto") return;

  // Ensure response was successful (no errors)
  if (responseBody.error || responseBody.is_error) return;

  const keyData = {
    model,
    messages: body.messages || body.input || body.contents || [],
    system: body.system,
    tools: body.tools,
  };

  const hashKey = hashObject(keyData);
  if (!hashKey) return;

  responseCache.set(hashKey, {
    response: responseBody,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  // Basic cleanup to prevent unlimited memory growth (cap at 1000 entries)
  if (responseCache.size > 1000) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
}
