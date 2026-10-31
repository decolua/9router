import { FORMATS } from "../translator/formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, COMMANDCODE_BLOCK, RESPONSES_ITEM } from "../translator/schema/index.js";
import { HEADROOM_TOOL_OUTPUT_MAX_DEPTH } from "./constants.js";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../translator/request/openai-responses.js";

const DEFAULT_TIMEOUT_MS = 3000;

function normalizeTimeout(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TIMEOUT_MS;
}

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
  if (Array.isArray(body?.params?.messages)) return body.params.messages;
  if (Array.isArray(body?.request?.contents)) return body.request.contents;
  if (Array.isArray(body?.contents)) return body.contents;
  const kiro = collectKiroHeadroomMessages(body);
  if (kiro) return kiro.messages;
  return null;
}

function captureSizeSnapshot(body) {
  const messages = messagePayload(body);
  const toolHistory = messages?.filter((message) =>
    message?.role === "tool"
    || message?.role === "function"
    || message?.tool_calls?.length
    || message?.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT
    || message?.parts?.some?.((part) => part?.functionResponse || part?.functionCall)
    || message?.content?.some?.((part) => part?.type === "tool_use" || part?.type === "tool_result"
      || part?.type === COMMANDCODE_BLOCK.TOOL_CALL || part?.type === COMMANDCODE_BLOCK.TOOL_RESULT)
  ) || [];
  return {
    bodyBytes: jsonBytes(body),
    messageBytes: messages ? jsonBytes(messages) : 0,
    toolSchemaBytes: jsonBytes(body?.tools || body?.params?.tools || body?.request?.tools || []),
    toolHistoryBytes: jsonBytes(toolHistory),
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

// Project only plain tool-output leaves. Keep protocol items and structured
// payloads in their native format instead of round-tripping the conversation.
function collectToolOutputText(body, format) {
  const messages = [];
  const targets = [];
  const visit = (object, key, depth = 0) => {
    if (depth > HEADROOM_TOOL_OUTPUT_MAX_DEPTH) return;
    const value = object?.[key];
    if (typeof value === "string") {
      if (!value.trim()) return;
      try { JSON.parse(value); return; } catch { /* plain text */ }
      messages.push({ role: ROLE.TOOL, tool_call_id: `headroom-tool-${messages.length}`, content: value });
      targets.push({ object, key, text: value });
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) visit(value, i, depth + 1);
    } else if (value && typeof value === "object") {
      if (value.type && value.type !== OPENAI_BLOCK.TEXT && value.type !== RESPONSES_ITEM.INPUT_TEXT) return;
      for (const field of ["result", "output", "content", "text"]) {
        if (Object.hasOwn(value, field)) visit(value, field, depth + 1);
      }
    }
  };

  if (format === FORMATS.OPENAI_RESPONSES && hasUnsafeResponsesInputForCompression(body)) {
    for (const item of body.input) {
      if (item?.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) visit(item, "output");
    }
  } else if ([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY, FORMATS.VERTEX].includes(format)) {
    const contents = body.request?.contents || body.contents;
    if (!Array.isArray(contents)) return null;
    for (const content of contents) {
      if (!Array.isArray(content?.parts)) continue;
      for (const part of content.parts) {
        if (part?.functionResponse) visit(part.functionResponse, "response");
      }
    }
  } else {
    return null;
  }
  return { messages, targets };
}

function applyToolOutputText(projection, messages, diagnostics) {
  if (!Array.isArray(messages) || messages.length !== projection.messages.length) {
    setDiagnostic(diagnostics, "proxy response did not match tool-output count");
    return false;
  }
  const updates = [];
  for (let i = 0; i < messages.length; i++) {
    const actual = messages[i];
    if (actual?.role !== ROLE.TOOL || actual.tool_call_id !== projection.messages[i].tool_call_id
      || typeof actual.content !== "string") {
      setDiagnostic(diagnostics, "proxy response did not preserve tool-output IDs, order, roles or text");
      return false;
    }
    if (actual.content.trim() && actual.content.length < projection.targets[i].text.length) {
      updates.push({ ...projection.targets[i], text: actual.content });
    }
  }
  for (const { object, key, text } of updates) object[key] = text;
  return true;
}

// Project text leaves, never the native blocks themselves. A Claude/OpenAI
// round-trip drops documents, signed thinking and tool-result metadata.
function collectClaudeHeadroomMessages(body) {
  if (!Array.isArray(body?.messages)) return null;
  const messages = [];
  const targets = [];
  const addText = (role, object, key, extra = {}) => {
    if (typeof object?.[key] !== "string") return;
    messages.push({ role, content: object[key], ...extra });
    targets.push({ object, key });
  };
  const addContent = (role, object, key, extra = {}) => {
    if (typeof object?.[key] === "string") {
      addText(role, object, key, extra);
    } else if (Array.isArray(object?.[key])) {
      for (const block of object[key]) {
        if (block?.type === CLAUDE_BLOCK.TEXT) addText(role, block, "text", extra);
      }
    }
  };

  addContent(ROLE.SYSTEM, body, "system");
  for (const message of body.messages) {
    const blocks = Array.isArray(message?.content) ? message.content : [];
    const toolUses = blocks.filter((block) => block?.type === CLAUDE_BLOCK.TOOL_USE);
    if (message?.role === ROLE.ASSISTANT && toolUses.length) {
      messages.push({
        role: ROLE.ASSISTANT,
        content: "",
        tool_calls: toolUses.map((block) => ({
          id: block.id,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
        })),
      });
      targets.push(null);
    }
    addContent(message?.role, message, "content");
    for (const block of blocks) {
      if (block?.type === CLAUDE_BLOCK.TOOL_RESULT) {
        addContent(ROLE.TOOL, block, "content", { tool_call_id: block.tool_use_id });
      }
    }
  }
  return targets.some(Boolean) ? { messages, targets } : null;
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

function collectCommandCodeHeadroomMessages(body) {
  const params = body?.params;
  if (!Array.isArray(params?.messages)) return null;
  const messages = [];
  const targets = [];
  const addText = (role, object, key, extra = {}) => {
    if (typeof object?.[key] !== "string") return;
    messages.push({ role, content: object[key], ...extra });
    targets.push({ object, key });
  };

  addText(ROLE.SYSTEM, params, "system");
  for (const message of params.messages) {
    if (!Array.isArray(message?.content)) continue;
    const toolCalls = message.content.filter((part) => part?.type === COMMANDCODE_BLOCK.TOOL_CALL);
    if (message.role === ROLE.ASSISTANT && toolCalls.length) {
      messages.push({
        role: ROLE.ASSISTANT,
        content: "",
        tool_calls: toolCalls.map((part) => ({
          id: part.toolCallId,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: part.toolName, arguments: JSON.stringify(part.input ?? {}) },
        })),
      });
      // Tool metadata is context for the proxy; only native text fields are updated.
      targets.push(null);
    }
    for (const part of message.content) {
      if (part?.type === OPENAI_BLOCK.TEXT) {
        addText(message.role, part, "text");
      } else if (part?.type === COMMANDCODE_BLOCK.TOOL_RESULT && part.output?.type === OPENAI_BLOCK.TEXT) {
        addText(ROLE.TOOL, part.output, "value", { tool_call_id: part.toolCallId, name: part.toolName });
      }
    }
  }
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

function applyProjectedHeadroomMessages(projection, compressedMessages, diagnostics, label) {
  if (!Array.isArray(compressedMessages) || compressedMessages.length !== projection.messages.length) {
    setDiagnostic(diagnostics, `proxy response did not match ${label} message count`);
    return false;
  }

  const updates = [];
  for (let i = 0; i < projection.messages.length; i++) {
    const expected = projection.messages[i];
    const actual = compressedMessages[i];
    if (!actual || actual.role !== expected.role || actual.tool_call_id !== expected.tool_call_id) {
      setDiagnostic(diagnostics, `proxy response did not preserve ${label} message order`);
      return false;
    }

    const text = textFromHeadroomMessage(actual);
    if (text === null) {
      setDiagnostic(diagnostics, `proxy response missing ${label} text content`);
      return false;
    }
    if (projection.targets[i]) updates.push({ target: projection.targets[i], text });
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
  timeoutMs = normalizeTimeout(timeoutMs);
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

    const toolOutputs = collectToolOutputText(body, format);
    if (toolOutputs) {
      if (!toolOutputs.messages.length) {
        setDiagnostic(diagnostics, "no eligible plain-text tool output");
        return null;
      }
      const data = await callCompress(url, toolOutputs.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data || !applyToolOutputText(toolOutputs, data.messages, diagnostics)) return null;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // Keep Claude's documents, tool blocks and signatures in their native form.
    // Only validated text leaves are copied back after compression.
    if (format === FORMATS.CLAUDE) {
      const projection = collectClaudeHeadroomMessages(body);
      if (!projection) {
        setDiagnostic(diagnostics, "Claude request has no eligible text content");
        return null;
      }
      const data = await callCompress(url, projection.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      if (!applyProjectedHeadroomMessages(projection, data.messages, diagnostics, "Claude")) return null;
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
      if (!Array.isArray(oai?.messages)) {
        setDiagnostic(diagnostics, "openai-responses request did not translate to messages[]");
        return null;
      }
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
      if (!applyProjectedHeadroomMessages(projection, data.messages, diagnostics, "Kiro")) return null;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // CommandCode keeps native blocks under params. Project text for Headroom,
    // then update only those fields so tool calls, reasoning and images survive.
    if (format === FORMATS.COMMANDCODE) {
      const projection = collectCommandCodeHeadroomMessages(body);
      if (!projection) {
        setDiagnostic(diagnostics, "CommandCode request did not project to messages[]");
        return null;
      }
      const data = await callCompress(url, projection.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      if (!applyProjectedHeadroomMessages(projection, data.messages, diagnostics, "CommandCode")) return null;
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
  const effective = before.bodyBytes > 0
    ? (((before.bodyBytes - after.bodyBytes) / before.bodyBytes) * 100).toFixed(1)
    : "0.0";
  return `body=${before.bodyBytes}B→${after.bodyBytes}B messages=${before.messageBytes}B→${after.messageBytes}B tools=${before.toolSchemaBytes || 0}B→${after.toolSchemaBytes || 0}B toolHistory=${before.toolHistoryBytes || 0}B→${after.toolHistoryBytes || 0}B effective=${effective}%`;
}

export function isHeadroomPhantomSavings(stats, diagnostics, minShrinkRatio = 0.05) {
  if (!stats?.tokens_saved || stats.tokens_saved <= 0) return false;
  // Keep the body check for savings in Claude's top-level system prompt.
  return ["bodyBytes", "messageBytes"].every((key) => {
    const before = diagnostics?.before?.[key] || 0;
    const after = diagnostics?.after?.[key] || 0;
    return before > 0 && after > 0 && after >= before * (1 - minShrinkRatio);
  });
}
