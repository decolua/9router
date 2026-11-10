import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const ENDPOINT = "https://api.deepai.org/hacking_is_a_serious_crime";
const SIGNATURE_SALT = "hackers_become_a_little_stinkier_every_time_they_hack";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function md5Reversed(value) {
  return crypto.createHash("md5").update(value).digest("hex").split("").reverse().join("");
}

function buildApiKey() {
  const randomDigits = String(Math.floor(10_000_000_000 + Math.random() * 89_999_999_999));
  const first = md5Reversed(BROWSER_UA + randomDigits + SIGNATURE_SALT);
  const second = md5Reversed(BROWSER_UA + first);
  const third = md5Reversed(BROWSER_UA + second);
  return `tryit-${randomDigits}-${third}`;
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function buildChatHistory(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const history = [];
  const systemParts = [];
  for (const message of messages) {
    const text = contentToText(message?.content);
    if (!text) continue;
    if (message.role === "system") {
      systemParts.push(text);
      continue;
    }
    if (message.role === "user" || message.role === "assistant") {
      history.push({ role: message.role, content: text });
    }
  }
  if (systemParts.length && history.length) {
    const first = history[0];
    history[0] = { ...first, content: `${systemParts.join("\n\n")}\n\n${first.content}` };
  } else if (systemParts.length) {
    history.push({ role: "user", content: systemParts.join("\n\n") });
  }
  if (!history.length) history.push({ role: "user", content: "Hello" });
  return history;
}

function chatId() {
  return `chatcmpl-${crypto.randomBytes(12).toString("hex")}`;
}

function streamResponse(text, model, id) {
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);
  const chunk = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const base = { id, object: "chat.completion.chunk", created, model };
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk({
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
      }));
      controller.enqueue(chunk({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

function jsonResponse(text, model, id) {
  const created = Math.floor(Date.now() / 1000);
  const usage = {
    prompt_tokens: 0,
    completion_tokens: text.length,
    total_tokens: text.length,
  };
  return new Response(
    JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function errorResponse(status, message) {
  return new Response(
    JSON.stringify({ error: { message: message || `HTTP ${status}`, type: "upstream_error", code: `HTTP_${status}` } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export class DeepAIExecutor extends BaseExecutor {
  constructor() {
    super("deepai", { baseUrl: "https://api.deepai.org", noAuth: true });
  }

  buildUrl() {
    return ENDPOINT;
  }

  async execute({ model, body, stream, signal, proxyOptions = null }) {
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": BROWSER_UA,
      "api-key": buildApiKey(),
      Referer: "https://deepai.org/chat",
      Origin: "https://deepai.org",
      Accept: "*/*",
    };
    const form = new URLSearchParams({
      chat_style: "chat",
      model: model || body?.model || "standard",
      session_uuid: crypto.randomUUID(),
      chatHistory: JSON.stringify(buildChatHistory(body)),
    });
    const payload = form.toString();

    let response;
    try {
      response = await proxyAwareFetch(
        ENDPOINT,
        { method: "POST", headers, body: payload, signal },
        proxyOptions
      );
    } catch (error) {
      return {
        response: errorResponse(502, error?.message || "DeepAI connect failed"),
        url: ENDPOINT,
        headers,
        transformedBody: payload,
      };
    }

    const text = (await response.text()).trim();
    if (!response.ok) {
      return {
        response: errorResponse(response.status, text),
        url: ENDPOINT,
        headers,
        transformedBody: payload,
      };
    }

    const id = chatId();
    return {
      response: stream ? streamResponse(text, model, id) : jsonResponse(text, model, id),
      url: ENDPOINT,
      headers,
      transformedBody: payload,
    };
  }
}
