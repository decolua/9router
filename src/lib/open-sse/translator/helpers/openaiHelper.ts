// OpenAI helper functions for translator

// Valid OpenAI content block types
export const VALID_OPENAI_CONTENT_TYPES = ["text", "image_url", "image"];
export const VALID_OPENAI_MESSAGE_TYPES = ["text", "image_url", "image", "tool_calls", "tool_result"];

// Filter messages to OpenAI standard format
export function filterToOpenAIFormat(body: any) {
  if (!body.messages || !Array.isArray(body.messages)) return body;
  
  body.messages = body.messages.map((msg: any) => {
    // Keep tool messages as-is (OpenAI format)
    if (msg.role === "tool") return msg;
    
    // Keep assistant messages with tool_calls as-is
    if (msg.role === "assistant" && msg.tool_calls) return msg;
    
    // Handle string content
    if (typeof msg.content === "string") return msg;
    
    // Handle array content
    if (Array.isArray(msg.content)) {
      const filteredContent: any[] = [];
      
      for (const block of msg.content) {
        // Skip thinking blocks
        if (block.type === "thinking" || block.type === "redacted_thinking") continue;
        
        // Only keep valid OpenAI content types
        if (VALID_OPENAI_CONTENT_TYPES.includes(block.type)) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { signature, cache_control, ...cleanBlock } = block;
          filteredContent.push(cleanBlock);
        } else if (block.type === "tool_use") {
          continue;
        } else if (block.type === "tool_result") {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  
  // Filter out messages with only empty text
  body.messages = body.messages.filter((msg: any) => {
    if (msg.role === "tool") return true;
    if (msg.role === "assistant" && msg.tool_calls) return true;
    
    if (typeof msg.content === "string") return msg.content.trim() !== "";
    if (Array.isArray(msg.content)) {
      return msg.content.some((b: any) => 
        (b.type === "text" && b.text?.trim()) ||
        b.type !== "text"
      );
    }
    return true;
  });

  // Remove empty tools array
  if (body.tools && Array.isArray(body.tools) && body.tools.length === 0) {
    delete body.tools;
  }

  // Normalize tools to OpenAI format
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    body.tools = body.tools.map((tool: any) => {
      // Already OpenAI format
      if (tool.type === "function" && tool.function) return tool;
      
      // Claude format: {name, description, input_schema}
      if (tool.name && (tool.input_schema || tool.description)) {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: String(tool.description || ""),
            parameters: tool.input_schema || { type: "object", properties: {} }
          }
        };
      }
      
      // Gemini format
      if (tool.functionDeclarations && Array.isArray(tool.functionDeclarations)) {
        return tool.functionDeclarations.map((fn: any) => ({
          type: "function",
          function: {
            name: fn.name,
            description: String(fn.description || ""),
            parameters: fn.parameters || { type: "object", properties: {} }
          }
        }));
      }
      
      return tool;
    }).flat();
  }

  // Normalize tool_choice to OpenAI format
  if (body.tool_choice && typeof body.tool_choice === "object") {
    const choice = body.tool_choice;
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
