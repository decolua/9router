import { createHash, randomBytes, randomUUID } from "crypto";
import { CLAUDE_TOOL_SUFFIX, CC_DEFAULT_TOOLS } from "../config/appConstants.js";

const CLAUDE_VERSION = "2.1.92";
const CC_ENTRYPOINT = "sdk-cli";

// Generate billing header matching real Claude Code 2.1.92+ format:
// x-anthropic-billing-header: cc_version=<ver>.<build>; cc_entrypoint=sdk-cli; cch=<hash>;
function generateBillingHeader(payload) {
  const content = JSON.stringify(payload);
  const cch = createHash("sha256").update(content).digest("hex").slice(0, 5);
  const buildHash = randomBytes(2).toString("hex").slice(0, 3);
  return `x-anthropic-billing-header: cc_version=${CLAUDE_VERSION}.${buildHash}; cc_entrypoint=${CC_ENTRYPOINT}; cch=${cch};`;
}

// Generate fake user ID in Claude Code 2.1.92+ JSON format:
// {"device_id":"<64hex>","account_uuid":"<uuid>","session_id":"<uuid>"}
function generateFakeUserID(sessionId) {
  const deviceId = randomBytes(32).toString("hex");
  const accountUuid = randomUUID();
  const sessionUuid = sessionId || randomUUID();
  return `{"device_id":"${deviceId}","account_uuid":"${accountUuid}","session_id":"${sessionUuid}"}`;
}

/**
 * Cloak tools before sending to Claude provider (anti-ban):
 * - Rename non-CC client tools with _cc suffix in tools[] and messages[]
 * - Skip tools that are already CC default names (they become decoys as-is)
 * - Inject CC_DECOY_TOOLS after client tools
 * Returns { body, toolNameMap } where toolNameMap maps suffixed → original
 * @param {object} body - Claude API request body
 * @returns {{ body: object, toolNameMap: Map|null }}
 */
export function cloakClaudeTools(body) {
  const tools = body.tools;
  if (!tools || tools.length === 0) return { body, toolNameMap: null };

  const toolNameMap = new Map();
  const clientDeclarations = [];

  // All client tools get renamed with suffix
  for (const tool of tools) {
    const suffixed = `${tool.name}${CLAUDE_TOOL_SUFFIX}`;
    toolNameMap.set(suffixed, tool.name);
    clientDeclarations.push({ ...tool, name: suffixed });
  }

  // Client tools first, then CC decoy tools (no overlap: client tools all have _cc suffix)
  const allTools = [...clientDeclarations, ...CC_DECOY_TOOLS];

  // Rename tool_use in message history (all client tools get suffix)
  const renamedMessages = body.messages?.map(msg => {
    if (!Array.isArray(msg.content)) return msg;
    const renamedContent = msg.content.map(block => {
      if (block.type === "tool_use") {
        return { ...block, name: `${block.name}${CLAUDE_TOOL_SUFFIX}` };
      }
      return block;
    });
    return { ...msg, content: renamedContent };
  });

  return {
    body: { ...body, tools: allTools, messages: renamedMessages || body.messages },
    toolNameMap: toolNameMap.size > 0 ? toolNameMap : null
  };
}

// Decloak tool_use names in non-streaming Claude response body (INPUT side)
export function decloakToolNames(body, toolNameMap) {
  if (!toolNameMap?.size || !Array.isArray(body?.content)) return body;
  const content = body.content.map(block => {
    if (block?.type === "tool_use" && toolNameMap.has(block.name)) {
      return { ...block, name: toolNameMap.get(block.name) };
    }
    return block;
  });
  return { ...body, content };
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
    result.metadata = { ...result.metadata, user_id: generateFakeUserID(sessionId) };
  }

  return result;
}
