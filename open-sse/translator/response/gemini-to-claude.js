/**
 * Gemini to Claude Response Translator
 * Converts Gemini CLI streaming responses to Claude format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

/**
 * Convert Gemini SSE chunk to Claude format
 */
export function geminiToClaudeResponse(chunk) {
  try {
    const data = JSON.parse(chunk);
    
    // Gemini streaming format: { candidates: [{ content: { parts: [] } }] }
    if (data.candidates && data.candidates.length > 0) {
      const candidate = data.candidates[0];
      const parts = candidate.content?.parts || [];
      
      for (const part of parts) {
        // Text content
        if (part.text) {
          return {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: part.text
            }
          };
        }
        
        // Function call (tool use)
        if (part.functionCall) {
          return {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: part.functionCall.id || `call_${Date.now()}`,
              name: part.functionCall.name,
              input: part.functionCall.args || {}
            }
          };
        }
      }
    }
    
    // Complete message
    if (data.candidates && data.candidates.length > 0) {
      const candidate = data.candidates[0];
      const parts = candidate.content?.parts || [];
      const content = [];
      
      for (const part of parts) {
        if (part.text) {
          content.push({
            type: "text",
            text: part.text
          });
        }
        
        if (part.functionCall) {
          content.push({
            type: "tool_use",
            id: part.functionCall.id || `call_${Date.now()}`,
            name: part.functionCall.name,
            input: part.functionCall.args || {}
          });
        }
      }
      
      if (content.length > 0) {
        return {
          type: "message",
          role: "assistant",
          content: content,
          model: data.modelVersion || "unknown",
          stop_reason: candidate.finishReason === "STOP" ? "end_turn" : "max_tokens",
          usage: {
            input_tokens: data.usageMetadata?.promptTokenCount || 0,
            output_tokens: data.usageMetadata?.candidatesTokenCount || 0
          }
        };
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Convert non-streaming Gemini response to Claude format
 */
export function geminiToClaudeNonStreaming(data) {
  const content = [];
  
  if (data.candidates && data.candidates.length > 0) {
    const candidate = data.candidates[0];
    const parts = candidate.content?.parts || [];
    
    for (const part of parts) {
      if (part.text) {
        content.push({
          type: "text",
          text: part.text
        });
      }
      
      if (part.functionCall) {
        content.push({
          type: "tool_use",
          id: part.functionCall.id || `call_${Date.now()}`,
          name: part.functionCall.name,
          input: part.functionCall.args || {}
        });
      }
    }
  }
  
  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content: content,
    model: data.modelVersion || "unknown",
    stop_reason: "end_turn",
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount || 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount || 0
    }
  };
}

// Register translator
register(FORMATS.GEMINI_CLI, FORMATS.CLAUDE, null, geminiToClaudeResponse);
register(FORMATS.GEMINI, FORMATS.CLAUDE, null, geminiToClaudeResponse);
