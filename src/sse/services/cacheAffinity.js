import { createHash } from "node:crypto";

/**
 * Cache-affinity account selection.
 *
 * Provider-side prompt caches are keyed per account: once a conversation has
 * been served by account A, every later turn that lands on account B pays the
 * full (uncached) input price again. Sticky round-robin limits the damage but
 * still rotates every N calls, and its "current account" is global, so two
 * concurrent conversations fight over it.
 *
 * Here the *conversation* picks the account, via rendezvous (HRW) hashing on a
 * key that stays constant for the whole conversation:
 *   - stateless: nothing to persist, survives restarts, identical from any client
 *   - minimal remapping: removing an account only moves the keys it owned;
 *     other conversations keep their cache
 *   - retry-friendly: excluding a failed account simply promotes the next-ranked
 */

function contentToString(content) {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content ?? "");
  } catch {
    return "";
  }
}

/**
 * Key for a request, in order of preference:
 *   1. explicit `prompt_cache_key` (OpenAI-style)
 *   2. `metadata.user_id` (Claude Code sends a per-session id here)
 *   3. hash of the stable prompt prefix: system prompt + first non-system message
 * Returns null when there is no reusable prefix at all.
 */
export function buildCacheAffinityKey(body) {
  if (!body || typeof body !== "object") return null;

  const explicit = typeof body.prompt_cache_key === "string" ? body.prompt_cache_key.trim() : "";
  if (explicit) return explicit;

  const userId = typeof body.metadata?.user_id === "string" ? body.metadata.user_id.trim() : "";
  if (userId) return userId;

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts = [];
  if (body.system !== undefined && body.system !== null) systemParts.push(contentToString(body.system));
  let firstMessage = null;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "system" || m.role === "developer") {
      systemParts.push(contentToString(m.content));
      continue;
    }
    firstMessage = m;
    break;
  }
  const system = systemParts.join("\n");
  if (!system && !firstMessage) return null;

  const prefix = `${system}\0${firstMessage ? `${firstMessage.role}:${contentToString(firstMessage.content)}` : ""}`;
  return createHash("sha256").update(prefix).digest("hex");
}

/**
 * Rendezvous hashing: score every connection against the key and take the
 * highest. Ties (astronomically rare) break on connection id for determinism.
 */
export function pickByCacheAffinity(key, connections) {
  let best = null;
  let bestScore = "";
  for (const c of connections) {
    const score = createHash("sha256").update(`${key}\0${c.id}`).digest("hex");
    if (!best || score > bestScore || (score === bestScore && String(c.id) < String(best.id))) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
