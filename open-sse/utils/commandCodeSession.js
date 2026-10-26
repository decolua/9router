/**
 * Stable conversation identity for CommandCode `/alpha/generate`.
 *
 * The upstream prompt cache is keyed on the session identity the client sends:
 * the `x-session-id` header plus the envelope `threadId`. The official CLI mints
 * ONE random v4 UUID per conversation and reuses it for every turn — a fresh id
 * per request makes every turn look like a new conversation and forces a cache
 * rebuild (confirmed against the CLI's own wire behavior by independent
 * CommandCode proxies, which derive a content-keyed id for the same reason).
 *
 * So derive the id instead of randomizing it per request:
 *   1. an explicit client session field (`prompt_cache_key`, `session_id`,
 *      `conversation_id`, Claude Code's `metadata.user_id`) — reused as-is when
 *      it is already a UUID, hashed into UUID shape otherwise;
 *   2. otherwise the conversation-stable prefix (system text + first user turn),
 *      which stays constant while later turns append.
 *
 * The envelope only accepts a real UUID for `threadId` (the CLI drops any other
 * value), so every derived id is v4-shaped. Only when there is nothing to key on
 * do we fall back to a per-request random id (the previous behavior).
 */

import crypto from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_SESSION_FIELDS = ["prompt_cache_key", "session_id", "conversation_id"];
const SYSTEM_ROLES = new Set(["system", "developer"]);

/** True when the value is a UUID the CommandCode envelope will accept. */
export function isCommandCodeThreadId(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Shape a 32-byte digest as a v4 UUID (RFC 4122 version/variant bits set). */
function toV4Uuid(digest) {
  const bytes = Buffer.from(digest).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Flatten OpenAI/Claude text content (string or block array) to plain text. */
function flattenText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") return part.text || part.output || "";
        return "";
      })
      .join("\n");
  }
  return String(content);
}

function normalizeClientSession(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Claude Code carries its session inside `metadata.user_id`. */
function claudeCodeSession(body) {
  const userId = body?.metadata?.user_id;
  const raw = normalizeClientSession(userId);
  if (!raw) return null;
  const embedded = raw.match(/_session_([a-f0-9-]+)$/i);
  if (embedded) return embedded[1];
  if (raw.startsWith("{")) {
    try {
      return normalizeClientSession(JSON.parse(raw)?.session_id);
    } catch {
      return null;
    }
  }
  return raw;
}

/** Conversation-stable hash input: system text + first user turn. */
function conversationPrefix(body) {
  const systemParts = [];
  const topLevelSystem = flattenText(body?.system);
  if (topLevelSystem) systemParts.push(topLevelSystem);

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const message of messages) {
    if (!message || !SYSTEM_ROLES.has(message.role)) continue;
    const text = flattenText(message.content);
    if (text) systemParts.push(text);
  }

  const firstUser = messages.find((message) => message?.role === "user");
  const firstUserText = firstUser ? flattenText(firstUser.content) : "";

  if (systemParts.length === 0 && !firstUserText) return null;
  return `${systemParts.join("\n\n")}\0${firstUserText}`;
}

/**
 * Conversation-stable v4 UUID for CommandCode's `threadId` and `x-session-id`.
 * Same conversation ⇒ same id; different conversation ⇒ different id.
 */
export function commandCodeThreadId(body) {
  for (const field of CLIENT_SESSION_FIELDS) {
    const client = normalizeClientSession(body?.[field]);
    if (!client) continue;
    if (isCommandCodeThreadId(client)) return client.toLowerCase();
    return toV4Uuid(crypto.createHash("sha256").update(`9router:commandcode:client\0${client}`).digest());
  }

  const claude = claudeCodeSession(body);
  if (claude) {
    if (isCommandCodeThreadId(claude)) return claude.toLowerCase();
    return toV4Uuid(crypto.createHash("sha256").update(`9router:commandcode:claude\0${claude}`).digest());
  }

  const prefix = conversationPrefix(body);
  if (prefix == null) return crypto.randomUUID();

  return toV4Uuid(
    crypto.createHash("sha256").update("9router:commandcode:prefix\0").update(prefix).digest(),
  );
}

export default commandCodeThreadId;
