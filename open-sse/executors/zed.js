import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { ZED_CLIENT_VERSION } from "../config/zedConstants.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { refreshZedToken } from "../services/tokenRefresh.js";
import { openaiToZedRequest } from "../translator/request/openai-to-zed.js";
import { CLAUDE_BLOCK, OPENAI_BLOCK, RESPONSES_ITEM } from "../translator/schema/index.js";
import crypto from "crypto";

/**
 * Zed Hosted AI executor
 * Posts CompletionBody to cloud.zed.dev/completions and converts JSONL
 * Status/Event lines into OpenAI SSE (so chatCore can passthrough).
 */
export class ZedExecutor extends BaseExecutor {
  constructor() {
    super("zed", PROVIDERS.zed || {});
  }

  getBaseUrls() {
    const base = (this.config.baseUrl || "https://cloud.zed.dev").replace(/\/$/, "");
    return [`${base}${this.config.chatPath || "/completions"}`];
  }

  buildUrl() {
    return this.getBaseUrls()[0];
  }

  buildHeaders(credentials, stream = true) {
    const llmToken = credentials?.accessToken || credentials?.providerSpecificData?.llmToken;
    return {
      "Content-Type": "application/json",
      Accept: stream ? "application/json, text/plain, */*" : "application/json",
      Authorization: `Bearer ${llmToken}`,
      "x-zed-version": ZED_CLIENT_VERSION,
      "x-zed-client-supports-status-messages": "true",
      "x-zed-client-supports-x-ai": "true",
      ...(this.config.headers || {}),
    };
  }

  transformRequest(model, body, stream) {
    // If already a CompletionBody (from openai-to-zed translator), keep it
    if (body?.provider_request && body?.provider) {
      return {
        ...body,
        model: body.model || model,
      };
    }
    return openaiToZedRequest(model, body, stream !== false);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    // Delegate to shared refreshZedToken so HTTP + token unwrap stay single-sourced
    // with tokenRefresh/providers.js (and dashboard refresh paths).
    const zedAccessToken =
      credentials?.providerSpecificData?.zedAccessToken || credentials?.refreshToken;
    if (!credentials?.providerSpecificData?.userId || !zedAccessToken) {
      log?.warn?.("TOKEN_REFRESH", "Zed missing userId/zedAccessToken for LLM token refresh");
      return null;
    }
    try {
      return await refreshZedToken(zedAccessToken, credentials, log, proxyOptions);
    } catch (err) {
      log?.error?.("TOKEN_REFRESH", `Zed LLM token refresh failed: ${err.message}`);
      return null;
    }
  }

  isExpiredTokenResponse(response) {
    if (!response) return false;
    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === 401) return true;
    const expired =
      response.headers?.get?.("x-zed-expired-token") ||
      response.headers?.get?.("x-zed-outdated-token");
    return Boolean(expired);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl(model, stream, 0, credentials);
    let creds = credentials;
    let transformedBody = this.transformRequest(model, body, stream, creds);
    let headers = this.buildHeaders(creds, stream);

    const doFetch = async () => {
      const connectCtrl = new AbortController();
      const timeoutMs = this.config?.timeoutMs || 30000;
      const connectTimer = setTimeout(
        () => connectCtrl.abort(new Error("fetch connect timeout")),
        timeoutMs,
      );
      const mergedSignal = signal
        ? AbortSignal.any([signal, connectCtrl.signal])
        : connectCtrl.signal;
      try {
        const response = await proxyAwareFetch(
          url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(transformedBody),
            signal: mergedSignal,
          },
          proxyOptions,
        );
        clearTimeout(connectTimer);
        return response;
      } catch (error) {
        clearTimeout(connectTimer);
        throw error;
      }
    };

    let response = await doFetch();

    if (this.isExpiredTokenResponse(response)) {
      log?.debug?.("TOKEN_REFRESH", "Zed LLM token expired — refreshing");
      const refreshed = await this.refreshCredentials(creds, log, proxyOptions);
      if (refreshed?.accessToken) {
        creds = {
          ...creds,
          accessToken: refreshed.accessToken,
          providerSpecificData: {
            ...(creds.providerSpecificData || {}),
            ...(refreshed.providerSpecificData || {}),
            llmToken: refreshed.accessToken,
          },
        };
        headers = this.buildHeaders(creds, stream);
        response = await doFetch();
      }
    }

    if (!response.ok) {
      return { response, url, headers, transformedBody };
    }

    const openaiResponse = stream
      ? await this.transformJsonlToSSE(response, model)
      : await this.transformJsonlToJSON(response, model);

    return { response: openaiResponse, url, headers, transformedBody };
  }

  /**
   * Convert Zed JSONL (Status/Event) stream into OpenAI SSE.
   */
  async transformJsonlToSSE(upstream, model) {
    const id = `chatcmpl-zed-${crypto.randomUUID?.() || Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const reader = upstream.body?.getReader?.();
    if (!reader) {
      const text = await upstream.text();
      return this.jsonlTextToSSEResponse(text, model, id, created);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const sseState = createSseState(id, created, model);

    const streamOut = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const push = (str) => controller.enqueue(enc.encode(str));

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const sse = lineToOpenAiSse(line, sseState);
              if (sse?.chunk) push(sse.chunk);
            }
          }
          if (buffer.trim()) {
            const sse = lineToOpenAiSse(buffer, sseState);
            if (sse?.chunk) push(sse.chunk);
          }
          if (!sseState.finished) {
            const finishReason = sseState.hasToolCalls ? "tool_calls" : "stop";
            push(chatChunkSse({ id, created, model, delta: {}, finishReason }));
            sseState.finished = true;
          }
          push(SSE_DONE);
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
      cancel() {
        try {
          reader.cancel();
        } catch {
          /* ignore */
        }
      },
    });

    return new Response(streamOut, { status: 200, headers: SSE_HEADERS });
  }

  async transformJsonlToJSON(upstream, model) {
    const text = await upstream.text();
    const id = `chatcmpl-zed-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let content = "";
    let finishReason = "stop";
    const toolCalls = [];
    const sseState = createSseState(id, created, model);

    for (const line of text.split("\n")) {
      for (const parsed of parseZedLine(line)) {
        const unwrapped = unwrapZedEvent(parsed);
        if (unwrapped.kind !== "event") continue;
        const extracted = extractFromEvent(unwrapped.event, sseState);
        if (extracted.text) content += extracted.text;
        if (extracted.tool_calls?.length) {
          for (const tc of extracted.tool_calls) {
            const existing = toolCalls.find((t) => t.index === tc.index);
            if (existing) {
              if (tc.function?.arguments) {
                existing.function.arguments =
                  (existing.function.arguments || "") + (tc.function.arguments || "");
              }
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.function.name = tc.function.name;
            } else {
              toolCalls.push({
                index: tc.index ?? toolCalls.length,
                id: tc.id,
                type: tc.type || OPENAI_BLOCK.FUNCTION,
                function: {
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                },
              });
            }
          }
        }
        if (extracted.finishReason) finishReason = extracted.finishReason;
      }
    }

    if (toolCalls.length > 0 && finishReason === "stop") finishReason = "tool_calls";

    const message = { role: "assistant", content: content || (toolCalls.length ? null : "") };
    if (toolCalls.length) message.tool_calls = toolCalls;

    const completion = {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason,
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  jsonlTextToSSEResponse(text, model, id, created) {
    const chunks = [];
    const sseState = createSseState(id, created, model);
    for (const line of text.split("\n")) {
      const sse = lineToOpenAiSse(line, sseState);
      if (sse?.chunk) chunks.push(sse.chunk);
    }
    if (!sseState.finished) {
      const finishReason = sseState.hasToolCalls ? "tool_calls" : "stop";
      chunks.push(chatChunkSse({ id, created, model, delta: {}, finishReason }));
      sseState.finished = true;
    }
    chunks.push(SSE_DONE);
    return new Response(chunks.join(""), { status: 200, headers: SSE_HEADERS });
  }
}

function createSseState(id, created, model) {
  return {
    id,
    created,
    model,
    roleSent: false,
    finished: false,
    hasToolCalls: false,
    toolCallIndex: 0,
    // Anthropic block-index → OpenAI tool_call bookkeeping
    toolCalls: new Map(),
  };
}

function parseZedLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return [];
  // Zed sometimes emits multiple JSON objects on one physical line
  const objs = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = trimmed.slice(start, i + 1);
        try {
          objs.push(JSON.parse(slice));
        } catch {
          /* skip */
        }
        start = -1;
      }
    }
  }
  if (!objs.length) {
    try {
      objs.push(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return objs;
}

function unwrapZedEvent(parsed) {
  if (!parsed || typeof parsed !== "object") return { kind: "none" };
  if (parsed.Status !== undefined || parsed.status !== undefined) {
    return { kind: "status", status: parsed.Status ?? parsed.status };
  }
  if (parsed.Event !== undefined || parsed.event !== undefined) {
    return { kind: "event", event: parsed.Event ?? parsed.event };
  }
  // Bare upstream event
  return { kind: "event", event: parsed };
}

/**
 * Extract OpenAI-compatible text / tool_calls / finish_reason from a nested
 * Zed upstream event (OpenAI chat, Responses API, Gemini, or Anthropic).
 */
function extractFromEvent(event, state) {
  if (!event || typeof event !== "object") {
    return { text: "", finishReason: null, tool_calls: null, role: null };
  }

  // OpenAI chat.completion.chunk / message
  if (event.choices?.[0]) {
    const choice = event.choices[0];
    const delta = choice.delta || choice.message || {};
    const text =
      typeof delta.content === "string"
        ? delta.content
        : Array.isArray(delta.content)
          ? delta.content.map((p) => p?.text || "").join("")
          : "";
    const tool_calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : null;
    if (tool_calls?.length) state.hasToolCalls = true;
    // Non-streaming message.tool_calls
    if (!tool_calls && Array.isArray(choice.message?.tool_calls)) {
      state.hasToolCalls = true;
      return {
        text,
        finishReason: choice.finish_reason || "tool_calls",
        tool_calls: choice.message.tool_calls,
        role: delta.role,
      };
    }
    return {
      text,
      finishReason: choice.finish_reason || null,
      tool_calls,
      role: delta.role,
    };
  }

  // OpenAI Responses API streaming events
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
    return { text: event.delta, finishReason: null, tool_calls: null, role: null };
  }
  if (event.type === "response.output_text.delta" && typeof event.delta?.text === "string") {
    return { text: event.delta.text, finishReason: null, tool_calls: null, role: null };
  }
  if (
    event.type === "response.output_item.added" &&
    (event.item?.type === RESPONSES_ITEM.FUNCTION_CALL || event.item?.type === "custom_tool_call")
  ) {
    const item = event.item;
    const idx = state.toolCallIndex++;
    state.hasToolCalls = true;
    state.toolCalls.set(item.id || idx, { index: idx, id: item.call_id || item.id });
    return {
      text: "",
      finishReason: null,
      tool_calls: [
        {
          index: idx,
          id: item.call_id || item.id,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: item.name || "", arguments: "" },
        },
      ],
      role: null,
    };
  }
  if (
    event.type === "response.function_call_arguments.delta" ||
    event.type === "response.custom_tool_call_input.delta"
  ) {
    const argsDelta = event.delta || "";
    const tracked = state.toolCalls.get(event.item_id) || { index: Math.max(0, state.toolCallIndex - 1) };
    state.hasToolCalls = true;
    return {
      text: "",
      finishReason: null,
      tool_calls: [{ index: tracked.index, function: { arguments: argsDelta } }],
      role: null,
    };
  }
  if (event.type === "response.completed" || event.type === "response.done") {
    return {
      text: "",
      finishReason: state.hasToolCalls ? "tool_calls" : "stop",
      tool_calls: null,
      role: null,
    };
  }

  // Gemini generateContent / stream chunks
  if (Array.isArray(event.candidates)) {
    let text = "";
    const tool_calls = [];
    for (const c of event.candidates) {
      const parts = c?.content?.parts || [];
      for (const p of parts) {
        if (typeof p?.text === "string") text += p.text;
        if (p?.functionCall) {
          const fc = p.functionCall;
          const idx = state.toolCallIndex++;
          state.hasToolCalls = true;
          tool_calls.push({
            index: idx,
            id: `${fc.name || "fn"}-${Date.now()}-${idx}`,
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: fc.name || "",
              arguments: JSON.stringify(fc.args || {}),
            },
          });
        }
      }
      if (c?.finishReason && c.finishReason !== "STOP" && c.finishReason !== "stop") {
        return {
          text,
          finishReason: tool_calls.length ? "tool_calls" : "stop",
          tool_calls: tool_calls.length ? tool_calls : null,
          role: null,
        };
      }
    }
    return {
      text,
      finishReason: null,
      tool_calls: tool_calls.length ? tool_calls : null,
      role: null,
    };
  }

  // Anthropic SSE — tool_use content blocks
  if (event.type === "content_block_start") {
    const block = event.content_block;
    if (block?.type === CLAUDE_BLOCK.TOOL_USE) {
      const toolCallIndex = state.toolCallIndex++;
      const toolCall = {
        index: toolCallIndex,
        id: block.id,
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: block.name || "", arguments: "" },
      };
      state.toolCalls.set(event.index, toolCall);
      state.hasToolCalls = true;
      return { text: "", finishReason: null, tool_calls: [toolCall], role: null };
    }
  }
  if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
    const toolCall = state.toolCalls.get(event.index);
    if (toolCall && event.delta.partial_json) {
      toolCall.function.arguments += event.delta.partial_json;
      state.hasToolCalls = true;
      return {
        text: "",
        finishReason: null,
        tool_calls: [
          {
            index: toolCall.index,
            id: toolCall.id,
            function: { arguments: event.delta.partial_json },
          },
        ],
        role: null,
      };
    }
  }
  if (event.type === "content_block_delta" && event.delta?.text) {
    return { text: event.delta.text, finishReason: null, tool_calls: null, role: null };
  }
  if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
    return { text: event.delta.text || "", finishReason: null, tool_calls: null, role: null };
  }
  if (event.type === "message_delta" && event.delta?.stop_reason) {
    return {
      text: "",
      finishReason: mapAnthropicStop(event.delta.stop_reason),
      tool_calls: null,
      role: null,
    };
  }
  if (event.type === "message_stop") {
    return {
      text: "",
      finishReason: state.hasToolCalls ? "tool_calls" : "stop",
      tool_calls: null,
      role: null,
    };
  }
  if (typeof event.text === "string") {
    return { text: event.text, finishReason: null, tool_calls: null, role: null };
  }
  if (typeof event.delta?.text === "string") {
    return { text: event.delta.text, finishReason: null, tool_calls: null, role: null };
  }

  return { text: "", finishReason: null, tool_calls: null, role: null };
}

function mapAnthropicStop(reason) {
  if (reason === "end_turn" || reason === "stop_sequence") return "stop";
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  return "stop";
}

function lineToOpenAiSse(line, state) {
  const { id, created, model } = state;
  const parsedList = parseZedLine(line);
  if (!parsedList.length) return null;

  const parts = [];
  for (const parsed of parsedList) {
    const unwrapped = unwrapZedEvent(parsed);
    if (unwrapped.kind === "status") {
      const status = unwrapped.status;
      if (status === "StreamEnded" || status?.Failed || status === "failed") {
        if (!state.finished) {
          const finishReason = status?.Failed
            ? "stop"
            : state.hasToolCalls
              ? "tool_calls"
              : "stop";
          parts.push(chatChunkSse({
            id,
            created,
            model,
            delta: {},
            finishReason: status?.Failed ? "stop" : finishReason,
          }));
          state.finished = true;
        }
      }
      continue;
    }

    const event = unwrapped.event;
    if (!event || typeof event !== "object") continue;

    // Pass through already-OpenAI chat.completion.chunk events unchanged
    // (includes tool_calls deltas when Zed nests OpenAI-compatible streams).
    if (event.object === "chat.completion.chunk" && event.choices) {
      const delta = event.choices[0]?.delta;
      if (delta?.tool_calls?.length) state.hasToolCalls = true;
      if (event.choices[0]?.finish_reason === "tool_calls") state.hasToolCalls = true;
      if (event.choices[0]?.finish_reason) state.finished = true;
      parts.push(sseChunk(event));
      state.roleSent = true;
      continue;
    }

    const extracted = extractFromEvent(event, state);
    if (!state.roleSent && (extracted.text || extracted.tool_calls || extracted.role === "assistant")) {
      parts.push(chatChunkSse({ id, created, model, delta: { role: "assistant" } }));
      state.roleSent = true;
    }
    if (extracted.text) {
      parts.push(chatChunkSse({ id, created, model, delta: { content: extracted.text } }));
    }
    if (extracted.tool_calls?.length) {
      parts.push(chatChunkSse({ id, created, model, delta: { tool_calls: extracted.tool_calls } }));
    }
    if (extracted.finishReason) {
      parts.push(chatChunkSse({ id, created, model, delta: {}, finishReason: extracted.finishReason }));
      state.finished = true;
    }
  }

  if (!parts.length) return null;
  return { chunk: parts.join(""), roleSent: state.roleSent };
}

export default ZedExecutor;
