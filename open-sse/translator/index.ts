import { FORMATS } from "./formats.js";
import { ensureToolCallIds, fixMissingToolResponses } from "./concerns/toolCall.js";
import { prepareClaudeRequest } from "./formats/claude.js";
import { cloakClaudeTools } from "../utils/claudeCloaking.js";
import { filterToOpenAIFormat } from "./formats/openai.js";
import { normalizeThinkingConfig } from "../services/provider.js";
import { applyThinking, captureThinking } from "./concerns/thinkingUnified.js";
import { captureSessionId } from "../utils/sessionManager.js";
import { AntigravityExecutor as _AntigravityExecutor } from "../executors/antigravity.js";
import { PROVIDERS } from "../providers/index.js";
import type { JsonValue, ExecutorCredentials } from "../types/executor.js";

// Registry for translators. Lazy-init guards against circular-import order:
// translator modules call register() (side-effect) before this module's body runs.
// var (not let): hoisted as undefined so register() can run during circular import (no TDZ).
// eslint-disable-next-line no-var
var requestRegistry: Map<string, RequestFn> | undefined;
// eslint-disable-next-line no-var
var responseRegistry: Map<string, ResponseFn> | undefined;

/** Credentials with the dynamic _clientSessionId field written by translateRequest. */
type TranslatorCredentials = ExecutorCredentials & { [key: string]: JsonValue | undefined };

/** Typed alias for cloakClaudeTools return (JS file has no .d.ts). */
type CloakResult = { body: Record<string, JsonValue>; toolNameMap: Map<string, string> | null };
const cloakClaudeToolsTyped = cloakClaudeTools as (body: Record<string, JsonValue>) => CloakResult;

type RequestFn = (
  model: string,
  body: Record<string, JsonValue>,
  stream: boolean,
  credentials: TranslatorCredentials | null,
) => Record<string, JsonValue>;

type ResponseFn = (
  chunk: JsonValue,
  state: TranslatorState,
) => JsonValue;

/** Streaming state object initialised by initState(). */
export interface TranslatorState {
  messageId: string | null;
  model: string | null;
  textBlockStarted: boolean;
  thinkingBlockStarted: boolean;
  inThinkingBlock: boolean;
  currentBlockIndex: number | null;
  toolCalls: Map<string, JsonValue>;
  finishReason: string | null;
  finishReasonSent: boolean;
  usage: JsonValue | null;
  contentBlockIndex: number;
  // openai-responses extra fields (optional)
  seq?: number;
  responseId?: string;
  created?: number;
  started?: boolean;
  msgTextBuf?: Record<string, JsonValue>;
  msgItemAdded?: Record<string, JsonValue>;
  msgContentAdded?: Record<string, JsonValue>;
  msgItemDone?: Record<string, JsonValue>;
  reasoningId?: string;
  reasoningIndex?: number;
  reasoningBuf?: string;
  reasoningPartAdded?: boolean;
  reasoningDone?: boolean;
  inThinking?: boolean;
  funcArgsBuf?: Record<string, JsonValue>;
  funcNames?: Record<string, JsonValue>;
  funcCallIds?: Record<string, JsonValue>;
  funcArgsDone?: Record<string, JsonValue>;
  funcItemDone?: Record<string, JsonValue>;
  completedSent?: boolean;
}

// Register translator
export function register(
  from: string,
  to: string,
  requestFn: RequestFn | null | undefined,
  responseFn: ResponseFn | null | undefined,
): void {
  requestRegistry ??= new Map();
  responseRegistry ??= new Map();
  const key = `${from}:${to}`;
  if (requestFn) {
    requestRegistry.set(key, requestFn);
  }
  if (responseFn) {
    responseRegistry.set(key, responseFn);
  }
}

// No-op: translators self-register via the static imports at the bottom of this file.
function ensureInitialized(): void {}

// Strip specific content types from messages (explicit opt-in via strip[] in PROVIDER_MODELS)
function stripContentTypes(body: Record<string, JsonValue>, stripList: string[] = []): void {
  if (!stripList.length || !body.messages || !Array.isArray(body.messages)) return;
  const imageTypes = new Set<string>(["image_url", "image"]);
  const audioTypes = new Set<string>(["audio_url", "input_audio"]);
  const shouldStrip = (type: string): boolean => {
    if (imageTypes.has(type)) return stripList.includes("image");
    if (audioTypes.has(type)) return stripList.includes("audio");
    return false;
  };
  for (const msg of body.messages as Array<Record<string, JsonValue>>) {
    if (!Array.isArray(msg.content)) continue;
    msg.content = (msg.content as Array<Record<string, JsonValue>>).filter(
      (part) => !shouldStrip(part.type as string),
    );
    if ((msg.content as JsonValue[]).length === 0) msg.content = "";
  }
}

// Translate request: source -> openai -> target
export function translateRequest(
  sourceFormat: string,
  targetFormat: string,
  model: string,
  body: Record<string, JsonValue>,
  stream = true,
  credentials: TranslatorCredentials | null = null,
  provider: string | null = null,
  reqLogger: { logOpenAIRequest?: (r: Record<string, JsonValue>) => void } | null = null,
  stripList: string[] = [],
  connectionId: string | null = null,
  clientTool: JsonValue | null = null,
): Record<string, JsonValue> {
  ensureInitialized();
  let result = body;

  // Strip explicit content types (opt-in via strip[] in PROVIDER_MODELS entry)
  stripContentTypes(result, stripList);

  // Normalize thinking config: remove if lastMessage is not user
  normalizeThinkingConfig(result);

  // Always ensure tool_calls have id (some providers require it)
  ensureToolCallIds(result);
  
  // Fix missing tool responses (insert empty tool_result if needed)
  fixMissingToolResponses(result);

  // Capture thinking intent from the original (pre-translation) body, before any
  // format conversion strips/renames the fields. Applied after translation.
  const thinkingIntent = captureThinking(result);

  // Capture session id from the original body (envelope still intact, e.g. antigravity request.sessionId)
  const clientSessionId = captureSessionId(result, credentials, connectionId, targetFormat);
  // Expose to downstream translators (gemini-cli/antigravity envelopes) that run after envelope is stripped
  if (credentials) credentials._clientSessionId = clientSessionId;

  // If same format, skip translation steps
  if (sourceFormat !== targetFormat) {
    // Direct route: if a translator is registered for this exact source:target
    // pair, use it instead of pivoting through OpenAI. This is lossless for
    // pairs like claude:kiro (avoids the claude->openai->kiro double-hop).
    const directFn = requestRegistry!.get(`${sourceFormat}:${targetFormat}`);
    if (directFn) {
      result = directFn(model, result, stream, credentials);
    } else {
      // Step 1: source -> openai (if source is not openai)
      if (sourceFormat !== FORMATS.OPENAI) {
        const toOpenAI = requestRegistry!.get(`${sourceFormat}:${FORMATS.OPENAI}`);
        if (toOpenAI) {
          result = toOpenAI(model, result, stream, credentials);
          // Log OpenAI intermediate format
          reqLogger?.logOpenAIRequest?.(result);
        }
      }

      // Step 2: openai -> target (if target is not openai)
      if (targetFormat !== FORMATS.OPENAI) {
        const fromOpenAI = requestRegistry!.get(`${FORMATS.OPENAI}:${targetFormat}`);
        if (fromOpenAI) {
          result = fromOpenAI(model, result, stream, credentials);
        }
      }
    }
  }

  // Normalize thinking to the target provider-native format (config-driven, capability-aware)
  (applyThinking as (format: string, model: string, body: Record<string, JsonValue>, provider: string | null, intent: JsonValue | undefined) => void)(targetFormat, model, result, provider, thinkingIntent);

  // Always normalize to clean OpenAI format when target is OpenAI
  // This handles hybrid requests (e.g., OpenAI messages + Claude tools)
  if (targetFormat === FORMATS.OPENAI) {
    result = filterToOpenAIFormat(result);
  }

  // Final step: prepare request for Claude format endpoints
  if (targetFormat === FORMATS.CLAUDE) {
    const apiKey = (credentials?.accessToken || credentials?.apiKey || null) as string | null;
    result = (prepareClaudeRequest as (body: Record<string, JsonValue>, provider: string | null, apiKey: string | null, connectionId: string | null, rawHeaders: Record<string, string> | null | undefined, sessionId: string | null) => Record<string, JsonValue>)(result, provider, apiKey, connectionId, credentials?.rawHeaders, clientSessionId);
  }

  // Claude cloaking: rename client tools with _cc suffix (anti-ban)
  // quirk: only providers flagged cloakToolsOnOAuth, and only with an OAuth token
  const providerEntry = (PROVIDERS as Record<string, { quirks?: { cloakToolsOnOAuth?: boolean } }>)[provider ?? ""];
  if (providerEntry?.quirks?.cloakToolsOnOAuth) {
    const apiKey = (credentials?.accessToken || credentials?.apiKey || null) as string | null;
    if (apiKey?.includes("sk-ant-oat")) {
      const { body: cloakedBody, toolNameMap } = cloakClaudeToolsTyped(result);
      result = cloakedBody;
      if (toolNameMap !== null && toolNameMap.size > 0) {
        // _toolNameMap is an internal side-channel (Map, not JsonValue); chatCore deletes it before dispatch.
        (result as Record<string, JsonValue | Map<string, string>>)._toolNameMap = toolNameMap;
      }
    }
  }

  // Antigravity cloaking disabled
  // if (provider === FORMATS.ANTIGRAVITY && body.userAgent !== FORMATS.ANTIGRAVITY) {
  //   const { cloakedBody, toolNameMap } = AntigravityExecutor.cloakTools(result);
  //   result = cloakedBody;
  //   if (toolNameMap?.size > 0) {
  //     result._toolNameMap = toolNameMap;
  //   }
  // }

  return result;
}

/** Response array with optional OpenAI intermediate attached for logging. */
export type TranslateResponseResult = JsonValue[] & { _openaiIntermediate?: JsonValue[] };

// Translate response chunk: target -> openai -> source
export function translateResponse(
  targetFormat: string,
  sourceFormat: string,
  chunk: JsonValue,
  state: TranslatorState,
): TranslateResponseResult {
  ensureInitialized();
  // If same format, return as-is
  if (sourceFormat === targetFormat) {
    return [chunk];
  }

  let results: JsonValue[] = [chunk];
  let openaiResults: JsonValue[] | null = null; // Store OpenAI intermediate results

  // Direct route: if a response translator is registered for this exact
  // target:source pair, use it instead of pivoting through OpenAI. Mirrors the
  // request-side direct route (e.g. kiro:claude — KiroExecutor already emits
  // OpenAI-shaped chunks, so this converts them straight to Claude SSE).
  const directFn = responseRegistry!.get(`${targetFormat}:${sourceFormat}`);
  if (directFn) {
    const converted = directFn(chunk, state);
    return converted ? (Array.isArray(converted) ? converted : [converted]) : [];
  }

  // Step 1: target -> openai (if target is not openai)
  if (targetFormat !== FORMATS.OPENAI) {
    const toOpenAI = responseRegistry!.get(`${targetFormat}:${FORMATS.OPENAI}`);
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
    const fromOpenAI = responseRegistry!.get(`${FORMATS.OPENAI}:${sourceFormat}`);
    if (fromOpenAI) {
      const finalResults: JsonValue[] = [];
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
    (results as TranslateResponseResult)._openaiIntermediate = openaiResults;
  }

  return results;
}

// Check if translation needed
export function needsTranslation(sourceFormat: string, targetFormat: string): boolean {
  return sourceFormat !== targetFormat;
}

// Initialize state for streaming response based on format
export function initState(sourceFormat: string): TranslatorState {
  // Base state for all formats
  const base: TranslatorState = {
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

// Kept for backward compatibility; translators are already registered at import time.
export function initTranslators(): void {
  ensureInitialized();
}

// Static side-effect imports: each module calls register() at load (works in ESM + bundler).
import "./request/claude-to-openai.js";
import "./request/openai-to-claude.js";
import "./request/gemini-to-openai.js";
import "./request/openai-to-gemini.js";
import "./request/openai-to-vertex.js";
import "./request/antigravity-to-openai.js";
import "./request/openai-responses.js";
import "./request/openai-to-kiro.js";
import "./request/openai-to-cursor.js";
import "./request/openai-to-ollama.js";
import "./request/openai-to-commandcode.js";
import "./request/claude-to-kiro.js";
import "./response/claude-to-openai.js";
import "./response/openai-to-claude.js";
import "./response/gemini-to-openai.js";
import "./response/openai-to-antigravity.js";
import "./response/openai-responses.js";
import "./response/kiro-to-openai.js";
import "./response/cursor-to-openai.js";
import "./response/ollama-to-openai.js";
import "./response/commandcode-to-openai.js";
import "./response/kiro-to-claude.js";
