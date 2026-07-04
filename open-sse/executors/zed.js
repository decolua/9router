import pkg from "../../package.json" with { type: "json" };

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { FORMATS } from "../translator/formats.js";
import { initState } from "../translator/index.js";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.js";
import { openaiToGeminiRequest } from "../translator/request/openai-to-gemini.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { claudeToOpenAIResponse } from "../translator/response/claude-to-openai.js";
import { geminiToOpenAIResponse } from "../translator/response/gemini-to-openai.js";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses.js";
import { buildChunk } from "../translator/concerns/chunk.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import {
  ZED_HEADERS,
  resolveZedModels,
  zedLlmFetch,
} from "../shared/zedAuth.js";

const PROVIDER = {
  anthropic: "anthropic",
  openai: "open_ai",
  google: "google",
  xai: "x_ai",
};

function normalizeZedProvider(value, model) {
  const raw = String(value || "").toLowerCase();
  if (raw === "anthropic") return PROVIDER.anthropic;
  if (raw === "openai" || raw === "open_ai") return PROVIDER.openai;
  if (raw === "google" || raw === "gemini") return PROVIDER.google;
  if (raw === "xai" || raw === "x_ai" || raw === "x-ai") return PROVIDER.xai;

  const m = String(model || "").toLowerCase();
  if (m.includes("claude")) return PROVIDER.anthropic;
  if (m.includes("gemini")) return PROVIDER.google;
  if (m.includes("grok") || m.includes("xai")) return PROVIDER.xai;
  return PROVIDER.openai;
}

function buildProviderRequest(provider, model, body, stream, credentials) {
  if (provider === PROVIDER.anthropic) {
    return openaiToClaudeRequest(model, body, true, credentials);
  }
  if (provider === PROVIDER.google) {
    return openaiToGeminiRequest(model, body, true, credentials);
  }
  if (provider === PROVIDER.openai) {
    return openaiToOpenAIResponsesRequest(model, body, true, credentials);
  }
  return {
    ...body,
    model,
    stream: stream !== false,
  };
}

function initProviderState(provider, model) {
  if (provider === PROVIDER.anthropic) return initState(FORMATS.CLAUDE);
  if (provider === PROVIDER.google) return initState(FORMATS.GEMINI);
  if (provider === PROVIDER.openai) return initState(FORMATS.OPENAI_RESPONSES);
  const state = initState(FORMATS.OPENAI);
  state.model = model;
  return state;
}

function convertProviderEvent(provider, event, state) {
  if (provider === PROVIDER.anthropic) return claudeToOpenAIResponse(event, state);
  if (provider === PROVIDER.google) return geminiToOpenAIResponse(event, state);
  if (provider === PROVIDER.openai) return openaiResponsesToOpenAIResponse(event, state);
  return event;
}

function createErrorChunk(model, message) {
  return buildChunk(
    { id: `chatcmpl-zed-error-${Date.now()}`, created: Math.floor(Date.now() / 1000), model },
    { content: `[Zed error] ${message}` },
    "stop",
  );
}

function enqueueSseObject(controller, encoder, chunk) {
  if (!chunk) return;
  const items = Array.isArray(chunk) ? chunk : [chunk];
  for (const item of items) {
    if (!item) continue;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
  }
}

function unwrapZedLine(line) {
  let text = line.replace(/\r$/, "").trim();
  if (!text) return null;
  if (text.startsWith("data:")) text = text.slice(5).trimStart();
  if (text === "[DONE]") return { done: true };
  try {
    const parsed = JSON.parse(text);
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, "event")) {
      return { event: parsed.event };
    }
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, "status")) {
      return { status: parsed.status };
    }
    return { event: parsed };
  } catch {
    return null;
  }
}

function normalizeStatus(status) {
  if (!status) return null;
  if (typeof status === "string") return { type: status };
  if (typeof status === "object") {
    const key = Object.keys(status)[0];
    if (key && typeof status[key] === "object") return { type: key, ...status[key] };
    return status;
  }
  return null;
}

function wrapZedCompletionStream(response, provider, model) {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = initProviderState(provider, model);
  let buffer = "";
  let done = false;

  const finish = (controller) => {
    if (done) return;
    const finalChunk = convertProviderEvent(provider, null, state);
    enqueueSseObject(controller, encoder, finalChunk);
    controller.enqueue(encoder.encode(SSE_DONE));
    done = true;
  };

  const processLine = (line, controller) => {
    if (done) return;
    const payload = unwrapZedLine(line);
    if (!payload) return;
    if (payload.done) {
      finish(controller);
      return;
    }
    if (payload.status) {
      const status = normalizeStatus(payload.status);
      if (status?.type === "failed" || status?.failed) {
        const failed = status.failed || status;
        const message = failed.message || failed.error || failed.code || "request failed";
        enqueueSseObject(controller, encoder, createErrorChunk(model, message));
        finish(controller);
      } else if (status?.type === "stream_ended" || status === "stream_ended") {
        finish(controller);
      }
      return;
    }
    const converted = convertProviderEvent(provider, payload.event, state);
    enqueueSseObject(controller, encoder, converted);
  };

  const transformed = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        processLine(line, controller);
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) {
        processLine(buffer, controller);
        buffer = "";
      }
      finish(controller);
    },
  }));

  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export class ZedExecutor extends BaseExecutor {
  constructor() {
    super("zed", PROVIDERS.zed);
  }

  async resolveModel(model, credentials, proxyOptions, signal, log) {
    try {
      const catalog = await resolveZedModels(credentials, { proxyOptions, signal });
      let raw = catalog?.rawById?.get(model);
      if (!raw) {
        const refreshed = await resolveZedModels(credentials, { proxyOptions, signal, forceRefresh: true });
        raw = refreshed?.rawById?.get(model);
      }
      return {
        raw,
        provider: normalizeZedProvider(raw?.provider, model),
      };
    } catch (error) {
      log?.warn?.("ZED", `model catalog unavailable, inferring provider for ${model}: ${error.message}`);
      return { raw: null, provider: normalizeZedProvider(null, model) };
    }
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const { provider } = await this.resolveModel(model, credentials, proxyOptions, signal, log);
    const providerRequest = buildProviderRequest(provider, model, body, stream, credentials);
    const payload = {
      thread_id: body.thread_id || credentials?._clientSessionId || undefined,
      prompt_id: body.prompt_id || undefined,
      provider,
      model,
      provider_request: providerRequest,
    };

    const response = await zedLlmFetch(credentials, "/completions", {
      config: this.config,
      signal,
      proxyOptions,
      fetchOptions: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, text/event-stream, */*",
          "User-Agent": `9Router/${pkg.version || "0.0.0"}`,
          "x-zed-version": this.config?.appVersion || "0.200.0",
          [ZED_HEADERS.clientSupportsStatus]: "true",
          [ZED_HEADERS.clientSupportsStreamEnded]: "true",
        },
        body: JSON.stringify(payload),
      },
    });

    const wrapped = response.ok ? wrapZedCompletionStream(response, provider, model) : response;
    return {
      response: wrapped,
      url: `${this.config?.llmBaseUrl || "https://cloud.zed.dev"}/completions`,
      headers: { "Content-Type": "application/json", Authorization: "Bearer <zed-llm-token>" },
      transformedBody: payload,
    };
  }

  parseError(response, bodyText) {
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch {
      parsed = null;
    }

    const code = parsed?.code || parsed?.error?.code || "";
    const rawMessage = parsed?.message || parsed?.error?.message || bodyText || response.statusText;
    if (code === "trial_blocked") {
      return {
        status: response.status,
        message: `Zed upstream returned trial_blocked: ${rawMessage}`,
      };
    }
    if (code) {
      return {
        status: response.status,
        message: `Zed ${code}: ${rawMessage}`,
      };
    }
    return {
      status: response.status,
      message: rawMessage || `Zed upstream error: ${response.status}`,
    };
  }

  async refreshCredentials() {
    return null;
  }

  needsRefresh() {
    return false;
  }
}

export default ZedExecutor;

export const __test__ = {
  normalizeZedProvider,
  unwrapZedLine,
  wrapZedCompletionStream,
};
