import { register } from "../index.js";
import { FORMATS } from "../formats.js";

// Convert Gemini response chunk to OpenAI format
function geminiToOpenAIResponse(chunk, state) {
  if (!chunk) return null;

  // Handle Antigravity wrapper
  const response = chunk.response || chunk;

  // Debug logging for empty responses
  if (!response || !response.candidates?.[0]) {
    console.log("[DEBUG] gemini-to-openai: Empty response received");
    console.log("[DEBUG] chunk:", JSON.stringify(chunk).slice(0, 500));
    return null;
  }

  const results = [];
  const candidate = response.candidates[0];
  const content = candidate.content;

  // Initialize state
  if (!state.messageId) {
    state.messageId = response.responseId || `msg_${Date.now()}`;
    state.model = response.modelVersion || "gemini";
    state.functionIndex = 0;
    results.push({
      id: `chatcmpl-${state.messageId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [{
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null
      }]
    });
  }

  // Process parts
  if (content?.parts) {
    for (const part of content.parts) {
      const hasThoughtSig = part.thoughtSignature || part.thought_signature;
      const isThought = part.thought === true;
      
      // Handle thought signature (thinking mode)
      if (hasThoughtSig) {
        const hasTextContent = part.text !== undefined && part.text !== "";
        const hasFunctionCall = !!part.functionCall;
        
        if (hasTextContent) {
          results.push({
            id: `chatcmpl-${state.messageId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: state.model,
            choices: [{
              index: 0,
              delta: isThought 
                ? { reasoning_content: part.text }
                : { content: part.text },
              finish_reason: null
            }]
          });
        }
        
        if (hasFunctionCall) {
          const fcName = part.functionCall.name;
          const fcArgs = part.functionCall.args || {};
          const toolCallIndex = state.functionIndex++;
          
          const toolCall = {
            id: `${fcName}-${Date.now()}-${toolCallIndex}`,
            index: toolCallIndex,
            type: "function",
            function: {
              name: fcName,
              arguments: JSON.stringify(fcArgs)
            }
          };
          
          state.toolCalls.set(toolCallIndex, toolCall);
          
          results.push({
            id: `chatcmpl-${state.messageId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: state.model,
            choices: [{
              index: 0,
              delta: { tool_calls: [toolCall] },
              finish_reason: null
            }]
          });
        }
        continue;
      }

      // Text content (non-thinking)
      if (part.text !== undefined && part.text !== "") {
        results.push({
          id: `chatcmpl-${state.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: { content: part.text },
            finish_reason: null
          }]
        });
      }

      // Function call
      if (part.functionCall) {
        const fcName = part.functionCall.name;
        const fcArgs = part.functionCall.args || {};
        const toolCallIndex = state.functionIndex++;
        
        const toolCall = {
          id: `${fcName}-${Date.now()}-${toolCallIndex}`,
          index: toolCallIndex,
          type: "function",
          function: {
            name: fcName,
            arguments: JSON.stringify(fcArgs)
          }
        };
        
        state.toolCalls.set(toolCallIndex, toolCall);
        
        results.push({
          id: `chatcmpl-${state.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: { tool_calls: [toolCall] },
            finish_reason: null
          }]
        });
      }

      // Inline data (images)
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
        results.push({
          id: `chatcmpl-${state.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: {
              images: [{
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${inlineData.data}` }
              }]
            },
            finish_reason: null
          }]
        });
      }
    }
  }

  // Finish reason
  if (candidate.finishReason) {
    let finishReason = candidate.finishReason.toLowerCase();
    if (finishReason === "stop" && state.toolCalls.size > 0) {
      finishReason = "tool_calls";
    }
    
    results.push({
      id: `chatcmpl-${state.messageId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finishReason
      }]
    });
    state.finishReason = finishReason;
  }

  // Usage metadata
  const usage = response.usageMetadata || chunk.usageMetadata;
  if (usage) {
    const promptTokens = (usage.promptTokenCount || 0) + (usage.thoughtsTokenCount || 0);
    state.usage = {
      prompt_tokens: promptTokens,
      completion_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0
    };
    if (usage.thoughtsTokenCount > 0) {
      state.usage.completion_tokens_details = {
        reasoning_tokens: usage.thoughtsTokenCount
      };
    }
  }

  return results.length > 0 ? results : null;
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, null, geminiToOpenAIResponse);

