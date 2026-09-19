import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { GEMINI_ROLE, OPENAI_FINISH, GEMINI_FINISH } from "../schema/index.js";

// Convert OpenAI SSE chunk → plain Gemini streaming chunk (achado A1, T1.2.md).
// Closes the missing `openai:gemini` RESPONSE route: without it the 2nd hop of
// translateResponse (translator/index.js:198-211) forwarded raw OpenAI chunks
// ({"id":"chatcmpl…","choices":[…]}) to gemini-format clients.
//
// Structure mirrors response/openai-to-antigravity.js (the sibling for the
// antigravity envelope): accumulate incremental tool_call args in state and emit
// them ONCE as functionCall parts at finish. Difference by design: plain Gemini
// REST stream chunks are the bare generateContentResponse object
// ({candidates:[…],usageMetadata,modelVersion,responseId}) — NO `response`
// envelope. The reverse decoder accepts both shapes (chunk.response || chunk).
//
// finish_reason→finishReason: concerns/finishReason.js has no gemini response-side
// formatter (fromOpenAIFinish default echoes the raw OpenAI value → wrong for
// Gemini), so the mapping table follows the sibling's schema-constant map
// (OPENAI_FINISH→GEMINI_FINISH, no string literals).
//
// JSON-path sibling: open-sse/handlers/chatCore/sseToJsonHandler.js (~:260-266) builds
// the gemini-family JSON payload inline (no extractable helper, and it consumes
// Responses-API JSON, not OpenAI chunks) — nothing to share without duplicating
// logic across different input shapes, so no shared module was born here.

function toUsageMetadata(usage) {
  if (!usage) return null;
  const meta = {
    promptTokenCount: usage.prompt_tokens || 0,
    candidatesTokenCount: usage.completion_tokens || 0,
    totalTokenCount: usage.total_tokens || 0
  };
  if (usage.completion_tokens_details?.reasoning_tokens) {
    meta.thoughtsTokenCount = usage.completion_tokens_details.reasoning_tokens;
  }
  if (usage.prompt_tokens_details?.cached_tokens) {
    meta.cachedContentTokenCount = usage.prompt_tokens_details.cached_tokens;
  }
  return meta;
}

export function openaiToGeminiResponse(chunk, state) {
  if (!chunk) return null;

  const choice = chunk.choices?.[0];
  if (!choice) {
    if (chunk.usage) {
      state._usage = chunk.usage;
      // Terminal chunk already went out without usage (common OpenAI-compat order:
      // finish_reason chunk, then a usage-only chunk with choices:[]). Surface it
      // instead of dropping — a trailing empty-candidates chunk is valid in Gemini
      // streams.
      if (state._geminiFinishSent && !state._geminiUsageSent) {
        state._geminiUsageSent = true;
        return { candidates: [], usageMetadata: toUsageMetadata(chunk.usage) };
      }
    }
    return null;
  }

  const delta = choice.delta || {};
  const finishReason = choice.finish_reason;

  // Init state (same fields/pattern as the antigravity sibling)
  if (!state._toolCallAccum) state._toolCallAccum = {};
  if (!state._responseId) state._responseId = chunk.id || `resp_${Date.now()}`;
  if (!state._modelVersion) state._modelVersion = chunk.model || "";

  const parts = [];

  // Thinking/reasoning → thought part
  if (delta.reasoning_content) {
    parts.push({ thought: true, text: delta.reasoning_content });
  }

  // Text content
  if (delta.content) {
    parts.push({ text: delta.content });
  }

  // Accumulate tool calls silently (no emit until finish)
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      if (!state._toolCallAccum[idx]) {
        state._toolCallAccum[idx] = { id: "", name: "", arguments: "" };
      }
      const accum = state._toolCallAccum[idx];
      if (tc.id) accum.id = tc.id;
      if (tc.function?.name) accum.name += tc.function.name;
      if (tc.function?.arguments) accum.arguments += tc.function.arguments;
    }
    // Skip emit — wait for finish_reason
    if (parts.length === 0 && !finishReason) return null;
  }

  // On finish, emit accumulated tool calls as complete functionCall parts
  if (finishReason) {
    for (const idx of Object.keys(state._toolCallAccum)) {
      const accum = state._toolCallAccum[idx];
      let args = {};
      try { args = JSON.parse(accum.arguments); } catch { /* empty */ }
      // Restore original tool name if it was prefixed during cloaking
      const originalName = state.toolNameMap?.get(accum.name) || accum.name;
      parts.push({
        functionCall: {
          name: originalName,
          args
        }
      });
    }
  }

  // Skip empty non-finish chunks
  if (parts.length === 0 && !finishReason) return null;

  // Ensure at least empty text part on finish with no content
  if (parts.length === 0 && finishReason) {
    parts.push({ text: "" });
  }

  // Build candidate
  const candidate = { content: { role: GEMINI_ROLE.MODEL, parts }, index: 0 };

  // Finish reason mapping (schema constants; table identical to the sibling)
  if (finishReason) {
    const reasonMap = {
      [OPENAI_FINISH.STOP]: GEMINI_FINISH.STOP,
      [OPENAI_FINISH.LENGTH]: GEMINI_FINISH.MAX_TOKENS,
      [OPENAI_FINISH.TOOL_CALLS]: GEMINI_FINISH.STOP,
      [OPENAI_FINISH.CONTENT_FILTER]: GEMINI_FINISH.SAFETY
    };
    candidate.finishReason = reasonMap[finishReason] || GEMINI_FINISH.STOP;
  }

  // Build bare generateContentResponse chunk (plain Gemini REST streaming shape)
  const response = {
    candidates: [candidate],
    modelVersion: state._modelVersion,
    responseId: state._responseId
  };

  // Usage metadata (usage on the same chunk, or accumulated from an earlier one)
  const usage = chunk.usage || state._usage;
  if (usage) {
    response.usageMetadata = toUsageMetadata(usage);
  }
  if (finishReason) state._geminiFinishSent = true;

  return response;
}

// Register — RESPONSE-side only, mirroring the antigravity sibling's shape
// (register(OPENAI, ANTIGRAVITY, null, fn)). The request:gemini pair for this key
// lives in request/openai-to-gemini.js and is untouched: register() stores the
// two sides in separate Maps and skips null fns (index.js:23-28), so there is no
// overwrite and no duplicate request translator.
register(FORMATS.OPENAI, FORMATS.GEMINI, null, openaiToGeminiResponse);
