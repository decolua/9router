import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveKiroModel } from "../config/kiroConstants.js";
import { v4 as uuidv4 } from "uuid";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { STREAM_FIRST_CHUNK_TIMEOUT_MS } from "../config/runtimeConfig.js";

const KIRO_REPAIR_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
const KIRO_REPAIR_HEARTBEAT_MS = 10_000;
const KIRO_SHORT_FINAL_MAX_CHARS = 800;
const EVENTSTREAM_MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
const EVENTSTREAM_MAX_HEADERS_BYTES = 128 * 1024;
const KIRO_EVENT_TYPES = new Set([
  "assistantResponseEvent",
  "reasoningContentEvent",
  "codeEvent",
  "toolUseEvent",
  "messageStopEvent",
  "metadataEvent",
  "MetadataEvent",
  "contextUsageEvent",
  "meteringEvent",
  "metricsEvent"
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

const REPAIR_INSTRUCTIONS = Object.freeze({
  tool: "Retry the previous response because its Kiro tool_call wrapper was malformed. If you use the wrapper tool named tool_call, its input must contain a non-empty name and an arguments field.",
  ellipsis: "Retry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….",
  short_final: "Retry the previous response because its final only announced a future action. Complete the check now and return the result or a concrete blocker."
});
const SHORT_FUTURE_ACTION = /^(?:(?:(?:現在|接著|接下來|下一步)[，,:：\s]*(?:我(?:只)?(?:會|要|將|再)?\s*)?|我只再)(?:補|查|確認|驗證|追(?:查|蹤)?|繼續|檢查|測試)|我(?:會|要|將)(?:再|重新)?(?:補(?:齊|查)?|抓取|查(?:詢)?|確認|驗證|追(?:查|蹤)?|繼續|檢查|測試)|(?:(?:next|now|then)\b[\s,:-]*)?(?:i(?:'ll| will| am going to| need to)|let me)\s+(?:verify|check|confirm|validate|investigate|trace|continue|follow up|test)\b)/iu;
// Keep this tied to the observed whole-response signature. Broader Chinese
// result/progress heuristics create false positives for completed findings.
const OBSERVED_TRAILING_FUTURE_ACTION = /^目前證據顯示[\s\S]{1,700}[。.!?；;]\s*最後補查\s+504\s+access\s+log[，,]\s*確認\s+host[／/]路徑與是否為集中流量[。.!]?$/iu;
const ENGLISH_FUTURE_ACTION = /^(?:(?:next|now|then)\b[\s,:-]*)?(?:i(?:'ll| will| am going to| need to)|let me)\s+(?:verify|check|confirm|validate|investigate|trace|continue|follow up|test)\b/iu;
const ENGLISH_RESULT_CLAUSE = /(?:[:;\n]|[.!?]\s+\S|\b(?:status|checksum|response|deployment)\s+(?:is|are|was|were|matches?|equals?|returned)\b)/iu;
const CHINESE_FUTURE_ACTION = /^(?:(?:現在|接著|接下來|下一步)[，,:：\s]*(?:我(?:只)?(?:會|要|將|再)?\s*)?|我只再|我(?:會|要|將)(?:再|重新)?)(?:補|抓取|查|確認|驗證|追|繼續|檢查|測試)/u;
const CHINESE_RESULT_CLAUSE = /(?:[。！？]\s*\S|(?:版本|狀態|回應|結果|部署|校驗碼)(?:是|為|等於|顯示))/u;
const USER_WAIT = /(?:請(?:你|先)|你(?:先|需要|可以|提供|確認|批准|允許)|等待(?:你|使用者)|等你|核准|同意|授權|\b(?:after|when|once)\s+you\b|\byour\s+(?:approval|confirmation|permission|input)\b|\bwait(?:ing)?\s+for\s+you\b|\bplease\s+(?:approve|confirm|provide|send)\b)/iu;
const COMPLETED_FINAL = /(?:已(?:經)?完成|完成(?:了|驗證|確認)|修復完成|確認無誤|驗證(?:完成|通過)|測試(?:均)?通過|結論|總結|\b(?:done|completed|fixed|verified|confirmed|passed|in conclusion|summary)\b|\b(?:is|are) complete\b)/iu;
const RESULT_EVIDENCE = /(?:顯示|發現|因此|成功|失敗|正常|無錯誤|沒有錯誤|\b(?:found|shows?|showed|because|therefore|succeeded|failed|healthy|green|no errors?)\b)/iu;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function envPositiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env?.[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function concatChunks(chunks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function makeAbortError(reason) {
  const error = new Error(reason?.message || reason || "Request aborted");
  error.name = "AbortError";
  return error;
}

async function readWithTimeout(reader, signal, timeoutMs, message) {
  if (signal?.aborted) throw makeAbortError(signal.reason);
  let timeout;
  let abortHandler;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => reject(makeAbortError(signal.reason));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([reader.read(), timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abortHandler);
  }
}

async function readResponsePrefix(response, signal, maxBytes, timeoutMs) {
  const reader = response?.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let totalBytes = 0;
  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await readWithTimeout(
        reader,
        signal,
        timeoutMs,
        "Kiro retry error body stalled"
      );
      if (done) break;
      const remaining = maxBytes - totalBytes;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel("bounded Kiro retry error body").catch(() => {});
  }
  return decoder.decode(concatChunks(chunks, totalBytes));
}

function appendRepairInstruction(body, kind) {
  const repaired = structuredClone(body || {});
  const instruction = REPAIR_INSTRUCTIONS[kind] || "Retry the previous incomplete Kiro response.";
  repaired.systemPrompt = repaired.systemPrompt
    ? `${repaired.systemPrompt}\n\n${instruction}`
    : instruction;
  return repaired;
}

function normalizeStopReason(value) {
  const reason = String(value || "").trim().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_");
  if (["endturn", "end_turn", "stop", "stop_sequence"].includes(reason)) return "end_turn";
  if (["tooluse", "tool_use", "tool_calls"].includes(reason)) return "tool_use";
  if (["maxtokens", "max_tokens", "max_output_tokens", "length"].includes(reason)) return "max_tokens";
  return reason || null;
}

function stopDisposition(stopReason, hasToolCalls) {
  if (["malformed_model_output", "invalid_model_output"].includes(stopReason)) return "retryable_protocol_failure";
  if (["cancelled", "pause_turn", "model_context_window_exceeded"].includes(stopReason)) return "terminal_incomplete";
  if (stopReason === "refusal" || /(?:content.*filter|guardrail|safety|policy|blocked)/u.test(stopReason)) return "terminal_refusal";
  if (stopReason === "max_tokens") return hasToolCalls ? "terminal_incomplete" : "length";
  if (stopReason && !["end_turn", "tool_use"].includes(stopReason)) return "unknown_failure";
  if (hasToolCalls || stopReason === "tool_use") return "tool_use";
  if (!stopReason || stopReason === "end_turn") return "complete";
  return "unknown_failure";
}

function mergeStopReason(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;
  const severity = (reason) => {
    const disposition = stopDisposition(reason, false);
    if (disposition === "terminal_refusal") return 6;
    if (disposition === "terminal_incomplete") return 5;
    if (disposition === "unknown_failure") return 4;
    if (disposition === "retryable_protocol_failure") return 3;
    if (disposition === "length") return 2;
    return 1;
  };
  return severity(incoming) > severity(current) ? incoming : current;
}

function isEllipsisOnly(value) {
  return ["...", "…"].includes(String(value || "").trim());
}

function isShortFutureAction(value) {
  const text = String(value || "").trim().replaceAll("’", "'");
  if (OBSERVED_TRAILING_FUTURE_ACTION.test(text)) return true;
  if (ENGLISH_FUTURE_ACTION.test(text) && ENGLISH_RESULT_CLAUSE.test(text)) return false;
  if (CHINESE_FUTURE_ACTION.test(text) && CHINESE_RESULT_CLAUSE.test(text)) return false;
  return text.length > 0 && text.length <= KIRO_SHORT_FINAL_MAX_CHARS &&
    SHORT_FUTURE_ACTION.test(text) && !USER_WAIT.test(text) &&
    !COMPLETED_FINAL.test(text) && !RESULT_EVIDENCE.test(text);
}

function encodeSSEError(code, message, details) {
  return encoder.encode(`data: ${JSON.stringify({ error: {
    message,
    type: "upstream_error",
    code,
    ...(details ? { details } : {})
  } })}\n\ndata: [DONE]\n\n`);
}

function inspectSSEChunk(chunk, state) {
  for (const line of decoder.decode(chunk).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      if (event.error) state.error = event.error;
      for (const choice of event.choices || []) {
        const delta = choice.delta || {};
        if (typeof delta.content === "string") state.content += delta.content;
        if (typeof delta.reasoning_content === "string") state.reasoning += delta.reasoning_content;
        if (delta.tool_calls?.length) state.hasToolCalls = true;
      }
    } catch { /* a malformed SSE line is diagnosed by the transformer */ }
  }
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
    if (result?.response?.ok) this.attachIntegrityGate(result, args);
    return result;
  }

  attachIntegrityGate(result, args) {
    const abortController = new AbortController();
    const maxBytes = envPositiveInt("KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES", KIRO_REPAIR_BUFFER_MAX_BYTES);
    const legacyTimeout = envPositiveInt("KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS", STREAM_FIRST_CHUNK_TIMEOUT_MS);
    const ttftTimeoutMs = envPositiveInt("KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS", legacyTimeout);
    const stallTimeoutMs = envPositiveInt("KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS", legacyTimeout);
    const repairEnabled = args.credentials?.providerSpecificData?.kiroToolCallRepair !== false &&
      process.env.KIRO_TOOL_CALL_REPAIR !== "false";
    const forwardAbort = () => abortController.abort(args.signal?.reason);
    args.signal?.addEventListener("abort", forwardAbort, { once: true });
    let open = true;
    let heartbeatTimer;

    const stream = new ReadableStream({
      start: async (controller) => {
        const heartbeat = () => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(": kiro-validation\n\n"));
          } catch {
            open = false;
          }
        };
        heartbeat();
        heartbeatTimer = setInterval(heartbeat, KIRO_REPAIR_HEARTBEAT_MS);

        try {
          const bytes = await this.runIntegrityRecovery(result.response, args, {
            signal: abortController.signal,
            maxBytes,
            ttftTimeoutMs,
            stallTimeoutMs,
            repairEnabled
          });
          if (abortController.signal.aborted) throw makeAbortError(abortController.signal.reason);
          controller.enqueue(bytes);
          controller.close();
        } catch (error) {
          if (open && error.name === "AbortError") {
            controller.error(error);
          } else if (open && error.name !== "AbortError") {
            controller.enqueue(encodeSSEError(
              "kiro_integrity_gate_failed",
              error.message || "Kiro integrity validation failed"
            ));
            controller.close();
          }
        } finally {
          open = false;
          clearInterval(heartbeatTimer);
          args.signal?.removeEventListener?.("abort", forwardAbort);
        }
      },
      cancel(reason) {
        open = false;
        clearInterval(heartbeatTimer);
        abortController.abort(reason || "client cancelled");
      }
    });

    result.response = new Response(stream, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers: { ...SSE_HEADERS }
    });
  }

  async runIntegrityRecovery(rawResponse, args, options) {
    const first = await this.readRecoverableIntegrityAttempt(
      rawResponse,
      args.model,
      options,
      "initial"
    );
    if (first.kind === "complete") return first.bytes;
    if (first.kind === "terminal_stop" || first.kind === "upstream_error") {
      return this.integrityFailureSSE(first);
    }
    if (first.kind === "invalid_tool" && !options.repairEnabled) {
      return encodeSSEError("invalid_kiro_tool_call", first.message, first.diagnostics);
    }

    const repairKind = ["ellipsis", "short_final", "invalid_tool"].includes(first.kind)
      ? first.kind
      : null;
    const repairBody = repairKind
      ? appendRepairInstruction(args.body, repairKind === "invalid_tool" ? "tool" : repairKind)
      : structuredClone(args.body || {});

    const retry = await BaseExecutor.prototype.execute.call(this, {
      ...args,
      body: repairBody,
      signal: options.signal
    });
    if (!retry?.response?.ok) {
      let body = "";
      try {
        body = await readResponsePrefix(
          retry?.response,
          options.signal,
          Math.min(options.maxBytes, 4096),
          options.stallTimeoutMs
        );
      } catch (error) {
        if (error.name === "AbortError") throw error;
      }
      return encodeSSEError(
        "kiro_integrity_retry_upstream_error",
        body || `Kiro integrity retry failed with HTTP ${retry?.response?.status || 502}`,
        { status: retry?.response?.status || 502 }
      );
    }

    const second = await this.readRecoverableIntegrityAttempt(
      retry.response,
      args.model,
      options,
      "retry"
    );
    if (second.kind === "complete") return second.bytes;
    if (second.kind === "terminal_stop" || second.kind === "upstream_error") {
      return this.integrityFailureSSE(second);
    }
    const code = second.kind === "ellipsis"
      ? "kiro_ellipsis_retry_failed"
      : second.kind === "short_final"
        ? "kiro_short_final_retry_failed"
        : second.kind === "invalid_tool"
          ? "kiro_tool_call_repair_retry_failed"
          : "kiro_missing_terminal_retry_failed";
    return encodeSSEError(
      code,
      `Kiro integrity validation failed after one bounded retry: ${second.message || second.kind}`,
      { attempts: [first.diagnostics, second.diagnostics].filter(Boolean) }
    );
  }

  integrityFailureSSE(attempt) {
    const disposition = attempt.diagnostics?.stop_disposition;
    const code = attempt.diagnostics?.terminal_provenance === "integrity_buffer_exceeded"
      ? "kiro_integrity_buffer_exceeded"
      : attempt.kind === "upstream_error"
      ? "kiro_upstream_eventstream_error"
      : disposition === "terminal_refusal"
        ? "kiro_terminal_refusal"
        : disposition === "terminal_incomplete"
          ? "kiro_terminal_incomplete"
          : "kiro_unknown_stop_reason";
    return encodeSSEError(code, attempt.message || "Kiro stream ended with a terminal failure", attempt.diagnostics);
  }

  async readRecoverableIntegrityAttempt(rawResponse, model, options, attempt) {
    try {
      return await this.readIntegrityAttempt(rawResponse, model, options, attempt);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      return {
        kind: "missing_terminal",
        message: error.message || "Kiro transport read failed",
        diagnostics: {
          attempt,
          terminal_provenance: "transport_read_error",
          transport_state: "upstream_error",
          stop_reason: null,
          stop_disposition: "terminal_incomplete",
          response_state: "no_semantic_output",
          event_counts: {},
          incomplete_frame_bytes: 0
        }
      };
    }
  }

  async readIntegrityAttempt(rawResponse, model, options, attempt) {
    let diagnostics;
    const transformed = this.transformEventStreamToSSE(rawResponse, model, {
      maxToolBytes: Math.max(1, Math.floor(options.maxBytes / 2)),
      onTerminalState: (value) => {
        diagnostics = value;
      }
    });
    const reader = transformed.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    let sawChunk = false;
    const output = { content: "", reasoning: "", hasToolCalls: false, error: null };

    try {
      while (true) {
        const timeoutMs = sawChunk ? options.stallTimeoutMs : options.ttftTimeoutMs;
        const phase = sawChunk ? "stalled" : "timed out before first chunk";
        const { done, value } = await readWithTimeout(
          reader,
          options.signal,
          timeoutMs,
          `Kiro integrity validation ${phase}`
        );
        if (done) break;
        sawChunk = true;
        totalBytes += value.byteLength;
        if (totalBytes > options.maxBytes) {
          await reader.cancel("kiro_integrity_buffer_exceeded").catch(() => {});
          return {
            kind: "terminal_stop",
            message: `Kiro integrity buffer exceeded ${options.maxBytes} bytes`,
            diagnostics: { terminal_provenance: "integrity_buffer_exceeded" }
          };
        }
        chunks.push(value);
        inspectSSEChunk(value, output);
      }
    } catch (error) {
      await reader.cancel(error.message).catch(() => {});
      throw error;
    }

    const safeDiagnostics = {
      attempt,
      terminal_provenance: diagnostics?.terminal_provenance || "missing_terminal_diagnostics",
      transport_state: diagnostics?.transport_state || "unknown",
      stop_reason: diagnostics?.stop_reason || null,
      stop_disposition: diagnostics?.stop_disposition || "terminal_incomplete",
      response_state: diagnostics?.response_state || "no_semantic_output",
      event_counts: diagnostics?.event_counts || {},
      incomplete_frame_bytes: diagnostics?.incomplete_frame_bytes || 0
    };
    if (safeDiagnostics.stop_disposition === "retryable_protocol_failure") {
      const kind = safeDiagnostics.terminal_provenance === "invalid_tool_call"
        ? "invalid_tool"
        : "retryable_stop";
      return { kind, message: output.error?.message, diagnostics: safeDiagnostics };
    }
    if (safeDiagnostics.stop_disposition === "terminal_incomplete" ||
        safeDiagnostics.stop_disposition === "terminal_refusal" ||
        safeDiagnostics.stop_disposition === "unknown_failure") {
      const kind = safeDiagnostics.terminal_provenance === "upstream_eventstream_error"
        ? "upstream_error"
        : safeDiagnostics.terminal_provenance === "integrity_buffer_exceeded"
          ? "terminal_stop"
        : ["metadata_stop_reason", "message_stop_event"].includes(safeDiagnostics.terminal_provenance)
          ? "terminal_stop"
          : "missing_terminal";
      return { kind, message: output.error?.message, diagnostics: safeDiagnostics };
    }
    if (output.error) {
      return { kind: "missing_terminal", message: output.error.message, diagnostics: safeDiagnostics };
    }
    if (!output.hasToolCalls) {
      if (isEllipsisOnly(output.content) ||
          (!output.content.trim() && isEllipsisOnly(output.reasoning))) {
        return { kind: "ellipsis", diagnostics: safeDiagnostics };
      }
      if (isShortFutureAction(output.content)) {
        return { kind: "short_final", diagnostics: safeDiagnostics };
      }
    }
    return { kind: "complete", bytes: concatChunks(chunks, totalBytes), diagnostics: safeDiagnostics };
  }

  transformEventStreamToSSE(response, model, options = {}) {
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const capabilityModel = resolveKiroModel(model).upstream;
    const contextWindow = getCapabilitiesForModel("kiro", capabilityModel).contextWindow || 200000;
    const eventCounts = {};
    const state = {
      buffer: new Uint8Array(0),
      chunkIndex: 0,
      toolCounter: 0,
      tools: new Map(),
      bufferedToolBytes: 0,
      hasText: false,
      hasReasoning: false,
      hasCode: false,
      hasToolCalls: false,
      sawToolUse: false,
      explicitStop: false,
      stopReason: null,
      terminalProvenance: null,
      transportState: "consuming_response",
      totalContentLength: 0,
      contextUsagePercentage: 0,
      hasContextUsage: false,
      hasMetering: false,
      usage: null,
      inThinking: false,
      toolValidationError: null,
      validatedFrames: 0,
      finished: false
    };

    const diagnostics = (overrides = {}) => ({
      terminal_provenance: state.terminalProvenance || "clean_eventstream_eof",
      transport_state: state.transportState,
      stop_reason: state.stopReason,
      stop_disposition: stopDisposition(state.stopReason, state.hasToolCalls),
      response_state: state.hasToolCalls
        ? "valid_tool"
        : state.hasText || state.hasReasoning || state.hasCode
          ? "text_reasoning"
          : state.explicitStop
            ? "explicit_stop"
            : "no_semantic_output",
      event_counts: { ...eventCounts },
      incomplete_frame_bytes: state.buffer.byteLength,
      ...overrides
    });
    const sseChunk = (delta, finishReason = null, usage) => encoder.encode(`data: ${JSON.stringify({
      id: responseId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage } : {})
    })}\n\n`);
    const emitDelta = (controller, delta) => {
      if (state.chunkIndex === 0) delta = { role: "assistant", ...delta };
      state.chunkIndex++;
      controller.enqueue(sseChunk(delta));
    };
    const fail = (controller, provenance, code, message, extra = {}) => {
      state.finished = true;
      state.terminalProvenance = provenance;
      state.transportState = extra.transport_state || "corrupt_frame";
      const detail = diagnostics({
        stop_disposition: extra.stop_disposition || "terminal_incomplete",
        ...extra
      });
      options.onTerminalState?.(detail);
      controller.enqueue(encodeSSEError(code, message, detail));
    };
    const assertToolBufferBound = () => {
      if (state.bufferedToolBytes <= (options.maxToolBytes || KIRO_REPAIR_BUFFER_MAX_BYTES / 2)) return;
      const error = new Error("Kiro buffered tool input exceeded the integrity memory bound");
      error.code = "KIRO_BUFFER_EXCEEDED";
      throw error;
    };
    const appendToolInput = (tool, input) => {
      if (input === undefined) return;
      if (typeof input === "string") {
        if (tool.inputKind && tool.inputKind !== "string") throw new Error("Kiro tool input changed fragment type");
        tool.inputKind = "string";
        tool.inputChunks ||= [];
        tool.inputChunks.push(input);
        state.bufferedToolBytes += encoder.encode(input).byteLength;
      } else if (input && typeof input === "object" && !Array.isArray(input)) {
        if (tool.inputKind && tool.inputKind !== "object") throw new Error("Kiro tool input changed fragment type");
        tool.inputKind = "object";
        state.bufferedToolBytes -= tool.inputBytes || 0;
        tool.inputObject = input;
        tool.inputBytes = encoder.encode(JSON.stringify(input)).byteLength;
        state.bufferedToolBytes += tool.inputBytes;
      } else {
        throw new Error("Kiro tool input must be a JSON object");
      }
      assertToolBufferBound();
    };
    const parsedToolInput = (tool) => {
      if (!tool.inputKind) throw new Error("Kiro tool call is missing input");
      if (tool.inputKind === "object") return tool.inputObject;
      try {
        const input = JSON.parse(tool.inputChunks.join(""));
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("not an object");
        return input;
      } catch (error) {
        throw new Error(`Kiro tool input must be valid object JSON (${error.message})`);
      }
    };
    const emitTools = (controller) => {
      for (const tool of state.tools.values()) {
        const input = parsedToolInput(tool);
        if (tool.name === "tool_call") {
          if (typeof input.name !== "string" || !input.name.trim()) {
            throw new Error("Invalid Kiro tool_call payload: missing nested MCP tool name");
          }
          if (!Object.prototype.hasOwnProperty.call(input, "arguments")) {
            throw new Error("Invalid Kiro tool_call payload: missing nested MCP tool arguments");
          }
        }
        const index = state.toolCounter++;
        emitDelta(controller, {
          tool_calls: [{
            index,
            id: tool.id,
            type: "function",
            function: { name: tool.name, arguments: "" }
          }]
        });
        emitDelta(controller, {
          tool_calls: [{ index, function: { arguments: JSON.stringify(input) } }]
        });
        state.hasToolCalls = true;
      }
      state.tools.clear();
      state.bufferedToolBytes = 0;
      if (state.stopReason === "tool_use" && !state.hasToolCalls) {
        throw new Error("Kiro tool_use stop reason did not include a complete tool call");
      }
    };
    const processEvent = (event, controller) => {
      const messageType = event.headers[":message-type"];
      if (messageType === "error" || messageType === "exception") {
        fail(
          controller,
          "upstream_eventstream_error",
          "kiro_upstream_eventstream_error",
          event.payload?.message || `Kiro upstream sent an EventStream ${messageType}`,
          { transport_state: "upstream_error" }
        );
        return false;
      }

      const eventType = event.headers[":event-type"] || "";
      const eventCountKey = KIRO_EVENT_TYPES.has(eventType) ? eventType : "other";
      eventCounts[eventCountKey] = (eventCounts[eventCountKey] || 0) + 1;
      if (eventType === "assistantResponseEvent" && typeof event.payload?.content === "string") {
        let content = event.payload.content;
        if (state.inThinking) {
          const end = content.indexOf("</thinking>");
          if (end < 0) content = "";
          else {
            state.inThinking = false;
            content = content.slice(end + 11).replace(/^\n/u, "");
          }
        } else {
          const start = content.indexOf("<thinking>");
          if (start >= 0) {
            const end = content.indexOf("</thinking>", start + 10);
            if (end < 0) {
              state.inThinking = true;
              content = content.slice(0, start);
            } else {
              content = content.slice(0, start) + content.slice(end + 11).replace(/^\n/u, "");
            }
          }
        }
        if (content || !state.hasReasoning) {
          state.hasText ||= content.length > 0;
          state.totalContentLength += content.length;
          emitDelta(controller, { content });
        }
      } else if (eventType === "reasoningContentEvent") {
        const value = event.payload?.reasoningContentEvent || event.payload || {};
        const content = typeof value === "string" ? value : value.text || value.content || "";
        if (content) {
          state.hasReasoning = true;
          state.totalContentLength += content.length;
          emitDelta(controller, { reasoning_content: content });
        }
      } else if (eventType === "codeEvent" && typeof event.payload?.content === "string") {
        state.hasCode = true;
        state.totalContentLength += event.payload.content.length;
        emitDelta(controller, { content: event.payload.content });
      } else if (eventType === "toolUseEvent") {
        state.sawToolUse = true;
        if (state.toolValidationError) return true;
        const values = Array.isArray(event.payload) ? event.payload : [event.payload];
        if (!values[0]) throw new Error("Kiro toolUseEvent is empty");
        for (const value of values) {
          const name = typeof value?.name === "string" ? value.name.trim() : "";
          if (!name) throw new Error("Kiro toolUseEvent is missing a tool name");
          let id;
          if (value.toolUseId == null) {
            id = `call_${created}_${state.tools.size + 1}`;
          } else if (typeof value.toolUseId !== "string" || !value.toolUseId.trim()) {
            throw new Error("Kiro toolUseEvent has an invalid toolUseId");
          } else {
            id = value.toolUseId;
          }
          let tool = state.tools.get(id);
          if (!tool) {
            tool = { id, name };
            state.tools.set(id, tool);
            state.bufferedToolBytes += encoder.encode(id).byteLength + encoder.encode(name).byteLength + 32;
            assertToolBufferBound();
          } else if (tool.name !== name) {
            throw new Error("Kiro tool name changed between fragments");
          }
          appendToolInput(tool, value.input);
        }
      } else if (eventType === "messageStopEvent") {
        state.explicitStop = true;
        const reason = normalizeStopReason(
          event.payload?.stopReason ?? event.payload?.stop_reason
        ) || (state.sawToolUse ? "tool_use" : "end_turn");
        const merged = mergeStopReason(state.stopReason, reason);
        if (merged !== state.stopReason) state.terminalProvenance = "message_stop_event";
        state.stopReason = merged;
      } else if (eventType === "metadataEvent" || eventType === "MetadataEvent") {
        const metadata = event.payload?.metadataEvent || event.payload?.metadata || event.payload;
        const reason = normalizeStopReason(metadata?.stopReason ?? metadata?.stop_reason);
        if (reason) {
          state.explicitStop = true;
          const merged = mergeStopReason(state.stopReason, reason);
          if (merged !== state.stopReason) state.terminalProvenance = "metadata_stop_reason";
          state.stopReason = merged;
        }
      } else if (eventType === "contextUsageEvent") {
        const percentage = Number(event.payload?.contextUsagePercentage);
        if (Number.isFinite(percentage)) {
          state.contextUsagePercentage = percentage;
          state.hasContextUsage = true;
        }
      } else if (eventType === "meteringEvent") {
        state.hasMetering = true;
        const metering = event.payload?.meteringEvent || event.payload || {};
        const credits = Number(metering.usage);
        if (Number.isFinite(credits)) {
          state.usage = {
            ...(state.usage || {}),
            kiro_credits: credits,
            kiro_credit_unit: typeof metering.unit === "string" ? metering.unit : "credit"
          };
        }
      } else if (eventType === "metricsEvent") {
        const metrics = event.payload?.metricsEvent || event.payload || {};
        const prompt = Number(metrics.inputTokens) || 0;
        const completion = Number(metrics.outputTokens) || 0;
        if (prompt || completion) {
          state.usage = {
            ...(state.usage || {}),
            prompt_tokens: prompt,
            completion_tokens: completion,
            total_tokens: prompt + completion
          };
          const cacheRead = Number(metrics.cacheReadInputTokens || metrics.cache_read_input_tokens) || 0;
          const cacheCreate = Number(metrics.cacheCreationInputTokens || metrics.cache_creation_input_tokens) || 0;
          if (cacheRead) state.usage.cache_read_input_tokens = cacheRead;
          if (cacheCreate) state.usage.cache_creation_input_tokens = cacheCreate;
        }
      }
      return true;
    };
    const processBytes = (chunk, controller) => {
      const combinedLength = state.buffer.byteLength + chunk.byteLength;
      if (combinedLength > (options.maxRawBytes || EVENTSTREAM_MAX_MESSAGE_BYTES)) {
        fail(
          controller,
          "corrupt_eventstream_frame",
          "kiro_missing_terminal",
          "Kiro EventStream buffered bytes exceed the protocol bound"
        );
        return false;
      }
      if (state.buffer.byteLength === 0) {
        state.buffer = chunk;
      } else {
        const joined = new Uint8Array(combinedLength);
        joined.set(state.buffer);
        joined.set(chunk, state.buffer.byteLength);
        state.buffer = joined;
      }

      while (state.buffer.byteLength >= 12) {
        const view = new DataView(state.buffer.buffer, state.buffer.byteOffset);
        if (view.getUint32(8, false) !== crc32(state.buffer.subarray(0, 8))) {
          fail(controller, "corrupt_eventstream_frame", "kiro_missing_terminal", "Kiro EventStream prelude CRC mismatch");
          return false;
        }
        const totalLength = view.getUint32(0, false);
        const headersLength = view.getUint32(4, false);
        if (totalLength < 16 || totalLength > EVENTSTREAM_MAX_MESSAGE_BYTES ||
            headersLength > EVENTSTREAM_MAX_HEADERS_BYTES || headersLength > totalLength - 16) {
          fail(controller, "corrupt_eventstream_frame", "kiro_missing_terminal", "Kiro EventStream frame bounds are invalid");
          return false;
        }
        if (state.buffer.byteLength < totalLength) break;
        const frame = state.buffer.slice(0, totalLength);
        state.buffer = state.buffer.slice(totalLength);
        let event;
        try {
          event = parseEventFrame(frame);
        } catch (error) {
          fail(controller, "corrupt_eventstream_frame", "kiro_missing_terminal", error.message);
          return false;
        }
        state.transportState = "valid_complete_frame";
        state.validatedFrames++;
        try {
          if (!processEvent(event, controller)) return false;
        } catch (error) {
          const bufferExceeded = error.code === "KIRO_BUFFER_EXCEEDED";
          if (!bufferExceeded) {
            state.toolValidationError ||= error.message;
            state.tools.clear();
            state.bufferedToolBytes = 0;
            continue;
          }
          fail(
            controller,
            "integrity_buffer_exceeded",
            "kiro_integrity_buffer_exceeded",
            error.message,
            {
              transport_state: state.transportState,
              stop_disposition: "terminal_incomplete"
            }
          );
          return false;
        }
      }
      return true;
    };
    const finish = (controller) => {
      if (state.finished) return;
      if (state.buffer.byteLength) {
        fail(
          controller,
          "incomplete_eventstream_frame",
          "kiro_missing_terminal",
          "Kiro EventStream ended with a truncated frame",
          { transport_state: "incomplete_frame" }
        );
        return;
      }
      state.transportState = "clean_eof";
      const declaredDisposition = stopDisposition(state.stopReason, state.sawToolUse);
      if (["retryable_protocol_failure", "terminal_incomplete", "terminal_refusal", "unknown_failure"].includes(declaredDisposition)) {
        const code = declaredDisposition === "retryable_protocol_failure"
          ? "kiro_retryable_protocol_failure"
          : declaredDisposition === "terminal_refusal"
            ? "kiro_terminal_refusal"
            : declaredDisposition === "terminal_incomplete"
              ? "kiro_terminal_incomplete"
              : "kiro_unknown_stop_reason";
        fail(
          controller,
          state.terminalProvenance || "metadata_stop_reason",
          code,
          `Kiro ended with non-success stop reason: ${state.stopReason}`,
          { transport_state: state.transportState, stop_disposition: declaredDisposition }
        );
        return;
      }
      if (state.toolValidationError) {
        fail(
          controller,
          "invalid_tool_call",
          "invalid_kiro_tool_call",
          state.toolValidationError,
          { transport_state: state.transportState, stop_disposition: "retryable_protocol_failure" }
        );
        return;
      }
      try {
        emitTools(controller);
      } catch (error) {
        fail(
          controller,
          "invalid_tool_call",
          "invalid_kiro_tool_call",
          error.message,
          { transport_state: state.transportState, stop_disposition: "retryable_protocol_failure" }
        );
        return;
      }

      const hasOutput = state.hasText || state.hasReasoning || state.hasCode || state.hasToolCalls;
      if (!hasOutput && !state.explicitStop) {
        fail(
          controller,
          "empty_response_eof",
          "kiro_missing_terminal",
          "Kiro EventStream ended without model output",
          { transport_state: state.transportState }
        );
        return;
      }

      const disposition = stopDisposition(state.stopReason, state.hasToolCalls);
      if (["retryable_protocol_failure", "terminal_incomplete", "terminal_refusal", "unknown_failure"].includes(disposition)) {
        const code = disposition === "retryable_protocol_failure"
          ? "kiro_retryable_protocol_failure"
          : disposition === "terminal_refusal"
            ? "kiro_terminal_refusal"
            : disposition === "terminal_incomplete"
              ? "kiro_terminal_incomplete"
              : "kiro_unknown_stop_reason";
        fail(
          controller,
          state.terminalProvenance || "metadata_stop_reason",
          code,
          `Kiro ended with non-success stop reason: ${state.stopReason}`,
          { transport_state: state.transportState, stop_disposition: disposition }
        );
        return;
      }

      if (state.hasMetering && state.hasContextUsage && !state.usage?.total_tokens) {
        const completion = state.totalContentLength
          ? Math.max(1, Math.floor(state.totalContentLength / 4))
          : 0;
        const prompt = Math.floor(state.contextUsagePercentage * contextWindow / 100);
        state.usage = {
          ...(state.usage || {}),
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: prompt + completion
        };
      }
      const finishReason = state.hasToolCalls
        ? "tool_calls"
        : disposition === "length"
          ? "length"
          : "stop";
      controller.enqueue(sseChunk({}, finishReason, state.usage));
      controller.enqueue(encoder.encode(SSE_DONE));
      state.finished = true;
      options.onTerminalState?.(diagnostics({
        terminal_provenance: state.terminalProvenance || "clean_eventstream_eof",
        transport_state: state.transportState,
        stop_disposition: disposition
      }));
    };

    if (!response.body) {
      const detail = diagnostics({
        terminal_provenance: "missing_response_body",
        transport_state: "missing_body",
        stop_disposition: "terminal_incomplete"
      });
      options.onTerminalState?.(detail);
      return new Response(encodeSSEError(
        "kiro_missing_terminal",
        "Kiro response did not include an EventStream body",
        detail
      ), { status: response.status, headers: { ...SSE_HEADERS } });
    }

    const reader = response.body.getReader();
    const stream = new ReadableStream({
      start: async (controller) => {
        try {
          while (!state.finished) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunksBefore = state.chunkIndex;
            const framesBefore = state.validatedFrames;
            if (!processBytes(value, controller)) {
              await reader.cancel("invalid Kiro EventStream").catch(() => {});
              break;
            }
            if (state.validatedFrames > framesBefore && state.chunkIndex === chunksBefore) {
              controller.enqueue(encoder.encode(": kiro-upstream\n\n"));
            }
          }
          finish(controller);
          controller.close();
        } catch (error) {
          if (!state.finished) {
            fail(
              controller,
              "upstream_read_error",
              "kiro_missing_terminal",
              error.message || "Kiro EventStream read failed",
              { transport_state: "upstream_error" }
            );
          }
          controller.close();
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    });
    return new Response(stream, {
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
  if (!(data instanceof Uint8Array) || data.byteLength < 16) {
    throw new Error("AWS EventStream frame is shorter than 16 bytes");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalLength = view.getUint32(0, false);
  const headersLength = view.getUint32(4, false);
  if (totalLength !== data.byteLength) {
    throw new Error("AWS EventStream frame length does not match its prelude");
  }
  if (totalLength > EVENTSTREAM_MAX_MESSAGE_BYTES ||
      headersLength > EVENTSTREAM_MAX_HEADERS_BYTES ||
      headersLength > totalLength - 16) {
    throw new Error("AWS EventStream frame bounds are invalid");
  }
  if (view.getUint32(8, false) !== crc32(data.subarray(0, 8))) {
    throw new Error("AWS EventStream prelude CRC mismatch");
  }
  if (view.getUint32(totalLength - 4, false) !== crc32(data.subarray(0, totalLength - 4))) {
    throw new Error("AWS EventStream message CRC mismatch");
  }

  const headers = Object.create(null);
  const names = new Set();
  let offset = 12;
  const headerEnd = offset + headersLength;
  const requireBytes = (count) => {
    if (offset + count > headerEnd) {
      throw new Error("AWS EventStream header exceeds its declared bounds");
    }
  };

  while (offset < headerEnd) {
    requireBytes(1);
    const nameLength = data[offset++];
    requireBytes(nameLength + 1);
    const name = decoder.decode(data.subarray(offset, offset + nameLength));
    offset += nameLength;
    if (names.has(name)) throw new Error(`AWS EventStream contains duplicate header: ${name}`);
    names.add(name);
    const type = data[offset++];

    if (type === 0 || type === 1) {
      headers[name] = type === 0;
    } else if (type === 2) {
      requireBytes(1);
      headers[name] = view.getInt8(offset);
      offset += 1;
    } else if (type === 3) {
      requireBytes(2);
      headers[name] = view.getInt16(offset, false);
      offset += 2;
    } else if (type === 4) {
      requireBytes(4);
      headers[name] = view.getInt32(offset, false);
      offset += 4;
    } else if (type === 5 || type === 8) {
      requireBytes(8);
      offset += 8;
    } else if (type === 6 || type === 7) {
      requireBytes(2);
      const valueLength = view.getUint16(offset, false);
      offset += 2;
      requireBytes(valueLength);
      const bytes = data.subarray(offset, offset + valueLength);
      headers[name] = type === 7 ? decoder.decode(bytes) : bytes;
      offset += valueLength;
    } else if (type === 9) {
      requireBytes(16);
      offset += 16;
    } else {
      throw new Error(`AWS EventStream header ${name} has unknown type ${type}`);
    }
  }

  const payloadBytes = data.subarray(headerEnd, totalLength - 4);
  if (payloadBytes.byteLength === 0) return { headers, payload: null };
  const payloadText = decoder.decode(payloadBytes);
  if (!payloadText.trim()) return { headers, payload: null };
  try {
    return { headers, payload: JSON.parse(payloadText) };
  } catch (error) {
    throw new Error(`AWS EventStream payload is not valid JSON (${error.message})`);
  }
}

export default KiroExecutor;
