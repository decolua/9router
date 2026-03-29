import { register } from "../index.js";
import { FORMATS } from "../formats.js";

// Encode base64 → base64url (safe for tool_call IDs: only [a-zA-Z0-9_-])
function toBase64Url(b64) {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Convert Gemini response chunk to OpenAI format
export function geminiToOpenAIResponse(chunk, state) {
  if (!chunk) return null;
  
  // Handle Antigravity wrapper
  const response = chunk.response || chunk;
  if (!response || !response.candidates?.[0]) return null;

  const results = [];
  const candidate = response.candidates[0];
  const content = candidate.content;

  // Initialize state
  if (!state.messageId) {
    state.messageId = response.responseId || `msg_${Date.now()}`;
    state.model = response.modelVersion || "gemini";
    state.functionIndex = 0;
    state.pendingThoughtSignature = null;
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
      const partThoughtSig = part.thoughtSignature || part.thought_signature || "";
      const isThought = part.thought === true;

      // Accumulate thoughtSignature across parts: a sig-only part precedes the functionCall part
      if (partThoughtSig) {
        state.pendingThoughtSignature = partThoughtSig;
      }

      const hasTextContent = part.text !== undefined && part.text !== "";
      const hasFunctionCall = !!part.functionCall;

      // Emit reasoning/thought text
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

      // Emit function call, attaching the best available thoughtSignature
      if (hasFunctionCall) {
        const fcName = part.functionCall.name;
        const fcArgs = part.functionCall.args || {};
        const toolCallIndex = state.functionIndex++;
        // Use signature from this part, or the one carried from a preceding part
        const thoughtSig = partThoughtSig || state.pendingThoughtSignature || "";
        if (thoughtSig) state.pendingThoughtSignature = null; // consumed
        // Encode signature using _TSIG_ delimiter and base64url for safe tool_call ID
        const toolCallId = thoughtSig
          ? `${fcName}-${Date.now()}-${toolCallIndex}_TSIG_${toBase64Url(thoughtSig)}`
          : `${fcName}-${Date.now()}-${toolCallIndex}`;

        const toolCall = {
          id: toolCallId,
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

  // Usage metadata - extract before finish reason so we can include it
  const usageMeta = response.usageMetadata || chunk.usageMetadata;
  if (usageMeta && typeof usageMeta === "object") {
    const cachedTokens = typeof usageMeta.cachedContentTokenCount === "number" ? usageMeta.cachedContentTokenCount : 0;
    const promptTokenCountRaw = typeof usageMeta.promptTokenCount === "number" ? usageMeta.promptTokenCount : 0;
    const thoughtsTokens = typeof usageMeta.thoughtsTokenCount === "number" ? usageMeta.thoughtsTokenCount : 0;
    let candidatesTokens = typeof usageMeta.candidatesTokenCount === "number" ? usageMeta.candidatesTokenCount : 0;
    const totalTokens = typeof usageMeta.totalTokenCount === "number" ? usageMeta.totalTokenCount : 0;
    
    // prompt_tokens = promptTokenCount (includes cached tokens, matching claude-to-openai.js behavior)
    const promptTokens = promptTokenCountRaw;
    
    // Fallback calculation if candidatesTokenCount is 0 but totalTokenCount exists
    if (candidatesTokens === 0 && totalTokens > 0) {
      candidatesTokens = totalTokens - promptTokenCountRaw - thoughtsTokens;
      if (candidatesTokens < 0) candidatesTokens = 0;
    }
    
    // completion_tokens = candidatesTokenCount + thoughtsTokenCount (match Go code)
    const completionTokens = candidatesTokens + thoughtsTokens;
    
    state.usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens
    };
    
    // Add prompt_tokens_details if cached tokens exist
    if (cachedTokens > 0) {
      state.usage.prompt_tokens_details = {
        cached_tokens: cachedTokens
      };
    }
    
    // Add completion_tokens_details if reasoning tokens exist
    if (thoughtsTokens > 0) {
      state.usage.completion_tokens_details = {
        reasoning_tokens: thoughtsTokens
      };
    }
  }

  // Finish reason - include usage in final chunk
  if (candidate.finishReason) {
    let finishReason = candidate.finishReason.toLowerCase();
    if (finishReason === "stop" && state.toolCalls.size > 0) {
      finishReason = "tool_calls";
    }
    
    const finalChunk = {
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
    
    // Include usage in final chunk for downstream translators
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

