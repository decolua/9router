const PAYLOAD_KEYS = ["blocks", "model"];

export const CLAUDE_THINKING_ENVELOPE_PREFIX = "9router:claude-thinking:v1:";
export const MAX_CLAUDE_THINKING_ENVELOPE_LENGTH = 2 * 1024 * 1024;

function hasExactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === keys.slice().sort().join("\0");
}

function normalizeBlock(block) {
  if (block?.type === "thinking" &&
      hasExactKeys(block, ["signature", "thinking", "type"]) &&
      typeof block.thinking === "string" &&
      typeof block.signature === "string" && block.signature) {
    return { type: "thinking", thinking: block.thinking, signature: block.signature };
  }
  if (block?.type === "redacted_thinking" &&
      hasExactKeys(block, ["data", "type"]) &&
      typeof block.data === "string" && block.data) {
    return { type: "redacted_thinking", data: block.data };
  }
  return null;
}

function normalizePayload(payload, model) {
  if (!hasExactKeys(payload, PAYLOAD_KEYS) || payload.model !== model || !Array.isArray(payload.blocks) || payload.blocks.length === 0) {
    return null;
  }
  const blocks = payload.blocks.map(normalizeBlock);
  return blocks.every(Boolean) ? blocks : null;
}

export function encodeClaudeThinkingEnvelope(model, blocks) {
  if (typeof model !== "string" || !model || !Array.isArray(blocks)) return null;
  const normalized = normalizePayload({ model, blocks }, model);
  if (!normalized) return null;

  try {
    const encoded = Buffer.from(JSON.stringify({ model, blocks: normalized }), "utf8").toString("base64url");
    return encoded.length <= MAX_CLAUDE_THINKING_ENVELOPE_LENGTH
      ? CLAUDE_THINKING_ENVELOPE_PREFIX + encoded
      : null;
  } catch {
    return null;
  }
}

export function decodeClaudeThinkingEnvelope(value, model) {
  if (typeof value !== "string" || typeof model !== "string" || !model ||
      !value.startsWith(CLAUDE_THINKING_ENVELOPE_PREFIX)) {
    return null;
  }

  const encoded = value.slice(CLAUDE_THINKING_ENVELOPE_PREFIX.length);
  if (!encoded || encoded.length > MAX_CLAUDE_THINKING_ENVELOPE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) return null;
    return normalizePayload(JSON.parse(decoded.toString("utf8")), model);
  } catch {
    return null;
  }
}
