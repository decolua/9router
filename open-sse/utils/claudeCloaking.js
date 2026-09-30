import { createHash, randomBytes, randomUUID } from "crypto";
import { CLAUDE_TOOL_SUFFIX, CC_DEFAULT_TOOLS } from "../config/appConstants.js";
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

// Generate fake user ID in the current Claude Code JSON format:
// {"device_id":"<64hex>","account_uuid":"<uuid>","session_id":"<uuid>"}
// device_id/account_uuid derive from apiKey (stable per account), session_id per-conversation
function generateFakeUserID(sessionId, apiKey) {
  const deviceId = apiKey ? createHash("sha256").update(`device:${apiKey}`).digest("hex") : randomBytes(32).toString("hex");
  const accountUuid = apiKey ? deriveUuid(`account:${apiKey}`) : randomUUID();
  const cleanSessionId = typeof sessionId === "string" ? sessionId.replace(/^claude:/i, "").trim() : null;
  const sessionUuid = cleanSessionId || randomUUID();
  return `{"device_id":"${deviceId}","account_uuid":"${accountUuid}","session_id":"${sessionUuid}"}`;
}

export function extractClaudeSessionIdFromUserId(userId) {
  if (typeof userId !== "string" || !userId) return null;
  if (userId[0] === "{") {
    try {
      const sid = JSON.parse(userId)?.session_id;
      return typeof sid === "string" && sid ? sid.replace(/^claude:/i, "").trim() || null : null;
    } catch {
      return null;
    }
  }
  const clean = userId.replace(/^claude:/i, "").trim();
  return clean || null;
}

/**
 * Cloak tools before sending to Claude provider (anti-ban):
 * - Rename client tools with the CLAUDE_TOOL_SUFFIX ("_ide") in tools[] and messages[]
 * - Skip tools that carry a `type` (server-side built-ins) — sent as-is
 * - Inject CC_DECOY_TOOLS after client tools
 * Returns { body, toolNameMap } where toolNameMap maps suffixed → original
 * @param {object} body - Claude API request body
 * @returns {{ body: object, toolNameMap: Map|null }}
 */
export function cloakClaudeTools(body) {
  const tools = body.tools;
  if (!tools || tools.length === 0) return { body, toolNameMap: null };

  const suffix = (name) => `${name}${CLAUDE_TOOL_SUFFIX}`;
  const toolNameMap = new Map();
  const clientToolNames = new Set();
  const clientDeclarations = [];

  // All client tools get renamed with suffix.
  // Built-in server tools (web_search_20250305, etc.) carry a `type` and require
  // an exact reserved `name` — never suffix those or Claude rejects the request.
  for (const tool of tools) {
    if (tool.type) { clientDeclarations.push(tool); continue; }
    const suffixed = suffix(tool.name);
    toolNameMap.set(suffixed, tool.name);
    clientToolNames.add(tool.name);
    clientDeclarations.push({ ...tool, name: suffixed });
  }

  // Client tools first, then CC decoy tools (no overlap: client tools all have _cc suffix)
  const allTools = [...clientDeclarations, ...CC_DECOY_TOOLS];

  // Rename tool_use in message history (all client tools get suffix)
  const renamedMessages = body.messages?.map(msg => {
    if (!Array.isArray(msg.content)) return msg;
    const renamedContent = msg.content.map(block =>
      block.type === "tool_use" ? { ...block, name: suffix(block.name) } : block
    );
    return { ...msg, content: renamedContent };
  });

  const cloakedBody = { ...body, tools: allTools, messages: renamedMessages || body.messages };

  // A forced tool_choice ({ type: "tool", name }) must point at the suffixed
  // tool name, otherwise Claude rejects it: "Tool '<name>' not found in provided tools".
  // Only rewrite when the choice targets one of the client tools we actually
  // renamed — never a decoy/built-in name (those are sent unsuffixed).
  if (
    body.tool_choice?.type === "tool" &&
    clientToolNames.has(body.tool_choice.name)
  ) {
    cloakedBody.tool_choice = { ...body.tool_choice, name: suffix(body.tool_choice.name) };
  }

  return {
    body: cloakedBody,
    toolNameMap: toolNameMap.size > 0 ? toolNameMap : null
  };
}

// Strip a trailing CLAUDE_TOOL_SUFFIX from a cloaked name as a last-resort
// fallback when the name isn't in toolNameMap (e.g. map lost across a retry/
// reconnect). Never strips decoy names — those are meant to reach the client
// unresolved so it can see "tool unavailable" instead of silently no-oping.
function stripCloakSuffix(name) {
  if (typeof name !== "string" || !name.endsWith(CLAUDE_TOOL_SUFFIX)) return null;
  if (CC_DEFAULT_TOOLS.has(name)) return null;
  const original = name.slice(0, -CLAUDE_TOOL_SUFFIX.length);
  return original.length > 0 ? original : null;
}

// Decloak tool_use names in non-streaming Claude response body (INPUT side)
export function decloakToolNames(body, toolNameMap) {
  if (!Array.isArray(body?.content)) return body;
  const content = body.content.map(block => {
    if (block?.type !== "tool_use") return block;
    if (toolNameMap?.has(block.name)) {
      return { ...block, name: toolNameMap.get(block.name) };
    }
    // toolNameMap missing/stale for this name — fall back to suffix stripping
    // rather than forwarding an unresolvable "<tool>_ide" name to the client.
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
 * without this the client receives the cloaked ("_ide"-suffixed) tool name
 * and rejects the call as an unknown tool. In a Claude SSE stream a tool
 * name appears exactly once per call — on the content_block_start event of
 * a tool_use block; argument deltas carry no name.
 *
 * Falls back to stripping the literal CLAUDE_TOOL_SUFFIX when the name isn't
 * in toolNameMap (map lost across a retry/reconnect), matching the
 * non-streaming decloak behavior. Decoy tool names (real CC tool names) and
 * anything else pass through unchanged.
 *
 * @param {object|null} chunk - Parsed SSE event (may be null on stream flush)
 * @param {Map|null} toolNameMap - Suffixed → original name map from cloakClaudeTools()
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
 * Apply Claude cloaking to request body:
 * 1. Inject billing header as first system block
 * 2. Inject fake user ID into metadata (JSON format, session_id aligned with X-Claude-Code-Session-Id)
 * Only applies when using OAuth token (sk-ant-oat).
 * @param {object} body - Claude API request body
 * @param {string} apiKey - API key or OAuth token
 * @param {string} [sessionId] - Session ID to align with X-Claude-Code-Session-Id header
 * @returns {object} Modified body
 */
export function applyCloaking(body, apiKey, sessionId) {
  if (!apiKey || !apiKey.includes("sk-ant-oat")) return body;

  const result = { ...body };

  // Inject billing header as system[0], preserve existing system blocks
  const billingText = generateBillingHeader(body);
  const billingBlock = { type: "text", text: billingText };

  if (Array.isArray(result.system)) {
    // Skip if already injected
    if (!result.system[0]?.text?.startsWith("x-anthropic-billing-header:")) {
      result.system = [billingBlock, ...result.system];
    }
  } else if (typeof result.system === "string") {
    result.system = [billingBlock, { type: "text", text: result.system }];
  } else {
    result.system = [billingBlock];
  }

  // Inject fake user ID into metadata (session_id must match X-Claude-Code-Session-Id)
  const existingUserId = result.metadata?.user_id;
  if (!existingUserId) {
    result.metadata = { ...result.metadata, user_id: generateFakeUserID(sessionId, apiKey) };
  }

  return result;
}
