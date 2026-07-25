import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { openaiToZedRequest } from "../translator/request/openai-to-zed.js";
import crypto from "crypto";

const DEFAULT_ZED_VERSION = "1.6.3";

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
      "x-zed-version": DEFAULT_ZED_VERSION,
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
    const psd = credentials?.providerSpecificData || {};
    const userId = psd.userId;
    const zedAccessToken = psd.zedAccessToken || credentials?.refreshToken;
    const organizationId = psd.organizationId;
    if (!userId || !zedAccessToken) {
      log?.warn?.("TOKEN_REFRESH", "Zed missing userId/zedAccessToken for LLM token refresh");
      return null;
    }
    try {
      const base = (this.config.baseUrl || "https://cloud.zed.dev").replace(/\/$/, "");
      const path = PROVIDER_OAUTH.zed?.llmTokensPath || "/client/llm_tokens";
      const body = organizationId ? { organization_id: organizationId } : {};
      const res = await proxyAwareFetch(`${base}${path}`, {
        method: "POST",
        headers: {
          Authorization: `${userId} ${zedAccessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      }, proxyOptions);
      const text = await res.text();
      if (!res.ok) {
        log?.error?.("TOKEN_REFRESH", `Zed LLM token refresh failed (${res.status}): ${text.slice(0, 200)}`);
        return null;
      }
      const data = JSON.parse(text);
      const raw = data?.token;
      const token =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object"
            ? raw["0"] || raw.token || Object.values(raw)[0]
            : null;
      if (!token) return null;
      return {
        accessToken: token,
        expiresIn: 3600,
        providerSpecificData: {
          llmToken: token,
          lastLlmTokenAt: new Date().toISOString(),
        },
      };
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
    const sseState = { id, created, model, roleSent: false };

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
          push(chatChunkSse({ id, created, model, delta: {}, finishReason: "stop" }));
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

    for (const line of text.split("\n")) {
      for (const parsed of parseZedLine(line)) {
        const unwrapped = unwrapZedEvent(parsed);
        if (unwrapped.kind !== "event") continue;
        const extracted = extractTextFromEvent(unwrapped.event);
        if (extracted.text) content += extracted.text;
        if (extracted.finishReason) finishReason = extracted.finishReason;
      }
    }

    const completion = {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
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
    const sseState = { id, created, model, roleSent: false };
    for (const line of text.split("\n")) {
      const sse = lineToOpenAiSse(line, sseState);
      if (sse?.chunk) chunks.push(sse.chunk);
    }
    chunks.push(chatChunkSse({ id, created, model, delta: {}, finishReason: "stop" }));
    chunks.push(SSE_DONE);
    return new Response(chunks.join(""), { status: 200, headers: SSE_HEADERS });
  }
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

function extractTextFromEvent(event) {
  if (!event || typeof event !== "object") return { text: "", finishReason: null };

  // OpenAI chat.completion.chunk
  if (event.choices?.[0]) {
    const choice = event.choices[0];
    const delta = choice.delta || choice.message || {};
    const text =
      typeof delta.content === "string"
        ? delta.content
        : Array.isArray(delta.content)
          ? delta.content.map((p) => p?.text || "").join("")
          : "";
    return { text, finishReason: choice.finish_reason || null, role: delta.role };
  }

  // OpenAI Responses API streaming events
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
    return { text: event.delta, finishReason: null };
  }
  if (event.type === "response.output_text.delta" && typeof event.delta?.text === "string") {
    return { text: event.delta.text, finishReason: null };
  }
  if (event.type === "response.completed" || event.type === "response.done") {
    return { text: "", finishReason: "stop" };
  }

  // Gemini generateContent / stream chunks
  if (Array.isArray(event.candidates)) {
    let text = "";
    for (const c of event.candidates) {
      const parts = c?.content?.parts || [];
      for (const p of parts) {
        if (typeof p?.text === "string") text += p.text;
      }
      if (c?.finishReason && c.finishReason !== "STOP" && c.finishReason !== "stop") {
        return { text, finishReason: "stop" };
      }
    }
    return { text, finishReason: null };
  }

  // Anthropic SSE event shapes
  if (event.type === "content_block_delta" && event.delta?.text) {
    return { text: event.delta.text, finishReason: null };
  }
  if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
    return { text: event.delta.text || "", finishReason: null };
  }
  if (event.type === "message_delta" && event.delta?.stop_reason) {
    return { text: "", finishReason: mapAnthropicStop(event.delta.stop_reason) };
  }
  if (event.type === "message_stop") {
    return { text: "", finishReason: "stop" };
  }
  if (typeof event.text === "string") {
    return { text: event.text, finishReason: null };
  }
  if (typeof event.delta?.text === "string") {
    return { text: event.delta.text, finishReason: null };
  }

  return { text: "", finishReason: null };
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
        parts.push(chatChunkSse({
          id,
          created,
          model,
          delta: {},
          finishReason: status?.Failed ? "stop" : null,
        }));
      }
      continue;
    }

    const event = unwrapped.event;
    if (!event || typeof event !== "object") continue;

    if (event.object === "chat.completion.chunk" && event.choices) {
      parts.push(sseChunk(event));
      state.roleSent = true;
      continue;
    }

    const extracted = extractTextFromEvent(event);
    if (!state.roleSent && (extracted.text || extracted.role === "assistant")) {
      parts.push(chatChunkSse({ id, created, model, delta: { role: "assistant" } }));
      state.roleSent = true;
    }
    if (extracted.text) {
      parts.push(chatChunkSse({ id, created, model, delta: { content: extracted.text } }));
    }
    if (extracted.finishReason) {
      parts.push(chatChunkSse({ id, created, model, delta: {}, finishReason: extracted.finishReason }));
    }
  }

  if (!parts.length) return null;
  return { chunk: parts.join(""), roleSent: state.roleSent };
}

export default ZedExecutor;
