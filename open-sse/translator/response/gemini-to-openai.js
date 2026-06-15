import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH, DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { encodeDataUri } from "../concerns/image.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";

// Build chunk meta for current gemini state
function chunkMeta(state) {
  return { id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model };
}

// Build a tool_call chunk from a gemini functionCall part (shared by sig/non-sig branches)
function emitFunctionCall(functionCall, state) {
  const rawName = functionCall.name;
  // Restore original tool name from mapping (AG cloaking)
  const fcName = state.toolNameMap?.get(rawName) || rawName;
  const fcArgs = functionCall.args || {};
  const toolCallIndex = state.functionIndex++;
  const toolCall = {
    id: `${fcName}-${Date.now()}-${toolCallIndex}`,
    index: toolCallIndex,
    type: OPENAI_BLOCK.FUNCTION,
    function: { name: fcName, arguments: JSON.stringify(fcArgs) },
  };
  state.toolCalls.set(toolCallIndex, toolCall);
  return buildChunk(chunkMeta(state), { tool_calls: [toolCall] }, null);
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
    results.push(buildChunk(chunkMeta(state), { role: ROLE.ASSISTANT }, null));
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
          results.push(buildChunk(
            chunkMeta(state),
            isThought ? reasoningDelta(part.text) : { content: part.text },
            null
          ));
        }
        
        if (hasFunctionCall) {
          results.push(emitFunctionCall(part.functionCall, state));
        }
        continue;
      }

      // Text content. Gemini marks model-internal thinking with `thought: true`.
      // Some responses include a thoughtSignature, but Google AI Studio/Gemini API
      // can also stream thought parts without a signature; those must not be
      // surfaced as normal assistant content in OpenAI-compatible clients.
      if (part.text !== undefined && part.text !== "") {
        results.push(buildChunk(
          chunkMeta(state),
          isThought ? reasoningDelta(part.text) : { content: part.text },
          null
        ));
      }

      // Function call
      if (part.functionCall) {
        results.push(emitFunctionCall(part.functionCall, state));
      }

      // Inline data (images)
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || DEFAULT_IMAGE_MIME;
        results.push(buildChunk(
          chunkMeta(state),
          {
            images: [{
              type: OPENAI_BLOCK.IMAGE_URL,
              image_url: { url: encodeDataUri(mimeType, inlineData.data) }
            }]
          },
          null
        ));
      }
    }
  }

  // Usage metadata - extract before finish reason so we can include it
  const usageMeta = response.usageMetadata || chunk.usageMetadata;
  const geminiUsage = toOpenAIUsage(usageMeta, "gemini");
  if (geminiUsage) state.usage = geminiUsage;

  // Finish reason - include usage in final chunk
  if (candidate.finishReason) {
    let finishReason = toOpenAIFinish(candidate.finishReason, "gemini");
    if (finishReason === OPENAI_FINISH.STOP && state.toolCalls.size > 0) {
      finishReason = OPENAI_FINISH.TOOL_CALLS;
    }
    
    const finalChunk = buildChunk(chunkMeta(state), {}, finishReason);
    
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

