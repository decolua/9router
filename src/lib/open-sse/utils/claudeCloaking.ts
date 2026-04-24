import { createHash, randomBytes, randomUUID } from "crypto";
import { CLAUDE_TOOL_SUFFIX } from "../config/appConstants";

const CLAUDE_VERSION = "2.1.92";
const CC_ENTRYPOINT = "sdk-cli";

interface ClaudeBody {
  tools?: any[];
  messages?: any[];
  system?: any;
  metadata?: any;
  [key: string]: any;
}

// Generate billing header matching real Claude Code 2.1.92+ format:
// x-anthropic-billing-header: cc_version=<ver>.<build>; cc_entrypoint=sdk-cli; cch=<hash>;
function generateBillingHeader(payload: any): string {
  const content = JSON.stringify(payload);
  const cch = createHash("sha256").update(content).digest("hex").slice(0, 5);
  const buildHash = randomBytes(2).toString("hex").slice(0, 3);
  return `x-anthropic-billing-header: cc_version=${CLAUDE_VERSION}.${buildHash}; cc_entrypoint=${CC_ENTRYPOINT}; cch=${cch};`;
}

// Generate fake user ID in Claude Code 2.1.92+ JSON format:
// {"device_id":"<64hex>","account_uuid":"<uuid>","session_id":"<uuid>"}
function generateFakeUserID(sessionId?: string | null): string {
  const deviceId = randomBytes(32).toString("hex");
  const accountUuid = randomUUID();
  const sessionUuid = sessionId || randomUUID();
  return `{"device_id":"${deviceId}","account_uuid":"${accountUuid}","session_id":"${sessionUuid}"}`;
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
 * Cloak tools before sending to Claude provider (anti-ban)
 */
export function cloakClaudeTools(body: ClaudeBody): { body: ClaudeBody; toolNameMap: Map<string, string> | null } {
  const tools = body.tools;
  if (!tools || tools.length === 0) return { body, toolNameMap: null };

  const toolNameMap = new Map<string, string>();
  const clientDeclarations: any[] = [];

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
    const renamedContent = msg.content.map((block: any) => {
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

/**
 * Apply Claude cloaking to request body
 */
export function applyCloaking(body: ClaudeBody, apiKey: string | null | undefined, sessionId?: string | null): ClaudeBody {
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
