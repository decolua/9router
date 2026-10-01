import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK } from "../schema/index.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";

// Sanitize tool call arguments to fix bad params from non-Anthropic models
function sanitizeToolArgs(toolName, argsJson) {
  try {
    const args = JSON.parse(argsJson);
    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
      ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
      : toolName;
    if (name === "Read") sanitizeReadArgs(args);
    return JSON.stringify(args);
  } catch {
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

// Helper: close every still-open tool_use block (buffered args + stop).
// A tool-call block is opened on the first delta fragment and — because args
// are buffered until finish — can stay open across many chunks. If the next
// semantic event is text/thinking (or a second, distinct tool call), the open
// block must be flushed first, otherwise its input_json_delta is emitted after
// an unrelated later block (Claude Code then associates the args with the
// wrong block). Returns true if anything was closed so the caller can avoid
// re-emitting on finish.
function stopToolBlocks(state, results) {
  if (!state.toolCalls || state.toolCalls.size === 0) return false;
  let closed = false;
  for (const [key, toolInfo] of state.toolCalls) {
    if (toolInfo.closed) continue;
    emitToolArgsAndStop(state, key, toolInfo, results);
    closed = true;
  }
  return closed;
}

// Emit a tool call's buffered (sanitized) args as one input_json_delta, then
// close the block. Idempotent per index so a flush followed by the finish
// branch cannot double-emit.
function emitToolArgsAndStop(state, key, toolInfo, results) {
  if (toolInfo.closed) return;
  toolInfo.closed = true;
  const buffered = state.toolArgBuffers?.get(key);
  // Emit the accumulated args, or an explicit "{}" when none arrived (a tool
  // call with no arguments). Always sending one input_json_delta keeps the
  // block well-formed for clients that expect args to follow content_block_start.
  const sanitized = buffered ? sanitizeToolArgs(toolInfo.name, buffered) : "{}";
  results.push({
    type: "content_block_delta",
    index: toolInfo.blockIndex,
    delta: { type: "input_json_delta", partial_json: sanitized }
  });
  results.push({
    type: "content_block_stop",
    index: toolInfo.blockIndex
  });
}

// Resolve the grouping KEY for a tool_call delta, returning a stable internal
// key (not necessarily the provider's `index`). The OpenAI streaming schema
// makes `index` optional and lets a provider reuse it, and synthetic keys must
// not collide with real provider indices — so we key by identity where we can:
//
//   1. by id        — the strongest identity; a fragment carrying the same id
//                     always lands on the same call, even if `index` changes.
//   2. by index      — bind an index to the id seen with it, so a LATER fragment
//                     with the same index but a DIFFERENT id starts a NEW call
//                     instead of being merged into the stale one.
//   3. synthetic     — no index and no id: namespace these into the negative
//                     range so they can never collide with a provider index.
//
// `state.toolIndexById` : id -> key
// `state.toolIdByIndex` : raw provider index -> id seen with it
// `state.toolKeyByIndex`: raw provider index -> internal key
function resolveToolKey(state, tc) {
  const hasIndex = typeof tc.index === "number";
  const id = tc.id || null;

  if (id) {
    if (!state.toolIndexById) state.toolIndexById = new Map();
    const known = state.toolIndexById.get(id);
    if (known !== undefined) return known;
  }

  if (hasIndex) {
    if (!state.toolKeyByIndex) state.toolKeyByIndex = new Map();
    if (!state.toolIdByIndex) state.toolIdByIndex = new Map();
    const boundId = state.toolIdByIndex.get(tc.index);
    // Same index, but a NEW id => a distinct call that reused the index slot.
    // Allocate a fresh key AND rebind the index to it, so subsequent
    // index-only fragments (no id) follow the NEW call rather than the stale
    // one. The previous call's block is flushed separately by the caller.
    if (id && boundId && boundId !== id) {
      const fresh = state.syntheticToolKey ?? -1;
      state.syntheticToolKey = fresh - 1;
      state.toolIndexById.set(id, fresh);
      state.toolIdByIndex.set(tc.index, id);
      state.toolKeyByIndex.set(tc.index, fresh);
      return fresh;
    }
    if (!state.toolKeyByIndex.has(tc.index)) {
      // First time we bind this index: keep the provider index as the key.
      state.toolKeyByIndex.set(tc.index, tc.index);
    }
    const key = state.toolKeyByIndex.get(tc.index);
    if (id) state.toolIdByIndex.set(tc.index, id);
    return key;
  }

  if (id) {
    // No index but a fresh id: allocate a namespaced synthetic key.
    const fresh = state.syntheticToolKey ?? -1;
    state.syntheticToolKey = fresh - 1;
    if (!state.toolIndexById) state.toolIndexById = new Map();
    state.toolIndexById.set(id, fresh);
    return fresh;
  }

  // No index, no id: attribute to the most recently opened call, else allocate.
  if (state.lastToolKey !== undefined) return state.lastToolKey;
  const fresh = state.syntheticToolKey ?? -1;
  state.syntheticToolKey = fresh - 1;
  return fresh;
}

// Close every open block and emit the terminal message_delta + message_stop,
// exactly once. Returns the emitted frames (possibly empty).
//
// `stopReason` is the OpenAI finish_reason to translate; when the stream ends
// with no finish_reason at all (upstream truncation / disconnect) the caller
// passes null and we synthesize "stop" so the client is never left hanging on
// an unterminated stream. Idempotent via state.finishReasonSent.
function finalize(state, results, stopReason) {
  // Blocks must flush on EVERY finalize call, even after the terminal pair was
  // already sent — parallel tool calls can complete in chunks that arrive after
  // a premature finish_reason, and those buffered args must not be stranded.
  stopThinkingBlock(state, results);
  stopTextBlock(state, results);
  stopToolBlocks(state, results);

  if (state.finishReasonSent) return results;

  const reason = stopReason || state.finishReason || "stop";
  if (!state.finishReason) state.finishReason = reason;

  const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
  results.push({
    type: "message_delta",
    delta: { stop_reason: convertFinishReason(reason) },
    usage: finalUsage
  });
  results.push({ type: "message_stop" });
  state.finishReasonSent = true;
  return results;
}

// Convert OpenAI stream chunk to Claude format
export function openaiToClaudeResponse(chunk, state) {
  // Flush contract: a null chunk means the upstream stream has ended. If we
  // opened a message but never saw a finish_reason (provider disconnect,
  // truncation, or a stream that simply stops), synthesize the terminal pair so
  // Claude Code's agent loop advances instead of blocking forever. Mirrors the
  // openaiResponsesToOpenAIResponse flush at openai-responses.js.
  if (!chunk) {
    if (!state.messageStartSent || state.finishReasonSent) return null;
    const out = [];
    finalize(state, out, null);
    return out.length > 0 ? out : null;
  }
  if (!chunk.choices?.[0]) return null;

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

  // After the terminal pair is emitted, ignore trailing CONTENT/THINKING text:
  // opening a block now would place it after message_stop and leave it
  // unterminated. (Late tool ARGUMENTS are still buffered in the tool branch,
  // which handles only blocks already open.)
  const terminalSent = state.finishReasonSent === true;

  // Handle reasoning (thinking) across vendor shapes - GLM/DeepSeek/Qwen/MiniMax/etc.
  const reasoningContent = terminalSent ? null : extractReasoningText(delta);
  if (reasoningContent) {
    stopTextBlock(state, results);
    // A buffered tool call may still be open; flush it before an unrelated
    // block starts so its args stay attributed to the right tool_use.
    stopToolBlocks(state, results);

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
  if (delta?.content && !state.finishReasonSent) {
    stopThinkingBlock(state, results);
    // Flush any open tool call before text starts (see stopToolBlocks).
    stopToolBlocks(state, results);

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
      delta: { type: "text_delta", text: delta.content }
    });
  }

  // Tool calls
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const key = resolveToolKey(state, tc);
      state.lastToolKey = key;

      const hasIdentity = tc.id || tc.function?.name;
      // Open the block on the first fragment carrying an id OR a name — some
      // upstreams omit the optional id entirely. A missing id is materialised
      // so the block is still emitted (Claude Code cannot address a tool_use
      // without an id, and dropping it silently loses the tool call).
      const existing = state.toolCalls.get(key);
      const needsOpen = !existing || (hasIdentity && tc.id && existing.id !== tc.id && !existing.syntheticId);
      if (hasIdentity && needsOpen && !state.finishReasonSent) {
        // If the provider REUSED a provider index for a new id, the previous
        // call's block is still open under that index as its key. Flush it now
        // (its args would otherwise be stranded). We flush ONLY a block bound to
        // the same provider index being reused, never unrelated parallel calls,
        // so N concurrent tool calls with distinct indices remain untouched.
        if (typeof tc.index === "number" && key !== tc.index) {
          const stale = state.toolCalls.get(tc.index);
          if (stale && !stale.closed) {
            emitToolArgsAndStop(state, tc.index, stale, results);
            state.toolArgBuffers?.delete(tc.index);
            state.toolCalls.delete(tc.index);
          }
        }
        state.toolCalls.delete(key);
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);

        const toolBlockIndex = state.nextBlockIndex++;
        const toolId = tc.id || fallbackToolCallId(key);
        state.toolCalls.set(key, {
          id: toolId,
          name: tc.function?.name || "",
          blockIndex: toolBlockIndex,
          syntheticId: !tc.id,
        });

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
            id: toolId,
            name: toolName,
            input: {}
          }
        });
      }

      // Buffer args unconditionally, keyed by the resolved key — a fragment can
      // legitimately arrive BEFORE the id/name fragment (args-first ordering),
      // and dropping it would truncate the tool input. The block-open path reads
      // this buffer later.
      if (tc.function?.arguments) {
        if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
        state.toolArgBuffers.set(key, (state.toolArgBuffers.get(key) || "") + tc.function.arguments);
        // If the block is already open, a late name fragment may still be needed;
        // if the name is still empty, adopt it here.
        const info = state.toolCalls.get(key);
        if (info && !info.name && tc.function?.name) info.name = tc.function.name;
      }
    }
  }

  // Finish — flush any blocks still open, then emit the terminal pair ONCE.
  // Two distinct concerns deliberately separated:
  //   * block flush (thinking/text/tool) must run whenever blocks remain open,
  //     even if a finish_reason chunk repeats, or a late tool-call's buffered
  //     args would be stranded (parallel tool calls complete across chunks).
  //   * the message_delta + message_stop pair must be idempotent — upstreams
  //     that send finish_reason twice must not finalize the client stream twice.
  if (choice.finish_reason) {
    finalize(state, results, choice.finish_reason);
  }

  return results.length > 0 ? results : null;
}

const convertFinishReason = (reason) => fromOpenAIFinish(reason, "claude");

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse);
