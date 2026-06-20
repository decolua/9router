// Ported from OmniRoute open-sse/executors/theoldllm.ts.
// TheOldLlm — free no-auth web provider (theoldllm.vercel.app). Generates an
// X-Request-Token server-side (mirrors the SPA's client-side djb2-hash token),
// POSTs an OpenAI-shaped body, and parses the SSE response.

import { BaseExecutor } from "./base.js";
import { randomUUID } from "node:crypto";

const API_BASE = "https://theoldllm.vercel.app";
const API_PATH = "/api/chatgpt";
const API_URL = `${API_BASE}${API_PATH}`;
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const GPT_MODELS = {
  "gpt-5.4": "GPT_5_4", "gpt-5.3": "GPT_5_3", "gpt-5.2": "GPT_5_2", "gpt-5.1": "GPT_5_1", "gpt-5": "GPT_5",
  gpt5_4: "GPT_5_4", gpt5_3: "GPT_5_3", gpt5_2: "GPT_5_2", gpt5_1: "GPT_5_1",
  gpt_4o: "GPT_4O", "gpt-4o": "GPT_4O",
  gpt_5_3: "GPT_5_3", gpt_5_2: "GPT_5_2", gpt_5_1: "GPT_5_1", gpt_5: "GPT_5",
};

const CLAUDE_NAMES = {
  "claude-4.6-opus": "CLAUDE_4_6_OPUS", "claude-4.6-sonnet": "CLAUDE_4_6_SONNET", "claude-4.5-haiku": "CLAUDE_4_5_HAIKU",
  claude_opus_4: "CLAUDE_4_6_OPUS", claude_sonnet_4: "CLAUDE_4_6_SONNET", claude_haiku_3_5: "CLAUDE_4_5_HAIKU",
  "claude opus 4": "CLAUDE_4_6_OPUS", "claude sonnet 4": "CLAUDE_4_6_SONNET", "claude haiku 3.5": "CLAUDE_4_5_HAIKU",
};

export function mapModel(model) {
  const n = String(model || "").toLowerCase().trim();
  const gptKey = n.replace(/[_\s]+/g, "-");
  if (GPT_MODELS[gptKey]) return GPT_MODELS[gptKey];
  const gptKey2 = n.replace(/[-\s]+/g, "_");
  if (GPT_MODELS[gptKey2]) return GPT_MODELS[gptKey2];
  if (CLAUDE_NAMES[n]) return CLAUDE_NAMES[n];
  if (n.includes("claude")) {
    if (n.includes("opus")) return "CLAUDE_4_6_OPUS";
    if (n.includes("sonnet")) return "CLAUDE_4_6_SONNET";
    if (n.includes("haiku")) return "CLAUDE_4_5_HAIKU";
  }
  return "GPT_5_4";
}

// Mirrors the SPA's client-side rie(): djb2-hash of `${ts}-${seed}-${uaSlice}`.
const TOKEN_SEED = "oldllm-client-2026";
const UA_PREFIX = CHROME_UA.slice(0, 20);

export function generateRequestToken() {
  const n = Date.now();
  const e = `${n}-${TOKEN_SEED}-${UA_PREFIX}`;
  let t = 0;
  for (let i = 0; i < e.length; i++) {
    const s = e.charCodeAt(i);
    t = (t << 5) - t + s;
    t = t & t;
  }
  const r = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${n.toString(36)}-${Math.abs(t).toString(36)}-${r}`;
}

// Stub kept for import compatibility (server-side flow generates per-request).
export const tokenCache = { value: "", expiresAt: 0 };

async function directFetch(reqBody, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const onSignal = signal ? () => controller.abort(signal.reason) : undefined;
  if (signal) signal.addEventListener("abort", onSignal, { once: true });

  try {
    return await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Version": "3.8.4",
        "X-Request-Token": generateRequestToken(),
        "User-Agent": CHROME_UA,
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (onSignal && signal) signal.removeEventListener("abort", onSignal);
  }
}

function isTokenRejected(status, body) {
  if (status === 401 || status === 403) return true;
  try {
    const p = JSON.parse(body);
    return (
      p?.error?.type === "access_denied" ||
      (typeof p?.error === "string" && /blocked|denied|invalid/i.test(p.error))
    );
  } catch {
    return false;
  }
}

function parseSseContent(sseText) {
  let content = "";
  for (const line of sseText.split("\n")) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const d = JSON.parse(line.slice(6));
        content += d.choices?.[0]?.delta?.content || d.choices?.[0]?.delta?.text || "";
      } catch {}
    }
  }
  return content;
}

function buildChatCompletion(content, model) {
  return JSON.stringify({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: mapModel(model),
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function buildErrorResponse(status, body) {
  let detail = body;
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const p = JSON.parse(line.slice(6));
        if (p.error) { detail = JSON.stringify(p.error); break; }
      } catch {}
    }
  }
  return JSON.stringify({ error: { message: detail, type: "upstream_error", code: `HTTP_${status}` } });
}

export class TheOldLlmExecutor extends BaseExecutor {
  constructor() {
    super("theoldllm", { format: "openai" });
  }

  buildUrl() {
    return API_URL;
  }

  buildHeaders() {
    return { "Content-Type": "application/json", "X-Client-Version": "3.8.4", "User-Agent": CHROME_UA };
  }

  transformRequest(model, body) {
    if (typeof body === "object" && body !== null) {
      return { ...body, model: mapModel(model) };
    }
    return body;
  }

  async testConnection(_credentials, signal, log) {
    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Version": "3.8.4",
          "X-Request-Token": generateRequestToken(),
          "User-Agent": CHROME_UA,
        },
        body: JSON.stringify({ model: "GPT_5_4", messages: [{ role: "user", content: "ping" }], stream: false }),
        signal: signal ?? undefined,
      });
      return resp.status === 200;
    } catch {
      log?.warn?.("THEOLDLLM", "testConnection network error");
      return false;
    }
  }

  async execute(input) {
    const { model, stream, body, signal, log } = input;
    const encoder = new TextEncoder();

    if (signal?.aborted) {
      return {
        response: new Response(encoder.encode(JSON.stringify({ error: { message: "Request aborted", type: "abort", code: "ABORTED" } })), { status: 499, headers: { "Content-Type": "application/json" } }),
        url: API_URL, headers: this.buildHeaders(), transformedBody: body,
      };
    }

    try {
      const reqBody = { ...body, model: mapModel(model), stream: true };
      let upstream = await directFetch(reqBody, signal);
      let finalBody = await upstream.text();

      if (isTokenRejected(upstream.status, finalBody)) {
        log?.warn?.("THEOLDLLM", `Token rejected (${upstream.status}), retrying with fresh token…`);
        upstream = await directFetch(reqBody, signal);
        finalBody = await upstream.text();
      }

      if (upstream.status === 200 && finalBody) {
        const payload = stream ? finalBody : buildChatCompletion(parseSseContent(finalBody), model);
        return {
          response: new Response(encoder.encode(payload), { status: 200, headers: { "Content-Type": stream ? "text/event-stream" : "application/json", "Cache-Control": "no-cache" } }),
          url: API_URL, headers: this.buildHeaders(), transformedBody: body,
        };
      }

      return {
        response: new Response(encoder.encode(buildErrorResponse(upstream.status, finalBody)), { status: upstream.status, headers: { "Content-Type": "application/json" } }),
        url: API_URL, headers: this.buildHeaders(), transformedBody: body,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("THEOLDLLM", `Executor error: ${msg}`);
      return {
        response: new Response(encoder.encode(JSON.stringify({ error: { message: msg, type: "upstream_error", code: "EXECUTOR_ERROR" } })), { status: 502, headers: { "Content-Type": "application/json" } }),
        url: API_URL, headers: this.buildHeaders(), transformedBody: body,
      };
    }
  }
}

export default TheOldLlmExecutor;
