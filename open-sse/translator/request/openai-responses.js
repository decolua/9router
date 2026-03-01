/**
 * Translator: OpenAI Responses API → OpenAI Chat Completions
 * 
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { normalizeResponsesInput } from "../helpers/responsesApiHelper.js";

/**
 * Convert OpenAI Responses API request to OpenAI Chat Completions format
 */
export function openaiResponsesToOpenAIRequest(model, body, stream, credentials) {
  if (!body.input) return body;

  const result = { ...body };
  result.messages = [];

  // Convert instructions to system message
  if (body.instructions) {
    result.messages.push({ role: "system", content: body.instructions });
  }

  // Group items by conversation turn
  let currentAssistantMsg = null;
  let pendingToolResults = [];

  const inputItems = normalizeResponsesInput(body.input);
  if (!inputItems) return body;

  for (const item of inputItems) {
    // Determine item type - Droid CLI sends role-based items without 'type' field
    // Fallback: if no type but has role property, treat as message
    const itemType = item.type || (item.role ? "message" : null);

    if (itemType === "message") {
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

      // Convert content: input_text → text, output_text → text
      const content = Array.isArray(item.content)
        ? item.content.map(c => {
          if (c.type === "input_text") return { type: "text", text: c.text };
          if (c.type === "output_text") return { type: "text", text: c.text };
          return c;
        })
        : item.content;
      result.messages.push({ role: item.role, content });
    }
    else if (itemType === "function_call") {
      // Start or append to assistant message with tool_calls
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: "assistant",
          content: null,
          tool_calls: []
        };
      }
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
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output)
      });
    }
    else if (itemType === "reasoning") {
      // Skip reasoning items - they are for display only
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

  // Convert tools format
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools.map(tool => {
      if (tool.function) return tool;
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict
        }
      };
    });
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
 * Convert OpenAI Chat Completions to OpenAI Responses API format
 */
export function openaiToOpenAIResponsesRequest(model, body, stream, credentials) {
  // Body already in Responses API format (e.g. Cursor CLI calling /chat/completions with input[])
  if (body.input) return { ...body, model, stream: true };

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
    if (msg.role === "system") {
      // Use first system message as instructions
      if (!hasSystemMessage) {
        result.instructions = typeof msg.content === "string" ? msg.content : "";
        hasSystemMessage = true;
      }
      continue; // Skip system messages in input
    }

    // Convert user/assistant messages to input items
    if (msg.role === "user" || msg.role === "assistant") {
      const contentType = msg.role === "user" ? "input_text" : "output_text";
      const content = typeof msg.content === "string"
        ? [{ type: contentType, text: msg.content }]
        : Array.isArray(msg.content)
          ? msg.content.map(c => {
            if (c.type === "text") return { type: contentType, text: c.text };
            if (c.type === "image_url") return { type: "image_url", image_url: c.image_url };
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
          type: "message",
          role: msg.role,
          content
        });
      }
    }

    // Convert tool calls
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        result.input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function?.name || "",
          arguments: tc.function?.arguments || "{}"
        });
      }
    }

    // Convert tool results
    if (msg.role === "tool") {
      result.input.push({
        type: "function_call_output",
        call_id: msg.tool_call_id,
        output: msg.content
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
      if (tool.type === "function") {
        return {
          type: "function",
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
          strict: tool.function.strict
        };
      }
      return tool;
    });
  }

  // Pass through other relevant fields
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens;
  if (body.top_p !== undefined) result.top_p = body.top_p;

  return result;
}

// Register both directions
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, openaiResponsesToOpenAIRequest, null);
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, openaiToOpenAIResponsesRequest, null);
