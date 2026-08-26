import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH, DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { encodeDataUri } from "../concerns/image.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";
import { EMPTY_TURN_PHRASE } from "./emptyTurn.js";

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
  // Keep Gemini bookkeeping separate from the shared translator state.toolCalls map.
  // The downstream OpenAI→Claude translator uses state.toolCalls for Claude block
  // metadata; pre-populating it here makes Anthropic tool deltas lose index.
  state.geminiToolCallCount = (state.geminiToolCallCount || 0) + 1;
  return buildChunk(chunkMeta(state), { tool_calls: [toolCall] }, null);
}

// Gemini drops `content.parts` when it blocks a candidate, so a SAFETY finish
// arrives carrying a finishReason and nothing else. The parts loop then runs
// zero times while the finish branch still emits a final chunk, producing a
// well-formed OpenAI completion whose content is empty — which every client
// downstream reports as the model having said nothing. The Claude route had the
// same hole; see translator/response/gemini-to-claude.js.
function blockNotice(state, candidate, response) {
  const finish = candidate?.finishReason || response?.promptFeedback?.blockReason || "none";
  const blocked = (candidate?.safetyRatings || [])
    .filter((r) => r && r.blocked)
    .map((r) => r.category)
    .join(", ");

  let text = `[9router] ${state.model || "upstream"} ${EMPTY_TURN_PHRASE} (finishReason=${finish}`;
  if (blocked) text += `, blocked=${blocked}`;
  text += ").";

  if (finish === "MALFORMED_FUNCTION_CALL") {
    text += " The model emitted an unparseable tool call. Retry the request; if it repeats, simplify the tool arguments.";
  } else if (finish !== "STOP" && finish !== "none") {
    text += " This is a provider-side block, not a tool or network failure."
      + " Rephrase the request, or switch to another model — repeating it verbatim will be blocked again.";
  } else {
    text += " The stream closed before emitting any content.";
  }
  return text;
}

// Convert Gemini response chunk to OpenAI format
export function geminiToOpenAIResponse(chunk, state) {
  if (!chunk) return null;

  // Handle Antigravity wrapper
  const response = chunk.response || chunk;
  if (!response) return null;

  // A prompt blocked before generation comes back with no candidates at all.
  // Returning null here emitted literally nothing, so the client saw a silent
  // stream rather than a reason.
  if (!response.candidates?.[0]) {
    if (!response.promptFeedback?.blockReason || state.finishReason) return null;
    const out = [];
    if (!state.messageId) {
      state.messageId = response.responseId || `msg_${Date.now()}`;
      state.model = response.modelVersion || "gemini";
      state.functionIndex = 0;
      state.geminiToolCallCount = 0;
      out.push(buildChunk(chunkMeta(state), { role: ROLE.ASSISTANT }, null));
    }
    out.push(buildChunk(chunkMeta(state), { content: blockNotice(state, null, response) }, null));
    out.push(buildChunk(chunkMeta(state), {}, OPENAI_FINISH.STOP));
    state.finishReason = OPENAI_FINISH.STOP;
    return out;
  }

  const results = [];
  const candidate = response.candidates[0];
  const content = candidate.content;

  // Initialize state
  if (!state.messageId) {
    state.messageId = response.responseId || `msg_${Date.now()}`;
    state.model = response.modelVersion || "gemini";
    state.functionIndex = 0;
    state.geminiToolCallCount = 0;
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
          state.geminiSawOutput = true;
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
        state.geminiSawOutput = true;
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
        state.geminiSawOutput = true;
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
    if (finishReason === OPENAI_FINISH.STOP && state.geminiToolCallCount > 0) {
      finishReason = OPENAI_FINISH.TOOL_CALLS;
    }

    // Nothing was ever emitted, so finishing here would hand the client an
    // empty completion and no reason for it.
    if (!state.geminiSawOutput && !state.geminiToolCallCount) {
      results.push(buildChunk(chunkMeta(state), { content: blockNotice(state, candidate, response) }, null));
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

