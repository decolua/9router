/**
 * Kiro to Claude Response Translator
 * Converts Kiro streaming responses to Claude format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

/**
 * Convert Kiro SSE chunk to Claude format
 */
export function kiroToClaudeResponse(chunk) {
  try {
    const data = JSON.parse(chunk);
    
    // Kiro streaming format: { assistantResponseEvent: { content: { text } } }
    if (data.assistantResponseEvent) {
      const event = data.assistantResponseEvent;
      
      // Text content
      if (event.content?.text) {
        return {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: event.content.text
          }
        };
      }
      
      // Tool use
      if (event.content?.toolUse) {
        const toolUse = event.content.toolUse;
        return {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: toolUse.toolUseId,
            name: toolUse.name,
            input: toolUse.input || {}
          }
        };
      }
    }
    
    // Complete message
    if (data.completeAssistantResponse) {
      const response = data.completeAssistantResponse;
      const content = [];
      
      if (response.content?.text) {
        content.push({
          type: "text",
          text: response.content.text
        });
      }
      
      if (response.content?.toolUses) {
        for (const toolUse of response.content.toolUses) {
          content.push({
            type: "tool_use",
            id: toolUse.toolUseId,
            name: toolUse.name,
            input: toolUse.input || {}
          });
        }
      }
      
      return {
        type: "message",
        role: "assistant",
        content: content,
        model: response.modelId || "unknown",
        stop_reason: "end_turn",
        usage: {
          input_tokens: 0,
          output_tokens: 0
        }
      };
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Convert non-streaming Kiro response to Claude format
 */
export function kiroToClaudeNonStreaming(data) {
  const content = [];
  
  if (data.content?.text) {
    content.push({
      type: "text",
      text: data.content.text
    });
  }
  
  if (data.content?.toolUses) {
    for (const toolUse of data.content.toolUses) {
      content.push({
        type: "tool_use",
        id: toolUse.toolUseId,
        name: toolUse.name,
        input: toolUse.input || {}
      });
    }
  }
  
  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content: content,
    model: data.modelId || "unknown",
    stop_reason: "end_turn",
    usage: {
      input_tokens: 0,
      output_tokens: 0
    }
  };
}

// Register translator
register(FORMATS.KIRO, FORMATS.CLAUDE, null, kiroToClaudeResponse);
