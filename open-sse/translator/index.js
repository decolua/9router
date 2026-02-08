import { FORMATS } from "./formats.js";
import { ensureToolCallIds, fixMissingToolResponses } from "./helpers/toolCallHelper.js";
import { prepareClaudeRequest } from "./helpers/claudeHelper.js";
import { filterToOpenAIFormat } from "./helpers/openaiHelper.js";
import { normalizeThinkingConfig } from "../services/provider.js";

// Registry for translators
const requestRegistry = new Map();
const responseRegistry = new Map();

// Track initialization state
let initialized = false;

// Register translator
export function register(from, to, requestFn, responseFn) {
  const key = `${from}:${to}`;
  if (requestFn) {
    requestRegistry.set(key, requestFn);
  }
  if (responseFn) {
    responseRegistry.set(key, responseFn);
  }
}

// Lazy load translators (called once on first use)
function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  
  // Request translators - sync require pattern for bundler
  require("./request/claude-to-openai.js");
  require("./request/openai-to-claude.js");
  require("./request/gemini-to-openai.js");
  require("./request/openai-to-gemini.js");
  require("./request/antigravity-to-openai.js");
  require("./request/openai-responses.js");
  require("./request/openai-to-kiro.js");
  require("./request/openai-to-cursor.js");
  
  // Response translators
  require("./response/claude-to-openai.js");
  require("./response/openai-to-claude.js");
  require("./response/gemini-to-openai.js");
  require("./response/openai-to-antigravity.js");
  require("./response/openai-responses.js");
  require("./response/kiro-to-openai.js");
  require("./response/cursor-to-openai.js");
}

// Translate request: source -> openai -> target
export function translateRequest(sourceFormat, targetFormat, model, body, stream = true, credentials = null, provider = null, reqLogger = null) {
  ensureInitialized();
  let result = body;

  // Normalize thinking config: remove if lastMessage is not user
  normalizeThinkingConfig(result);

  // Always ensure tool_calls have id (some providers require it)
  ensureToolCallIds(result);
  
  // Fix missing tool responses (insert empty tool_result if needed)
  fixMissingToolResponses(result);

  // If same format, skip translation steps
  if (sourceFormat !== targetFormat) {
    // Step 1: source -> openai (if source is not openai)
    if (sourceFormat !== FORMATS.OPENAI) {
      const toOpenAI = requestRegistry.get(`${sourceFormat}:${FORMATS.OPENAI}`);
      if (toOpenAI) {
        result = toOpenAI(model, result, stream, credentials);
        // Log OpenAI intermediate format
        reqLogger?.logOpenAIRequest?.(result);
      }
    }

    // Step 2: openai -> target (if target is not openai)
    if (targetFormat !== FORMATS.OPENAI) {
      const fromOpenAI = requestRegistry.get(`${FORMATS.OPENAI}:${targetFormat}`);
      if (fromOpenAI) {
        result = fromOpenAI(model, result, stream, credentials);
      }
    }
  }

  // Always normalize to clean OpenAI format when target is OpenAI
  // This handles hybrid requests (e.g., OpenAI messages + Claude tools)
  if (targetFormat === FORMATS.OPENAI) {
    result = filterToOpenAIFormat(result);
  }

  // Final step: prepare request for Claude format endpoints
  if (targetFormat === FORMATS.CLAUDE) {
    result = prepareClaudeRequest(result, provider);
  }

  return result;
}

// Translate response chunk: target -> openai -> source
export function translateResponse(targetFormat, sourceFormat, chunk, state) {
  ensureInitialized();
  // If same format, return as-is
  if (sourceFormat === targetFormat) {
    return [chunk];
  }

  let results = [chunk];
  let openaiResults = null; // Store OpenAI intermediate results

  // Step 1: target -> openai (if target is not openai)
  if (targetFormat !== FORMATS.OPENAI) {
    const toOpenAI = responseRegistry.get(`${targetFormat}:${FORMATS.OPENAI}`);
    if (toOpenAI) {
      results = [];
      const converted = toOpenAI(chunk, state);
      if (converted) {
        results = Array.isArray(converted) ? converted : [converted];
        openaiResults = results; // Store OpenAI intermediate
      }
    }
  }

  // Step 2: openai -> source (if source is not openai)
  if (sourceFormat !== FORMATS.OPENAI) {
    const fromOpenAI = responseRegistry.get(`${FORMATS.OPENAI}:${sourceFormat}`);
    if (fromOpenAI) {
      const finalResults = [];
      for (const r of results) {
        const converted = fromOpenAI(r, state);
        if (converted) {
          finalResults.push(...(Array.isArray(converted) ? converted : [converted]));
        }
      }
      results = finalResults;
    }
  }

  // Attach OpenAI intermediate results for logging
  if (openaiResults && sourceFormat !== FORMATS.OPENAI && targetFormat !== FORMATS.OPENAI) {
    results._openaiIntermediate = openaiResults;
  }

  return results;
}

// Check if translation needed
export function needsTranslation(sourceFormat, targetFormat) {
  return sourceFormat !== targetFormat;
}

// Initialize state for streaming response based on format
export function initState(sourceFormat) {
  // Base state for all formats
  const base = {
    messageId: null,
    model: null,
    textBlockStarted: false,
    thinkingBlockStarted: false,
    inThinkingBlock: false,
    currentBlockIndex: null,
    toolCalls: new Map(),
    finishReason: null,
    finishReasonSent: false,
    usage: null,
    contentBlockIndex: -1
  };

  // Add openai-responses specific fields
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return {
      ...base,
      seq: 0,
      responseId: `resp_${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      started: false,
      msgTextBuf: {},
      msgItemAdded: {},
      msgContentAdded: {},
      msgItemDone: {},
      reasoningId: "",
      reasoningIndex: -1,
      reasoningBuf: "",
      reasoningPartAdded: false,
      reasoningDone: false,
      inThinking: false,
      funcArgsBuf: {},
      funcNames: {},
      funcCallIds: {},
      funcArgsDone: {},
      funcItemDone: {},
      completedSent: false
    };
  }

  return base;
}

// Initialize all translators (kept for backward compatibility)
export function initTranslators() {
  ensureInitialized();
}
