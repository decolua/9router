// OpenAI helper functions for translator

// Valid OpenAI content block types
export const VALID_OPENAI_CONTENT_TYPES = ["text", "image_url", "image"];
export const VALID_OPENAI_MESSAGE_TYPES = ["text", "image_url", "image", "tool_calls", "tool_result"];

// Filter messages to OpenAI standard format
// Remove: thinking, redacted_thinking, signature, and other non-OpenAI blocks
export function filterToOpenAIFormat(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;
  
  body.messages = body.messages.map(msg => {
    // Keep tool messages as-is (OpenAI format)
    if (msg.role === "tool") return msg;
    
    // Keep assistant messages with tool_calls as-is
    if (msg.role === "assistant" && msg.tool_calls) return msg;
    
    // Handle string content
    if (typeof msg.content === "string") return msg;
    
    // Handle array content
    if (Array.isArray(msg.content)) {
      const filteredContent = [];
      
      for (const block of msg.content) {
        // Skip thinking blocks
        if (block.type === "thinking" || block.type === "redacted_thinking") continue;
        
        // Only keep valid OpenAI content types
        if (VALID_OPENAI_CONTENT_TYPES.includes(block.type)) {
          // Remove signature field if exists
          const { signature, cache_control, ...cleanBlock } = block;
          filteredContent.push(cleanBlock);
        } else if (block.type === "tool_use") {
          // Convert tool_use to tool_calls format (handled separately)
          continue;
        } else if (block.type === "tool_result") {
          // Keep tool_result but clean it
          const { signature, cache_control, ...cleanBlock } = block;
          filteredContent.push(cleanBlock);
        }
      }
      
      // If all content was filtered, add empty text
      if (filteredContent.length === 0) {
        filteredContent.push({ type: "text", text: "" });
      }
      
      return { ...msg, content: filteredContent };
    }
    
    return msg;
  });
  
  // Filter out messages with only empty text (but NEVER filter tool messages)
  body.messages = body.messages.filter(msg => {
    // Always keep tool messages
    if (msg.role === "tool") return true;
    // Always keep assistant messages with tool_calls
    if (msg.role === "assistant" && msg.tool_calls) return true;
    
    if (typeof msg.content === "string") return msg.content.trim() !== "";
    if (Array.isArray(msg.content)) {
      return msg.content.some(b => 
        (b.type === "text" && b.text?.trim()) ||
        b.type !== "text"
      );
    }
    return true;
  });

  // Remove empty tools array (some providers like QWEN reject it)
  if (body.tools && Array.isArray(body.tools) && body.tools.length === 0) {
    delete body.tools;
  }

  // Normalize tools to OpenAI format (from Claude, Gemini, etc.)
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    body.tools = body.tools.map(tool => {
      // Already OpenAI format
      if (tool.type === "function" && tool.function) return tool;
      
      // Claude format: {name, description, input_schema}
      if (tool.name && (tool.input_schema || tool.description)) {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description || "",
            parameters: coerceSchemaNumericConstraints(tool.input_schema || { type: "object", properties: {} })
          }
        };
      }
      
      // Gemini format: {functionDeclarations: [{name, description, parameters}]}
      if (tool.functionDeclarations && Array.isArray(tool.functionDeclarations)) {
        return tool.functionDeclarations.map(fn => ({
          type: "function",
          function: {
            name: fn.name,
            description: fn.description || "",
            parameters: coerceSchemaNumericConstraints(fn.parameters || { type: "object", properties: {} })
          }
        }));
      }
      
      return tool;
    }).flat();
  }

  // Normalize tool_choice to OpenAI format
  if (body.tool_choice && typeof body.tool_choice === "object") {
    const choice = body.tool_choice;
    // Claude format: {type: "auto|any|tool", name?: "..."}
    if (choice.type === "auto") {
      body.tool_choice = "auto";
    } else if (choice.type === "any") {
      body.tool_choice = "required";
    } else if (choice.type === "tool" && choice.name) {
      body.tool_choice = { type: "function", function: { name: choice.name } };
    }
  }

  return body;
}

// JSON Schema keywords whose values must be integers (not strings)
const NUMERIC_SCHEMA_KEYWORDS = [
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "minItems", "maxItems",
  "minProperties", "maxProperties", "multipleOf"
];

/**
 * Recursively coerce string numeric values for integer-typed JSON Schema keywords.
 * Fixes errors like: '[codex] Invalid schema: '64' is not of type 'integer''
 * when MCP tools or clients serialize numeric constraints as strings.
 */
export function coerceSchemaNumericConstraints(schema) {
  if (!schema || typeof schema !== "object") return schema;

  if (Array.isArray(schema)) {
    for (const item of schema) coerceSchemaNumericConstraints(item);
    return schema;
  }

  for (const key of NUMERIC_SCHEMA_KEYWORDS) {
    if (typeof schema[key] === "string") {
      const parsed = Number(schema[key]);
      if (!isNaN(parsed)) schema[key] = parsed;
    }
  }

  // Recurse into nested schemas
  for (const value of Object.values(schema)) {
    if (value && typeof value === "object") {
      coerceSchemaNumericConstraints(value);
    }
  }

  return schema;
}

