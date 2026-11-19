// ChatGPT Web chat over plain HTTP.
//
// Same transport the web app uses: sentinel headers → `/f/conversation/prepare`
// → `/f/conversation` SSE. Tool calling rides the shared `<tool>` prompt
// contract (translator/webTools.js); this module only owns the wire format.
//
// Two behaviours are ChatGPT-specific and live here rather than in the shared
// helpers:
//   - The prompt must end with an explicit "emit only <tool> blocks" order, or
//     the model answers in prose and never calls anything.
//   - The SSE closes before the turn is done. The conversation document must be
//     polled until `is_complete`, otherwise a long tool batch is parsed half-way.

import { randomUUID } from "node:crypto";
import { fetchSentinelHeaders } from "./sentinel.js";
import { prepareToolMessages } from "../../translator/webTools.js";
const SSE_DEADLINE_MS = 120000;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 180000;
const MAX_SSE_BYTES = 16 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** ChatGPT ignores the shared contract unless told, in the last turn, to emit it. */
const TOOL_ORDER =
  "Respond with ONLY <tool> blocks, one per line. No prose, no code fences, no explanation before or after the blocks.";

/** The order has to lead AND trail: ChatGPT discounts a contract it only sees last. */
const TOOL_LEAD = "Use the client tools provided below. Do not answer with prose when a tool is needed.";

/**
 * The strict order is only safe while the model still has tools to call. Once
 * the conversation carries tool results the model is summarizing, and forcing
 * the order makes it call the same tool again.
 */
function withToolOrder(prompt, hasTools, messages) {
  if (!hasTools) return prompt;
  const hasToolResults = messages.some((message) => String(message?.role || "").toLowerCase() === "tool");
  return hasToolResults ? prompt : `${TOOL_LEAD}\n\n${prompt}\n\n${TOOL_ORDER}`;
}

function fetchWithTimeout(url, options, timeoutMs, outerSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onAbort, { once: true });
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onAbort);
  });
}

/** Flatten OpenAI messages into one prompt turn (the web app has no role array). */
function flattenMessages(messages) {
  const systemLines = [];
  const lines = [];
  for (const message of messages) {
    const role = String(message?.role || "user");
    const parts = [];

    if (typeof message?.content === "string") parts.push(message.content);
    else if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (typeof part === "string") parts.push(part);
        else if (typeof part?.text === "string") parts.push(part.text);
      }
    }

    if (Array.isArray(message?.tool_calls)) {
      for (const call of message.tool_calls) {
        const name = call?.function?.name;
        if (!name) continue;
        let args = call.function.arguments;
        try {
          args = typeof args === "string" ? JSON.parse(args) : args;
        } catch {
          // Keep the raw string when it is not JSON.
        }
        parts.push(`<tool>${JSON.stringify({ name, arguments: args })}</tool>`);
      }
    }

    const text = parts.join("\n").trim();
    if (!text) continue;
    if (role === "system" || role === "developer") {
      systemLines.push(text);
    } else if (role === "tool") {
      lines.push(`Tool result${message?.tool_call_id ? ` (${message.tool_call_id})` : ""}: ${text}`);
    } else if (role === "assistant") {
      lines.push(`Assistant: ${text}`);
    } else {
      lines.push(text);
    }
  }
  // System first: the client-tool contract loses authority when it trails the
  // conversation and the model answers in prose instead.
  return [...systemLines, ...lines].join("\n\n");
}

/** Read the SSE stream, stopping at the deadline — partial text is expected. */
async function readSse(response, limit, deadlineMs) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + deadlineMs;
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      text += decoder.decode(value, { stream: true });
      if (text.length > limit) break;
    }
  } catch {
    // Deadline abort lands here; the partial text is what we want.
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

/**
 * Collect the finished assistant text from a conversation document.
 * Returns null while the turn has not finished yet.
 */
function finishedAssistantText(document) {
  const mapping = document?.mapping || {};
  let text = "";
  let complete = false;
  let errorText = "";
  for (const node of Object.values(mapping)) {
    const message = node?.message;
    if (!message) continue;
    const role = String(message.author?.role || "").toLowerCase();
    if (role === "assistant") {
      if (message.metadata?.is_complete === true) complete = true;
      if (message.content?.content_type === "text") {
        text += (message.content.parts || []).filter((part) => typeof part === "string").join("");
      }
      if (message.metadata?.is_error) {
        const parts = message.content?.parts || [];
        const joined = parts.filter((part) => typeof part === "string").join("");
        if (joined) errorText = joined;
      }
    }
  }
  if (!complete) return null;
  return { text, errorText };
}

/**
 * Run one chat turn over HTTP.
 *
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {string} options.accessToken
 * @param {string} options.cookie - Cookie header from the stored credential
 * @param {string} options.userAgent
 * @param {object} options.body - OpenAI chat body ({ messages, tools, ... })
 * @returns {Promise<{text: string, hasTools: boolean, requestedTools: Array}>}
 */
export async function runChatGptWebHttpTurn({ baseUrl, accessToken, cookie, userAgent, body, signal, log }) {
  if (!accessToken) throw Object.assign(new Error("ChatGPT session has no access token"), { status: 401 });
  if (signal?.aborted) throw new Error("Request aborted");

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) throw Object.assign(new Error("ChatGPT Web requires messages"), { status: 400 });

  const prepared = prepareToolMessages(body, messages);
  const prompt = withToolOrder(flattenMessages(prepared.effectiveMessages), prepared.hasTools, messages);
  if (!prompt.trim()) throw Object.assign(new Error("ChatGPT Web requires non-empty text"), { status: 400 });

  const sentinel = await fetchSentinelHeaders({ baseUrl, accessToken, userAgent, signal });
  const headers = {
    ...sentinel,
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": userAgent,
    ...(cookie ? { Cookie: cookie } : {}),
    "Content-Type": "application/json",
  };

  const prepare = await fetchWithTimeout(`${baseUrl}/backend-api/f/conversation/prepare`, {
    method: "POST",
    headers: { ...headers, Accept: "application/json" },
    body: JSON.stringify({
      action: "next",
      parent_message_id: randomUUID(),
      model: "auto",
      client_prepare_state: "success",
      timezone_offset_min: 0,
      timezone: "UTC",
      conversation_mode: { kind: "primary_assistant" },
      partial_query: {
        id: randomUUID(),
        author: { role: "user" },
        content: { content_type: "text", parts: [prompt] },
      },
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: { app_name: "chatgpt.com" },
    }),
  }, 60000, signal);
  if (!prepare.ok) {
    const detail = (await prepare.text().catch(() => "")).slice(0, 200);
    throw Object.assign(new Error(`ChatGPT prepare failed (HTTP ${prepare.status}) ${detail}`), { status: prepare.status || 502 });
  }
  const prepareJson = await prepare.json().catch(() => null);

  const conversation = await fetchWithTimeout(`${baseUrl}/backend-api/f/conversation`, {
    method: "POST",
    headers: {
      ...headers,
      Accept: "text/event-stream",
      "X-Conduit-Token": prepareJson?.conduit_token || "",
      "X-Oai-Turn-Trace-Id": randomUUID(),
    },
    body: JSON.stringify({
      action: "next",
      messages: [{
        id: randomUUID(),
        author: { role: "user" },
        create_time: Date.now() / 1000,
        content: { content_type: "text", parts: [prompt] },
        metadata: { serialization_metadata: { custom_symbol_offsets: [] } },
      }],
      parent_message_id: randomUUID(),
      model: "auto",
      client_prepare_state: "sent",
      timezone_offset_min: 0,
      timezone: "UTC",
      conversation_mode: { kind: "primary_assistant" },
      enable_message_followups: true,
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: { app_name: "chatgpt.com" },
      force_parallel_switch: "auto",
    }),
  }, SSE_DEADLINE_MS + 15000, signal);
  if (!conversation.ok) {
    throw Object.assign(new Error(`ChatGPT conversation failed (HTTP ${conversation.status})`), { status: conversation.status || 502 });
  }

  const sseText = await readSse(conversation, MAX_SSE_BYTES, SSE_DEADLINE_MS);
  const conversationId = (sseText.match(/"conversation_id"\s*:\s*"([0-9a-f-]{36})"/) || [])[1] || "";
  if (!conversationId) {
    throw Object.assign(new Error("ChatGPT conversation produced no conversation id"), { status: 502 });
  }

  // The stream ends long before the turn does — wait for is_complete or the
  // tool batch gets parsed half-finished.
  const started = Date.now();
  while (Date.now() - started <= POLL_TIMEOUT_MS) {
    if (signal?.aborted) throw new Error("Request aborted");
    const res = await fetchWithTimeout(
      `${baseUrl}/backend-api/conversation/${conversationId}`,
      { headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": userAgent, Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) } },
      30000,
      signal
    ).catch(() => null);
    if (res?.ok) {
      const document = await res.json().catch(() => null);
      const finished = document ? finishedAssistantText(document) : null;
      if (finished) {
        if (!finished.text.trim() && finished.errorText) {
          throw Object.assign(new Error(`ChatGPT refused the turn: ${finished.errorText.slice(0, 200)}`), { status: 400 });
        }
        // Return the raw text: buildToolModeResponse() strips and parses the
        // `<tool>` blocks downstream, so parsing twice here would lose them.
        if (log && !prepared.hasTools) log.debug?.("CGPT-WEB", `chat turn complete (${finished.text.length} chars)`);
        return { text: finished.text, hasTools: prepared.hasTools, requestedTools: prepared.requestedTools };
      }
    } else if (log) {
      log.debug?.("CGPT-WEB", `conversation poll status ${res?.status ?? "network"}, retrying`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw Object.assign(new Error("ChatGPT chat turn timed out"), { status: 504 });
}
