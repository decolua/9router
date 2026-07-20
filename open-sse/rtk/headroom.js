import { claudeToOpenAIRequest } from "../translator/request/claude-to-openai.js";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.js";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../translator/request/openai-responses.js";

const DEFAULT_TIMEOUT_MS = 3000;

function jsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value) || "").length;
  } catch {
    return 0;
  }
}

function messagePayload(body) {
  if (Array.isArray(body?.messages)) return body.messages;
  if (Array.isArray(body?.input)) return body.input;
  const kiro = collectKiroHeadroomMessages(body);
  if (kiro) return kiro.messages;
  return null;
}

function captureSizeSnapshot(body) {
  const messages = messagePayload(body);
  return {
    bodyBytes: jsonBytes(body),
    messageBytes: messages ? jsonBytes(messages) : 0,
  };
}

function setDiagnostic(diagnostics, reason) {
  if (diagnostics && !diagnostics.reason) diagnostics.reason = reason;
}

function scrubSensitiveUrlText(text) {
  return String(text)
    .replace(/\/\/[^/@\s]+@/g, "//")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, "$1");
}

function describeFetchError(error) {
  const cause = error?.cause;
  const code = cause?.code || error?.code;
  const message = scrubSensitiveUrlText(cause?.message || error?.message || String(error));
  return code ? `${code}: ${message}` : message;
}

function buildCompressEndpoint(url) {
  try {
    const parsed = new URL(url);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/v1/compress`;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const raw = String(url).replace(/#.*$/, "");
    const [base, query = ""] = raw.split("?", 2);
    const endpoint = `${base.replace(/\/$/, "")}/v1/compress`;
    return query ? `${endpoint}?${query}` : endpoint;
  }
}

function maskEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(endpoint).replace(/\/\/[^/@\s]+@/, "//").replace(/[?#].*$/, "");
  }
}

function hasUnsafeResponsesInputForCompression(body) {
  if (!Array.isArray(body?.input)) return false;
  return body.input.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return typeof item.type === "string" && item.type !== "message";
  });
}

function collectKiroHeadroomMessages(body) {
  const state = body?.conversationState;
  if (!state || typeof state !== "object") return null;

  const messages = [];
  const targets = [];

  const addTextTarget = (role, text, target, extra = {}) => {
    if (typeof text !== "string") return;
    messages.push({ role, content: text, ...extra });
    targets.push(target);
  };

  const toToolCalls = (toolUses) => {
    if (!Array.isArray(toolUses) || toolUses.length === 0) return undefined;
    const calls = toolUses.map((toolUse) => ({
      id: toolUse?.toolUseId,
      type: "function",
      function: {
        name: toolUse?.name || "",
        arguments: JSON.stringify(toolUse?.input || {}),
      },
    })).filter((call) => call.id || call.function.name);
    return calls.length > 0 ? calls : undefined;
  };

  const visit = (item) => {
    const user = item?.userInputMessage;
    if (user) {
      addTextTarget("system", user.systemInstruction, { object: user, key: "systemInstruction" });
      addTextTarget("user", user.content, { object: user, key: "content" });

      const toolResults = user.userInputMessageContext?.toolResults;
      if (Array.isArray(toolResults)) {
        for (const toolResult of toolResults) {
          const content = toolResult?.content;
          if (!Array.isArray(content)) continue;
          for (const part of content) {
            addTextTarget(
              "tool",
              part?.text,
              { object: part, key: "text" },
              toolResult?.toolUseId ? { tool_call_id: toolResult.toolUseId } : {}
            );
          }
        }
      }
      return;
    }

    const assistant = item?.assistantResponseMessage;
    if (assistant) {
      const toolCalls = toToolCalls(assistant.toolUses);
      addTextTarget(
        "assistant",
        assistant.content,
        { object: assistant, key: "content" },
        toolCalls ? { tool_calls: toolCalls } : {}
      );
    }
  };

  if (Array.isArray(state.history)) {
    for (const item of state.history) visit(item);
  }
  if (state.currentMessage) visit(state.currentMessage);

  return messages.length > 0 ? { messages, targets } : null;
}

function textFromHeadroomMessage(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const parts = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
    } else if (typeof part?.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function applyKiroHeadroomMessages(projection, compressedMessages, diagnostics) {
  if (!Array.isArray(compressedMessages) || compressedMessages.length !== projection.messages.length) {
    setDiagnostic(diagnostics, "proxy response did not match Kiro message count");
    return false;
  }

  const updates = [];
  for (let i = 0; i < projection.messages.length; i++) {
    const expected = projection.messages[i];
    const actual = compressedMessages[i];
    if (!actual || actual.role !== expected.role) {
      setDiagnostic(diagnostics, "proxy response did not preserve Kiro message order");
      return false;
    }

    const text = textFromHeadroomMessage(actual);
    if (text === null) {
      setDiagnostic(diagnostics, "proxy response missing Kiro text content");
      return false;
    }
    updates.push({ target: projection.targets[i], text });
  }

  for (const update of updates) {
    update.target.object[update.target.key] = update.text;
  }
  return true;
}

// POST messages to Headroom /v1/compress; returns compressed messages + stats or null.
async function callCompress(url, messages, model, timeoutMs, compressUserMessages, diagnostics) {
  const endpoint = buildCompressEndpoint(url);
  diagnostics.endpoint = maskEndpoint(endpoint);
  const payload = { messages, model };
  if (compressUserMessages) payload.config = { compress_user_messages: true };
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    setDiagnostic(diagnostics, `request failed: ${describeFetchError(error)}`);
    return null;
  }
  if (!res.ok) {
    setDiagnostic(diagnostics, `proxy returned HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (!Array.isArray(data?.messages)) {
    setDiagnostic(diagnostics, "proxy response missing messages[]");
    return null;
  }
  return data;
}

// Compress request body via Headroom proxy. Fail-open: returns null on any error.
// /v1/compress only understands OpenAI shape, so Claude bodies are translated
// to OpenAI, compressed, then translated back using 9Router's own translators.
export async function compressWithHeadroom(body, { enabled, url, model, format, compressUserMessages, timeoutMs = DEFAULT_TIMEOUT_MS, diagnostics = null } = {}) {
  if (!enabled) {
    setDiagnostic(diagnostics, "disabled");
    return null;
  }
  if (!url) {
    setDiagnostic(diagnostics, "missing proxy URL");
    return null;
  }
  if (!body) {
    setDiagnostic(diagnostics, "missing request body");
    return null;
  }

  try {
    if (diagnostics) diagnostics.before = captureSizeSnapshot(body);

    // Claude shape: translate → OpenAI → compress → translate back.
    if (format === "claude") {
      const oai = claudeToOpenAIRequest(model, body, false);
      if (!Array.isArray(oai?.messages)) {
        setDiagnostic(diagnostics, "Claude request did not translate to messages[]");
        return null;
      }
      const data = await callCompress(url, oai.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      const claudeBody = openaiToClaudeRequest(model, { ...oai, messages: data.messages }, false);
      if (Array.isArray(claudeBody?.messages)) body.messages = claudeBody.messages;
      if (claudeBody?.system !== undefined) body.system = claudeBody.system;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI Responses shape (Codex): body.input holds Responses items, NOT OpenAI
    // messages. Translate input -> OpenAI -> compress -> translate back to input so
    // body.input keeps the Responses contract (the proxy only understands OpenAI). (#1998)
    if (format === "openai-responses") {
      if (hasUnsafeResponsesInputForCompression(body)) {
        setDiagnostic(diagnostics, "skipped: openai-responses tool/reasoning input is not safe to compress");
        return null;
      }
      const oai = openaiResponsesToOpenAIRequest(model, body, false);
      if (!Array.isArray(oai?.messages)) return null;
      const data = await callCompress(url, oai.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      // input: undefined so the translator rebuilds input from the compressed
      // messages instead of returning the original input unchanged.
      const responsesBody = openaiToOpenAIResponsesRequest(
        model,
        { ...oai, input: undefined, messages: data.messages },
        false
      );
      if (Array.isArray(responsesBody?.input)) body.input = responsesBody.input;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // Kiro shape: conversationState.history/currentMessage are projected to
    // OpenAI messages for the proxy, then copied back into the original Kiro
    // fields. Keep the provider payload shape intact for Kiro's executor.
    if (format === "kiro") {
      const projection = collectKiroHeadroomMessages(body);
      if (!projection) {
        setDiagnostic(diagnostics, "Kiro request did not project to messages[]");
        return null;
      }
      const data = await callCompress(url, projection.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      if (!applyKiroHeadroomMessages(projection, data.messages, diagnostics)) return null;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI shape: messages/input go straight to the proxy.
    const key = Array.isArray(body.messages) ? "messages"
      : Array.isArray(body.input) ? "input"
      : null;
    if (!key) {
      setDiagnostic(diagnostics, `unsupported ${format || "unknown"} request shape`);
      return null;
    }
    const data = await callCompress(url, body[key], model, timeoutMs, compressUserMessages, diagnostics || {});
    if (!data) return null;
    body[key] = data.messages;
    if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
    return data;
  } catch (error) {
    setDiagnostic(diagnostics, `unexpected error: ${error?.message || String(error)}`);
    return null;
  }
}

export function formatHeadroomLog(stats) {
  if (!stats) return null;
  const before = stats.tokens_before || 0;
  const after = stats.tokens_after || 0;
  const delta = stats.tokens_saved || 0;
  const pct = before > 0 ? ((delta / before) * 100).toFixed(1) : "0";
  return `reported token delta=${delta} before=${before}${after ? ` after=${after}` : ""} (${pct}%)`.trim();
}

export function formatHeadroomSizeLog(diagnostics) {
  const before = diagnostics?.before;
  const after = diagnostics?.after;
  if (!before || !after) return "";
  return `body=${before.bodyBytes}B→${after.bodyBytes}B messages=${before.messageBytes}B→${after.messageBytes}B`;
}

export function isHeadroomPhantomSavings(stats, diagnostics, minShrinkRatio = 0.05) {
  if (!stats?.tokens_saved || stats.tokens_saved <= 0) return false;
  const before = diagnostics?.before?.bodyBytes || 0;
  const after = diagnostics?.after?.bodyBytes || 0;
  if (before <= 0 || after <= 0) return false;
  return after >= before * (1 - minShrinkRatio);
}
