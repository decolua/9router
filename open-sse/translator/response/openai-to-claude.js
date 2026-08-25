import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK } from "../schema/index.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { extractReasoningText } from "../concerns/reasoning.js";

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";

// Sanitize tool call arguments to fix bad params from non-Anthropic models
// (e.g. stealth/ox-alpha, DeepSeek, Qwen, and other OpenAI-format models)
function sanitizeToolArgs(toolName, argsJson) {
  try {
    const args = JSON.parse(argsJson);
    if (!args || typeof args !== "object" || Array.isArray(args)) return argsJson;

    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
      ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
      : toolName;

    switch (name) {
      case "Read":
        sanitizeReadArgs(args);
        break;
      case "Grep":
        sanitizeGrepArgs(args);
        break;
      case "Glob":
        sanitizeGlobArgs(args);
        break;
      case "Write":
        sanitizeWriteArgs(args);
        break;
      case "Edit":
        sanitizeEditArgs(args);
        break;
      case "WebFetch":
        sanitizeWebFetchArgs(args);
        break;
      case "WebSearch":
        sanitizeWebSearchArgs(args);
        break;
      case "Bash":
        sanitizeBashArgs(args);
        break;
      case "TaskCreate":
        sanitizeTaskCreateArgs(args);
        break;
      case "TaskUpdate":
        sanitizeTaskUpdateArgs(args);
        break;
      case "TaskGet":
        sanitizeTaskGetArgs(args);
        break;
    }

    return JSON.stringify(args);
  } catch {
    return argsJson;
  }
}

function sanitizeReadArgs(args) {
  // Alias mapping
  if (!args.file_path && args.filePath) args.file_path = args.filePath;
  if (!args.file_path && args.path) args.file_path = args.path;

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

function sanitizeGrepArgs(args) {
  // Alias: pattern aliases
  if (!args.pattern && args.query) args.pattern = args.query;
  if (!args.pattern && args.regex) args.pattern = args.regex;
  if (!args.pattern && args.search) args.pattern = args.search;
  if (typeof args.pattern !== "string") args.pattern = String(args.pattern || "");

  // Path cleanup: cannot be array, null, undefined string
  if (Array.isArray(args.path)) args.path = args.path[0] || undefined;
  if (args.path === null || args.path === "null" || args.path === "undefined" || args.path === "") {
    delete args.path;
  }
  if (!args.path && args.dir) args.path = args.dir;
  if (!args.path && args.directory) args.path = args.directory;

  // Type coercions
  if (typeof args["-i"] === "string") args["-i"] = args["-i"] === "true";
  if (typeof args["-n"] === "string") args["-n"] = args["-n"] === "true";
  if (typeof args.multiline === "string") args.multiline = args.multiline === "true";

  // Numeric coercions
  if (typeof args.head_limit === "string" && /^\d+$/.test(args.head_limit)) args.head_limit = Number(args.head_limit);
  if (typeof args.offset === "string" && /^\d+$/.test(args.offset)) args.offset = Number(args.offset);
  if (typeof args.context === "string" && /^\d+$/.test(args.context)) args.context = Number(args.context);
  if (typeof args["-C"] === "string" && /^\d+$/.test(args["-C"])) args["-C"] = Number(args["-C"]);
  if (typeof args["-A"] === "string" && /^\d+$/.test(args["-A"])) args["-A"] = Number(args["-A"]);
  if (typeof args["-B"] === "string" && /^\d+$/.test(args["-B"])) args["-B"] = Number(args["-B"]);

  // Valid output_mode enum
  const validModes = new Set(["content", "files_with_matches", "count"]);
  if (args.output_mode && !validModes.has(args.output_mode)) {
    delete args.output_mode;
  }
}

function sanitizeGlobArgs(args) {
  // Alias: pattern aliases
  if (!args.pattern && args.glob) args.pattern = args.glob;
  if (!args.pattern && args.query) args.pattern = args.query;
  if (typeof args.pattern !== "string") args.pattern = String(args.pattern || "**/*");

  // Path cleanup: Claude Code schema explicitly says "DO NOT enter 'undefined' or 'null'"
  if (Array.isArray(args.path)) args.path = args.path[0] || undefined;
  if (args.path === null || args.path === "null" || args.path === "undefined" || args.path === "") {
    delete args.path;
  }
  if (!args.path && args.dir) args.path = args.dir;
  if (!args.path && args.directory) args.path = args.directory;
}

function sanitizeWriteArgs(args) {
  // Alias: file_path
  if (!args.file_path && args.filePath) args.file_path = args.filePath;
  if (!args.file_path && args.path) args.file_path = args.path;
  if (!args.file_path && args.filename) args.file_path = args.filename;

  // Alias: content
  if (args.content === undefined && args.contents !== undefined) args.content = args.contents;
  if (args.content === undefined && args.text !== undefined) args.content = args.text;
  if (args.content === undefined && args.body !== undefined) args.content = args.body;
  if (typeof args.content !== "string") args.content = String(args.content ?? "");
}

function sanitizeEditArgs(args) {
  // Alias: file_path
  if (!args.file_path && args.filePath) args.file_path = args.filePath;
  if (!args.file_path && args.path) args.file_path = args.path;
  if (!args.file_path && args.filename) args.file_path = args.filename;

  // Alias: old_string
  if (args.old_string === undefined && args.oldString !== undefined) args.old_string = args.oldString;
  if (args.old_string === undefined && args.old_str !== undefined) args.old_string = args.old_str;
  if (args.old_string === undefined && args.oldText !== undefined) args.old_string = args.oldText;
  if (args.old_string === undefined && args.old !== undefined) args.old_string = args.old;

  // Alias: new_string
  if (args.new_string === undefined && args.newString !== undefined) args.new_string = args.newString;
  if (args.new_string === undefined && args.new_str !== undefined) args.new_string = args.new_str;
  if (args.new_string === undefined && args.newText !== undefined) args.new_string = args.newText;
  if (args.new_string === undefined && args.new !== undefined) args.new_string = args.new;

  if (typeof args.old_string !== "string") args.old_string = String(args.old_string ?? "");
  if (typeof args.new_string !== "string") args.new_string = String(args.new_string ?? "");

  if (typeof args.replace_all === "string") args.replace_all = args.replace_all === "true";
}

function sanitizeWebFetchArgs(args) {
  if (!args.url && args.URL) args.url = args.URL;
  if (!args.url && args.link) args.url = args.link;
  if (!args.url && args.href) args.url = args.href;

  // Claude Code requires 'prompt' on WebFetch
  if (!args.prompt) {
    args.prompt = "Extract and summarize the main content of this page relevant to the user request.";
  }
}

function sanitizeWebSearchArgs(args) {
  if (!args.query && args.q) args.query = args.q;
  if (!args.query && args.search_query) args.query = args.search_query;
  if (!args.query && args.prompt) args.query = args.prompt;
}

function sanitizeBashArgs(args) {
  // Alias: command
  if (!args.command && args.cmd) args.command = args.cmd;
  if (!args.command && args.script) args.command = args.script;
  if (Array.isArray(args.command)) args.command = args.command.join(" ");
  if (typeof args.command !== "string") args.command = String(args.command || "");

  if (typeof args.dangerouslyDisableSandbox === "string") {
    args.dangerouslyDisableSandbox = args.dangerouslyDisableSandbox === "true";
  }
  if (typeof args.run_in_background === "string") {
    args.run_in_background = args.run_in_background === "true";
  }
  if (typeof args.timeout === "string" && /^\d+$/.test(args.timeout)) {
    args.timeout = Number(args.timeout);
  }
}

function sanitizeTaskCreateArgs(args) {
  if (!args.subject && args.title) args.subject = args.title;
  if (!args.subject && args.name) args.subject = args.name;
  if (!args.description && args.desc) args.description = args.desc;
  if (!args.description) args.description = args.subject || "Task";
}

function sanitizeTaskUpdateArgs(args) {
  if (!args.taskId && args.task_id) args.taskId = String(args.task_id);
  if (!args.taskId && args.id) args.taskId = String(args.id);
  if (args.taskId !== undefined && typeof args.taskId !== "string") args.taskId = String(args.taskId);

  const validStatuses = new Set(["pending", "in_progress", "completed", "deleted"]);
  if (args.status && !validStatuses.has(args.status)) {
    delete args.status;
  }
}

function sanitizeTaskGetArgs(args) {
  if (!args.taskId && args.task_id) args.taskId = String(args.task_id);
  if (!args.taskId && args.id) args.taskId = String(args.id);
  if (args.taskId !== undefined && typeof args.taskId !== "string") args.taskId = String(args.taskId);
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
      delta: { type: "text_delta", text: delta.content }
    });
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
          state.toolArgBuffers.set(idx, (state.toolArgBuffers.get(idx) || "") + tc.function.arguments);
        }
      }
    }
  }

  // Finish
  if (choice.finish_reason) {
    stopThinkingBlock(state, results);
    stopTextBlock(state, results);

    for (const [idx, toolInfo] of state.toolCalls) {
      // Emit buffered + sanitized args as single delta before stop
      const buffered = state.toolArgBuffers?.get(idx);
      if (buffered) {
        const sanitized = sanitizeToolArgs(toolInfo.name, buffered);
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
