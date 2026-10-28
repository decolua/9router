import { createHash, randomBytes, randomUUID } from "crypto";
import { CLAUDE_TOOL_SUFFIX, CC_DEFAULT_TOOLS, CLAUDE_SYSTEM_PROMPT } from "../config/appConstants.js";
import { CLAUDE_CLI_VERSION } from "../providers/shared.js";

const CC_ENTRYPOINT = "sdk-cli";

// Generate the billing header expected from current Claude Code clients.
// x-anthropic-billing-header: cc_version=<ver>.<build>; cc_entrypoint=sdk-cli; cch=<hash>;
function generateBillingHeader(payload) {
  const content = JSON.stringify(payload);
  const cch = createHash("sha256").update(content).digest("hex").slice(0, 5);
  const buildHash = randomBytes(2).toString("hex").slice(0, 3);
  return `x-anthropic-billing-header: cc_version=${CLAUDE_CLI_VERSION}.${buildHash}; cc_entrypoint=${CC_ENTRYPOINT}; cch=${cch};`;
}

// Derive a deterministic UUID-v4-shaped string from a seed (stable per account)
function deriveUuid(seed) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Strip scope prefixes (e.g. `claude:`) so session ids look like Claude Code UUIDs. */
export function normalizeClaudeSessionId(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) return sessionId;
  return sessionId.replace(/^claude:/i, "").trim() || null;
}

// Generate fake user ID in the current Claude Code JSON format:
// {"device_id":"<64hex>","account_uuid":"<uuid>","session_id":"<uuid>"}
// device_id/account_uuid derive from apiKey (stable per account), session_id per-conversation
function generateFakeUserID(sessionId, apiKey) {
  const deviceId = apiKey ? createHash("sha256").update(`device:${apiKey}`).digest("hex") : randomBytes(32).toString("hex");
  const accountUuid = apiKey ? deriveUuid(`account:${apiKey}`) : randomUUID();
  const sessionUuid = normalizeClaudeSessionId(sessionId) || randomUUID();
  return `{"device_id":"${deviceId}","account_uuid":"${accountUuid}","session_id":"${sessionUuid}"}`;
}

/** Parse session_id out of metadata.user_id (JSON Claude Code shape or plain string). */
export function extractClaudeSessionIdFromUserId(userId) {
  if (typeof userId !== "string" || !userId) return null;
  if (userId[0] === "{") {
    try {
      const sid = JSON.parse(userId)?.session_id;
      return typeof sid === "string" && sid ? normalizeClaudeSessionId(sid) : null;
    } catch {
      return null;
    }
  }
  return normalizeClaudeSessionId(userId);
}

function normalizeToolKey(name) {
  return String(name || "").replace(/[_-\s]/g, "").toLowerCase();
}

function toTitleCaseToolName(name) {
  const parts = String(name || "").split(/[_-\s]+/).filter(Boolean);
  if (!parts.length) return String(name || "");
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
}

// lowercase/normalized → official Claude Code TitleCase name
const CC_TOOL_BY_KEY = new Map(
  [...CC_DEFAULT_TOOLS].map((name) => [normalizeToolKey(name), name])
);

/**
 * Map a client tool name to a TitleCase / Claude Code fingerprint name.
 * Anthropic classifies all-lowercase OAuth tool names as third-party.
 */
export function cloakOAuthToolName(original, usedCloaked = null) {
  if (typeof original !== "string" || !original) return original;

  let cloaked;
  if (CC_DEFAULT_TOOLS.has(original)) {
    cloaked = original;
  } else {
    const keyed = CC_TOOL_BY_KEY.get(normalizeToolKey(original));
    cloaked = keyed || toTitleCaseToolName(original);
  }

  if (usedCloaked) {
    let candidate = cloaked;
    let n = 2;
    while (usedCloaked.has(candidate) && usedCloaked.get(candidate) !== original) {
      candidate = `${cloaked}${n}`;
      n += 1;
    }
    cloaked = candidate;
    usedCloaked.set(cloaked, original);
  }

  return cloaked;
}

function isBillingHeaderBlock(block) {
  return typeof block?.text === "string" && block.text.startsWith("x-anthropic-billing-header:");
}

function isClaudeCodePromptBlock(block) {
  const text = typeof block === "string" ? block : block?.text;
  return typeof text === "string" && text.includes("You are Claude Code");
}

function blockText(block) {
  if (typeof block === "string") return block;
  if (typeof block?.text === "string") return block.text;
  return "";
}

/**
 * Prepend text to the first user message (Claude content-block shape).
 * Used to park third-party system prompts outside system[] so Anthropic
 * does not fingerprint the request as a non-Claude-Code client.
 */
export function prependToFirstUserMessage(messages, text) {
  const prefix = { type: "text", text };
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ role: "user", content: [prefix] }];
  }

  const msgs = messages.map((m) => ({ ...m }));
  const idx = msgs.findIndex((m) => m.role === "user");
  if (idx < 0) {
    return [{ role: "user", content: [prefix] }, ...msgs];
  }

  const msg = msgs[idx];
  if (typeof msg.content === "string") {
    msgs[idx] = { ...msg, content: [prefix, { type: "text", text: msg.content }] };
  } else if (Array.isArray(msg.content)) {
    msgs[idx] = { ...msg, content: [prefix, ...msg.content] };
  } else {
    msgs[idx] = { ...msg, content: [prefix] };
  }
  return msgs;
}

/**
 * Cloak tools before sending to Claude OAuth (anti third-party fingerprint):
 * - Remap client tools to TitleCase / Claude Code names in tools[] and messages[]
 * - Skip tools that carry a `type` (server-side built-ins) — sent as-is
 * - Inject CC_DECOY_TOOLS for native CC names the client did not send
 * Returns { body, toolNameMap } where toolNameMap maps cloaked → original
 * @param {object} body - Claude API request body
 * @returns {{ body: object, toolNameMap: Map|null }}
 */
export function cloakClaudeTools(body) {
  const tools = body.tools;
  if (!tools || tools.length === 0) return { body, toolNameMap: null };

  const toolNameMap = new Map(); // cloaked → original
  const originalToCloaked = new Map();
  const usedCloaked = new Map(); // cloaked → original (collision guard)
  const clientDeclarations = [];
  const clientCloakedNames = new Set();

  for (const tool of tools) {
    // Built-in server tools (web_search_20250305, etc.) carry a `type` and require
    // an exact reserved `name` — never rename those or Claude rejects the request.
    if (tool.type) {
      clientDeclarations.push(tool);
      continue;
    }
    const original = tool.name;
    const cloaked = cloakOAuthToolName(original, usedCloaked);
    toolNameMap.set(cloaked, original);
    originalToCloaked.set(original, cloaked);
    clientCloakedNames.add(cloaked);
    clientDeclarations.push({ ...tool, name: cloaked });
  }

  // Client tools first, then CC decoys the client did not already declare
  const decoys = CC_DECOY_TOOLS.filter((t) => !clientCloakedNames.has(t.name));
  const allTools = [...clientDeclarations, ...decoys];

  const renameToolUse = (name) => {
    if (typeof name !== "string") return name;
    if (originalToCloaked.has(name)) return originalToCloaked.get(name);
    // Already cloaked on a prior hop, or unknown — leave alone
    return name;
  };

  const renamedMessages = body.messages?.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    const renamedContent = msg.content.map((block) =>
      block.type === "tool_use" ? { ...block, name: renameToolUse(block.name) } : block
    );
    return { ...msg, content: renamedContent };
  });

  const cloakedBody = { ...body, tools: allTools, messages: renamedMessages || body.messages };

  // Forced tool_choice must point at the cloaked name.
  if (
    body.tool_choice?.type === "tool" &&
    typeof body.tool_choice.name === "string" &&
    originalToCloaked.has(body.tool_choice.name)
  ) {
    cloakedBody.tool_choice = {
      ...body.tool_choice,
      name: originalToCloaked.get(body.tool_choice.name),
    };
  }

  return {
    body: cloakedBody,
    toolNameMap: toolNameMap.size > 0 ? toolNameMap : null,
  };
}

// Strip a trailing CLAUDE_TOOL_SUFFIX from a cloaked name as a last-resort
// fallback when the name isn't in toolNameMap (e.g. map lost across a retry/
// reconnect, or a legacy *_ide cloak still in flight). Never strips decoy
// names — those are meant to reach the client unresolved so it can see
// "tool unavailable" instead of silently no-oping.
function stripCloakSuffix(name) {
  if (typeof name !== "string" || !name.endsWith(CLAUDE_TOOL_SUFFIX)) return null;
  if (CC_DEFAULT_TOOLS.has(name)) return null;
  const original = name.slice(0, -CLAUDE_TOOL_SUFFIX.length);
  return original.length > 0 ? original : null;
}

// Decloak tool_use names in non-streaming Claude response body (INPUT side)
export function decloakToolNames(body, toolNameMap) {
  if (!Array.isArray(body?.content)) return body;
  const content = body.content.map((block) => {
    if (block?.type !== "tool_use") return block;
    if (toolNameMap?.has(block.name)) {
      return { ...block, name: toolNameMap.get(block.name) };
    }
    // toolNameMap missing/stale for this name — fall back to legacy *_ide
    // stripping rather than forwarding an unresolvable name to the client.
    const fallback = stripCloakSuffix(block.name);
    return fallback ? { ...block, name: fallback } : block;
  });
  return { ...body, content };
}

/**
 * Decloak the tool name inside a single streamed Claude SSE event.
 *
 * Streaming counterpart of decloakToolNames(). Required for claude→claude
 * proxying: translateResponse() returns same-format chunks untouched, so
 * without this the client receives the cloaked TitleCase tool name and
 * rejects the call as an unknown tool. In a Claude SSE stream a tool name
 * appears exactly once per call — on the content_block_start event of a
 * tool_use block; argument deltas carry no name.
 *
 * Falls back to stripping the literal CLAUDE_TOOL_SUFFIX when the name isn't
 * in toolNameMap (map lost across a retry/reconnect, or a legacy *_ide cloak),
 * matching the non-streaming decloak behavior. Decoy tool names and anything
 * else pass through unchanged.
 *
 * @param {object|null} chunk - Parsed SSE event (may be null on stream flush)
 * @param {Map|null} toolNameMap - Cloaked → original name map from cloakClaudeTools()
 * @returns {object|null} The chunk, with the tool_use name restored when cloaked
 */
export function decloakStreamChunk(chunk, toolNameMap) {
  if (!chunk || typeof chunk !== "object") return chunk;
  if (chunk.type !== "content_block_start") return chunk;
  const block = chunk.content_block;
  if (block?.type !== "tool_use" || typeof block.name !== "string") return chunk;
  const original = toolNameMap?.get(block.name) || stripCloakSuffix(block.name);
  if (!original) return chunk;
  return { ...chunk, content_block: { ...block, name: original } };
}

// CC decoy tools — Claude Code native tool names, marked unavailable
const CC_DECOY_TOOLS = [
  { name: "Task", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskOutput", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskStop", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskCreate", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskGet", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskUpdate", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "TaskList", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Bash", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Glob", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Grep", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Read", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Edit", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Write", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "NotebookEdit", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "WebFetch", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "WebSearch", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "AskUserQuestion", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "Skill", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "EnterPlanMode", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
  { name: "ExitPlanMode", description: "This tool is currently unavailable.", input_schema: { type: "object", properties: {} } },
];

/**
 * Apply Claude cloaking to request body (OAuth / sk-ant-oat only):
 * 1. Inject billing header + Claude Code system prompt as the only system[] blocks
 * 2. Move third-party system text into the first user message
 * 3. Inject fake user ID into metadata (session_id aligned with X-Claude-Code-Session-Id)
 * @param {object} body - Claude API request body
 * @param {string} apiKey - API key or OAuth token
 * @param {string} [sessionId] - Session ID to align with X-Claude-Code-Session-Id header
 * @returns {object} Modified body
 */
export function applyCloaking(body, apiKey, sessionId) {
  if (!apiKey || !apiKey.includes("sk-ant-oat")) return body;

  const result = { ...body };
  const billingText = generateBillingHeader(body);
  const billingBlock = { type: "text", text: billingText };
  const ccPromptBlock = { type: "text", text: CLAUDE_SYSTEM_PROMPT };

  // Collect third-party system text to relocate into the first user message.
  const extras = [];
  if (Array.isArray(result.system)) {
    for (const block of result.system) {
      if (isBillingHeaderBlock(block) || isClaudeCodePromptBlock(block)) continue;
      const text = blockText(block);
      if (text) extras.push(text);
    }
  } else if (typeof result.system === "string") {
    if (!result.system.includes("You are Claude Code") && !result.system.startsWith("x-anthropic-billing-header:")) {
      extras.push(result.system);
    }
  }

  result.system = [billingBlock, ccPromptBlock];

  if (extras.length > 0) {
    result.messages = prependToFirstUserMessage(result.messages, extras.join("\n\n"));
  }

  // Inject fake user ID into metadata (session_id must match X-Claude-Code-Session-Id)
  const existingUserId = result.metadata?.user_id;
  if (!existingUserId) {
    result.metadata = { ...result.metadata, user_id: generateFakeUserID(sessionId, apiKey) };
  }

  return result;
}
