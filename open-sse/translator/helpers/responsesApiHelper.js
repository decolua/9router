/**
 * Normalize Responses API input to array format.
 * Accepts string or array, returns array of message items.
 * An empty array is treated like an empty string — providers require at least one user
 * message, so we inject a placeholder rather than forwarding an empty messages[].
 * @param {string|Array} input - raw input from Responses API body
 * @returns {Array|null} normalized array or null if invalid
 */
export function normalizeResponsesInput(input) {
  if (typeof input === "string") {
    const text = input.trim() === "" ? "..." : input;
    return [{ type: "message", role: "user", content: [{ type: "input_text", text }] }];
  }
  if (Array.isArray(input)) {
    // Empty input[] would produce messages:[] which all providers reject (#389)
    if (input.length === 0) {
      return [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }
    return input;
  }
  return null;
}

/**
 * Convert OpenAI Responses API format to standard chat completions format
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 */
export function convertResponsesApiFormat(body) {
  if (!body.input) return body;

  const result = { ...body };
  result.messages = [];

  // Convert instructions to system message
  if (body.instructions) {
    result.messages.push({ role: "system", content: body.instructions });
  }

  // Group items by conversation turn
  let currentAssistantMsg = null;
  let pendingToolCalls = [];
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

      // Convert content: input_text → text, output_text → text, input_image → image_url
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
      result.messages.push({ role: item.role, content });
    }
    else if (itemType === "function_call" || itemType === "custom_tool_call") {
      // Start or append to assistant message with tool_calls
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: "assistant",
          content: null,
          tool_calls: []
        };
      }
      // Skip items with empty/missing name — upstream APIs reject nameless tool calls (#444)
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") continue;
      // custom_tool_call carries raw freeform `input` — wrap as `{ "input": ... }`
      // so it round-trips through the synthesized function-tool schema (#1371).
      const argsString = itemType === "custom_tool_call"
        ? JSON.stringify({ input: typeof item.input === "string" ? item.input : (item.input ?? "") })
        : (item.arguments ?? "{}");
      currentAssistantMsg.tool_calls.push({
        id: item.call_id,
        type: "function",
        function: {
          name: item.name,
          arguments: argsString
        }
      });
    }
    else if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
      // Flush assistant message first if exists
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Add tool result
      pendingToolResults.push({
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

  // Normalize tools so freeform `custom` tools survive downstream Chat Completions
  // round-tripping (Codex `apply_patch` etc. — see #1371).
  if (Array.isArray(result.tools)) {
    result.tools = normalizeResponsesTools(result.tools);
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
 * Ensure object schema has properties (Chat Completions tool param requirement).
 */
function ensureObjectProperties(params) {
  if (!params) return { type: "object", properties: {} };
  if (params.type === "object" && !params.properties) return { ...params, properties: {} };
  return params;
}

/**
 * Convert a Responses API tools[] array to Chat Completions tools[]:
 *   - Pass through tools that are already in Chat shape (`{ function: {...} }`)
 *   - Drop hosted tools without a `name`
 *   - Convert `{ type: "function", name, parameters, ... }` → Chat function tool
 *   - Convert `{ type: "custom", name, format, ... }` (freeform / `apply_patch`)
 *     into a function tool with a single string `input` parameter so downstream
 *     models that don't support freeform tools still emit the raw payload as
 *     `{"input":"<raw>"}`. The response translator unwraps it back to
 *     `custom_tool_call_input` for the client (#1371).
 */
export function normalizeResponsesTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools
    .map(tool => {
      if (!tool) return null;
      if (tool.function) return tool;
      const name = tool.name;
      if (!name || typeof name !== "string" || name.trim() === "") return null;

      if (tool.type === "custom") {
        const baseDesc = String(tool.description || "");
        return {
          type: "function",
          function: {
            name,
            description: baseDesc
              ? `${baseDesc}\n\nCall this tool by passing the full raw payload as the string parameter "input".`
              : `Call this tool by passing the full raw payload as the string parameter "input".`,
            parameters: {
              type: "object",
              properties: {
                input: {
                  type: "string",
                  description: "Raw text input passed verbatim to the tool."
                }
              },
              required: ["input"]
            }
          }
        };
      }

      return {
        type: "function",
        function: {
          name,
          description: String(tool.description || ""),
          parameters: ensureObjectProperties(tool.parameters),
          strict: tool.strict
        }
      };
    })
    .filter(Boolean);
}
