import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK } from "../schema/index.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { recordStrike } from "../../utils/discipline.js";
import { isUserEcho } from "../../utils/userEcho.js";

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";

function recordToolJsonStrike(state) {
  const { shouldLock } = recordStrike(state.servingModel, "doubled-json");
  if (!shouldLock) return;
  try { state.onDisciplineLock?.("doubled-json"); } catch { /* discipline must not break output */ }
}

// Sanitize tool call arguments to fix bad params from non-Anthropic models
function sanitizeToolArgs(state, toolName, argsJson, strikeRecorded = false) {
  try {
    const args = JSON.parse(argsJson);
    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
      ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
      : toolName;
    if (name === "Read") sanitizeReadArgs(args);
    return JSON.stringify(args);
  } catch {
    // Known non-Anthropic failure: the complete args JSON emitted twice
    // back-to-back ({...}{...}), which the client cannot parse. Halve and retry.
    const half = argsJson.length / 2;
    if (Number.isInteger(half) && argsJson.slice(0, half) === argsJson.slice(half)) {
      if (!strikeRecorded) recordToolJsonStrike(state);
      return sanitizeToolArgs(state, toolName, argsJson.slice(0, half), true);
    }
    if (!strikeRecorded) recordToolJsonStrike(state);
    return argsJson;
  }
}

function sanitizeReadArgs(args) {
  if (typeof args.limit === "string" && /^\d+$/.test(args.limit)) args.limit = Number(args.limit);
  if (typeof args.offset === "string" && /^-?\d+$/.test(args.offset)) args.offset = Number(args.offset);

  if (typeof args.limit === "number") {
    if (args.limit > 2000) args.limit = 2000;
    if (args.limit < 1) delete args.limit;
  }
  if (typeof args.offset === "number" && args.offset < 0) args.offset = 0;

  if ("pages" in args && !isValidPdfPagesArg(args.file_path, args.pages)) {
    delete args.pages;
  }
}

function isValidPdfPagesArg(filePath, pages) {
  return typeof filePath === "string" &&
    filePath.toLowerCase().endsWith(".pdf") &&
    typeof pages === "string" &&
    /^\d+(?:-\d+)?$/.test(pages);
}

// Some models (gemini family observed) echo the client harness's XML wrapper
// blocks (<instructions>, <system-reminder>, ...) verbatim into their visible
// output. Models never legitimately emit these tags, so drop the whole block.
// Streaming-safe: tags split across chunks are held in state.echoCarry.
const ECHO_TAGS = ["instructions", "system-reminder", "task-notification", "command-message", "command-name"];

// A model repeating the user's own message back as its reply. Judged on the
// accumulated visible text rather than per chunk, because the regurgitation
// only becomes recognisable once enough of it has arrived. Conservative by
// design — see userEcho.js; a short quote of the user is never touched.
function filterUserEcho(state, out) {
  if (!out || !state.lastUserText || state.userEchoDropped) return out;
  state.echoSeen = (state.echoSeen || "") + out;
  if (!isUserEcho(state.echoSeen, state.lastUserText)) return out;
  state.userEchoDropped = true;
  try { recordStrike(state.servingModel, "echo"); } catch { /* discipline must not break output */ }
  return "";
}

function filterEchoText(state, text) {
  let buf = (state.echoCarry || "") + text;
  state.echoCarry = "";
  let out = "";
  while (buf.length) {
    if (state.echoDropTag) {
      const close = "</" + state.echoDropTag + ">";
      const i = buf.indexOf(close);
      if (i === -1) {
        // hold a tail that could be the start of a split closing tag
        state.echoCarry = buf.slice(Math.max(0, buf.length - (close.length - 1)));
        return out;
      }
      buf = buf.slice(i + close.length);
      state.echoDropTag = null;
      continue;
    }
    const lt = buf.indexOf("<");
    if (lt === -1) { out += buf; break; }
    out += buf.slice(0, lt);
    buf = buf.slice(lt);
    let matched = false, partial = false;
    for (const tag of ECHO_TAGS) {
      const open = "<" + tag + ">";
      if (buf.startsWith(open)) {
        state.echoDropTag = tag;
        buf = buf.slice(open.length);
        matched = true;
        // Echoing harness XML is a discipline strike. It never locks the model
        // (only doubled-json counts toward the threshold) but it arms a nudge
        // on this model's next request.
        try { recordStrike(state.servingModel, "echo"); } catch { /* discipline must not break output */ }
        break;
      }
      if (open.startsWith(buf)) partial = true;
    }
    if (matched) continue;
    if (partial) { state.echoCarry = buf; return out; }
    out += "<";
    buf = buf.slice(1);
  }
  return out;
}

// End of stream: an unclosed echo block is dropped; a held non-tag prefix is real text.
function flushEchoText(state) {
  const tail = state.echoDropTag ? "" : (state.echoCarry || "");
  state.echoCarry = "";
  state.echoDropTag = null;
  return tail;
}

// Helper: stop thinking block if started
function stopThinkingBlock(state, results) {
  if (!state.thinkingBlockStarted) return;
  results.push({
    type: "content_block_stop",
    index: state.thinkingBlockIndex
  });
  state.thinkingBlockStarted = false;
}

// Helper: stop text block if started
function stopTextBlock(state, results) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({
    type: "content_block_stop",
    index: state.textBlockIndex
  });
  state.textBlockStarted = false;
}

// Convert OpenAI stream chunk to Claude format
export function openaiToClaudeResponse(chunk, state) {
  if (!chunk || !chunk.choices?.[0]) return null;

  const results = [];
  const choice = chunk.choices[0];
  const delta = choice.delta;

  // Track usage from OpenAI chunk if available
  if (chunk.usage && typeof chunk.usage === "object") {
    const promptTokens = typeof chunk.usage.prompt_tokens === "number" ? chunk.usage.prompt_tokens : 0;
    const outputTokens = typeof chunk.usage.completion_tokens === "number" ? chunk.usage.completion_tokens : 0;

    // Extract cache tokens from prompt_tokens_details
    const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
    const cacheCreationTokens = chunk.usage.prompt_tokens_details?.cache_creation_tokens;
    const cacheReadTokens = typeof cachedTokens === "number" ? cachedTokens : 0;
    const cacheCreateTokens = typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0;

    // input_tokens = prompt_tokens - cached_tokens - cache_creation_tokens
    // Because OpenAI's prompt_tokens includes all prompt-side tokens
    const inputTokens = promptTokens - cacheReadTokens - cacheCreateTokens;

    state.usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens
    };

    // Add cache_read_input_tokens if present
    if (cacheReadTokens > 0) {
      state.usage.cache_read_input_tokens = cacheReadTokens;
    }

    // Add cache_creation_input_tokens if present
    if (cacheCreateTokens > 0) {
      state.usage.cache_creation_input_tokens = cacheCreateTokens;
    }

    // Note: completion_tokens_details.reasoning_tokens is already included in output_tokens
    // No need to add separately as Claude expects total output_tokens
  }

  // First chunk - ALWAYS send message_start first
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = chunk.id?.replace("chatcmpl-", "") || `msg_${Date.now()}`;
    if (!state.messageId || state.messageId === "chat" || state.messageId.length < 8) {
      state.messageId = chunk.extend_fields?.requestId ||
        chunk.extend_fields?.traceId ||
        `msg_${Date.now()}`;
    }
    state.model = chunk.model || MODEL_FALLBACK;
    state.nextBlockIndex = 0;
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: ROLE.ASSISTANT,
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
  }

  // Handle reasoning (thinking) across vendor shapes - GLM/DeepSeek/Qwen/MiniMax/etc.
  const reasoningContent = extractReasoningText(delta);
  if (reasoningContent) {
    stopTextBlock(state, results);

    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = state.nextBlockIndex++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: CLAUDE_BLOCK.THINKING, thinking: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent }
    });
  }

  // Handle regular content
  if (delta?.content) {
    const emitText = filterUserEcho(state, filterEchoText(state, delta.content));
    if (emitText) {
      stopThinkingBlock(state, results);

      if (!state.textBlockStarted) {
        state.textBlockIndex = state.nextBlockIndex++;
        state.textBlockStarted = true;
        state.textBlockClosed = false;
        results.push({
          type: "content_block_start",
          index: state.textBlockIndex,
          content_block: { type: CLAUDE_BLOCK.TEXT, text: "" }
        });
      }

      results.push({
        type: "content_block_delta",
        index: state.textBlockIndex,
        delta: { type: "text_delta", text: emitText }
      });
    }
  }

  // Tool calls
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;

      // GLM/fireworks repeats id+null-name on every arg chunk; open block once per idx
      if (tc.id && !state.toolCalls.has(idx)) {
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);

        const toolBlockIndex = state.nextBlockIndex++;
        state.toolCalls.set(idx, { id: tc.id, name: tc.function?.name || "", blockIndex: toolBlockIndex });

        // Strip prefix from tool name for response
        let toolName = tc.function?.name || "";
        if (toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
          toolName = toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length);
        }

        results.push({
          type: "content_block_start",
          index: toolBlockIndex,
          content_block: {
            type: CLAUDE_BLOCK.TOOL_USE,
            id: tc.id,
            name: toolName,
            input: {}
          }
        });
      }

      if (tc.function?.arguments) {
        const toolInfo = state.toolCalls.get(idx);
        if (toolInfo) {
          // Buffer args instead of streaming — sanitize at finish to fix bad params
          if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
          const prev = state.toolArgBuffers.get(idx) || "";
          const inc = tc.function.arguments;
          // Some providers stream cumulative args (each chunk restates the full
          // string so far) — appending would duplicate the JSON. Replace when
          // the new chunk already carries the buffer as its prefix.
          state.toolArgBuffers.set(idx, prev && inc.startsWith(prev) ? inc : prev + inc);
        }
      }
    }
  }

  // Finish. Guarded: some providers repeat finish_reason on a trailing usage
  // chunk — re-running this block would emit the buffered args a second time.
  if (choice.finish_reason && !state.finishHandled) {
    state.finishHandled = true;
    // Flush any text held back by the echo filter (a non-tag "<..." prefix).
    const echoTail = flushEchoText(state);
    if (echoTail) {
      if (!state.textBlockStarted) {
        state.textBlockIndex = state.nextBlockIndex++;
        state.textBlockStarted = true;
        state.textBlockClosed = false;
        results.push({
          type: "content_block_start",
          index: state.textBlockIndex,
          content_block: { type: CLAUDE_BLOCK.TEXT, text: "" }
        });
      }
      results.push({
        type: "content_block_delta",
        index: state.textBlockIndex,
        delta: { type: "text_delta", text: echoTail }
      });
    }
    stopThinkingBlock(state, results);
    stopTextBlock(state, results);

    for (const [idx, toolInfo] of state.toolCalls) {
      // Emit buffered + sanitized args as single delta before stop
      const buffered = state.toolArgBuffers?.get(idx);
      if (buffered) {
        const sanitized = sanitizeToolArgs(state, toolInfo.name, buffered);
        results.push({
          type: "content_block_delta",
          index: toolInfo.blockIndex,
          delta: { type: "input_json_delta", partial_json: sanitized }
        });
      }
      results.push({
        type: "content_block_stop",
        index: toolInfo.blockIndex
      });
    }

    // Mark finish for later usage injection in stream.js
    state.finishReason = choice.finish_reason;

    // Use tracked usage (will be estimated in stream.js if not valid)
    const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
    results.push({
      type: "message_delta",
      delta: { stop_reason: convertFinishReason(choice.finish_reason) },
      usage: finalUsage
    });
    results.push({ type: "message_stop" });
  }

  return results.length > 0 ? results : null;
}

const convertFinishReason = (reason) => fromOpenAIFinish(reason, "claude");

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse);
