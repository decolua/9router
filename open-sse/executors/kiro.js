import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveKiroModel } from "../config/kiroConstants.js";
import { v4 as uuidv4 } from "uuid";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { getKiroUsage } from "../services/usage/kiro.js";
import { KIRO_CREDIT_EXHAUSTION_PROBE_MS } from "../config/errorConfig.js";

/**
 * Confirmed-exhaustion signal for Kiro's monthly credit quota. Verified against a real
 * CodeWhisperer GenerateAssistantResponse 402 body (AWS ServiceQuotaExceededException):
 *   { "message": "You have reached the limit.",
 *     "cause": { "$metadata": { "httpStatusCode": 402 }, "name": "ServiceQuotaExceededException",
 *                "reason": "MONTHLY_REQUEST_COUNT" } }
 * Some surfaces flatten `cause.name`/`cause.reason` onto the top-level object instead, so both
 * shapes are checked. Any other 402 (bad payment method, suspended account, unrecognized shape)
 * is left ambiguous and keeps the existing generic 402 cooldown (open-sse/config/errorConfig.js).
 */
const KIRO_QUOTA_EXCEEDED_EXCEPTION = "ServiceQuotaExceededException";
const KIRO_QUOTA_EXCEEDED_REASON = "MONTHLY_REQUEST_COUNT";

/** Follow-up quota-lookup timeout — bounds how long a confirmed-402 error response can wait. */
const KIRO_RESET_LOOKUP_TIMEOUT_MS = 8000;

function isConfirmedKiroCreditExhaustion(bodyText) {
  if (!bodyText) return false;
  try {
    const json = JSON.parse(bodyText);
    const name = json?.name ?? json?.cause?.name;
    const reason = json?.reason ?? json?.cause?.reason;
    if (name === KIRO_QUOTA_EXCEEDED_EXCEPTION && reason === KIRO_QUOTA_EXCEEDED_REASON) return true;
  } catch { /* not JSON — fall through to the text-based check below */ }
  const lower = bodyText.toLowerCase();
  return lower.includes(KIRO_QUOTA_EXCEEDED_EXCEPTION.toLowerCase())
    && lower.includes(KIRO_QUOTA_EXCEEDED_REASON.toLowerCase());
}

/** Earliest resetAt (ms epoch) among fully-depleted quota buckets, or null if none/unknown. */
function earliestDepletedResetMs(quotas) {
  let earliest = null;
  for (const quota of Object.values(quotas || {})) {
    if (!quota || quota.unlimited || !(quota.total > 0) || quota.remaining > 0 || !quota.resetAt) continue;
    const ms = new Date(quota.resetAt).getTime();
    if (!Number.isFinite(ms)) continue;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  return earliest;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
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
   * Classify a Kiro 402 as confirmed monthly-credit exhaustion vs. ambiguous (bad payment
   * method, suspended account, unrecognized upstream shape — see isConfirmedKiroCreditExhaustion
   * doc above). Only a confirmed match gets a precise cooldown; everything else falls through
   * to the base classifier and keeps the existing generic 402 cooldown unchanged.
   *
   * The 402 body itself never carries a reset time, so on a confirmed match this makes a
   * best-effort follow-up call to Kiro's own quota API (GetUsageLimits) for the trustworthy
   * `resetAt` already surfaced there (services/usage/kiro.js). If that lookup is unreachable,
   * times out, or shows nothing depleted, resetsAtMs falls back to a bounded daily-probe
   * window rather than guessing a date — markAccountUnavailable caps either case at
   * KIRO_CREDIT_EXHAUSTION_PROBE_MS (see errorConfig.js) so the account is retried at most
   * about once a day until it recovers.
   */
  async parseError(response, bodyText, credentials, proxyOptions) {
    if (response.status !== 402 || !isConfirmedKiroCreditExhaustion(bodyText)) {
      return super.parseError(response, bodyText);
    }

    let resetsAtMs = null;
    try {
      const accessToken = credentials?.apiKey || credentials?.accessToken;
      const usage = await withTimeout(
        getKiroUsage(accessToken, credentials?.providerSpecificData, proxyOptions),
        KIRO_RESET_LOOKUP_TIMEOUT_MS
      );
      resetsAtMs = earliestDepletedResetMs(usage?.quotas);
    } catch { /* best-effort only — fall back to the daily probe below */ }

    if (!resetsAtMs || resetsAtMs <= Date.now()) {
      resetsAtMs = Date.now() + KIRO_CREDIT_EXHAUSTION_PROBE_MS;
    }

    return { status: 402, message: "Kiro monthly credit limit reached", resetsAtMs };
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
      result.response = this.transformEventStreamToSSE(result.response, args.model);
    }
    return result;
  }

  /**
   * Transform AWS EventStream binary response to SSE text stream
   * Using TransformStream instead of ReadableStream.pull() to avoid Workers timeout
   */
  transformEventStreamToSSE(response, model) {
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
      seenToolIds: new Map(),
      inThinking: false
    };

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
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
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
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
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
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
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }

          // Handle toolUseEvent
          if (eventType === "toolUseEvent" && event.payload) {
            state.hasToolCalls = true;
            const toolUse = event.payload;
            const toolUses = Array.isArray(toolUse) ? toolUse : [toolUse];

            for (const singleToolUse of toolUses) {
              const toolCallId = singleToolUse.toolUseId || `call_${Date.now()}`;
              const toolName = singleToolUse.name || "";
              const toolInput = singleToolUse.input;

              let toolIndex;
              const isNewTool = !state.seenToolIds.has(toolCallId);

              if (isNewTool) {
                toolIndex = state.toolCallIndex++;
                state.seenToolIds.set(toolCallId, toolIndex);

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
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(startChunk)}\n\n`));
              } else {
                toolIndex = state.seenToolIds.get(toolCallId);
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
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(argsChunk)}\n\n`));
              }
            }
          }

          // Handle messageStopEvent
          if (eventType === "messageStopEvent") {
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
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
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

            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
          }
        }

        if (iterations >= maxIterations) {
          console.warn("[Kiro] Max iterations reached in event parsing");
        }

        // No client chunk produced this frame — emit an SSE comment keepalive
                // so the stall watchdog sees upstream activity (ignored by parser/client).
                if (chunkIndex === enqueueCountBefore && !state.finishEmitted) {
                  controller.enqueue(new TextEncoder().encode(": ka\n\n"));
                }
      },

      flush(controller) {
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
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
        }

        // Send final done message
        controller.enqueue(new TextEncoder().encode(SSE_DONE));
      }
    });

    // Pipe response body through transform stream
    if (!response.body) {
      return new Response(SSE_DONE, { status: response.status, headers: { "Content-Type": "text/event-stream" } });
    }
    const transformedStream = response.body.pipeThrough(transformStream);

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

      const name = new TextDecoder().decode(data.slice(offset, offset + nameLen));
      offset += nameLen;

      const headerType = data[offset];
      offset++;

      if (headerType === 7) { // String type
        const valueLen = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        if (offset + valueLen > data.length) break;

        const value = new TextDecoder().decode(data.slice(offset, offset + valueLen));
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
      const payloadStr = new TextDecoder().decode(data.slice(payloadStart, payloadEnd));

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
