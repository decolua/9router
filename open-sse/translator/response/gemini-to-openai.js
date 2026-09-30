import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH, GEMINI_FINISH, GEMINI_BLOCK_REASON, DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { encodeDataUri } from "../concerns/image.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";
import { storeGeminiThoughtSignature } from "../../services/thoughtSignatureStore.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";

// The stream boundary serializes failures in the client's protocol. Never invent
// a successful finish to flush a truncated response (especially buffered tools).
function failGeminiStream(state, statusCode, code, message) {
  state.geminiStreamOutcome = { status: "error", statusCode, code, message };
  return null;
}

// Build chunk meta for current gemini state
function chunkMeta(state) {
  return { id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model };
}

// Build a tool_call chunk from a gemini functionCall part (shared by sig/non-sig branches)
function emitFunctionCall(functionCall, state, signature = null) {
  const rawName = functionCall.name;
  // Restore original tool name from mapping (AG cloaking)
  const fcName = state.toolNameMap?.get(rawName) || rawName;
  const fcArgs = functionCall.args || {};
  const toolCallIndex = state.functionIndex++;
  const callId = functionCall.id || `${fcName}-${Date.now()}-${toolCallIndex}`;
  if (signature) {
    storeGeminiThoughtSignature(callId, signature, state.sessionId, state.model);
  }
  const toolCall = {
    id: callId,
    index: toolCallIndex,
    type: OPENAI_BLOCK.FUNCTION,
    function: { name: fcName, arguments: JSON.stringify(fcArgs) },
  };
  // Keep Gemini bookkeeping separate from the shared translator state.toolCalls map.
  // The downstream OpenAI→Claude translator uses state.toolCalls for Claude block
  // metadata; pre-populating it here makes Anthropic tool deltas lose index.
  state.geminiToolCallCount = (state.geminiToolCallCount || 0) + 1;
  return buildChunk(chunkMeta(state), { tool_calls: [toolCall] }, null);
}

// Convert Gemini response chunk to OpenAI format
export function geminiToOpenAIResponse(chunk, state) {
  if (!chunk) {
    if (state.geminiStreamOutcome) return null;
    return failGeminiStream(state, HTTP_STATUS.BAD_GATEWAY, "incomplete_upstream_stream",
      "Gemini stream ended before a finish reason or an explicit prompt block.");
  }

  // Antigravity wraps Gemini frames; errors/feedback can live on either level.
  const response = chunk.response && typeof chunk.response === "object" ? chunk.response : chunk;
  const usageMeta = response.usageMetadata || chunk.usageMetadata;
  const geminiUsage = toOpenAIUsage(usageMeta, FORMATS.GEMINI);
  if (geminiUsage) state.usage = geminiUsage;

  // Usage-only trailers are useful, but must not reopen a finished message.
  if (state.geminiStreamOutcome) return null;
  const upstreamError = chunk.error || response.error;
  if (upstreamError) {
    const statusCode = Object.values(HTTP_STATUS).includes(upstreamError.code)
      ? upstreamError.code : HTTP_STATUS.BAD_GATEWAY;
    // Do not echo arbitrary upstream messages/details: they can contain prompts,
    // credentials, or HTML. Preserve the structured status without exposing them.
    return failGeminiStream(state, statusCode, "upstream_stream_error",
      `Gemini upstream returned an in-stream error (HTTP ${statusCode}).`);
  }

  const feedback = response.promptFeedback || chunk.promptFeedback;
  const blockReason = feedback?.blockReason;
  const blocked = typeof blockReason === "string" && blockReason.trim() !== "" &&
    blockReason !== GEMINI_BLOCK_REASON.UNSPECIFIED;
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  // The bridge supports one choice. An explicitly indexed secondary candidate
  // must never finish the still-incomplete primary candidate.
  const candidate = candidates.find(item => item?.index === 0) ||
    (candidates[0]?.index == null ? candidates[0] : null);
  if (!candidate && !blocked) return null;

  const results = [];
  const content = blocked ? null : candidate?.content;

  // Initialize state
  if (!state.messageId) {
    state.messageId = response.responseId || `msg_${Date.now()}`;
    state.model = response.modelVersion || state.model || "gemini";
    state.functionIndex = 0;
    state.geminiToolCallCount = 0;
    results.push(buildChunk(chunkMeta(state), { role: ROLE.ASSISTANT }, null));
  }

  // Process parts
  if (content?.parts) {
    for (const part of content.parts) {
      const hasThoughtSig = part.thoughtSignature || part.thought_signature;
      if (hasThoughtSig && typeof hasThoughtSig === "string") {
        state.pendingThoughtSignature = hasThoughtSig;
      }
      const isThought = part.thought === true;

      // Handle thought signature (thinking mode)
      if (hasThoughtSig) {
        const hasTextContent = part.text !== undefined && part.text !== "";
        const hasFunctionCall = !!part.functionCall;

        // Standalone thoughtSignature part (no text, no functionCall): keep pending for next functionCall
        if (!hasTextContent && !hasFunctionCall) {
          continue;
        }

        if (hasTextContent) {
          results.push(buildChunk(
            chunkMeta(state),
            isThought ? reasoningDelta(part.text) : { content: part.text },
            null
          ));
        }

        if (hasFunctionCall) {
          results.push(emitFunctionCall(part.functionCall, state, hasThoughtSig));
          state.pendingThoughtSignature = null;
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
        const sig = state.pendingThoughtSignature || null;
        results.push(emitFunctionCall(part.functionCall, state, sig));
        state.pendingThoughtSignature = null;
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

  // A prompt-level block is terminal even when Google supplies no candidates.
  // Ordinary text (including a quoted refusal sentence) is never a terminal signal.
  if (blocked || (candidate?.finishReason && candidate.finishReason !== GEMINI_FINISH.UNSPECIFIED)) {
    let finishReason = blocked ? OPENAI_FINISH.CONTENT_FILTER
      : toOpenAIFinish(candidate.finishReason, FORMATS.GEMINI);
    if (finishReason === OPENAI_FINISH.STOP && state.geminiToolCallCount > 0) {
      finishReason = OPENAI_FINISH.TOOL_CALLS;
    }
    
    const finalChunk = buildChunk(chunkMeta(state), {}, finishReason);
    
    // Include usage in final chunk for downstream translators
    if (state.usage) {
      finalChunk.usage = state.usage;
    }
    
    results.push(finalChunk);
    state.finishReason = finishReason;
    state.geminiStreamOutcome = finishReason === OPENAI_FINISH.CONTENT_FILTER
      ? { status: "error", statusCode: HTTP_STATUS.FORBIDDEN, code: "content_filter", message: "Gemini blocked the response with a content filter." }
      : { status: "success" };
  }

  return results.length > 0 ? results : null;
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.VERTEX, FORMATS.OPENAI, null, geminiToOpenAIResponse);

