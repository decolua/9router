/**
 * Translator: OpenAI Responses API → OpenAI Chat Completions
 * 
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import {
  normalizeResponsesInput,
  clampResponsesCallId,
  coerceResponsesArguments,
  coerceResponsesOutput,
} from "../formats/responsesApi.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index.js";
import {
  CHAT_TOOL_NAME_MAX_LENGTH,
  RESPONSES_TOOL_NAME_MAX_LENGTH,
  allocateToolName,
  isValidToolName,
  sanitizeToolName,
} from "../../utils/toolNameAliases.js";
import { composeToolNameMaps } from "../../utils/opencodeFingerprint.js";

export function sanitizeResponsesToolName(name) {
  return sanitizeToolName(name, RESPONSES_TOOL_NAME_MAX_LENGTH);
}

function responsesToolName(tool) {
  if (tool?.type === OPENAI_BLOCK.FUNCTION) {
    if (typeof tool.function?.name === "string") return tool.function.name;
    return typeof tool.name === "string" ? tool.name : "";
  }
  return typeof tool?.name === "string" ? tool.name : "";
}

function normalizeResponsesToolReferences(result) {
  if (Array.isArray(result.input)) {
    result.input = result.input.map((item) =>
      item?.type === RESPONSES_ITEM.ADDITIONAL_TOOLS && Array.isArray(item.tools)
        ? { ...item, tools: [...item.tools] }
        : item
    );
  }
  const containers = [
    result,
    ...(Array.isArray(result.input)
      ? result.input.filter((item) => item?.type === RESPONSES_ITEM.ADDITIONAL_TOOLS && Array.isArray(item.tools))
      : []),
  ];
  const declarations = containers.flatMap((container) => Array.isArray(container.tools) ? container.tools : []);
  const stableNames = new Set(declarations
    .filter((tool) => [OPENAI_BLOCK.FUNCTION, "custom", "namespace"].includes(tool?.type))
    .map(responsesToolName)
    .filter((name) => isValidToolName(name, RESPONSES_TOOL_NAME_MAX_LENGTH)));
  const usedNames = new Set(stableNames);
  const aliases = new Map();
  const childAliases = new Map();
  const renamed = new Map();
  const aliasFor = (rawName) => {
    if (aliases.has(rawName)) return aliases.get(rawName);
    const alias = isValidToolName(rawName, RESPONSES_TOOL_NAME_MAX_LENGTH)
      ? rawName
      : allocateToolName(rawName, RESPONSES_TOOL_NAME_MAX_LENGTH, usedNames);
    aliases.set(rawName, alias);
    if (alias !== rawName) renamed.set(alias, rawName);
    return alias;
  };

  for (const container of containers) {
    if (!Array.isArray(container.tools)) continue;
    container.tools = container.tools.map((tool) => {
      if (!tool || typeof tool !== "object") return tool;
      if (tool.type === OPENAI_BLOCK.FUNCTION || tool.type === "custom") {
        const rawName = responsesToolName(tool);
        if (!rawName.trim()) return null;
        const alias = aliasFor(rawName);
        if (tool.function) {
          return {
            ...tool,
            ...(typeof tool.name === "string" ? { name: alias } : {}),
            function: { ...tool.function, name: alias },
          };
        }
        return { ...tool, name: alias };
      }
      if (tool.type === "namespace") {
        const rawName = responsesToolName(tool);
        if (!rawName.trim()) return null;
        const children = Array.isArray(tool.tools) ? tool.tools : [];
        const stableChildren = new Set(children
          .map((child) => child?.name)
          .filter((name) => isValidToolName(name, RESPONSES_TOOL_NAME_MAX_LENGTH)));
        const usedChildren = new Set(stableChildren);
        const assignedChildren = new Map();
        const normalizedChildren = children.map((child) => {
          if (!child || typeof child !== "object" || typeof child.name !== "string" || !child.name.trim()) return child;
          let alias = assignedChildren.get(child.name);
          if (!alias) {
            alias = isValidToolName(child.name, RESPONSES_TOOL_NAME_MAX_LENGTH)
              ? child.name
              : allocateToolName(child.name, RESPONSES_TOOL_NAME_MAX_LENGTH, usedChildren);
            assignedChildren.set(child.name, alias);
          }
          if (!childAliases.has(child.name)) childAliases.set(child.name, alias);
          return { ...child, name: alias };
        });
        return { ...tool, name: aliasFor(rawName), tools: normalizedChildren };
      }
      return tool;
    }).filter(Boolean);
  }

  const resolveAlias = (name) => aliases.get(name) || childAliases.get(name) || sanitizeResponsesToolName(name);
  if (Array.isArray(result.input)) {
    result.input = result.input.map((item) => {
      if (!item || typeof item !== "object") return item;
      let modified = item;
      if ((item.type === RESPONSES_ITEM.FUNCTION_CALL || item.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL)
        && typeof item.name === "string") {
        const alias = resolveAlias(item.name);
        if (alias !== item.name) modified = { ...modified, name: alias };
      }
      if (item.call && typeof item.call.name === "string") {
        const alias = resolveAlias(item.call.name);
        if (alias !== item.call.name) modified = { ...modified, call: { ...item.call, name: alias } };
      }
      return modified;
    });
  }
  const choice = result.tool_choice;
  if (choice && typeof choice === "object" && (choice.type === OPENAI_BLOCK.FUNCTION || choice.type === "custom")) {
    const selectedName = typeof choice.name === "string" ? choice.name : choice.function?.name;
    if (typeof selectedName === "string") {
      result.tool_choice = { ...choice, name: resolveAlias(selectedName) };
      delete result.tool_choice.function;
    }
  }
  const combinedMap = composeToolNameMaps(result._toolNameMap, renamed);
  if (combinedMap?.size) result._toolNameMap = combinedMap;
  return result;
}

/**
 * Convert OpenAI Responses API request to OpenAI Chat Completions format
 */
export function openaiResponsesToOpenAIRequest(model, body, stream, credentials) {
  if (!body.input) return body;

  const result = { ...body };
  result.messages = [];

  // Convert instructions to system message
  if (body.instructions) {
    result.messages.push({ role: ROLE.SYSTEM, content: body.instructions });
  }

  // Group items by conversation turn
  let currentAssistantMsg = null;
  let pendingToolResults = [];
  let pendingReasoning = "";
  let pendingReasoningEncrypted = "";
  const additionalTools = [];
  const customToolNames = new Set();

  const inputItems = normalizeResponsesInput(body.input);
  if (!inputItems) return body;

  // Extract reasoning text from summary[].text (encrypted_content is continuity-only)
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

  const attachPendingReasoning = (msg) => {
    if (pendingReasoning) msg.reasoning_content = pendingReasoning;
    if (pendingReasoningEncrypted) msg.encrypted_content = pendingReasoningEncrypted;
    pendingReasoning = "";
    pendingReasoningEncrypted = "";
  };

  for (const item of inputItems) {
    // Determine item type - Droid CLI sends role-based items without 'type' field
    // Fallback: if no type but has role property, treat as message
    const itemType = item.type || (item.role ? RESPONSES_ITEM.MESSAGE : null);

    if (itemType === RESPONSES_ITEM.MESSAGE) {
      // Flush any pending assistant message with tool calls
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Flush pending tool results
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }

      // Convert content: input_text → text, output_text → text, input_image → image_url
      const content = Array.isArray(item.content)
        ? item.content.map(c => {
          if (c.type === RESPONSES_ITEM.INPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.OUTPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.INPUT_IMAGE) {
            const url = c.image_url || c.file_id || "";
            return { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url, detail: c.detail || "auto" } };
          }
          return c;
        })
        : item.content;
      const msg = { role: item.role, content };
      // Attach buffered reasoning to assistant turn (required by xiaomi-mimo + store=false continuity)
      if (item.role === ROLE.ASSISTANT) attachPendingReasoning(msg);
      else {
        pendingReasoning = "";
        pendingReasoningEncrypted = "";
      }
      result.messages.push(msg);
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL || itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL) {
      // Start or append to assistant message with tool_calls
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: ROLE.ASSISTANT,
          content: null,
          tool_calls: []
        };
        attachPendingReasoning(currentAssistantMsg);
      }
      // Skip items with empty/missing name — Codex/OpenAI reject nameless tool calls (#444)
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") continue;
      if (itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL) customToolNames.add(item.name);
      const toolInput = itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL
        ? { input: typeof item.input === "string" ? item.input : JSON.stringify(item.input ?? "") }
        : item.arguments;
      currentAssistantMsg.tool_calls.push({
        id: item.call_id,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: item.name,
          arguments: typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput ?? {})
        }
      });
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT || itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT) {
      // Flush assistant message first if exists
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Flush any pending tool results first
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }
      // Add tool result immediately
      result.messages.push({
        role: ROLE.TOOL,
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output)
      });
    }
    else if (itemType === RESPONSES_ITEM.ADDITIONAL_TOOLS) {
      if (Array.isArray(item.tools)) additionalTools.push(...item.tools);
    }
    else if (itemType === RESPONSES_ITEM.REASONING) {
      // Buffer reasoning text; attached to next assistant message/function_call.
      // Also stash encrypted_content so a later openai→responses hop can restore
      // the store=false continuity blob (Grok CLI / Codex multi-turn).
      const txt = extractReasoningText(item);
      if (txt) pendingReasoning = pendingReasoning ? `${pendingReasoning}\n${txt}` : txt;
      if (typeof item.encrypted_content === "string" && item.encrypted_content) {
        // Prefer attaching to the next assistant message we create
        pendingReasoningEncrypted = item.encrypted_content;
      }
      continue;
    }
  }

  // Flush remaining
  if (currentAssistantMsg) {
    result.messages.push(currentAssistantMsg);
  }
  if (pendingToolResults.length > 0) {
    for (const tr of pendingToolResults) {
      result.messages.push(tr);
    }
  }

  // Convert tools format.
  // Responses API supports "hosted" tools (e.g. { type: "request_user_input" }) that carry no
  // explicit `name` field and cannot be represented as Chat Completions function declarations.
  // Filter them out to avoid sending nameless functionDeclarations to downstream providers
  // such as Gemini, which strictly validates function names.
  // Codex groups callable tools under namespaces. Only tools loaded through
  // additional_tools are callable when defer_loading is set.
  const expandTools = (declarations, includeDeferred) => declarations.flatMap((group) => {
    if (!group || typeof group !== "object") return [];
    const isNamespace = group.type === "namespace";
    if (isNamespace && (typeof group.name !== "string" || !group.name.trim())) return [];
    const children = isNamespace ? (Array.isArray(group.tools) ? group.tools : []) : [group];
    const owner = isNamespace ? group.name : null;
    return children
      .filter((tool) => tool && (includeDeferred || tool.defer_loading !== true))
      .map((tool) => ({ tool, owner }));
  });
  const callableTools = [
    ...expandTools(Array.isArray(body.tools) ? body.tools : [], false),
    ...expandTools(additionalTools, true),
  ];
  const convertTool = (tool) => {
    // Already in Chat Completions format: { type: "function", function: { name, ... } }
    if (tool.function) return tool;
    // Responses API function/custom tool: { type, name, description, parameters|format }.
    // Hosted tools and namespace containers cannot become Chat functions.
    if (tool.type && tool.type !== "function" && tool.type !== "custom") return null;
    const name = tool.name;
    if (!name || typeof name !== "string" || name.trim() === "") return null;
    if (tool.type === "custom") {
      const formatHint = [tool.format?.syntax, tool.format?.definition].filter(Boolean).join("\n");
      return {
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name,
          description: [String(tool.description || ""), formatHint].filter(Boolean).join("\n\n"),
          parameters: {
            type: "object",
            properties: {
              input: {
                type: "string",
                description: "Raw freeform input for this custom tool"
              }
            },
            required: ["input"],
            additionalProperties: false
          }
        }
      };
    }
    return {
      type: OPENAI_BLOCK.FUNCTION,
      function: {
        name,
        description: String(tool.description || ""),
        parameters: normalizeToolParameters(tool.parameters),
        strict: tool.strict
      }
    };
  };
  if (callableTools.length > 0) {
    const declarations = [];
    const seenIdentities = new Map();
    for (const { tool, owner } of callableTools) {
      const converted = convertTool(tool);
      const name = converted?.function?.name;
      if (typeof name !== "string" || !name.trim()) continue;
      const originalName = owner === null ? name : `${owner}__${name}`.replace(/[^A-Za-z0-9_-]/g, '_');
      const entry = { converted, name, owner, originalName, custom: tool.type === "custom" };
      const declarationKey = `${owner ?? ""}::${name}`;
      const previousIndex = seenIdentities.get(declarationKey);
      if (previousIndex !== undefined) declarations[previousIndex] = entry;
      else {
        seenIdentities.set(declarationKey, declarations.length);
        declarations.push(entry);
      }
    }

    // Chat function names cannot contain dots and are limited to 64 characters.
    // Keep the namespace visible to the model, then map every sent alias back to
    // Codex's fully qualified tool name on the response path.
    const stableTopLevelNames = new Set(declarations
      .filter(({ owner, name }) => owner === null && isValidToolName(name, CHAT_TOOL_NAME_MAX_LENGTH))
      .map(({ name }) => name));
    const usedNames = new Set(stableTopLevelNames);
    const originalToAlias = new Map();
    const toolNameMap = new Map();
    result.tools = declarations.map(({ converted, name, owner, originalName, custom }) => {
      const sentName = owner === null && stableTopLevelNames.has(name)
        ? name
        : allocateToolName(originalName, CHAT_TOOL_NAME_MAX_LENGTH, usedNames);
      if (owner !== null || sentName !== name) toolNameMap.set(sentName, originalName);
      originalToAlias.set(originalName, sentName);
      if (owner !== null) {
        originalToAlias.set(`${owner}.${name}`, sentName);
      }
      if (custom) customToolNames.add(sentName);
      return { ...converted, function: { ...converted.function, name: sentName } };
    });

    for (const message of result.messages) {
      if (message.role !== ROLE.ASSISTANT || !Array.isArray(message.tool_calls)) continue;
      for (const call of message.tool_calls) {
        const originalName = call.function?.name;
        if (originalToAlias.has(originalName)) {
          call.function.name = originalToAlias.get(originalName);
        } else if (typeof call.function?.name === "string" && !/^[a-zA-Z0-9_-]+$/.test(call.function.name)) {
          call.function.name = sanitizeToolName(call.function.name, CHAT_TOOL_NAME_MAX_LENGTH);
        }
      }
    }
    const selectedName = result.tool_choice?.function?.name || result.tool_choice?.name;
    if (originalToAlias.has(selectedName)) {
      result.tool_choice = {
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: originalToAlias.get(selectedName) }
      };
    }
    if (toolNameMap.size > 0) result._toolNameMap = toolNameMap;
  } else if (Array.isArray(body.tools) && body.tools.length > 0) {
    result.tools = [];
  }
  if (customToolNames.size > 0) result._customToolNames = [...customToolNames];

  // Cleanup Responses API specific fields
  // Map Responses-only max_output_tokens to Chat max_tokens (avoid leaking unknown field upstream)
  if (result.max_output_tokens !== undefined) {
    if (result.max_tokens === undefined) result.max_tokens = result.max_output_tokens;
    delete result.max_output_tokens;
  }

  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  if (typeof result.reasoning?.effort === "string") {
    result.reasoning_effort = result.reasoning.effort;
  }
  delete result.reasoning;
  delete result.client_metadata;

  return result;
}

/**
 * Extract plain text from a system/developer message for Responses instructions.
 * Array content (text parts) is joined; anything else falls back to "" rather
 * than leaking "[object Object]" upstream.
 */
function extractInstructionsText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (typeof c?.text === "string") return c.text;
      if (typeof c?.content === "string") return c.content;
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

/**
 * Ensure object schema always has properties field (required by Codex Responses API)
 */
function normalizeToolParameters(params) {
  if (!params) return { type: "object", properties: {} };
  if (params.type === "object" && !params.properties) return { ...params, properties: {} };
  return params;
}

/**
 * Build a Responses `reasoning` input item from Chat Completions assistant fields.
 * Preserves encrypted blobs needed by store=false multi-turn (Grok CLI / Codex).
 * Returns null when the message has nothing useful to re-send.
 */
function buildReasoningInputItem(msg) {
  if (!msg || typeof msg !== "object") return null;

  const encrypted =
    (typeof msg.encrypted_content === "string" && msg.encrypted_content) ||
    (typeof msg.reasoning_encrypted_content === "string" && msg.reasoning_encrypted_content) ||
    (typeof msg.reasoning?.encrypted_content === "string" && msg.reasoning.encrypted_content) ||
    "";

  let summaryText = "";
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) {
    summaryText = msg.reasoning_content;
  } else if (typeof msg.reasoning === "string" && msg.reasoning.trim()) {
    summaryText = msg.reasoning;
  } else if (Array.isArray(msg.reasoning_details)) {
    summaryText = msg.reasoning_details
      .map((d) => (typeof d?.text === "string" ? d.text : typeof d?.content === "string" ? d.content : ""))
      .filter(Boolean)
      .join("\n");
  }

  if (!encrypted && !summaryText) return null;

  const item = { type: RESPONSES_ITEM.REASONING };
  if (summaryText) {
    item.summary = [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: summaryText }];
  }
  // encrypted_content is the continuity token for store=false backends
  if (encrypted) item.encrypted_content = encrypted;
  return item;
}

/**
 * Convert OpenAI Chat Completions to OpenAI Responses API format
 */
export function openaiToOpenAIResponsesRequest(model, body, stream, credentials) {
  // Body already in Responses API format (e.g. Cursor CLI calling /chat/completions with input[])
  if (body.input) {
    const out = { ...body, model, stream: true };
    if (out.max_output_tokens === undefined) {
      if (out.max_completion_tokens !== undefined) out.max_output_tokens = out.max_completion_tokens;
      else if (out.max_tokens !== undefined) out.max_output_tokens = out.max_tokens;
    }
    delete out.max_tokens;
    delete out.max_completion_tokens;
    return normalizeResponsesToolReferences(out);
  }

  const result = {
    model,
    input: [],
    stream: true,
    store: false
  };

  // Extract system message as instructions
  let hasSystemMessage = false;
  const messages = body.messages || [];

  for (const msg of messages) {
    if (msg.role === ROLE.SYSTEM || msg.role === ROLE.DEVELOPER) {
      // Use the first instruction-bearing message as instructions.
      // OpenAI recommends role="developer" for GPT-5/Codex as the system-level prompt.
      if (!hasSystemMessage) {
        result.instructions = extractInstructionsText(msg.content);
        hasSystemMessage = true;
      }
      continue; // Skip instruction messages in input
    }

    // Convert user/assistant messages to input items
    if (msg.role === ROLE.USER || msg.role === ROLE.ASSISTANT) {
      // Multi-turn continuity for store=false Responses backends (Codex / Grok CLI):
      // re-emit a reasoning item before the assistant message when the chat-format
      // history carried reasoning text and/or encrypted_content from a prior turn.
      if (msg.role === ROLE.ASSISTANT) {
        const reasoningItem = buildReasoningInputItem(msg);
        if (reasoningItem) result.input.push(reasoningItem);
      }

      const contentType = msg.role === ROLE.USER ? RESPONSES_ITEM.INPUT_TEXT : RESPONSES_ITEM.OUTPUT_TEXT;
      const content = typeof msg.content === "string"
        ? [{ type: contentType, text: msg.content }]
        : Array.isArray(msg.content)
          ? msg.content.map(c => {
            if (c.type === OPENAI_BLOCK.TEXT) return { type: contentType, text: c.text };
            // Convert Chat Completions image_url → Responses API input_image
            // Responses API expects: { type: "input_image", image_url: "<url string>" }
            // Chat Completions sends: { type: "image_url", image_url: { url: "...", detail: "..." } }
            if (c.type === OPENAI_BLOCK.IMAGE_URL) {
              const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url;
              return { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: url, detail: c.image_url?.detail || "auto" };
            }
            if (c.type === RESPONSES_ITEM.INPUT_IMAGE) return c;
            // Serialize any unknown type (tool_use, tool_result, thinking, etc.) as text
            const text = c.text || c.content || JSON.stringify(c);
            return { type: contentType, text: typeof text === "string" ? text : JSON.stringify(text) };
          })
          : [];

      // Only push a message block if content is non-empty.
      // Assistant messages with only tool_calls have content: null — skip the
      // message block in that case; the tool_calls are pushed separately below.
      if (content.length > 0) {
        result.input.push({
          type: RESPONSES_ITEM.MESSAGE,
          role: msg.role,
          content
        });
      }
    }

    // Convert tool calls
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        // Skip nameless calls — strict Responses upstreams reject them (#444)
        const name = typeof tc.function?.name === "string" ? tc.function.name.trim() : "";
        if (!name) continue;
        result.input.push({
          type: RESPONSES_ITEM.FUNCTION_CALL,
          call_id: clampResponsesCallId(tc.id),
          name,
          arguments: coerceResponsesArguments(tc.function?.arguments)
        });
      }
    }

    // Convert tool results - output must be a string for Responses API
    if (msg.role === ROLE.TOOL) {
      result.input.push({
        type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
        call_id: clampResponsesCallId(msg.tool_call_id),
        output: coerceResponsesOutput(msg.content)
      });
    }
  }

  // If no system message, leave instructions empty (will be filled by executor)
  if (!hasSystemMessage) {
    result.instructions = "";
  }

  // Convert tools format
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools.map(tool => {
      if (tool.type === OPENAI_BLOCK.FUNCTION) {
        // Strict upstreams reject nameless/overlong tool declarations
        const name = typeof tool.function?.name === "string" ? tool.function.name.trim() : (typeof tool.name === "string" ? tool.name.trim() : "");
        if (!name) return null;
        const description = String(tool.function?.description ?? tool.description ?? "");
        const parameters = normalizeToolParameters(tool.function?.parameters ?? tool.parameters);
        const strict = tool.function?.strict ?? tool.strict;
        return {
          type: OPENAI_BLOCK.FUNCTION,
          name,
          description,
          parameters,
          strict
        };
      }
      if (tool.type === "custom") {
        const name = typeof tool.name === "string" ? tool.name.trim() : "";
        if (!name) return null;
        return { ...tool, name };
      }
      return tool;
    }).filter(Boolean);
  }
  if (body.tool_choice !== undefined) result.tool_choice = body.tool_choice;

  // Pass through other relevant fields
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.max_output_tokens !== undefined) {
    result.max_output_tokens = body.max_output_tokens;
  } else if (body.max_completion_tokens !== undefined) {
    result.max_output_tokens = body.max_completion_tokens;
  } else if (body.max_tokens !== undefined) {
    result.max_output_tokens = body.max_tokens;
  }
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.reasoning !== undefined) result.reasoning = body.reasoning;
  if (body.reasoning_effort !== undefined) result.reasoning = { effort: body.reasoning_effort, summary: "auto" };
  if (body.service_tier !== undefined) result.service_tier = body.service_tier;
  if (body.prompt_cache_key !== undefined) result.prompt_cache_key = body.prompt_cache_key;

  return normalizeResponsesToolReferences(result);
}

// Register both directions
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, openaiResponsesToOpenAIRequest, null);
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, openaiToOpenAIResponsesRequest, null);
