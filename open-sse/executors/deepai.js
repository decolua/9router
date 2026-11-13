import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  buildToolInstructions,
  buildToolReminder,
  emitToolCallChunks,
  generateToolCallId,
  hasTools,
  parseToolCallReply,
  selectableTools,
} from "./webCookieToolBridge.js";
import { estimateInputTokens, estimateOutputTokens } from "../utils/usageTracking.js";

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

const TOOL_RESULT_MARKER = "<<TOOL_RESULT>>";

function TOOL_RESULT_LINE(text, name) {
  return `${TOOL_RESULT_MARKER} ${name || "tool"}: ${text} ${TOOL_RESULT_MARKER}`;
}

/**
 * Fold the request into DeepAI's chatHistory shape. A client that sent tools
 * gets the shared tool protocol (schema, transcript turns, tail reminder)
 * written into the first turn, and its assistant tool_calls / tool results are
 * flattened to prose, because the upstream only understands user/assistant text.
 */
function buildChatHistory(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const toolMode = hasTools(body);
  let instructions = "";
  let reminder = "";
  if (toolMode) {
    instructions = buildToolInstructions(body, "fenced");
    const { mode, forced } = selectableTools(body);
    reminder = buildToolReminder("fenced", { mode, forced });
  }
  const history = [];
  const systemParts = [];
  for (const message of messages) {
    if (message?.role === "tool") {
      const text = contentToText(message?.content);
      if (text) history.push({ role: "user", content: `${TOOL_RESULT_LINE(text, message.name)}\n\nThis is the result of the tool call you just made. If it answers the request, reply with the final answer in plain text and no tool_call block; call a tool again only if something is still missing.` });
      continue;
    }
    if (message?.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const text = contentToText(message?.content);
      const blocks = message.tool_calls
        .map((tc) => `\`\`\`tool_call\n{"name": ${JSON.stringify(String(tc?.function?.name || ""))}, "arguments": ${tc?.function?.arguments || "{}"}}\n\`\`\``)
        .join("\n");
      history.push({ role: "assistant", content: text ? `${text}\n${blocks}` : blocks });
      continue;
    }
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
  if (instructions) {
    // The schema leads, the last turn re-anchors it: a long agent system prompt
    // drowns a rule the model read 30 turns ago, so the reminder goes last.
    if (history.length) history[0] = { ...history[0], content: `${instructions}\n\n${history[0].content}` };
    else history.push({ role: "user", content: instructions });
  }
  if (reminder) {
    // A latest turn that is a tool result already ends with the stop condition;
    // the "call a tool NOW" reminder after it would ask for the same call twice.
    const lastIsToolResult = history[history.length - 1]?.content?.includes(TOOL_RESULT_MARKER);
    if (!lastIsToolResult) {
      for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].role === "user") {
          history[i] = { ...history[i], content: `${history[i].content}\n\n${reminder}` };
          break;
        }
      }
      if (history[history.length - 1]?.role !== "user") history.push({ role: "user", content: reminder });
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

function usageOf(body, content, calls = []) {
  const outputLen = (content ? content.length : 0) +
    (calls?.length ? JSON.stringify(calls).length : 0);
  const promptTokens = estimateInputTokens(body);
  const completionTokens = estimateOutputTokens(outputLen);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    estimated: true,
  };
}

function chatId() {
  return `chatcmpl-${crypto.randomBytes(12).toString("hex")}`;
}

function streamResponse(text, model, id, options = {}) {
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);
  const chunk = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const base = { id, object: "chat.completion.chunk", created, model };
  const { content, calls } = options.toolMode
    ? parseToolCallReply(text)
    : { content: text, calls: [] };
  const usage = usageOf(options.body, content, calls);
  const stream = new ReadableStream({
    start(controller) {
      const push = (delta, finishReason) =>
        controller.enqueue(chunk({
          ...base,
          choices: [{ index: 0, delta, ...(finishReason ? { finish_reason: finishReason } : {}) }],
          ...(finishReason ? { usage } : {}),
        }));
      let sentCalls = false;
      if (calls.length) {
        // In OpenAI protocol, when tool_calls are present, the initial content delta
        // is typically null or only preceding non-tool thought text.
        if (content) {
          push({ role: "assistant", content }, null);
        } else {
          push({ role: "assistant" }, null);
        }
        sentCalls = emitToolCallChunks(
          (delta, finishReason) => push(delta, finishReason),
          () => {},
          calls
        );
      } else {
        push({ role: "assistant", content }, null);
      }
      if (!sentCalls) push({}, "stop");
      // emitToolCallChunks already closed the stream with finish_reason
      // "tool_calls"; one [DONE] is the protocol.
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

function jsonResponse(text, model, id, options = {}) {
  const created = Math.floor(Date.now() / 1000);
  const { content, calls } = options.toolMode
    ? parseToolCallReply(text)
    : { content: text, calls: [] };
  const message = { role: "assistant", content: content || null };
  if (calls.length) {
    message.tool_calls = calls.map((call) => ({
      id: generateToolCallId(),
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
    }));
  }
  return new Response(
    JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: calls.length ? "tool_calls" : "stop",
      }],
      usage: usageOf(options.body, content, calls),
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
    const toolMode = hasTools(body);
    return {
      response: stream
        ? streamResponse(text, model, id, { toolMode, body })
        : jsonResponse(text, model, id, { toolMode, body }),
      url: ENDPOINT,
      headers,
      transformedBody: payload,
    };
  }
}
