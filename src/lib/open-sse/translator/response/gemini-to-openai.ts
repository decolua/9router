import { register } from "../index";
import { FORMATS } from "../formats";

// Convert Gemini response chunk to OpenAI format
export function geminiToOpenAIResponse(chunk: any, state: any) {
  if (!chunk) return null;
  
  const response = chunk.response || chunk;
  if (!response || !response.candidates?.[0]) return null;

  const results: any[] = [];
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        
        if (part.functionCall) {
          const rawName = part.functionCall.name;
          const fcName = state.toolNameMap?.get(rawName) || rawName;
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
        const rawName = part.functionCall.name;
        const fcName = state.toolNameMap?.get(rawName) || rawName;
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
            } as any,
            finish_reason: null
          }]
        });
      }
    }
  }

  // Usage metadata
  const usageMeta = response.usageMetadata || chunk.usageMetadata;
  if (usageMeta && typeof usageMeta === "object") {
    const cachedTokens = typeof usageMeta.cachedContentTokenCount === "number" ? usageMeta.cachedContentTokenCount : 0;
    const promptTokenCountRaw = typeof usageMeta.promptTokenCount === "number" ? usageMeta.promptTokenCount : 0;
    const thoughtsTokens = typeof usageMeta.thoughtsTokenCount === "number" ? usageMeta.thoughtsTokenCount : 0;
    let candidatesTokens = typeof usageMeta.candidatesTokenCount === "number" ? usageMeta.candidatesTokenCount : 0;
    const totalTokens = typeof usageMeta.totalTokenCount === "number" ? usageMeta.totalTokenCount : 0;
    
    const promptTokens = promptTokenCountRaw;
    
    if (candidatesTokens === 0 && totalTokens > 0) {
      candidatesTokens = totalTokens - promptTokenCountRaw - thoughtsTokens;
      if (candidatesTokens < 0) candidatesTokens = 0;
    }
    
    const completionTokens = candidatesTokens + thoughtsTokens;
    
    state.usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens
    };
    
    if (cachedTokens > 0) {
      state.usage.prompt_tokens_details = {
        cached_tokens: cachedTokens
      };
    }
    
    if (thoughtsTokens > 0) {
      state.usage.completion_tokens_details = {
        reasoning_tokens: thoughtsTokens
      };
    }
  }

  // Finish reason
  if (candidate.finishReason) {
    let finishReason = candidate.finishReason.toLowerCase();
    if (finishReason === "stop" && state.toolCalls.size > 0) {
      finishReason = "tool_calls";
    }
    
    const finalChunk: any = {
      id: `chatcmpl-${state.messageId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finishReason
      }]
    };
    
    if (state.usage) {
      finalChunk.usage = state.usage;
    }
    
    results.push(finalChunk);
    state.finishReason = finishReason;
  }

  return results.length > 0 ? results : null;
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.VERTEX, FORMATS.OPENAI, null, geminiToOpenAIResponse);
