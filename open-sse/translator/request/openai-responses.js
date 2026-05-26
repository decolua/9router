/**
 * Translator: OpenAI Responses API ↔ OpenAI Chat Completions
 * 
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 * 
 * This file handles:
 *   Responses → Chat:  flatten namespace tools, convert custom_tool_call tool_choice
 *   Chat → Responses:  preserve namespace info for round-trip
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { normalizeResponsesInput } from "../helpers/responsesApiHelper.js";

// Responses API enforces max 64 chars on call_id (#393)
const MAX_CALL_ID_LEN = 64;
const clampCallId = (id) => (typeof id === "string" && id.length > MAX_CALL_ID_LEN ? id.substring(0, MAX_CALL_ID_LEN) : id);

/**
 * Qualify a tool name with its namespace for Chat Completions flattening.
 *   qualifyToolName("mcp__api_request__", "send_api_request")
 *   → "mcp__api_request__send_api_request"
 */
function qualifyToolName(ns, name) {
  if (!ns || !name) return name;
  if (ns.startsWith("mcp__") && ns.endsWith("__")) return ns + name;
  return "mcp__" + ns + "__" + name;
}

/**
 * Decode a flat Chat Completions tool name back into { name, ns }.
 *   decodeToolName("mcp__api_request__send_api_request")
 *   → { name: "send_api_request", ns: "mcp__api_request__" }
 */
function decodeToolName(flat) {
  if (!flat || !flat.startsWith("mcp__")) return { name: flat || "", ns: "" };
  const rest = flat.slice(5);
  const idx = rest.indexOf("__");
  if (idx > 0) {
    const server = rest.slice(0, idx);
    const tool = rest.slice(idx + 2);
    return { name: tool, ns: "mcp__" + server + "__" };
  }
  return { name: flat, ns: "" };
}

/**
 * Convert Responses API tool_choice (including custom_tool_call with namespace)
 * to Chat Completions format.
 */
function convertToolChoice(choice) {
  if (!choice || typeof choice === "string") return choice;
  if (choice.type === "function") {
    return { type: "function", function: { name: choice.name } };
  }
  if (choice.type === "custom_tool_call") {
    const ns = choice.namespace;
    const name = choice.name;
    if (ns && name) {
      return { type: "function", function: { name: qualifyToolName(ns, name) } };
    }
    if (name) return { type: "function", function: { name } };
  }
  return choice;
}

/**
 * Ensure object schema always has properties field (required by Codex Responses API).
 */
function normalizeToolParameters(params) {
  if (!params) return { type: "object", properties: {} };
  if (params.type === "object" && !params.properties) return { ...params, properties: {} };
  return params;
}

/**
 * Deduplicate tools with the same flat function name, keeping the longest description.
 */
function deduplicateTools(tools) {
  const map = new Map();
  for (const tool of tools) {
    const key = tool.function && tool.function.name;
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, tool);
    } else {
      const existingDesc = (existing.function && existing.function.description) || "";
      const newDesc = (tool.function && tool.function.description) || "";
      if (newDesc.length > existingDesc.length) {
        existing.function.description = newDesc;
      }
    }
  }
  return [...map.values()];
}

/**
 * Convert OpenAI Responses API request to OpenAI Chat Completions format.
 * Handles namespace tools, custom_tool_call tool_choice, and MCP tool name round-trip.
 */
export function openaiResponsesToOpenAIRequest(model, body, stream, credentials) {
  if (!body.input) return body;

  const result = { ...body };

  // Namespace mapping for tool name round-trip (used downstream)
  const _toolNameNSMap = {};
  result._toolNameNSMap = _toolNameNSMap;

  result.messages = [];

  // Convert instructions to system message
  if (body.instructions) {
    result.messages.push({ role: "system", content: body.instructions });
  }

  // Group items by conversation turn
  let currentAssistantMsg = null;
  let pendingToolResults = [];
  let pendingReasoning = "";

  const inputItems = normalizeResponsesInput(body.input);
  if (!inputItems) return body;

  // Extract reasoning text from summary[].text or encrypted_content fallback
  const extractReasoningText = (item) => {
    if (Array.isArray(item.summary)) {
      const txt = item.summary.map(s => s?.text || "").filter(Boolean).join("\n");
      if (txt) return txt;
    }
    if (Array.isArray(item.content)) {
      const txt = item.content.map(c => c?.text || "").filter(Boolean).join("\n");
      if (txt) return txt;
    }
    return "";
  };

  for (const item of inputItems) {
    const itemType = item.type || (item.role ? "message" : null);

    if (itemType === "message") {
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }

      const content = Array.isArray(item.content)
        ? item.content.map(c => {
            if (c.type === "input_text") return { type: "text", text: c.text };
            if (c.type === "output_text") return { type: "text", text: c.text };
            if (c.type === "input_image") {
              const url = c.image_url || c.file_id || "";
              return { type: "image_url", image_url: { url, detail: c.detail || "auto" } };
            }
            return c;
          })
        : item.content;
      const msg = { role: item.role, content };
      // Attach buffered reasoning to assistant turn (required by xiaomi-mimo thinking mode)
      if (item.role === "assistant" && pendingReasoning) {
        msg.reasoning_content = pendingReasoning;
      }
      pendingReasoning = "";
      result.messages.push(msg);
    }
    else if (itemType === "function_call") {
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: "assistant",
          content: null,
          tool_calls: []
        };
        if (pendingReasoning) {
          currentAssistantMsg.reasoning_content = pendingReasoning;
          pendingReasoning = "";
        }
      }
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") continue;
      currentAssistantMsg.tool_calls.push({
        id: item.call_id,
        type: "function",
        function: {
          name: item.name,
          arguments: item.arguments
        }
      });
    }
    else if (itemType === "function_call_output") {
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }
      result.messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output)
      });
    }
    else if (itemType === "reasoning") {
      // Buffer reasoning text; attached to next assistant message/function_call
      const txt = extractReasoningText(item);
      if (txt) pendingReasoning = pendingReasoning ? `${pendingReasoning}\n${txt}` : txt;
      continue;
    }
  }

  if (currentAssistantMsg) {
    result.messages.push(currentAssistantMsg);
  }
  if (pendingToolResults.length > 0) {
    for (const tr of pendingToolResults) {
      result.messages.push(tr);
    }
  }

  // ── Convert tools format ──
  // Responses API namespace type + explicit namespace field → Chat Completions flat functions
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {
      // type: "namespace" - flatten nested tools with qualified names
      if (tool.type === "namespace") {
        const ns = tool.name;
        if (!ns || !Array.isArray(tool.tools)) continue;
        for (const inner of tool.tools) {
          const innerName = inner.name || (inner.function && inner.function.name);
          if (!innerName || typeof innerName !== "string" || innerName.trim() === "") continue;
          const flat = qualifyToolName(ns, innerName);
          _toolNameNSMap[flat] = { ns, name: innerName };
          const desc = String(inner.description || (inner.function && inner.function.description) || "");
          const params = normalizeToolParameters(inner.parameters || (inner.function && inner.function.parameters));
          result.tools.push({
            type: "function",
            function: { name: flat, description: desc, parameters: params }
          });
        }
        continue;
      }

      // Tool with explicit namespace field
      if (tool.namespace) {
        const innerName = tool.name || (tool.function && tool.function.name);
        if (!innerName || typeof innerName !== "string" || innerName.trim() === "") continue;
        const flat = qualifyToolName(tool.namespace, innerName);
        _toolNameNSMap[flat] = { ns: tool.namespace, name: innerName };
        const fn = tool.function || {};
        result.tools.push({
          type: "function",
          function: {
            name: flat,
            description: String(tool.description || fn.description || ""),
            parameters: normalizeToolParameters(tool.parameters || fn.parameters),
            strict: tool.strict || fn.strict
          }
        });
        continue;
      }

      // Already in Chat Completions format
      if (tool.function) {
        result.tools.push(tool);
        continue;
      }

      // Responses API function tool
      const name = tool.name;
      if (!name || typeof name !== "string" || name.trim() === "") continue;
      result.tools.push({
        type: "function",
        function: {
          name,
          description: String(tool.description || ""),
          parameters: normalizeToolParameters(tool.parameters),
          strict: tool.strict
        }
      });
    }

    // Dedup: when namespace expansion produces multiple entries for the same flat name
    if (result.tools.length > 0) {
      result.tools = deduplicateTools(result.tools);
    }
  }

  // ── Convert tool_choice (required for custom_tool_call namespace routing) ──
  if (body.tool_choice) {
    result.tool_choice = convertToolChoice(body.tool_choice);
  }

  // Cleanup Responses API specific fields
  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  delete result.reasoning;

  return result;
}

/**
 * Convert Chat Completions request back to Responses API format.
 * Used when Chat Completions body comes in but the provider expects Responses API.
 */
export function openaiToOpenAIResponsesRequest(model, body, stream, credentials) {
  if (body.input) return { ...body, model, stream: true };

  const result = {
    model,
    input: [],
    stream: true,
    store: false
  };

  let hasSystemMessage = false;
  const messages = body.messages || [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (!hasSystemMessage) {
        result.instructions = typeof msg.content === "string" ? msg.content : "";
        hasSystemMessage = true;
      }
      continue;
    }

    if (msg.role === "user" || msg.role === "assistant") {
      const contentType = msg.role === "user" ? "input_text" : "output_text";
      const content = typeof msg.content === "string"
        ? [{ type: contentType, text: msg.content }]
        : Array.isArray(msg.content)
          ? msg.content.map(c => {
              if (c.type === "text") return { type: contentType, text: c.text };
              if (c.type === "image_url") {
                const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url;
                return { type: "input_image", image_url: url, detail: c.image_url?.detail || "auto" };
              }
              if (c.type === "input_image") return c;
              const text = c.text || c.content || JSON.stringify(c);
              return { type: contentType, text: typeof text === "string" ? text : JSON.stringify(text) };
            })
          : [];

      if (content.length > 0) {
        result.input.push({ type: "message", role: msg.role, content });
      }
    }

    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        result.input.push({
          type: "function_call",
          call_id: clampCallId(tc.id),
          name: tc.function?.name || "_unknown",
          arguments: tc.function?.arguments || "{}"
        });
      }
    }

    if (msg.role === "tool") {
      const output = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map(c => c.text || JSON.stringify(c)).join("")
          : JSON.stringify(msg.content);
      result.input.push({
        type: "function_call_output",
        call_id: clampCallId(msg.tool_call_id),
        output
      });
    }
  }

  if (!hasSystemMessage) result.instructions = "";

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools.map(tool => {
      if (tool.type === "function") {
        return {
          type: "function",
          name: tool.function.name,
          description: String(tool.function.description || ""),
          parameters: normalizeToolParameters(tool.function.parameters),
          strict: tool.function.strict
        };
      }
      return tool;
    });
  }

  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens;
  if (body.top_p !== undefined) result.top_p = body.top_p;

  return result;
}

// ── Register both directions ──
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, openaiResponsesToOpenAIRequest, null);
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, openaiToOpenAIResponsesRequest, null);
