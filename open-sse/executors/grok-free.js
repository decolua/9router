import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import crypto from "crypto";

const CONSOLE_RESPONSES_API = "https://console.x.ai/v1/responses";

const CONSOLE_MODELS = {
  "grok-4.3-console":                     "grok-4.3",
  "grok-4.3-low":                         "grok-4.3",
  "grok-4.3-medium":                      "grok-4.3",
  "grok-4.3-high":                        "grok-4.3",
  "grok-4.20-0309-reasoning-console":     "grok-4.20-0309-reasoning",
  "grok-4.20-0309-console":               "grok-4.20-0309",
  "grok-4.20-0309-non-reasoning-console": "grok-4.20-0309-non-reasoning",
  "grok-4.20-multi-agent-console":        "grok-4.20-multi-agent-0309",
  "grok-4.20-multi-agent-low":            "grok-4.20-multi-agent-0309",
  "grok-4.20-multi-agent-medium":         "grok-4.20-multi-agent-0309",
  "grok-4.20-multi-agent-high":           "grok-4.20-multi-agent-0309",
  "grok-4.20-multi-agent-xhigh":          "grok-4.20-multi-agent-0309",
  "grok-build-console":                   "grok-build-0.1",
};

const MODELS_WITH_REASONING_FIELD = new Set([
  "grok-4.3",
  "grok-4.20-multi-agent-0309"
]);

const MODEL_FIXED_EFFORT = {
  "grok-4.3-low":    "low",
  "grok-4.3-medium": "medium",
  "grok-4.3-high":   "high",
  "grok-4.20-multi-agent-low":    "low",
  "grok-4.20-multi-agent-medium": "medium",
  "grok-4.20-multi-agent-high":   "high",
  "grok-4.20-multi-agent-xhigh":  "xhigh",
};

const MODEL_MAX_OUTPUT_TOKENS = {
  "grok-4.20-multi-agent-0309": 2000000,
  "grok-build-0.1": 256000,
};

const MODELS_WITH_SEARCH_TOOLS = new Set([
  "grok-4.20-multi-agent-0309",
  "grok-4.20-0309",
  "grok-4.20-0309-reasoning",
  "grok-4.20-0309-non-reasoning",
  "grok-4.3",
  "grok-build-0.1",
]);

const EFFORT_MAP = {
  "none":    "none",
  "minimal": "low",
  "low":     "low",
  "medium":  "medium",
  "high":    "high",
  "xhigh":   "xhigh",
};

function formatConsoleMessages(messages) {
  const inputItems = [];
  for (const msg of messages) {
    const role = msg.role || "user";
    let content = msg.content || "";

    let apiRole = "user";
    if (role === "system" || role === "developer") {
      apiRole = "system";
    } else if (role === "assistant") {
      apiRole = "assistant";
    }

    let contentBlocks = [];
    if (typeof content === "string") {
      contentBlocks.push({ type: "input_text", text: content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const btype = block.type || "";
        if (btype === "text") {
          contentBlocks.push({ type: "input_text", text: block.text || "" });
        } else if (btype === "image_url") {
          const url = block.image_url?.url || "";
          if (url) {
            contentBlocks.push({ type: "input_image", image_url: url });
          }
        } else {
          const text = block.text || String(block);
          contentBlocks.push({ type: "input_text", text: text });
        }
      }
    } else {
      contentBlocks.push({ type: "input_text", text: String(content) });
    }

    if (contentBlocks.length > 0) {
      inputItems.push({ role: apiRole, content: contentBlocks });
    }
  }
  return inputItems;
}

async function* readConsoleSseEvents(bodyReader, signal) {
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await bodyReader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            yield { event: currentEvent, data: parsed };
          } catch (e) {
            // ignore JSON parse errors
          }
          currentEvent = "";
        }
      }
    }
    buffer += decoder.decode();
    const remaining = buffer.trim();
    if (remaining.startsWith("data:")) {
      const data = remaining.slice(5).trim();
      if (data !== "[DONE]") {
        try {
          yield { event: currentEvent, data: JSON.parse(data) };
        } catch (e) {}
      }
    }
  } finally {
    bodyReader.releaseLock();
  }
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildStreamingResponse(responseBody, model, cid, created, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        const reader = responseBody.getReader();
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        for await (const event of readConsoleSseEvents(reader, signal)) {
          if (event.event === "error") {
            const msg = event.data?.message || JSON.stringify(event.data);
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: `[Error: ${msg}]` }, finish_reason: null, logprobs: null }],
            })));
            break;
          }

          if (event.event === "response.output_text.delta") {
            const deltaText = event.data?.delta || "";
            if (deltaText) {
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{ index: 0, delta: { content: deltaText }, finish_reason: null, logprobs: null }],
              })));
            }
          } else if (event.event === "response.completed") {
            const usage = event.data?.response?.usage;
            if (usage) {
              totalInputTokens = usage.input_tokens || usage.prompt_tokens || 0;
              totalOutputTokens = usage.output_tokens || usage.completion_tokens || 0;
            }
            break;
          }
        }

        const finalChunk = {
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
        };
        if (totalInputTokens || totalOutputTokens) {
          finalChunk.usage = {
            prompt_tokens: totalInputTokens,
            completion_tokens: totalOutputTokens,
            total_tokens: totalInputTokens + totalOutputTokens
          };
        }

        controller.enqueue(encoder.encode(sseChunk(finalChunk)));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${err.message || String(err)}]` }, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
}

async function buildNonStreamingResponse(responseBody, model, cid, created, promptTextLen, signal) {
  let fullContent = "";
  const reader = responseBody.getReader();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for await (const event of readConsoleSseEvents(reader, signal)) {
    if (event.event === "error") {
      const msg = event.data?.message || JSON.stringify(event.data);
      return new Response(JSON.stringify({
        error: { message: msg, type: "upstream_error", code: "CONSOLE_ERROR" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    if (event.event === "response.output_text.delta") {
      const deltaText = event.data?.delta || "";
      if (deltaText) {
        fullContent += deltaText;
      }
    } else if (event.event === "response.completed") {
      const usage = event.data?.response?.usage;
      if (usage) {
        totalInputTokens = usage.input_tokens || usage.prompt_tokens || 0;
        totalOutputTokens = usage.output_tokens || usage.completion_tokens || 0;
      }
      break;
    }
  }

  const promptTokens = totalInputTokens || Math.ceil(promptTextLen / 4);
  const completionTokens = totalOutputTokens || Math.ceil(fullContent.length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: { role: "assistant", content: fullContent }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class GrokFreeExecutor extends BaseExecutor {
  constructor() {
    super("grok-free", PROVIDERS["grok-free"] || {
      baseUrl: CONSOLE_RESPONSES_API,
      format: "grok-free"
    });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    let token = credentials.apiKey || credentials.accessToken;
    if (!token) {
      const errResp = new Response(JSON.stringify({
        error: { message: "sso Cookie (saved in API Key field) is required for grok-free", type: "invalid_request" }
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CONSOLE_RESPONSES_API, headers: {}, transformedBody: body };
    }

    if (token.startsWith("sso=")) {
      token = token.slice(4);
    }

    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CONSOLE_RESPONSES_API, headers: {}, transformedBody: body };
    }

    const consoleModel = CONSOLE_MODELS[model] || model;
    const inputItems = formatConsoleMessages(messages);

    const payload = {
      model: consoleModel,
      input: inputItems,
      max_output_tokens: MODEL_MAX_OUTPUT_TOKENS[consoleModel] || 1000000,
      temperature: body.temperature ?? 0.7,
      top_p: body.top_p ?? 0.95,
      store: false,
      include: ["reasoning.encrypted_content"],
      stream: true, // Always request stream from console.x.ai
    };

    const effort = MODEL_FIXED_EFFORT[model] || EFFORT_MAP[body.reasoning_effort || "medium"] || "medium";
    if (MODELS_WITH_REASONING_FIELD.has(consoleModel)) {
      payload.reasoning = { effort };
    }

    if (MODELS_WITH_SEARCH_TOOLS.has(consoleModel)) {
      payload.tools = [
        { type: "web_search", enable_image_understanding: true },
        { type: "x_search", enable_video_understanding: true }
      ];
      payload.tool_choice = "auto";
    }

    const headers = {
      "Accept": "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Authorization": "Bearer anonymous",
      "Content-Type": "application/json",
      "Cookie": `sso=${token}; sso-rw=${token}`,
      "Origin": "https://console.x.ai",
      "Referer": "https://console.x.ai/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "x-cluster": "https://us-east-1.api.x.ai",
    };

    log?.info?.("GROK-FREE", `Query to console.x.ai (model=${consoleModel}, stream=${stream}), len=${messages.reduce((acc, m) => acc + (typeof m.content === "string" ? m.content.length : 0), 0)}`);

    let response;
    try {
      response = await proxyAwareFetch(CONSOLE_RESPONSES_API, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal
      }, proxyOptions);
    } catch (err) {
      log?.error?.("GROK-FREE", `Fetch failed: ${err.message || String(err)}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `console.x.ai connection failed: ${err.message || String(err)}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CONSOLE_RESPONSES_API, headers, transformedBody: payload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `console.x.ai returned HTTP ${status}`;
      if (status === 401 || status === 403) {
        errMsg = "console.x.ai auth failed — SSO cookie may be invalid or expired. Please re-paste your sso cookie.";
      }
      log?.warn?.("GROK-FREE", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CONSOLE_RESPONSES_API, headers, transformedBody: payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "console.x.ai returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CONSOLE_RESPONSES_API, headers, transformedBody: payload };
    }

    const cid = `chatcmpl-grf-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
      });
    } else {
      const promptTextLen = messages.reduce((acc, m) => acc + (typeof m.content === "string" ? m.content.length : 0), 0);
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, promptTextLen, signal);
    }

    return { response: finalResponse, url: CONSOLE_RESPONSES_API, headers, transformedBody: payload };
  }
}

export default GrokFreeExecutor;
