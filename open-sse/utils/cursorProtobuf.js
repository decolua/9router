/**
 * Cursor Protobuf Encoder/Decoder
 * Implements ConnectRPC protobuf wire format for Cursor API
 */

import { v4 as uuidv4 } from "uuid";
import zlib from "zlib";

const DEBUG = process.env.CURSOR_PROTOBUF_DEBUG === "1";
const log = (tag, ...args) => DEBUG && console.log(`[PROTOBUF:${tag}]`, ...args);
const textDecoder = new TextDecoder();

const PROTOBUF_SCHEMA_VERSION = "1.1.3";

// ==================== SCHEMAS ====================

const WIRE_TYPE = { VARINT: 0, FIXED64: 1, LEN: 2, FIXED32: 5 };

const ROLE = { USER: 1, ASSISTANT: 2 };

const UNIFIED_MODE = { CHAT: 1, AGENT: 2, EDIT: 3, CUSTOM: 4 };

const CURSOR_MODE_MAP = {
  ask:    { enum: UNIFIED_MODE.CHAT,   name: "Ask",    agentic: false },
  agent:  { enum: UNIFIED_MODE.AGENT,  name: "Agent",  agentic: true  },
  plan:   { enum: UNIFIED_MODE.AGENT,  name: "Plan",   agentic: true  },
  debug:  { enum: UNIFIED_MODE.AGENT,  name: "Debug",  agentic: true  },
  edit:   { enum: UNIFIED_MODE.EDIT,   name: "Edit",   agentic: true  },
  custom: { enum: UNIFIED_MODE.CUSTOM, name: "Custom", agentic: true  },
};

const THINKING_LEVEL = { UNSPECIFIED: 0, MEDIUM: 1, HIGH: 2 };

// ClientSideToolV2 enum (from Cursor proto — server_full.proto line 29)
const CLIENT_SIDE_TOOL_V2 = {
  UNSPECIFIED: 0,
  READ_SEMSEARCH_FILES: 1,
  READ_FILE_FOR_IMPORTS: 2,
  RIPGREP_SEARCH: 3,
  RUN_TERMINAL_COMMAND: 4,
  READ_FILE: 5,
  LIST_DIR: 6,
  EDIT_FILE: 7,
  FILE_SEARCH: 8,
  SEMANTIC_SEARCH_FULL: 9,
  CREATE_FILE: 10,
  DELETE_FILE: 11,
  REAPPLY: 12,
  GET_RELATED_FILES: 13,
  PARALLEL_APPLY: 14,
  RUN_TERMINAL_COMMAND_V2: 15,
  FETCH_RULES: 16,
  PLANNER: 17,
  WEB_SEARCH: 18,
  MCP: 19,
  WEB_VIEWER: 20,
  DIFF_HISTORY: 21,
  IMPLEMENTER: 22,
  SEARCH_SYMBOLS: 23,
  BACKGROUND_COMPOSER_FOLLOWUP: 24,
};
const CLIENT_SIDE_TOOL_V2_MCP = CLIENT_SIDE_TOOL_V2.MCP;

// Fixed set of native client-side capabilities we claim to the Cursor server.
// This tells Cursor "the connected client can execute file reads, terminal commands,
// searches, web fetches, and arbitrary MCP tools." The enum values come from Cursor's
// proto (ClientSideToolV2), so this list is intrinsically static — it reflects what
// Cursor's schema knows about, NOT the particular tools the user has registered.
//
// IMPORTANT for the user asking "is this dynamic?":
//   The PER-TOOL dynamism happens at a different layer. Any tool the user adds to
//   Claude Code (built-ins, /skills, new MCP servers, custom functions) is sent to
//   9Router in body.tools and encoded as an MCP tool (enum 19) with its original
//   name preserved — no 9Router code change required. The list below is just a
//   capability advertisement, not a tool registry.
//
// EDIT_FILE (7) intentionally excluded — Cursor's edit_file schema uses `code_edit`
// with ellipsis sentinels designed for a server-side fast-apply model we can't invoke.
// Excluding it steers the model toward Bash+apply_patch (which 9Router intercepts and
// rewrites into Edit) or MCP Edit (exact schema passthrough).
const NATIVE_SUPPORTED_TOOLS = [
  CLIENT_SIDE_TOOL_V2.RIPGREP_SEARCH,            // 3  → Grep
  CLIENT_SIDE_TOOL_V2.RUN_TERMINAL_COMMAND,      // 4  → Bash (v1)
  CLIENT_SIDE_TOOL_V2.READ_FILE,                 // 5  → Read
  CLIENT_SIDE_TOOL_V2.LIST_DIR,                  // 6  → LS
  CLIENT_SIDE_TOOL_V2.FILE_SEARCH,               // 8  → Glob
  CLIENT_SIDE_TOOL_V2.CREATE_FILE,               // 10 → Write
  CLIENT_SIDE_TOOL_V2.RUN_TERMINAL_COMMAND_V2,   // 15 → Bash (v2)
  CLIENT_SIDE_TOOL_V2.WEB_SEARCH,                // 18 → WebSearch
  CLIENT_SIDE_TOOL_V2.MCP,                       // 19 → MCP tools (including Edit)
  CLIENT_SIDE_TOOL_V2.WEB_VIEWER,                // 20 → WebFetch
];

// Pack repeated enum values into a single LEN-wrapped payload (protobuf packed repeated)
function encodePackedVarints(values) {
  return concatArrays(...values.map(v => encodeVarint(v)));
}

const FIELD = {
  // StreamUnifiedChatRequestWithTools (top level)
  REQUEST: 1,

  // StreamUnifiedChatRequest
  MESSAGES: 1,
  UNKNOWN_2: 2,
  INSTRUCTION: 3,
  UNKNOWN_4: 4,
  MODEL: 5,
  WEB_TOOL: 8,
  UNKNOWN_13: 13,
  CURSOR_SETTING: 15,
  UNKNOWN_19: 19,
  CONVERSATION_ID: 23,
  METADATA: 26,
  IS_AGENTIC: 27,
  SUPPORTED_TOOLS: 29,
  MESSAGE_IDS: 30,
  ENABLE_YOLO_MODE: 31,
  MCP_TOOLS: 34,
  LARGE_CONTEXT: 35,
  UNKNOWN_38: 38,
  UNIFIED_MODE: 46,
  TOOLS_REQUIRING_ACCEPTED_RETURN: 47,
  SHOULD_DISABLE_TOOLS: 48,
  THINKING_LEVEL: 49,
  USES_RULES: 51,
  MODE_USES_AUTO_APPLY: 53,
  UNIFIED_MODE_NAME: 54,

  // Deprecated aliases kept for internal call sites; do not use for new code.
  UNKNOWN_47: 47,
  UNKNOWN_51: 51,
  UNKNOWN_53: 53,

  // ConversationMessage
  MSG_CONTENT: 1,
  MSG_ROLE: 2,
  MSG_ID: 13,
  MSG_TOOL_RESULTS: 18,
  MSG_IS_AGENTIC: 29,
  MSG_SERVER_BUBBLE_ID: 32,
  MSG_UNIFIED_MODE: 47,
  MSG_SUPPORTED_TOOLS: 51,

  // ConversationMessage.ToolResult
  TOOL_RESULT_CALL_ID: 1,
  TOOL_RESULT_NAME: 2,
  TOOL_RESULT_INDEX: 3,
  TOOL_RESULT_RAW_ARGS: 5,
  TOOL_RESULT_RESULT: 8,
  TOOL_RESULT_TOOL_CALL: 11,
  TOOL_RESULT_MODEL_CALL_ID: 12,

  // ClientSideToolV2Result (nested inside ToolResult.result)
  CLIENT_RESULT_TOOL: 1,
  CLIENT_RESULT_MCP_RESULT: 28,
  CLIENT_RESULT_TOOL_CALL_ID: 35,
  CLIENT_RESULT_MODEL_CALL_ID: 48,
  CLIENT_RESULT_TOOL_INDEX: 49,
  // Aliases used by encodeClientSideToolV2Result
  CV2R_TOOL: 1,
  CV2R_MCP_RESULT: 28,
  CV2R_CALL_ID: 35,
  CV2R_MODEL_CALL_ID: 48,
  CV2R_TOOL_INDEX: 49,

  // MCPResult (nested inside ClientSideToolV2Result.mcp_result)
  MCP_RESULT_SELECTED_TOOL: 1,
  MCP_RESULT_RESULT: 2,
  // Aliases used by encodeMcpResult
  MCPR_SELECTED_TOOL: 1,
  MCPR_RESULT: 2,

  // ClientSideToolV2Call (nested inside ToolResult.tool_call)
  CLIENT_CALL_TOOL: 1,
  CLIENT_CALL_MCP_PARAMS: 27,
  CLIENT_CALL_TOOL_CALL_ID: 3,
  CLIENT_CALL_NAME: 9,
  CLIENT_CALL_RAW_ARGS: 10,
  CLIENT_CALL_TOOL_INDEX: 48,
  CLIENT_CALL_MODEL_CALL_ID: 49,
  // Aliases used by encodeClientSideToolV2Call
  CV2C_TOOL: 1,
  CV2C_MCP_PARAMS: 27,
  CV2C_CALL_ID: 3,
  CV2C_NAME: 9,
  CV2C_RAW_ARGS: 10,
  CV2C_TOOL_INDEX: 48,
  CV2C_MODEL_CALL_ID: 49,

  // Model
  MODEL_NAME: 1,
  MODEL_EMPTY: 4,

  // Instruction
  INSTRUCTION_TEXT: 1,

  // CursorSetting
  SETTING_PATH: 1,
  SETTING_UNKNOWN_3: 3,
  SETTING_UNKNOWN_6: 6,
  SETTING_UNKNOWN_8: 8,
  SETTING_UNKNOWN_9: 9,

  // CursorSetting.Unknown6
  SETTING6_FIELD_1: 1,
  SETTING6_FIELD_2: 2,

  // Metadata
  META_PLATFORM: 1,
  META_ARCH: 2,
  META_VERSION: 3,
  META_CWD: 4,
  META_TIMESTAMP: 5,

  // MessageId
  MSGID_ID: 1,
  MSGID_SUMMARY: 2,
  MSGID_ROLE: 3,

  // MCPTool
  MCP_TOOL_NAME: 1,
  MCP_TOOL_DESC: 2,
  MCP_TOOL_PARAMS: 3,
  MCP_TOOL_SERVER: 4,

  // StreamUnifiedChatResponseWithTools (response)
  TOOL_CALL: 1,
  RESPONSE: 2,

  // ClientSideToolV2Call
  TOOL_ID: 3,
  TOOL_NAME: 9,
  TOOL_RAW_ARGS: 10,
  TOOL_IS_LAST: 11,
  TOOL_IS_LAST_ALT: 15,
  TOOL_MCP_PARAMS: 27,

  // MCPParams
  MCP_TOOLS_LIST: 1,

  // MCPParams.Tool (nested)
  MCP_NESTED_NAME: 1,
  MCP_NESTED_PARAMS: 3,
  MCP_NESTED_SERVER: 4,

  // StreamUnifiedChatResponse
  RESPONSE_TEXT: 1,
  THINKING: 25,

  // Thinking
  THINKING_TEXT: 1
};

// Known response field numbers — used to detect unknown fields from protocol updates
const KNOWN_RESPONSE_FIELDS = new Set([
  FIELD.TOOL_CALL,
  FIELD.RESPONSE,
  FIELD.TOOL_ID,
  FIELD.TOOL_NAME,
  FIELD.TOOL_RAW_ARGS,
  FIELD.TOOL_IS_LAST,
  FIELD.TOOL_MCP_PARAMS,
  FIELD.RESPONSE_TEXT,
  FIELD.THINKING
]);

// ==================== PRIMITIVE ENCODING ====================

export function encodeVarint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7F);
  return new Uint8Array(bytes);
}

export function encodeField(fieldNum, wireType, value) {
  const tag = (fieldNum << 3) | wireType;
  const tagBytes = encodeVarint(tag);

  if (wireType === WIRE_TYPE.VARINT) {
    const valueBytes = encodeVarint(value);
    return concatArrays(tagBytes, valueBytes);
  }

  if (wireType === WIRE_TYPE.LEN) {
    const dataBytes = typeof value === "string" 
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array ? value
      : Buffer.isBuffer(value) ? new Uint8Array(value)
      : new Uint8Array(0);
    
    const lengthBytes = encodeVarint(dataBytes.length);
    return concatArrays(tagBytes, lengthBytes, dataBytes);
  }

  return new Uint8Array(0);
}

function concatArrays(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ==================== MESSAGE ENCODING ====================

/**
 * Format tool name: "toolName" → "mcp_custom_toolName"
 * Also handles: "mcp__server__tool" → "mcp_server_tool"
 */
function formatToolName(name) {
  const base = typeof name === "string" && name.length > 0 ? name : "tool";

  if (base.startsWith("mcp__")) {
    const rest = base.slice("mcp__".length);
    const splitIdx = rest.indexOf("__");
    if (splitIdx >= 0) {
      const server = rest.slice(0, splitIdx) || "custom";
      const toolName = rest.slice(splitIdx + 2) || "tool";
      return `mcp_${server}_${toolName}`;
    }
    return `mcp_custom_${rest || "tool"}`;
  }

  if (base.startsWith("mcp_")) return base;
  return `mcp_custom_${base}`;
}

/**
 * Parse formatted tool name: "mcp_server_tool" → { serverName, selectedTool }
 */
function parseToolName(formattedName) {
  if (typeof formattedName !== "string" || !formattedName.startsWith("mcp_")) {
    return { serverName: "custom", selectedTool: formattedName || "tool" };
  }

  const tail = formattedName.slice("mcp_".length);
  const splitIdx = tail.lastIndexOf("_");
  if (splitIdx < 0) {
    return { serverName: "custom", selectedTool: tail || "tool" };
  }

  return {
    serverName: tail.slice(0, splitIdx) || "custom",
    selectedTool: tail.slice(splitIdx + 1) || "tool"
  };
}

/**
 * Parse tool_call_id into { toolCallId, modelCallId }
 * Cursor uses "\nmc_" delimiter for model_call_id
 */
function parseToolId(id) {
  const delimiter = "\nmc_";
  const idx = id.indexOf(delimiter);
  if (idx >= 0) {
    return { toolCallId: id.slice(0, idx), modelCallId: id.slice(idx + delimiter.length) };
  }
  return { toolCallId: id, modelCallId: null };
}

/**
 * Encode MCPResult proto: { selected_tool, result }
 */
function encodeMcpResult(selectedTool, resultContent) {
  return concatArrays(
    encodeField(FIELD.MCPR_SELECTED_TOOL, WIRE_TYPE.LEN, selectedTool),
    encodeField(FIELD.MCPR_RESULT, WIRE_TYPE.LEN, resultContent)
  );
}

/**
 * Encode ClientSideToolV2Result proto: { tool, mcp_result, call_id, model_call_id, tool_index }
 * Represents the result of executing a tool
 */
function encodeClientSideToolV2Result(toolCallId, modelCallId, selectedTool, resultContent, toolIndex = 1) {
  return concatArrays(
    encodeField(FIELD.CV2R_TOOL, WIRE_TYPE.VARINT, CLIENT_SIDE_TOOL_V2_MCP),
    encodeField(FIELD.CV2R_MCP_RESULT, WIRE_TYPE.LEN, encodeMcpResult(selectedTool, resultContent)),
    encodeField(FIELD.CV2R_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    ...(modelCallId ? [encodeField(FIELD.CV2R_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : []),
    encodeField(FIELD.CV2R_TOOL_INDEX, WIRE_TYPE.VARINT, toolIndex > 0 ? toolIndex : 1)
  );
}

/**
 * Encode MCPParams.Tool nested inside ClientSideToolV2Call
 */
function encodeMcpParamsForCall(toolName, rawArgs, serverName) {
  const tool = concatArrays(
    encodeField(FIELD.MCP_TOOL_NAME, WIRE_TYPE.LEN, toolName),
    encodeField(FIELD.MCP_TOOL_PARAMS, WIRE_TYPE.LEN, rawArgs),
    encodeField(FIELD.MCP_TOOL_SERVER, WIRE_TYPE.LEN, serverName)
  );
  return encodeField(FIELD.MCP_TOOLS_LIST, WIRE_TYPE.LEN, tool);
}

/**
 * Encode ClientSideToolV2Call proto: { tool, mcp_params, call_id, name, raw_args, tool_index, model_call_id }
 * Represents a tool call definition
 */
function encodeClientSideToolV2Call(toolCallId, toolName, selectedTool, serverName, rawArgs, modelCallId, toolIndex = 1) {
  return concatArrays(
    encodeField(FIELD.CV2C_TOOL, WIRE_TYPE.VARINT, CLIENT_SIDE_TOOL_V2_MCP),
    encodeField(FIELD.CV2C_MCP_PARAMS, WIRE_TYPE.LEN, encodeMcpParamsForCall(selectedTool, rawArgs, serverName)),
    encodeField(FIELD.CV2C_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    encodeField(FIELD.CV2C_NAME, WIRE_TYPE.LEN, toolName),
    encodeField(FIELD.CV2C_RAW_ARGS, WIRE_TYPE.LEN, rawArgs),
    encodeField(FIELD.CV2C_TOOL_INDEX, WIRE_TYPE.VARINT, toolIndex > 0 ? toolIndex : 1),
    ...(modelCallId ? [encodeField(FIELD.CV2C_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : [])
  );
}

/**
 * Encode ConversationMessage.ToolResult with full structure
 * Matches Cursor proto: tool_call_id, tool_name, tool_index, raw_args, result, tool_call
 */
export function encodeToolResult(toolResult) {
  const originalName = toolResult.tool_name || toolResult.name || "";
  const rawArgs = toolResult.raw_args || "{}";
  const resultContent = toolResult.result_content || toolResult.result || "";
  const { toolCallId, modelCallId } = parseToolId(toolResult.tool_call_id || "");
  const toolIndex = toolResult.tool_index || toolResult.index || 1;
  let toolName = formatToolName(originalName);
  let serverName;
  let selectedTool;
  if (typeof originalName === "string" && originalName.startsWith("mcp__")) {
    const parsed = parseMcpToolName(originalName);
    serverName = parsed.server || "custom";
    selectedTool = parsed.bareName || "tool";
    toolName = `mcp_${serverName}_${selectedTool}`;
  } else {
    const parsed = parseToolName(toolName);
    serverName = parsed.serverName;
    selectedTool = parsed.selectedTool;
  }

  return concatArrays(
    encodeField(FIELD.TOOL_RESULT_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    encodeField(FIELD.TOOL_RESULT_NAME, WIRE_TYPE.LEN, toolName),
    encodeField(FIELD.TOOL_RESULT_INDEX, WIRE_TYPE.VARINT, toolIndex > 0 ? toolIndex : 1),
    ...(modelCallId ? [encodeField(FIELD.TOOL_RESULT_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : []),
    encodeField(FIELD.TOOL_RESULT_RAW_ARGS, WIRE_TYPE.LEN, rawArgs),
    encodeField(FIELD.TOOL_RESULT_RESULT, WIRE_TYPE.LEN,
      encodeClientSideToolV2Result(toolCallId, modelCallId, selectedTool, resultContent, toolIndex)
    ),
    encodeField(FIELD.TOOL_RESULT_TOOL_CALL, WIRE_TYPE.LEN,
      encodeClientSideToolV2Call(toolCallId, toolName, selectedTool, serverName, rawArgs, modelCallId, toolIndex)
    )
  );
}

export function encodeMessage(content, role, messageId, chatModeEnum = null, isLast = false, hasTools = false, toolResults = [], serverBubbleId = null) {
  const hasToolResults = toolResults.length > 0;
  return concatArrays(
    encodeField(FIELD.MSG_CONTENT, WIRE_TYPE.LEN, content),
    encodeField(FIELD.MSG_ROLE, WIRE_TYPE.VARINT, role),
    encodeField(FIELD.MSG_ID, WIRE_TYPE.LEN, messageId),
    // Only include server_bubble_id if explicitly provided (last assistant message only)
    ...(serverBubbleId ? [encodeField(FIELD.MSG_SERVER_BUBBLE_ID, WIRE_TYPE.LEN, serverBubbleId)] : []),
    ...(hasToolResults ? toolResults.map(tr =>
      encodeField(FIELD.MSG_TOOL_RESULTS, WIRE_TYPE.LEN, encodeToolResult(tr))
    ) : []),
    encodeField(FIELD.MSG_IS_AGENTIC, WIRE_TYPE.VARINT, hasTools ? 1 : 0),
    encodeField(FIELD.MSG_UNIFIED_MODE, WIRE_TYPE.VARINT, hasTools ? UNIFIED_MODE.AGENT : UNIFIED_MODE.CHAT),
    ...(isLast && hasTools
      ? [encodeField(FIELD.MSG_SUPPORTED_TOOLS, WIRE_TYPE.LEN, encodePackedVarints(NATIVE_SUPPORTED_TOOLS))]
      : [])
  );
}

export function encodeInstruction(text) {
  return text ? encodeField(FIELD.INSTRUCTION_TEXT, WIRE_TYPE.LEN, text) : new Uint8Array(0);
}

export function encodeModel(modelName) {
  return concatArrays(
    encodeField(FIELD.MODEL_NAME, WIRE_TYPE.LEN, modelName),
    encodeField(FIELD.MODEL_EMPTY, WIRE_TYPE.LEN, new Uint8Array(0))
  );
}

export function encodeCursorSetting() {
  const unknown6 = concatArrays(
    encodeField(FIELD.SETTING6_FIELD_1, WIRE_TYPE.LEN, new Uint8Array(0)),
    encodeField(FIELD.SETTING6_FIELD_2, WIRE_TYPE.LEN, new Uint8Array(0))
  );

  return concatArrays(
    encodeField(FIELD.SETTING_PATH, WIRE_TYPE.LEN, "cursor\\aisettings"),
    encodeField(FIELD.SETTING_UNKNOWN_3, WIRE_TYPE.LEN, new Uint8Array(0)),
    encodeField(FIELD.SETTING_UNKNOWN_6, WIRE_TYPE.LEN, unknown6),
    encodeField(FIELD.SETTING_UNKNOWN_8, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.SETTING_UNKNOWN_9, WIRE_TYPE.VARINT, 1)
  );
}

export function encodeMetadata() {
  return concatArrays(
    encodeField(FIELD.META_PLATFORM, WIRE_TYPE.LEN, process.platform || "linux"),
    encodeField(FIELD.META_ARCH, WIRE_TYPE.LEN, process.arch || "x64"),
    encodeField(FIELD.META_VERSION, WIRE_TYPE.LEN, process.version || "v20.0.0"),
    encodeField(FIELD.META_CWD, WIRE_TYPE.LEN, process.cwd?.() || "/"),
    encodeField(FIELD.META_TIMESTAMP, WIRE_TYPE.LEN, new Date().toISOString())
  );
}

export function encodeMessageId(messageId, role, summaryId = null) {
  return concatArrays(
    encodeField(FIELD.MSGID_ID, WIRE_TYPE.LEN, messageId),
    ...(summaryId ? [encodeField(FIELD.MSGID_SUMMARY, WIRE_TYPE.LEN, summaryId)] : []),
    encodeField(FIELD.MSGID_ROLE, WIRE_TYPE.VARINT, role)
  );
}

// Parse Claude Code MCP naming: "mcp__github__create_issue" → { server: "github", bareName: "create_issue" }
// Non-MCP tool names (e.g. "Read", "Edit") stay as server "custom".
function parseMcpToolName(name) {
  if (typeof name === "string" && name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const splitIdx = rest.indexOf("__");
    if (splitIdx > 0) {
      const server = rest.slice(0, splitIdx);
      const bareName = rest.slice(splitIdx + 2);
      if (server && bareName) return { server, bareName };
    }
  }
  return { server: "custom", bareName: name };
}

export function encodeMcpTool(tool) {
  const rawName = tool.function?.name || tool.name || "";
  const toolDesc = tool.function?.description || tool.description || "";
  const inputSchema = tool.function?.parameters || tool.input_schema || {};
  const { server, bareName } = parseMcpToolName(rawName);

  return concatArrays(
    ...(bareName ? [encodeField(FIELD.MCP_TOOL_NAME, WIRE_TYPE.LEN, bareName)] : []),
    ...(toolDesc ? [encodeField(FIELD.MCP_TOOL_DESC, WIRE_TYPE.LEN, toolDesc)] : []),
    ...(Object.keys(inputSchema).length > 0 ? [encodeField(FIELD.MCP_TOOL_PARAMS, WIRE_TYPE.LEN, JSON.stringify(inputSchema))] : []),
    encodeField(FIELD.MCP_TOOL_SERVER, WIRE_TYPE.LEN, server)
  );
}

// ==================== REQUEST BUILDING ====================

export function encodeRequest(messages, modelName, tools = [], reasoningEffort = null, forceAgentMode = false, cursorMode = null, toolChoice = null) {
  const hasTools = tools?.length > 0;
  const normalizedMode = typeof cursorMode === "string" ? cursorMode.toLowerCase() : null;
  // Priority: explicit valid cursor_mode > "agent" default (tools/UA path also lands here)
  const modeKey = normalizedMode && CURSOR_MODE_MAP[normalizedMode]
    ? normalizedMode
    : "agent";
  const modeCfg = CURSOR_MODE_MAP[modeKey];
  const isAgentic = modeCfg.agentic;
  const formattedMessages = [];
  const messageIds = [];
  const normalizedMessages = [];

  // Guardrail: split mixed assistant payload into separate assistant messages
  // This prevents protobuf encoding errors when tool calls and results are in same message
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
    const hasToolResults = Array.isArray(msg?.tool_results) && msg.tool_results.length > 0;

    if (msg?.role === "assistant" && hasToolCalls && hasToolResults) {
      log(
        "ENCODE",
        `normalizing mixed assistant tool payload at msg[${i}] (calls=${msg.tool_calls.length}, results=${msg.tool_results.length})`
      );

      // Keep assistant tool call message without embedded results
      normalizedMessages.push({
        ...msg,
        tool_results: []
      });

      // Avoid inserting duplicate assistant tool-result message if next one already matches
      const nextMsg = messages[i + 1];
      const nextHasToolResults =
        nextMsg?.role === "assistant" &&
        Array.isArray(nextMsg?.tool_results) &&
        nextMsg.tool_results.length > 0;
      const currentIds = new Set(
        msg.tool_results.map(tr => tr?.tool_call_id).filter(id => typeof id === "string")
      );
      const nextIds = new Set(
        (nextMsg?.tool_results || [])
          .map(tr => tr?.tool_call_id)
          .filter(id => typeof id === "string")
      );
      let sameIds = currentIds.size > 0 && currentIds.size === nextIds.size;
      if (sameIds) {
        for (const id of currentIds) {
          if (!nextIds.has(id)) {
            sameIds = false;
            break;
          }
        }
      }

      if (!(nextHasToolResults && sameIds)) {
        normalizedMessages.push({
          role: "assistant",
          content: "",
          tool_results: msg.tool_results
        });
      }

      continue;
    }

    normalizedMessages.push(msg);
  }

  // Prepare messages
  for (let i = 0; i < normalizedMessages.length; i++) {
    const msg = normalizedMessages[i];
    const role = msg.role === "user" ? ROLE.USER : ROLE.ASSISTANT;
    const msgId = uuidv4();
    const isLast = i === normalizedMessages.length - 1;

    formattedMessages.push({
      content: msg.content,
      role,
      messageId: msgId,
      isLast,
      hasTools: isAgentic,
      toolResults: msg.tool_results || []
    });

    messageIds.push({ messageId: msgId, role });
  }

  // Map reasoning effort to thinking level
  let thinkingLevel = THINKING_LEVEL.UNSPECIFIED;
  if (reasoningEffort === "medium") thinkingLevel = THINKING_LEVEL.MEDIUM;
  else if (reasoningEffort === "high") thinkingLevel = THINKING_LEVEL.HIGH;

  const totalToolCount = Array.isArray(tools) ? tools.length : 0;
  const allToolNames = (tools || [])
    .map(t => t?.function?.name || t?.name || "")
    .filter(Boolean);
  const prefixedMcpToolNames = allToolNames.filter(name => name.startsWith("mcp__"));
  const builtinOrCustomToolNames = allToolNames.filter(name => !name.startsWith("mcp__"));
  const mcpServerCount = new Set(
    allToolNames.map((name) => parseMcpToolName(name).server)
  ).size;
  const explicitToolChoiceLog =
    typeof toolChoice === "string"
      ? toolChoice
      : (toolChoice?.function?.name || toolChoice?.name || "none");

  // Override Cursor's default training that emits ```N:N:filename code-edit blocks
  // for IDE fast-apply. In headless API mode the client (Claude Code, etc.) cannot
  // parse those blocks — it expects native tool_use calls. This instruction is
  // injected only when the request is agentic AND has tools available.
  const agentInstruction =
    isAgentic && totalToolCount > 0
      ? "You are operating as an autonomous agent in headless API mode. You MUST execute every action via direct tool calls. To modify files, call the Edit tool (file_path, old_string, new_string) or Write tool (file_path, content). Do NOT emit `N:N:filename` code-edit markdown blocks — they will not be applied. Do NOT tell the user to switch modes. Always respond by calling the appropriate tool from the tools list."
      : "";

  console.log(
    `[CURSOR PROTO ENCODE] model=${modelName} mode=${modeCfg.name} isAgentic=${isAgentic ? 1 : 0} messages=${formattedMessages.length} total_tools=${totalToolCount} prefixed_mcp_tools=${prefixedMcpToolNames.length} builtin_or_custom_tools=${builtinOrCustomToolNames.length} logical_servers=${mcpServerCount} tool_choice=${explicitToolChoiceLog} agent_instruction=${agentInstruction ? "on" : "off"}`
  );
  if (prefixedMcpToolNames.length > 0) {
    console.log(
      `[CURSOR PROTO ENCODE] mcp sample: ${prefixedMcpToolNames.slice(0, 10).join(", ")}${prefixedMcpToolNames.length > 10 ? " ..." : ""}`
    );
  }
  if (builtinOrCustomToolNames.length > 0) {
    console.log(
      `[CURSOR PROTO ENCODE] builtin/custom sample: ${builtinOrCustomToolNames.slice(0, 10).join(", ")}${builtinOrCustomToolNames.length > 10 ? " ..." : ""}`
    );
  }

  // Build request
  return concatArrays(
    // Messages
    ...formattedMessages.map(fm => 
      encodeField(FIELD.MESSAGES, WIRE_TYPE.LEN, 
        encodeMessage(fm.content, fm.role, fm.messageId, null, fm.isLast, fm.hasTools, fm.toolResults)
      )
    ),
    
    // Static fields
    encodeField(FIELD.UNKNOWN_2, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.INSTRUCTION, WIRE_TYPE.LEN, encodeInstruction(agentInstruction)),
    encodeField(FIELD.UNKNOWN_4, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.MODEL, WIRE_TYPE.LEN, encodeModel(modelName)),
    encodeField(FIELD.WEB_TOOL, WIRE_TYPE.LEN, ""),
    encodeField(FIELD.UNKNOWN_13, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.CURSOR_SETTING, WIRE_TYPE.LEN, encodeCursorSetting()),
    encodeField(FIELD.UNKNOWN_19, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.CONVERSATION_ID, WIRE_TYPE.LEN, uuidv4()),
    encodeField(FIELD.METADATA, WIRE_TYPE.LEN, encodeMetadata()),

    // Tool-related fields
    encodeField(FIELD.IS_AGENTIC, WIRE_TYPE.VARINT, isAgentic ? 1 : 0),
    ...(isAgentic
      ? [encodeField(FIELD.SUPPORTED_TOOLS, WIRE_TYPE.LEN, encodePackedVarints(NATIVE_SUPPORTED_TOOLS))]
      : []),
    // Auto-accept tool calls (no UI approval loop). Required for headless API mode —
    // without this, Cursor's model treats MCP tools as "declaration-only" ("not
    // available to me") because there's no way to prompt the user for confirmation.
    ...(isAgentic ? [encodeField(FIELD.ENABLE_YOLO_MODE, WIRE_TYPE.VARINT, 1)] : []),

    // Message IDs
    ...messageIds.map(mid =>
      encodeField(FIELD.MESSAGE_IDS, WIRE_TYPE.LEN, encodeMessageId(mid.messageId, mid.role))
    ),

    // MCP Tools
    ...(tools?.length > 0 ? tools.map(tool => 
      encodeField(FIELD.MCP_TOOLS, WIRE_TYPE.LEN, encodeMcpTool(tool))
    ) : []),

    // Mode fields
    encodeField(FIELD.LARGE_CONTEXT, WIRE_TYPE.VARINT, 0),
    encodeField(FIELD.UNKNOWN_38, WIRE_TYPE.VARINT, 0),
    encodeField(FIELD.UNIFIED_MODE, WIRE_TYPE.VARINT, modeCfg.enum),
    encodeField(FIELD.UNKNOWN_47, WIRE_TYPE.LEN, ""),
    encodeField(FIELD.SHOULD_DISABLE_TOOLS, WIRE_TYPE.VARINT, isAgentic ? 0 : 1),
    encodeField(FIELD.THINKING_LEVEL, WIRE_TYPE.VARINT, thinkingLevel),
    encodeField(FIELD.UNKNOWN_51, WIRE_TYPE.VARINT, 0),
    encodeField(FIELD.UNKNOWN_53, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.UNIFIED_MODE_NAME, WIRE_TYPE.LEN, modeCfg.name)
  );
}

export function buildChatRequest(messages, modelName, tools = [], reasoningEffort = null, forceAgentMode = false, cursorMode = null, toolChoice = null) {
  return encodeField(FIELD.REQUEST, WIRE_TYPE.LEN, encodeRequest(messages, modelName, tools, reasoningEffort, forceAgentMode, cursorMode, toolChoice));
}

/**
 * Encode a tool result as ClientSideToolV2Result (field 2 of StreamUnifiedChatRequestWithTools)
 * This is sent as a SEPARATE request frame, not inside conversation messages.
 * Proto: StreamUnifiedChatRequestWithTools.client_side_tool_v2_result = 2
 */
export function buildToolResultRequest(toolResult) {
  const { toolCallId, modelCallId } = parseToolId(toolResult.tool_call_id || "");
  const rawName = toolResult.tool_name || "";
  const resultContent = toolResult.result_content || "";

  // selected_tool = raw tool name (e.g. "Write", "Read") per cursor-api Rust source:
  // McpResult { selected_tool: tool_name, result } where tool_name is the mcpParams.tools[0].name
  // which is the name AFTER server prefix stripping (e.g. "custom_Write" -> name = "Write")
  // Actually cursor-api uses: name = tool_name.slice_unchecked(d+1..) → raw name without "custom_"
  // So selected_tool = raw tool name without any prefix
  const selectedTool = rawName.startsWith("mcp_custom_")
    ? rawName.slice("mcp_custom_".length)
    : rawName.startsWith("mcp_")
    ? rawName.slice(4)
    : rawName;

  // ClientSideToolV2Result per proto:
  //   field 1 (tool): varint = 19 (MCP)
  //   field 28 (mcp_result): LEN { field 1: selected_tool, field 2: result }
  //   field 35 (tool_call_id): string
  //   field 48 (model_call_id): string (optional)
  //   NO tool_index (None in Rust source: encode_tool_result sets tool_index: None)
  const cv2Result = concatArrays(
    encodeField(FIELD.CV2R_TOOL, WIRE_TYPE.VARINT, CLIENT_SIDE_TOOL_V2_MCP),
    encodeField(FIELD.CV2R_MCP_RESULT, WIRE_TYPE.LEN, encodeMcpResult(selectedTool, resultContent)),
    encodeField(FIELD.CV2R_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    ...(modelCallId ? [encodeField(FIELD.CV2R_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : [])
    // tool_index intentionally omitted (None per Rust source)
  );

  // StreamUnifiedChatRequestWithTools: field 2 = client_side_tool_v2_result
  return encodeField(2, WIRE_TYPE.LEN, cv2Result);
}

export function wrapConnectRPCFrame(payload, compress = false) {
  let finalPayload = payload;
  let flags = 0x00;

  if (compress) {
    finalPayload = new Uint8Array(zlib.gzipSync(Buffer.from(payload)));
    flags = 0x01;
  }

  const frame = new Uint8Array(5 + finalPayload.length);
  frame[0] = flags;
  frame[1] = (finalPayload.length >> 24) & 0xFF;
  frame[2] = (finalPayload.length >> 16) & 0xFF;
  frame[3] = (finalPayload.length >> 8) & 0xFF;
  frame[4] = finalPayload.length & 0xFF;
  frame.set(finalPayload, 5);

  return frame;
}

export function generateCursorBody(messages, modelName, tools = [], reasoningEffort = null, forceAgentMode = false, cursorMode = null, toolChoice = null) {
  log("BODY", `Generating: ${messages.length} msgs, model=${modelName}, tools=${tools.length}, reasoning=${reasoningEffort || "none"}, forceAgentMode=${forceAgentMode}, cursorMode=${cursorMode || "auto"}`);

  const protobuf = buildChatRequest(messages, modelName, tools, reasoningEffort, forceAgentMode, cursorMode, toolChoice);
  const framed = wrapConnectRPCFrame(protobuf, false); // Cursor doesn't support compressed requests

  log("BODY", `Protobuf=${protobuf.length}B, Framed=${framed.length}B`);
  return framed;
}

/**
 * Generate a framed tool result body to send as a separate request frame.
 * Uses field 2 (client_side_tool_v2_result) of StreamUnifiedChatRequestWithTools.
 */
export function generateToolResultBody(toolResult) {
  const protobuf = buildToolResultRequest(toolResult);
  return wrapConnectRPCFrame(protobuf, false);
}

// ==================== PRIMITIVE DECODING ====================

export function decodeVarint(buffer, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;

  while (pos < buffer.length) {
    const b = buffer[pos];
    result |= (b & 0x7F) << shift;
    pos++;
    if (!(b & 0x80)) break;
    shift += 7;
  }

  return [result, pos];
}

export function decodeField(buffer, offset) {
  if (offset >= buffer.length) return [null, null, null, offset];

  const [tag, pos1] = decodeVarint(buffer, offset);
  const fieldNum = tag >> 3;
  const wireType = tag & 0x07;

  let value;
  let pos = pos1;

  if (wireType === WIRE_TYPE.VARINT) {
    [value, pos] = decodeVarint(buffer, pos);
  } else if (wireType === WIRE_TYPE.LEN) {
    const [length, pos2] = decodeVarint(buffer, pos);
    value = buffer.slice(pos2, pos2 + length);
    pos = pos2 + length;
  } else if (wireType === WIRE_TYPE.FIXED64) {
    value = buffer.slice(pos, pos + 8);
    pos += 8;
  } else if (wireType === WIRE_TYPE.FIXED32) {
    value = buffer.slice(pos, pos + 4);
    pos += 4;
  } else {
    value = null;
  }

  return [fieldNum, wireType, value, pos];
}

export function decodeMessage(data) {
  const fields = new Map();
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, value, newPos] = decodeField(data, pos);
    if (fieldNum === null) break;

    if (!fields.has(fieldNum)) fields.set(fieldNum, []);
    fields.get(fieldNum).push({ wireType, value });
    pos = newPos;
  }

  return fields;
}

// ==================== RESPONSE PARSING ====================

export function parseConnectRPCFrame(buffer) {
  if (buffer.length < 5) return null;

  const flags = buffer[0];
  const length = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];

  if (buffer.length < 5 + length) return null;

  let payload = buffer.slice(5, 5 + length);

  // Decompress if gzip
  if (flags === 0x01) {
    try {
      payload = new Uint8Array(zlib.gunzipSync(Buffer.from(payload)));
    } catch (err) {
      log("PARSE", `Decompression failed: ${err.message}`);
    }
  }

  return { flags, length, payload, consumed: 5 + length };
}

// Map ClientSideToolV2 enum values → Claude Code / OpenAI-compatible tool names.
// Used when Cursor returns a native tool call (non-MCP) — so the client sees
// its own registered tool name and can execute it via the standard tool loop.
const NATIVE_TOOL_NAME_BY_ENUM = {
  3: "Grep",
  4: "Bash",
  5: "Read",
  6: "LS",
  // EDIT_FILE (7) → Write as last-resort best-effort. Cursor's edit_file schema uses
  // `code_edit` with ellipsis sentinels designed for a server-side fast-apply model
  // we can't invoke. If the model still emits EDIT_FILE (despite us removing it from
  // supported_tools), we overwrite the whole file with code_edit content. This fails
  // visibly when code_edit contains "// ... existing code ..." placeholders, which at
  // least gives the user signal instead of silent no-op.
  7: "Write",
  8: "Glob",
  10: "Write",
  15: "Bash",
  18: "WebSearch",
  20: "WebFetch",
};

// Translate Cursor native tool arguments → Claude Code tool arguments.
// Cursor schema is documented by its system prompt; Claude Code schema is the
// canonical tool signature Anthropic ships. Unknown fields are dropped, missing
// fields are left unset (tool will error clearly instead of silently doing nothing).
function pickPath(args) {
  return args.relative_workspace_path
      || args.target_file
      || args.path
      || args.file_path
      || "";
}
const NATIVE_ARG_TRANSLATORS = {
  // READ_FILE
  5: (args) => {
    const out = { file_path: pickPath(args) };
    if (args.should_read_entire_file !== true) {
      const start = Number(args.start_line_one_indexed);
      const end = Number(args.end_line_one_indexed_inclusive);
      if (Number.isFinite(start) && start > 0) out.offset = start - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        out.limit = end - start + 1;
      }
    }
    return out;
  },
  // CREATE_FILE
  10: (args) => ({
    file_path: pickPath(args),
    content: args.content ?? args.contents ?? args.code_edit ?? "",
  }),
  // EDIT_FILE → Write best-effort (see NATIVE_TOOL_NAME_BY_ENUM note)
  7: (args) => ({
    file_path: pickPath(args),
    content: args.code_edit ?? args.content ?? args.new_content ?? "",
  }),
  // RUN_TERMINAL_COMMAND (v1 and v2 share the same shape)
  4: (args) => ({
    command: args.command || "",
    ...(args.explanation ? { description: String(args.explanation) } : {}),
    ...(args.is_background === true ? { run_in_background: true } : {}),
  }),
  15: (args) => NATIVE_ARG_TRANSLATORS[4](args),
  // LIST_DIR
  6: (args) => ({ path: pickPath(args) }),
  // RIPGREP_SEARCH — accept both Cursor's `query` and any fallback search term names
  3: (args) => ({
    pattern: args.query ?? args.pattern ?? args.search_term ?? args.q ?? "",
    ...(args.include_pattern ? { glob: args.include_pattern } : {}),
    ...(args.case_sensitive === true ? { "-i": false } : {}),
  }),
  // FILE_SEARCH
  8: (args) => ({
    pattern: args.query ?? args.pattern ?? args.search_term ?? args.q ?? "",
  }),
  // WEB_SEARCH — Cursor's native schema varies; accept any plausible field name
  // so that Claude Code's Zod validator (minLength 2 on `query`) doesn't reject.
  18: (args) => ({
    query: args.query ?? args.search_term ?? args.search ?? args.q ?? args.term ?? "",
  }),
  // WEB_VIEWER
  20: (args) => ({
    url: args.url ?? args.uri ?? args.link ?? args.query ?? "",
    prompt: args.prompt ?? args.question ?? args.explanation ?? "Fetch and summarize this page",
  }),
};

// Parse Cursor's apply_patch heredoc format (single-file, single-hunk) and rewrite
// the tool call into a direct Edit/Write that Claude Code CAN execute.
// Cursor's model is trained to emit:
//   apply_patch <<'PATCH'
//   *** Begin Patch
//   *** Update File: path/to/file
//   @@
//   -old line
//   +new line
//    context line
//   *** End Patch
//   PATCH
// This command doesn't exist on the user's shell (exit code 127), so without
// interception the agent loop stalls. We parse the patch and synthesise an Edit
// or Write call. Falls back to the original Bash call if the patch can't be parsed.
function tryParseApplyPatch(command) {
  if (typeof command !== "string" || !command.includes("apply_patch")) return null;
  const m = command.match(/apply_patch\s+<<\s*['"]?PATCH['"]?\s*\n([\s\S]*?)\n\s*PATCH\s*$/);
  if (!m) return null;
  const body = m[1];

  // Strip Begin/End Patch sentinels
  const stripped = body
    .replace(/^\*\*\* Begin Patch\s*\n/, "")
    .replace(/\n\*\*\* End Patch\s*$/, "");

  // Split on "*** Update File:" / "*** Add File:" / "*** Delete File:" headers.
  // Only handle the first operation (Claude Code processes one tool call at a time).
  const headerMatch = stripped.match(/^\*\*\* (Update|Add|Delete) File:\s*(.+?)\s*(?:\n([\s\S]*))?$/);
  if (!headerMatch) return null;
  const [, op, filePath, rest = ""] = headerMatch;

  if (op === "Add") {
    const content = rest
      .split("\n")
      .filter((l) => !l.startsWith("***"))
      .map((l) => (l.startsWith("+") ? l.slice(1) : l))
      .join("\n");
    return { tool: "Write", args: { file_path: filePath, content } };
  }
  if (op === "Delete") {
    return {
      tool: "Bash",
      args: { command: `rm -f ${JSON.stringify(filePath)}`, description: `Delete ${filePath}` },
    };
  }
  // Update: parse hunk lines (- / + / space). Skip "@@" context headers.
  const oldLines = [];
  const newLines = [];
  for (const line of rest.split("\n")) {
    if (line.startsWith("***")) break;
    if (line.startsWith("@@")) continue;
    if (line.startsWith("-")) oldLines.push(line.slice(1));
    else if (line.startsWith("+")) newLines.push(line.slice(1));
    else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
    // unrecognised prefix: ignore (shouldn't happen in well-formed patch)
  }
  if (oldLines.length === 0 && newLines.length === 0) return null;
  return {
    tool: "Edit",
    args: {
      file_path: filePath,
      old_string: oldLines.join("\n"),
      new_string: newLines.join("\n"),
    },
  };
}

function translateNativeArgs(toolEnum, rawArgsStr) {
  const translator = NATIVE_ARG_TRANSLATORS[toolEnum];
  if (!translator || !rawArgsStr) return rawArgsStr;
  let parsed;
  try {
    parsed = JSON.parse(rawArgsStr);
  } catch {
    return rawArgsStr;
  }
  try {
    return JSON.stringify(translator(parsed));
  } catch {
    return rawArgsStr;
  }
}

NATIVE_ARG_TRANSLATORS[15] = NATIVE_ARG_TRANSLATORS[4];

// Inverse of formatToolName() used by encoder:
//   "Read"                      ← "mcp_custom_Read"
//   "mcp__github__create_issue" ← "mcp_github_create_issue"
// Clients (Claude Code/OpenAI) register tools by original name; the mcp_* prefix
// added during encoding must be undone so tool_use name matches the registered name.
function unformatToolName(name) {
  if (typeof name !== "string" || !name.startsWith("mcp_")) return name;
  const tail = name.slice("mcp_".length);
  if (tail.startsWith("custom_")) return tail.slice("custom_".length) || name;
  const splitIdx = tail.indexOf("_");
  if (splitIdx < 0) return name;
  const server = tail.slice(0, splitIdx);
  const tool = tail.slice(splitIdx + 1);
  if (!server || !tool) return name;
  return `mcp__${server}__${tool}`;
}

function extractToolCall(toolCallData) {
  const toolCall = decodeMessage(toolCallData);
  let toolCallId = "";
  let toolName = "";
  let rawArgs = "";
  let isLast = false;
  let nativeToolEnum = 0;
  let mcpServer = "";

  // Extract native tool enum (field 1 of ClientSideToolV2Call) — non-zero for native tools,
  // 19 for MCP. Used to pick a friendly client-side name when Cursor returns a native tool.
  if (toolCall.has(FIELD.CV2C_TOOL)) {
    nativeToolEnum = toolCall.get(FIELD.CV2C_TOOL)[0].value || 0;
  }

  // Extract tool call ID
  if (toolCall.has(FIELD.TOOL_ID)) {
    const fullId = new TextDecoder().decode(toolCall.get(FIELD.TOOL_ID)[0].value);
    toolCallId = fullId.split("\n")[0]; // Cursor returns multi-line ID, take first line
  }

  // Extract tool name
  if (toolCall.has(FIELD.TOOL_NAME)) {
    toolName = new TextDecoder().decode(toolCall.get(FIELD.TOOL_NAME)[0].value);
  }

  // Extract is_last flag
  if (toolCall.has(FIELD.TOOL_IS_LAST)) {
    isLast = toolCall.get(FIELD.TOOL_IS_LAST)[0].value !== 0;
  }

  // Extract MCP params - nested real tool info
  if (toolCall.has(FIELD.TOOL_MCP_PARAMS)) {
    try {
      const mcpParams = decodeMessage(toolCall.get(FIELD.TOOL_MCP_PARAMS)[0].value);
      
      if (mcpParams.has(FIELD.MCP_TOOLS_LIST)) {
        const tool = decodeMessage(mcpParams.get(FIELD.MCP_TOOLS_LIST)[0].value);
        
        if (tool.has(FIELD.MCP_NESTED_NAME)) {
          toolName = new TextDecoder().decode(tool.get(FIELD.MCP_NESTED_NAME)[0].value);
        }

        if (tool.has(FIELD.MCP_NESTED_PARAMS)) {
          rawArgs = new TextDecoder().decode(tool.get(FIELD.MCP_NESTED_PARAMS)[0].value);
        }

        if (tool.has(FIELD.MCP_NESTED_SERVER)) {
          mcpServer = new TextDecoder().decode(tool.get(FIELD.MCP_NESTED_SERVER)[0].value);
        }
      }
    } catch (err) {
      log("EXTRACT", `MCP parse error: ${err.message}`);
    }
  }

  // Fallback to raw_args
  if (!rawArgs && toolCall.has(FIELD.TOOL_RAW_ARGS)) {
    rawArgs = new TextDecoder().decode(toolCall.get(FIELD.TOOL_RAW_ARGS)[0].value);
  }

  if (toolCallId && toolName) {
    // If Cursor returned a native tool enum (not MCP=19), prefer the friendly
    // client-side name ("Read"/"Edit"/…) so Claude Code can execute it directly.
    const nativeName = NATIVE_TOOL_NAME_BY_ENUM[nativeToolEnum];
    // For MCP tools: reconstruct Claude Code naming "mcp__<server>__<tool>" when server != "custom",
    // strip "mcp_custom_" prefix when server == "custom" (or when it's a plain name).
    let mcpName;
    if (!nativeName && mcpServer && mcpServer !== "custom") {
      mcpName = `mcp__${mcpServer}__${toolName}`;
    } else {
      mcpName = unformatToolName(toolName);
    }
    let finalName = nativeName || mcpName;
    // Translate native tool arguments to Claude Code schema (e.g. relative_workspace_path → file_path)
    let finalArgs = nativeName
      ? translateNativeArgs(nativeToolEnum, rawArgs || "{}")
      : (rawArgs || "{}");

    // Intercept Cursor's apply_patch heredoc (emitted via Bash) → rewrite to direct Edit/Write.
    // Without this, the agent loop stalls because `apply_patch` is not a real shell command.
    if (finalName === "Bash" && finalArgs && finalArgs.includes("apply_patch")) {
      try {
        const parsed = JSON.parse(finalArgs);
        const patch = tryParseApplyPatch(parsed.command || "");
        if (patch) {
          finalName = patch.tool;
          finalArgs = JSON.stringify(patch.args);
          log("TOOLCALL", `apply_patch intercepted → rewrote Bash to ${patch.tool}`);
        }
      } catch {
        // leave finalName/finalArgs untouched
      }
    }

    log(
      "TOOLCALL",
      `enum=${nativeToolEnum} rawName="${toolName}" mcpServer="${mcpServer}" → finalName="${finalName}" args=${finalArgs.slice(0, 200)}`
    );
    return {
      id: toolCallId,
      type: "function",
      function: {
        name: finalName,
        arguments: finalArgs
      },
      isLast
    };
  }

  return null;
}

function extractTextAndThinking(responseData) {
  const nested = decodeMessage(responseData);
  let text = null;
  let thinking = null;

  // Extract text
  if (nested.has(FIELD.RESPONSE_TEXT)) {
    text = new TextDecoder().decode(nested.get(FIELD.RESPONSE_TEXT)[0].value);
  }

  // Extract thinking
  if (nested.has(FIELD.THINKING)) {
    try {
      const thinkingMsg = decodeMessage(nested.get(FIELD.THINKING)[0].value);
      if (thinkingMsg.has(FIELD.THINKING_TEXT)) {
        thinking = new TextDecoder().decode(thinkingMsg.get(FIELD.THINKING_TEXT)[0].value);
      }
    } catch (err) {
      log("EXTRACT", `Thinking parse error: ${err.message}`);
    }
  }

  return { text, thinking };
}

export function extractTextFromResponse(payload) {
  try {
    const fields = decodeMessage(payload);

    // Warn about unknown field numbers — may indicate a Cursor protocol update
    for (const fieldNum of fields.keys()) {
      if (!KNOWN_RESPONSE_FIELDS.has(fieldNum)) {
        log(
          "SCHEMA",
          `Unknown response field #${fieldNum} detected. Schema v${PROTOBUF_SCHEMA_VERSION} may be outdated.`
        );
      }
    }

    // Field 1: ClientSideToolV2Call
    if (fields.has(FIELD.TOOL_CALL)) {
      const toolCall = extractToolCall(fields.get(FIELD.TOOL_CALL)[0].value);
      if (toolCall) {
        if (DEBUG) log("DECODE", `toolCall detected: name=${toolCall.function.name} id=${toolCall.id}`);
        log("EXTRACT", `Tool call: ${toolCall.function.name}`);
        return { text: null, error: null, toolCall, thinking: null };
      }
    }

    // Field 2: StreamUnifiedChatResponse
    if (fields.has(FIELD.RESPONSE)) {
      const { text, thinking } = extractTextAndThinking(fields.get(FIELD.RESPONSE)[0].value);
      if ((text || thinking) && DEBUG) {
        log(
          "DECODE",
          `text_chunk=${text ? text.length : 0} thinking_chunk=${thinking ? thinking.length : 0}`
        );
      }

      if (text || thinking) {
        return { text, error: null, toolCall: null, thinking };
      }
    }

    return { text: null, error: null, toolCall: null, thinking: null };
  } catch (err) {
    log("EXTRACT", `Decode failed (schema v${PROTOBUF_SCHEMA_VERSION}): ${err.message}`);
    return {
      text: null,
      error: null,
      toolCall: null,
      thinking: null,
      raw: Buffer.from(payload).toString("base64"),
      decodeError: err.message
    };
  }
}

// ==================== EXPORTS ====================

export default {
  encodeVarint,
  encodeField,
  encodeMessage,
  buildChatRequest,
  wrapConnectRPCFrame,
  generateCursorBody,
  decodeVarint,
  decodeField,
  decodeMessage,
  parseConnectRPCFrame,
  extractTextFromResponse
};
