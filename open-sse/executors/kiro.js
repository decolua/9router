import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveKiroModel } from "../config/kiroConstants.js";
import { v4 as uuidv4 } from "uuid";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { STREAM_FIRST_CHUNK_TIMEOUT_MS } from "../config/runtimeConfig.js";

const KIRO_TOOL_CALL_WRAPPER = "tool_call";
const KIRO_TOOL_CALL_REPAIR_ENV = "KIRO_TOOL_CALL_REPAIR";
const KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES_ENV = "KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES";
const KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS_ENV = "KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS";
const KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS_ENV = "KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS";
const KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS_ENV = "KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS";
const KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
const KIRO_TOOL_CALL_REPAIR_INSTRUCTION = [
  "Retry the previous response because its Kiro tool_call wrapper was malformed.",
  "If you use the wrapper tool named tool_call, its input must be a JSON object with a non-empty string name and an arguments field.",
  "Do not emit a tool_call wrapper without input.name and input.arguments."
].join(" ");
const sharedEncoder = new TextEncoder();
const sharedDecoder = new TextDecoder();

function encodeSSE(value) {
  return sharedEncoder.encode(value);
}

function closeSSEController(controller) {
  if (typeof controller.terminate === "function") {
    controller.terminate();
  } else if (typeof controller.close === "function") {
    controller.close();
  }
}

function envInt(name, fallback) {
  const raw = process.env?.[name];
  if (raw == null || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthyConfig(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function isKiroToolCallRepairEnabled(credentials) {
  const configValue = credentials?.providerSpecificData?.kiroToolCallRepair
    ?? credentials?.providerSpecificData?.enableKiroToolCallRepair
    ?? process.env?.[KIRO_TOOL_CALL_REPAIR_ENV];
  if (configValue == null) return true;
  return isTruthyConfig(configValue);
}

function buildKiroToolCallRepairBody(body, invalidMessage) {
  const repaired = JSON.parse(JSON.stringify(body || {}));
  const reason = String(invalidMessage || "invalid tool_call payload").slice(0, 300);
  const instruction = `${KIRO_TOOL_CALL_REPAIR_INSTRUCTION} Previous validation error: ${reason}`;
  repaired.systemPrompt = repaired.systemPrompt
    ? `${repaired.systemPrompt}\n\n${instruction}`
    : instruction;
  return repaired;
}

function makeAbortError(reason) {
  const error = new Error(reason || "Request aborted");
  error.name = "AbortError";
  return error;
}

function combineAbortSignals(signals) {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 0) return { signal: undefined, cleanup: () => {} };
  if (activeSignals.length === 1) return { signal: activeSignals[0], cleanup: () => {} };

  const controller = new AbortController();
  const listeners = [];
  const abortFrom = (signal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason || makeAbortError("Request aborted"));
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push([signal, listener]);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener("abort", listener);
      }
    }
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw makeAbortError(signal.reason?.message || signal.reason || "Request aborted");
  }
}

async function readWithTimeout(reader, signal, timeoutMs, timeoutMessage) {
  throwIfAborted(signal);

  let abortHandler;
  let timeoutId;
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => reject(makeAbortError(signal?.reason?.message || signal?.reason || "Request aborted"));
    signal?.addEventListener?.("abort", abortHandler, { once: true });
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([reader.read(), abortPromise, timeoutPromise]);
  } finally {
    if (abortHandler) signal?.removeEventListener?.("abort", abortHandler);
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function concatChunks(chunks, totalBytes) {
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function hasMeaningfulSSEData(chunk) {
  const text = sharedDecoder.decode(chunk);
  return text.split("\n").some((line) => {
    if (!line.startsWith("data: ")) return false;
    const data = line.slice(6).trim();
    return data !== "" && data !== "[DONE]";
  });
}

function formatKiroToolCallRepairError(message, code = "kiro_tool_call_repair_failed") {
  return encodeSSE(`data: ${JSON.stringify({
    error: {
      message,
      type: "invalid_request_error",
      code
    }
  })}\n\ndata: [DONE]\n\n`);
}

function once(fn) {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    fn?.();
  };
}

function prependChunkToReader(firstChunk, reader, { onCancel, onDone } = {}) {
  let cancelled = false;
  const finish = once(onDone);
  return new ReadableStream({
    async start(controller) {
      try {
        if (firstChunk?.byteLength) controller.enqueue(firstChunk);
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!cancelled) controller.enqueue(value);
        }
        if (!cancelled) controller.close();
      } catch (error) {
        if (!cancelled) controller.error(error);
      } finally {
        finish();
      }
    },

    async cancel(reason) {
      cancelled = true;
      try {
        onCancel?.(reason);
      } finally {
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      }
    }
  });
}

function parseKiroToolInput(toolInput) {
  if (typeof toolInput === "string") {
    try {
      return JSON.parse(toolInput);
    } catch (error) {
      throw new Error(`Invalid Kiro tool_call payload: input must be valid JSON (${error.message})`);
    }
  }
  return toolInput;
}

function validateKiroToolName(toolUse) {
  const toolName = typeof toolUse?.name === "string" ? toolUse.name.trim() : "";
  if (!toolName) {
    throw new Error("Invalid Kiro toolUseEvent: missing tool name");
  }

  return toolName;
}

function getBufferedKiroToolInput(toolCall) {
  if (toolCall.inputKind === "string") return toolCall.inputText || "";
  return toolCall.inputObject;
}

function appendBufferedKiroToolInput(toolCall, toolInput) {
  if (toolInput === undefined) return;

  if (typeof toolInput === "string") {
    if (toolCall.inputKind && toolCall.inputKind !== "string") {
      throw new Error("Invalid Kiro tool_call payload: mixed input fragment types");
    }
    toolCall.inputKind = "string";
    toolCall.inputText = `${toolCall.inputText || ""}${toolInput}`;
    return;
  }

  if (toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)) {
    if (toolCall.inputKind && toolCall.inputKind !== "object") {
      throw new Error("Invalid Kiro tool_call payload: mixed input fragment types");
    }
    toolCall.inputKind = "object";
    toolCall.inputObject = toolInput;
  }
}

function validateKiroToolCallWrapperInput(toolInput) {
  if (toolInput === undefined) {
    throw new Error("Invalid Kiro tool_call payload: missing input");
  }

  const input = parseKiroToolInput(toolInput);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid Kiro tool_call payload: input must be an object with name and arguments");
  }

  const nestedName = typeof input.name === "string" ? input.name.trim() : "";
  if (!nestedName) {
    throw new Error("Invalid Kiro tool_call payload: missing nested MCP tool name at input.name");
  }

  if (!Object.prototype.hasOwnProperty.call(input, "arguments")) {
    throw new Error("Invalid Kiro tool_call payload: missing nested MCP tool arguments at input.arguments");
  }
}

/**
 * Validate a complete Kiro toolUseEvent payload. Streaming wrapper tool_call
 * fragments must be buffered first; otherwise an init/delta fragment without
 * the final nested input would be rejected as malformed.
 */
export function validateKiroToolUse(toolUse) {
  const toolName = validateKiroToolName(toolUse);
  if (toolName !== KIRO_TOOL_CALL_WRAPPER) {
    return;
  }

  validateKiroToolCallWrapperInput(toolUse.input);
}

function emitKiroToolCallValidationError(controller, state, message, options = {}) {
  const error = {
    error: {
      message,
      type: "invalid_request_error",
      code: options.invalidToolCallErrorCode || "invalid_kiro_tool_call"
    }
  };
  state.invalidToolCall = true;
  state.finishEmitted = true;
  state.doneSent = true;
  options.onInvalidToolCall?.(message);
  if (!options.suppressInvalidToolCallError) {
    controller.enqueue(encodeSSE(`data: ${JSON.stringify(error)}\n\n`));
    controller.enqueue(encodeSSE(SSE_DONE));
  }
  closeSSEController(controller);
}

/**
 * KiroExecutor - Executor for Kiro AI (AWS CodeWhisperer)
 * Uses AWS CodeWhisperer streaming API with AWS EventStream binary format
 */
export class KiroExecutor extends BaseExecutor {
  constructor() {
    super("kiro", PROVIDERS.kiro);
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      ...this.config.headers,
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": uuidv4()
    };

    // API-key auth: the key is stored as accessToken and sent as a bearer token
    // exactly like an OAuth access token, but with an extra `tokentype: API_KEY`
    // header so CodeWhisperer treats it as a long-lived API key rather than an
    // OIDC/social access token. Mirrors the Kiro IDE headless-auth behavior.
    // Enterprise / Microsoft Entra (external_idp) tokens are OAuth access tokens,
    // but CodeWhisperer requires TokenType=EXTERNAL_IDP to bind them to profiles.
    const authMethod = credentials?.providerSpecificData?.authMethod;
    const isApiKey = authMethod === "api_key";
    const isExternalIdp = authMethod === "external_idp";

    const apiKey = credentials?.apiKey || (isApiKey ? credentials?.accessToken : null);
    if (isApiKey && apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["tokentype"] = "API_KEY";
    } else if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      if (isExternalIdp) {
        headers["TokenType"] = "EXTERNAL_IDP";
      }
    }

    return headers;
  }

  /**
   * Auth-aware endpoint ordering.
   *
   * API-key Kiro connections store a raw CodeWhisperer credential (validated
   * against codewhisperer.us-east-1.amazonaws.com via ListAvailableProfiles).
   * The Kiro IDE gateway (runtime.*.kiro.dev) expects Kiro OIDC/social tokens
   * and rejects an `tokentype: API_KEY` token with 401/403 — which
   * BaseExecutor.execute() returns immediately (only 429 / network errors fall
   * through to the next host). So for api-key auth we must try the *.amazonaws.com
   * CodeWhisperer hosts FIRST, mirroring the Kiro-Go reference fork which never
   * routes api-key traffic through kiro.dev. External IdP enterprise tokens also
   * use the CodeWhisperer surface, with the `TokenType: EXTERNAL_IDP` header.
   * Other OAuth methods keep the default order (kiro.dev first) since their
   * tokens are what that gateway accepts.
   */
  getOrderedBaseUrls(credentials) {
    const baseUrls = this.getBaseUrls();
    const authMethod = credentials?.providerSpecificData?.authMethod;
    // IAM Identity Center (idc) tokens are AWS SSO access tokens — the same
    // family as external_idp/api_key. The kiro.dev gateway rejects them with
    // 403 "bearer token invalid", so they must hit the CodeWhisperer
    // *.amazonaws.com surface, and in the region the token was minted in
    // (the baseUrls are hardcoded us-east-1).
    const isCodeWhispererSurface =
      authMethod === "api_key" || authMethod === "external_idp" || authMethod === "idc";
    if (!isCodeWhispererSurface) return baseUrls;

    const region = (credentials?.providerSpecificData?.region || "us-east-1").trim();
    const regionalize = (u) =>
      region && region !== "us-east-1" && u.includes("amazonaws.com")
        ? u.replace(/([a-z]+)\.[a-z0-9-]+\.amazonaws\.com/, `$1.${region}.amazonaws.com`)
        : u;

    const amazon = baseUrls.filter((u) => u.includes("amazonaws.com")).map(regionalize);
    const others = baseUrls.filter((u) => !u.includes("amazonaws.com"));
    return amazon.length > 0 ? [...amazon, ...others] : baseUrls;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrls = this.getOrderedBaseUrls(credentials);
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  transformRequest(model, body, stream, credentials) {
    return body;
  }

  /**
   * Kiro execute — delegate to BaseExecutor for endpoint fallback + retry, then
   * transform the binary AWS EventStream into OpenAI-shaped SSE on success.
   *
   * BaseExecutor.execute() walks config.baseUrls (runtime.us-east-1.kiro.dev →
   * codewhisperer → q) advancing to the next host on 429 (shouldRetry) and on
   * network/5xx errors, while tryRetry handles in-place retries per `retry: {429: 2}`.
   * Note: api-key connections reorder these so the *.amazonaws.com hosts come
   * first — see getOrderedBaseUrls/buildUrl above.
   * Note: the baseUrls are alternate surfaces of one regional service, so rotation
   * is edge-level failover — it does not grant fresh 429 quota. Per-account 429
   * spreading is handled upstream by account rotation in sse/handlers/chat.js.
   *
   * Errors are returned untransformed so the upstream handler can read the body,
   * classify the status, and trigger account fallback/cooldown.
   */
  async execute(args) {
    const result = await super.execute(args);
    if (result?.response?.ok) {
      if (args.stream !== false && isKiroToolCallRepairEnabled(args.credentials)) {
        return this.createToolCallRepairResult(result, args);
      }
      result.response = this.transformEventStreamToSSE(result.response, args.model);
    }
    return result;
  }

  async createToolCallRepairResult(firstResult, args) {
    const executeRaw = (nextArgs) => BaseExecutor.prototype.execute.call(this, nextArgs);
    const repairController = new AbortController();
    const combined = combineAbortSignals([args.signal, repairController.signal]);
    let cleanupInFinally = true;
    const maxBufferBytes = envInt(
      KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES_ENV,
      KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES
    );
    const legacyTimeoutMs = envInt(KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS_ENV, STREAM_FIRST_CHUNK_TIMEOUT_MS);
    const ttftTimeoutMs = envInt(KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS_ENV, legacyTimeoutMs);
    const stallTimeoutMs = envInt(KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS_ENV, legacyTimeoutMs);

    // Repair is intentionally limited to the pre-output gate. Once a real data
    // chunk is released, streaming TTFT wins and later invalid wrappers surface
    // as validation errors instead of replaying behind already-visible output.
    try {
      const firstAttempt = await this.openToolCallRepairGate(firstResult.response, args, {
        signal: combined.signal,
        maxBufferBytes,
        ttftTimeoutMs,
        stallTimeoutMs,
        suppressInvalidToolCallError: true
      });

      if (firstAttempt.kind === "stream") {
        cleanupInFinally = false;
        firstResult.response = new Response(
          prependChunkToReader(firstAttempt.firstChunk, firstAttempt.reader, {
            onCancel: (reason) => repairController.abort(reason || "cancelled"),
            onDone: combined.cleanup
          }),
          {
            status: firstResult.response.status,
            statusText: firstResult.response.statusText,
            headers: { ...SSE_HEADERS }
          }
        );
        return firstResult;
      }

      if (firstAttempt.kind === "complete") {
        firstResult.response = new Response(firstAttempt.bytes, {
          status: firstResult.response.status,
          statusText: firstResult.response.statusText,
          headers: { ...SSE_HEADERS }
        });
        return firstResult;
      }

      if (firstAttempt.kind === "buffer_exceeded") {
        firstResult.response = new Response(formatKiroToolCallRepairError(
          `Kiro tool_call repair buffer exceeded ${maxBufferBytes} bytes`,
          "kiro_tool_call_repair_buffer_exceeded"
        ), {
          status: firstResult.response.status,
          statusText: firstResult.response.statusText,
          headers: { ...SSE_HEADERS }
        });
        return firstResult;
      }

      const repairBody = buildKiroToolCallRepairBody(args.body, firstAttempt.invalidToolCall);
      const retryResult = await executeRaw({
        ...args,
        body: repairBody,
        signal: combined.signal
      });

      if (!retryResult?.response?.ok) {
        return retryResult;
      }

      const retryAttempt = await this.openToolCallRepairGate(retryResult.response, args, {
        signal: combined.signal,
        maxBufferBytes,
        ttftTimeoutMs,
        stallTimeoutMs,
        suppressInvalidToolCallError: false,
        invalidToolCallErrorCode: "kiro_tool_call_repair_retry_failed"
      });

      if (retryAttempt.kind === "stream") {
        cleanupInFinally = false;
        retryResult.response = new Response(
          prependChunkToReader(retryAttempt.firstChunk, retryAttempt.reader, {
            onCancel: (reason) => repairController.abort(reason || "cancelled"),
            onDone: combined.cleanup
          }),
          {
            status: retryResult.response.status,
            statusText: retryResult.response.statusText,
            headers: { ...SSE_HEADERS }
          }
        );
        return retryResult;
      }

      if (retryAttempt.kind === "complete") {
        retryResult.response = new Response(retryAttempt.bytes, {
          status: retryResult.response.status,
          statusText: retryResult.response.statusText,
          headers: { ...SSE_HEADERS }
        });
        return retryResult;
      }

      retryResult.response = new Response(formatKiroToolCallRepairError(
        retryAttempt.kind === "buffer_exceeded"
          ? `Kiro tool_call repair buffer exceeded ${maxBufferBytes} bytes`
          : retryAttempt.invalidToolCall || "Kiro tool_call repair retry failed",
        retryAttempt.kind === "buffer_exceeded"
          ? "kiro_tool_call_repair_buffer_exceeded"
          : "kiro_tool_call_repair_retry_failed"
      ), {
        status: retryResult.response.status,
        statusText: retryResult.response.statusText,
        headers: { ...SSE_HEADERS }
      });
      return retryResult;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      firstResult.response = new Response(formatKiroToolCallRepairError(
        error.message || "Kiro tool_call repair failed"
      ), {
        status: firstResult.response.status,
        statusText: firstResult.response.statusText,
        headers: { ...SSE_HEADERS }
      });
      return firstResult;
    } finally {
      if (cleanupInFinally) combined.cleanup();
    }
  }

  async openToolCallRepairGate(rawResponse, args, options) {
    let invalidToolCall = null;
    const transformed = this.transformEventStreamToSSE(rawResponse, args.model, {
      onInvalidToolCall: (message) => {
        invalidToolCall = message;
      },
      suppressInvalidToolCallError: options.suppressInvalidToolCallError,
      invalidToolCallErrorCode: options.invalidToolCallErrorCode
    });
    const reader = transformed.body.getReader();
    const bufferedChunks = [];
    let totalBytes = 0;
    let sawAnyChunk = false;

    try {
      while (true) {
        const timeoutMs = sawAnyChunk ? options.stallTimeoutMs : options.ttftTimeoutMs;
        const timeoutKind = sawAnyChunk ? "stalled" : "timed out before first chunk";
        const { done, value } = await readWithTimeout(
          reader,
          options.signal,
          timeoutMs,
          `Kiro tool_call repair ${timeoutKind}`
        );

        if (done) {
          if (invalidToolCall) {
            return { kind: "invalid", invalidToolCall };
          }
          return { kind: "complete", bytes: concatChunks(bufferedChunks, totalBytes) };
        }

        sawAnyChunk = true;
        if (invalidToolCall) {
          await reader.cancel("invalid_kiro_tool_call").catch(() => {});
          return { kind: "invalid", invalidToolCall };
        }

        totalBytes += value.byteLength;
        if (totalBytes > options.maxBufferBytes) {
          await reader.cancel("kiro_tool_call_repair_buffer_exceeded").catch(() => {});
          return { kind: "buffer_exceeded" };
        }

        if (hasMeaningfulSSEData(value)) {
          return { kind: "stream", firstChunk: value, reader };
        }

        bufferedChunks.push(value);
      }
    } catch (error) {
      await reader.cancel(error.message || "kiro_tool_call_repair_failed").catch(() => {});
      throw error;
    }
  }

  /**
   * Transform AWS EventStream binary response to SSE text stream.
   * This pumps the upstream reader directly so a malformed wrapper can emit a
   * clean SSE error and then cancel the upstream HTTP body immediately.
   */
  transformEventStreamToSSE(response, model, options = {}) {
    let buffer = new Uint8Array(0);
    let chunkIndex = 0;
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const capabilityModel = resolveKiroModel(model).upstream;
    const contextWindow = getCapabilitiesForModel("kiro", capabilityModel).contextWindow || 200000;
    const state = {
      endDetected: false,
      finishEmitted: false,
      hasToolCalls: false,
      hasReasoningContent: false,
      reasoningChunkCount: 0,
      toolCallIndex: 0,
      generatedToolIdCounter: 0,
      seenToolIds: new Map(),
      pendingWrapperToolCalls: new Map(),
      inThinking: false
    };

    const getToolCallId = (toolUse) => {
      if (typeof toolUse?.toolUseId === "string" && toolUse.toolUseId) {
        return toolUse.toolUseId;
      }
      state.generatedToolIdCounter++;
      return `call_${created}_${state.generatedToolIdCounter}`;
    };

    const getOrAssignToolIndex = (toolCallId) => {
      if (state.seenToolIds.has(toolCallId)) {
        return { toolIndex: state.seenToolIds.get(toolCallId), isNewTool: false };
      }
      const toolIndex = state.toolCallIndex++;
      state.seenToolIds.set(toolCallId, toolIndex);
      return { toolIndex, isNewTool: true };
    };

    const emitToolCallStart = (controller, toolCallId, toolName, toolIndex) => {
      const startChunk = {
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: {
            ...(chunkIndex === 0 ? { role: "assistant" } : {}),
            tool_calls: [{
              index: toolIndex,
              id: toolCallId,
              type: "function",
              function: {
                name: toolName,
                arguments: ""
              }
            }]
          },
          finish_reason: null
        }]
      };
      chunkIndex++;
      controller.enqueue(encodeSSE(`data: ${JSON.stringify(startChunk)}\n\n`));
    };

    const emitToolCallArguments = (controller, toolIndex, argumentsStr) => {
      const argsChunk = {
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: toolIndex,
              function: {
                arguments: argumentsStr
              }
            }]
          },
          finish_reason: null
        }]
      };
      chunkIndex++;
      controller.enqueue(encodeSSE(`data: ${JSON.stringify(argsChunk)}\n\n`));
    };

    const failInvalidToolCall = (controller, message) => {
      emitKiroToolCallValidationError(controller, state, message, options);
      buffer = new Uint8Array(0);
    };

    const flushPendingWrapperToolCalls = (controller) => {
      if (state.pendingWrapperToolCalls.size === 0) return true;

      for (const toolCall of state.pendingWrapperToolCalls.values()) {
        const toolInput = getBufferedKiroToolInput(toolCall);
        try {
          validateKiroToolCallWrapperInput(toolInput);
        } catch (error) {
          failInvalidToolCall(controller, error.message);
          return false;
        }

        const { toolIndex } = getOrAssignToolIndex(toolCall.toolCallId);
        const argumentsStr = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput);
        toolCall.toolIndex = toolIndex;
        emitToolCallStart(controller, toolCall.toolCallId, toolCall.toolName, toolIndex);
        if (argumentsStr) {
          emitToolCallArguments(controller, toolIndex, argumentsStr);
        }
      }

      state.pendingWrapperToolCalls.clear();
      return true;
    };

    const transformChunk = async (chunk, controller) => {
        if (state.invalidToolCall) return;
        // Track output so we can emit a keepalive if this frame yields no chunk.
        const enqueueCountBefore = chunkIndex;
        // Append to buffer
        const newBuffer = new Uint8Array(buffer.length + chunk.length);
        newBuffer.set(buffer);
        newBuffer.set(chunk, buffer.length);
        buffer = newBuffer;

        // Parse events from buffer
        let iterations = 0;
        const maxIterations = 1000;
        while (buffer.length >= 16 && iterations < maxIterations) {
          iterations++;
          const view = new DataView(buffer.buffer, buffer.byteOffset);
          const totalLength = view.getUint32(0, false);

          if (totalLength < 16 || totalLength > buffer.length || buffer.length < totalLength) break;

          const eventData = buffer.slice(0, totalLength);
          buffer = buffer.slice(totalLength);

          const event = parseEventFrame(eventData);
          if (!event) continue;

          const eventType = event.headers[":event-type"] || "";

          // Track total content length for token estimation
          if (!state.totalContentLength) state.totalContentLength = 0;
          if (!state.contextUsagePercentage) state.contextUsagePercentage = 0;

          // Handle assistantResponseEvent
          if (eventType === "assistantResponseEvent" && event.payload?.content) {
            let content = event.payload.content;

            // Kiro Claude models can leak <thinking> blocks into the content stream.
            // We strip these literal tags to prevent duplication, as the reasoning 
            // is already routed correctly via reasoningContentEvent.
            if (state.inThinking) {
              if (content.includes("</thinking>")) {
                state.inThinking = false;
                const after = content.split("</thinking>").slice(1).join("</thinking>");
                content = after.startsWith("\n") ? after.substring(1) : after;
              } else {
                content = ""; // Drop entirely while inside thinking block
              }
            } else if (content.includes("<thinking>")) {
              state.inThinking = true;
              if (content.includes("</thinking>")) {
                state.inThinking = false;
                const before = content.split("<thinking>")[0];
                const after = content.split("</thinking>").slice(1).join("</thinking>");
                content = before + (after.startsWith("\n") ? after.substring(1) : after);
              } else {
                content = content.split("<thinking>")[0];
              }
            }

            if (!content && state.hasReasoningContent) {
              // If we stripped everything, skip emitting an empty content chunk
              continue;
            }

            state.totalContentLength += content.length;

            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: chunkIndex === 0
                  ? { role: "assistant", content }
                  : { content },
                finish_reason: null
              }]
            };
            chunkIndex++;
            controller.enqueue(encodeSSE(`data: ${JSON.stringify(chunk)}\n\n`));
          }

          // Handle reasoningContentEvent (Kiro thinking / reasoning)
          // Kiro returns reasoning as a separate event when the request system
          // prompt contains <thinking_mode>enabled</thinking_mode>. Surface it
          // as OpenAI delta.reasoning_content so downstream translators can map
          // it back to Claude thinking blocks / Anthropic reasoning, etc.
          if (eventType === "reasoningContentEvent") {
            const reasoning = event.payload?.reasoningContentEvent || event.payload || {};
            const reasoningText = (typeof reasoning === "string")
              ? reasoning
              : (reasoning.text || reasoning.content || "");
            if (reasoningText) {
              state.hasReasoningContent = true;
              state.totalContentLength += reasoningText.length;

              const reasoningDelta = state.reasoningChunkCount === 0 && chunkIndex === 0
                ? { role: "assistant", reasoning_content: reasoningText }
                : { reasoning_content: reasoningText };

              const chunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: reasoningDelta,
                  finish_reason: null
                }]
              };
              chunkIndex++;
              state.reasoningChunkCount++;
              controller.enqueue(encodeSSE(`data: ${JSON.stringify(chunk)}\n\n`));
            }
          }

          // Handle codeEvent
          if (eventType === "codeEvent" && event.payload?.content) {
            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: { content: event.payload.content },
                finish_reason: null
              }]
            };
            chunkIndex++;
            controller.enqueue(encodeSSE(`data: ${JSON.stringify(chunk)}\n\n`));
          }

          // Handle toolUseEvent
          if (eventType === "toolUseEvent" && event.payload) {
            state.hasToolCalls = true;
            const toolUse = event.payload;
            const toolUses = Array.isArray(toolUse) ? toolUse : [toolUse];

            for (const singleToolUse of toolUses) {
              let toolName;
              try {
                toolName = validateKiroToolName(singleToolUse);
              } catch (error) {
                failInvalidToolCall(controller, error.message);
                return;
              }

              const toolCallId = getToolCallId(singleToolUse);
              const toolInput = singleToolUse.input;

              if (toolName === KIRO_TOOL_CALL_WRAPPER) {
                let toolCall = state.pendingWrapperToolCalls.get(toolCallId);
                if (!toolCall) {
                  if (state.seenToolIds.has(toolCallId)) {
                    failInvalidToolCall(controller, "Invalid Kiro tool_call payload: duplicate toolUseId reused by wrapper");
                    return;
                  }
                  toolCall = { toolCallId, toolName };
                  state.pendingWrapperToolCalls.set(toolCallId, toolCall);
                }
                try {
                  appendBufferedKiroToolInput(toolCall, toolInput);
                } catch (error) {
                  failInvalidToolCall(controller, error.message);
                  return;
                }
                continue;
              }

              if (state.pendingWrapperToolCalls.has(toolCallId)) {
                failInvalidToolCall(controller, "Invalid Kiro tool_call payload: mixed wrapper and direct tool fragments");
                return;
              }

              const { toolIndex, isNewTool } = getOrAssignToolIndex(toolCallId);
              if (isNewTool) {
                emitToolCallStart(controller, toolCallId, toolName, toolIndex);
              }

              if (toolInput !== undefined) {
                let argumentsStr;

                if (typeof toolInput === 'string') {
                  argumentsStr = toolInput;
                } else if (typeof toolInput === 'object') {
                  argumentsStr = JSON.stringify(toolInput);
                } else {
                  continue;
                }

                emitToolCallArguments(controller, toolIndex, argumentsStr);
              }
            }
          }

          // Handle messageStopEvent
          if (eventType === "messageStopEvent") {
            if (!flushPendingWrapperToolCalls(controller)) return;
            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: state.hasToolCalls ? "tool_calls" : "stop"
              }]
            };
            state.finishEmitted = true;
            controller.enqueue(encodeSSE(`data: ${JSON.stringify(chunk)}\n\n`));
          }

          // Handle contextUsageEvent to extract contextUsagePercentage
          if (eventType === "contextUsageEvent" && event.payload?.contextUsagePercentage) {
            state.contextUsagePercentage = event.payload.contextUsagePercentage;
            // Mark that we received context usage event
            state.hasContextUsage = true;
          }

          // Handle meteringEvent - mark that we received it
          if (eventType === "meteringEvent") {
            state.hasMeteringEvent = true;
          }

          // Handle metricsEvent for token usage
          if (eventType === "metricsEvent") {
            // Extract usage data from metricsEvent payload
            const metrics = event.payload?.metricsEvent || event.payload;
            if (metrics && typeof metrics === 'object') {
              const inputTokens = metrics.inputTokens || 0;
              const outputTokens = metrics.outputTokens || 0;
              // ponytail: Amazon Q upstream does not expose cache fields today,
              // but pick up cache_read_input_tokens / cache_creation_input_tokens
              // if the event shape grows them so cost tracking stays accurate.
              const cachedTokens = metrics.cacheReadInputTokens || metrics.cache_read_input_tokens || 0;
              const cacheCreationInputTokens = metrics.cacheCreationInputTokens || metrics.cache_creation_input_tokens || 0;

              if (inputTokens > 0 || outputTokens > 0) {
                state.usage = {
                  prompt_tokens: inputTokens,
                  completion_tokens: outputTokens,
                  total_tokens: inputTokens + outputTokens
                };
                // Kiro is Claude-backed: inputTokens EXCLUDES cache (Claude convention),
                // not inclusive like OpenAI's cached_tokens. Emit cache_read_input_tokens
                // (not cached_tokens) so canonicalizeUsage takes the Claude fold path and
                // correctly adds cache back into prompt_tokens instead of undercharging.
                if (cachedTokens > 0) state.usage.cache_read_input_tokens = cachedTokens;
                if (cacheCreationInputTokens > 0) state.usage.cache_creation_input_tokens = cacheCreationInputTokens;
              }
            }
          }

          // Emit final chunk only after receiving BOTH meteringEvent AND contextUsageEvent
          if (state.hasMeteringEvent && state.hasContextUsage && !state.finishEmitted) {
            if (!flushPendingWrapperToolCalls(controller)) return;
            state.finishEmitted = true;

            // Estimate tokens if not available from events
            if (!state.usage) {
              // Estimate output tokens from content length
              const estimatedOutputTokens = state.totalContentLength > 0
                ? Math.max(1, Math.floor(state.totalContentLength / 4))
                : 0;

              // Estimate input tokens from contextUsagePercentage
              const estimatedInputTokens = state.contextUsagePercentage > 0
                ? Math.floor(state.contextUsagePercentage * contextWindow / 100)
                : 0;

              state.usage = {
                prompt_tokens: estimatedInputTokens,
                completion_tokens: estimatedOutputTokens,
                total_tokens: estimatedInputTokens + estimatedOutputTokens
              };
            }

            const finishChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: state.hasToolCalls ? "tool_calls" : "stop"
              }]
            };

            // Include usage in final chunk if available
            if (state.usage) {
              finishChunk.usage = state.usage;
            }

            controller.enqueue(encodeSSE(`data: ${JSON.stringify(finishChunk)}\n\n`));
          }
        }

        if (iterations >= maxIterations) {
          console.warn("[Kiro] Max iterations reached in event parsing");
        }

        // No client chunk produced this frame — emit an SSE comment keepalive
                // so the stall watchdog sees upstream activity (ignored by parser/client).
                if (chunkIndex === enqueueCountBefore && !state.finishEmitted) {
                  controller.enqueue(encodeSSE(": ka\n\n"));
                }
      };

      const flushOutput = (controller) => {
        if (state.invalidToolCall) return false;
        if (!flushPendingWrapperToolCalls(controller)) return false;
        // Emit finish chunk if not already sent
        if (!state.finishEmitted) {
          state.finishEmitted = true;
          const finishChunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: state.hasToolCalls ? "tool_calls" : "stop"
            }]
          };
          controller.enqueue(encodeSSE(`data: ${JSON.stringify(finishChunk)}\n\n`));
        }

        // Send final done message
        if (!state.doneSent) {
          state.doneSent = true;
          controller.enqueue(encodeSSE(SSE_DONE));
        }
        return true;
      };

    if (!response.body) {
      return new Response(SSE_DONE, { status: response.status, headers: { "Content-Type": "text/event-stream" } });
    }
    let reader;
    const transformedStream = new ReadableStream({
      async start(controller) {
        reader = response.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            await transformChunk(value, controller);
            if (state.invalidToolCall) {
              await reader.cancel("invalid_kiro_tool_call").catch(() => {});
              return;
            }
          }

          if (flushOutput(controller)) {
            closeSSEController(controller);
          }
        } catch (error) {
          if (state.invalidToolCall) return;
          controller.error(error);
        }
      },

      cancel(reason) {
        return reader?.cancel(reason);
      }
    });

    return new Response(transformedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: { ...SSE_HEADERS }
    });
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    try {
      // Use centralized refreshKiroToken function (handles both AWS SSO OIDC and Social Auth)
      const result = await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log,
        proxyOptions
      );

      return result;
    } catch (error) {
      log?.error?.("TOKEN", `Kiro refresh error: ${error.message}`);
      return null;
    }
  }
}

/**
 * Parse AWS EventStream frame
 */
function parseEventFrame(data) {
  try {
    const view = new DataView(data.buffer, data.byteOffset);
    const headersLength = view.getUint32(4, false);

    // Parse headers
    const headers = {};
    let offset = 12; // After prelude
    const headerEnd = 12 + headersLength;

    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset];
      offset++;
      if (offset + nameLen > data.length) break;

      const name = sharedDecoder.decode(data.slice(offset, offset + nameLen));
      offset += nameLen;

      const headerType = data[offset];
      offset++;

      if (headerType === 7) { // String type
        const valueLen = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        if (offset + valueLen > data.length) break;

        const value = sharedDecoder.decode(data.slice(offset, offset + valueLen));
        offset += valueLen;
        headers[name] = value;
      } else {
        break;
      }
    }

    // Parse payload
    const payloadStart = 12 + headersLength;
    const payloadEnd = data.length - 4; // Exclude message CRC

    let payload = null;
    if (payloadEnd > payloadStart) {
      const payloadStr = sharedDecoder.decode(data.slice(payloadStart, payloadEnd));

      // Skip empty or whitespace-only payloads
      if (!payloadStr || !payloadStr.trim()) {
        return { headers, payload: null };
      }

      try {
        payload = JSON.parse(payloadStr);
      } catch (parseError) {
        // Log parse error for debugging
        console.warn(`[Kiro] Failed to parse payload: ${parseError.message} | payload: ${payloadStr.substring(0, 100)}`);
        payload = { raw: payloadStr };
      }
    }

    return { headers, payload };
  } catch {
    return null;
  }
}

export default KiroExecutor;
