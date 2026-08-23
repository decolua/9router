// ponytail: Claude OpenAI-pivot imports dropped — direct Claude path ships;
// re-enable only with a round-trip no-loss proof (tool ids, is_error, cache_control).
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
  const toolHistory = messages?.filter((message) =>
    message?.role === "tool"
    || message?.role === "function"
    || message?.tool_calls?.length
    || message?.content?.some?.((part) => part?.type === "tool_use" || part?.type === "tool_result")
  ) || [];
  return {
    bodyBytes: jsonBytes(body),
    messageBytes: messages ? jsonBytes(messages) : 0,
    toolSchemaBytes: jsonBytes(body?.tools || []),
    toolHistoryBytes: jsonBytes(toolHistory),
  };
}

function sanitizeReason(text) {
  let s = String(text ?? "").trim().replace(/\s+/g, " ");
  s = scrubSensitiveUrlText(s);
  if (s.length > 200) s = s.slice(0, 200);
  return s;
}

function setDiagnostic(diagnostics, reason) {
  if (diagnostics && !diagnostics.reason) diagnostics.reason = sanitizeReason(reason);
}

// OpenAI shape structural guard: same count, ordered role, valid content shape,
// and tool-pairing identity preserved (tool_call_id + assistant tool_calls).
// Any fixup (e.g. reindexing tool_call_id) is dangerous — reject instead.
function validateOpenAIMessageShape(sourceMessages, candidateMessages, diagnostics) {
  if (!Array.isArray(candidateMessages) || candidateMessages.length !== sourceMessages.length) {
    setDiagnostic(diagnostics, "proxy response did not preserve message count or order");
    return false;
  }
  for (let i = 0; i < sourceMessages.length; i++) {
    const src = sourceMessages[i] || {};
    const cand = candidateMessages[i] || {};
    if (cand.role !== src.role) {
      setDiagnostic(diagnostics, "proxy response did not preserve message count or order");
      return false;
    }
    // content: string | array blocks | null/empty (assistant tool_calls-only)
    const candContent = cand.content;
    const srcHasToolCalls = Array.isArray(src.tool_calls) && src.tool_calls.length > 0;
    const candHasToolCalls = Array.isArray(cand.tool_calls) && cand.tool_calls.length > 0;
    const contentShape =
      typeof candContent === "string" || Array.isArray(candContent) ||
      candContent === null || candContent === undefined ||
      typeof candContent === "object";
    if (candContent === null || candContent === undefined) {
      if (!candHasToolCalls && !srcHasToolCalls) {
        setDiagnostic(diagnostics, "proxy response did not preserve message count or order");
        return false;
      }
    } else if (!contentShape) {
      setDiagnostic(diagnostics, "proxy response did not preserve message count or order");
      return false;
    }
    // Tool pairing: do not let the proxy rewrite routing metadata.
    if (src.tool_call_id != null || cand.tool_call_id != null) {
      if (String(cand.tool_call_id ?? "") !== String(src.tool_call_id ?? "")) {
        setDiagnostic(diagnostics, "proxy response did not preserve message count or order");
        return false;
      }
    }
    const srcCalls = src.tool_calls;
    const candCalls = cand.tool_calls;
    if ((Array.isArray(srcCalls) && srcCalls.length > 0) || (Array.isArray(candCalls) && candCalls.length > 0)) {
      if (!Array.isArray(candCalls) || candCalls.length !== (srcCalls?.length ?? 0)) {
        setDiagnostic(diagnostics, "proxy response did not preserve tool pairing identity");
        return false;
      }
      for (let j = 0; j < srcCalls.length; j++) {
        const sCall = srcCalls[j] || {};
        const cCall = candCalls[j] || {};
        if (String(cCall.id ?? "") !== String(sCall.id ?? "") ||
            String(cCall.type ?? "function") !== String(sCall.type ?? "function") ||
            String(cCall.function?.name ?? "") !== String(sCall.function?.name ?? "") ||
            String(cCall.function?.arguments ?? "") !== String(sCall.function?.arguments ?? "")) {
          setDiagnostic(diagnostics, "proxy response did not preserve tool pairing identity");
          return false;
        }
      }
    }
  }
  return true;
}

function resolveHeadroomAuth() {
  const key = (process.env.HEADROOM_API_KEY || "").trim();
  return key || null;
}

function containsCcrMarker(messages) {
  if (!Array.isArray(messages)) return false;
  for (const m of messages) {
    // Scan the whole message: `<<ccr:` hides in tool_calls.function.arguments
    // and non-text content parts, not just message.content text.
    try {
      if (JSON.stringify(m).includes("<<ccr:")) return true;
    } catch { /* circular/odd shape — fall through to text scan */ }
  }
  return false;
}

function hasCcrHashes(data) {
  return Array.isArray(data?.ccr_hashes) && data.ccr_hashes.length > 0;
}

function scrubSensitiveUrlText(text) {
  let s = String(text);
  s = s.replace(/\/\/[^/@\s]+@/g, "//");
  s = s.replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, "$1");
  // Secrets must NEVER be emitted in diagnostics or logs.
  const key = (process.env.HEADROOM_API_KEY || "").trim();
  const tok = (process.env.HEADROOM_PROXY_TOKEN || "").trim();
  for (const secret of [key, tok]) {
    if (!secret || secret.length < 8) continue;
    // Exact match only — no partial masking on short fragments.
    s = s.replaceAll(secret, "[redacted]");
  }
  return s;
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
    if (typeof item.type === "string" && item.type !== "message") return true;
    // Responses function_call_output with explicit error shape — never compress.
    if (typeof item.type === "string" && item.type === "function_call_output") {
      return item.status === "error" || item.is_error === true;
    }
    return false;
  });
}

// Detect an explicit error tool result anywhere in the request. Only explicit
// error shapes count (is_error / status:"error") — never infer from content text.
function hasErrorToolBlock(body, format) {
  try {
    // Claude: tool_result blocks carry is_error on the block.
    const hasClaudeToolResult = format === "claude";
    for (const message of body?.messages || []) {
      const content = message?.content;
      const parts = Array.isArray(content)
        ? content
        : typeof content === "object" && content !== null ? [content] : [];
      for (const part of parts) {
        if (part?.type === "tool_result" && (hasClaudeToolResult || message?.role === "tool")) {
          if (part.is_error === true) return true;
        }
        if ((part?.is_error === true || part?.status === "error") && (part?.type === "tool_result" || message?.role === "tool")) {
          return true;
        }
      }
      if (message?.role === "tool") {
        if (message.is_error === true || message.status === "error") return true;
      }
    }
    // Kiro: toolResults carry status.
    const state = body?.conversationState;
    if (state && typeof state === "object") {
      const items = [...(Array.isArray(state.history) ? state.history : []), state.currentMessage].filter(Boolean);
      for (const item of items) {
        const toolResults = item?.userInputMessage?.userInputMessageContext?.toolResults;
        if (!Array.isArray(toolResults)) continue;
        for (const tr of toolResults) {
          if (tr?.status === "error" || tr?.isError === true) return true;
        }
      }
    }
    // OpenAI Responses: function_call_output items carry status/is_error.
    if (format === "openai-responses" && Array.isArray(body?.input)) {
      for (const item of body.input) {
        if (item?.type === "function_call_output" && (item.status === "error" || item.is_error === true)) return true;
      }
    }
  } catch { /* fail-open */ }
  return false;
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
  // Exactly one outbound POST. Config is lossy-only. No frozen_message_count.
  const payload = { messages, model, config: { mode: "lossy_inline", ...(compressUserMessages ? { compress_user_messages: true } : {}) } };
  const headroomAuth = resolveHeadroomAuth();
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(headroomAuth ? { Authorization: `Bearer ${headroomAuth}` } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    setDiagnostic(diagnostics, `request failed: ${describeFetchError(error)}`);
    return null;
  }
  if (!res.ok) {
    if (res.status === 400 || res.status === 404) setDiagnostic(diagnostics, `proxy rejected config.mode (HTTP ${res.status})`);
    else setDiagnostic(diagnostics, `proxy returned HTTP ${res.status}`);
    return null; // no fallback retry — one call only
  }
  const data = await res.json();
  // CCR gate: gateway has no headroom_retrieve path — reject any CCR-marked response.
  if (hasCcrHashes(data)) {
    setDiagnostic(diagnostics, "rejected: response contains CCR markers");
    return null;
  }
  if (Array.isArray(data?.messages) && containsCcrMarker(data.messages)) {
    setDiagnostic(diagnostics, "rejected: response contains CCR markers");
    return null;
  }
  if (data?.compression_skipped === true) {
    setDiagnostic(diagnostics, sanitizeReason(data.skip_reason || "compression_skipped"));
    return null;
  }
  if (data?.skip_reason && !Array.isArray(data?.messages)) {
    setDiagnostic(diagnostics, sanitizeReason(data.skip_reason));
    return null;
  }
  if (!Array.isArray(data?.messages)) {
    setDiagnostic(diagnostics, "proxy response missing messages[]");
    return null;
  }
  // Token phantom / conflicting metrics gate — null means keep original.
  // Gates run on the PARSED numbers: a proxy returning string-encoded metrics
  // ("1000") must not bypass them via raw-value Number.isFinite checks.
  const tokensBefore = Number(data.tokens_before);
  const tokensAfter = Number(data.tokens_after);
  const tokensSaved = Number(data.tokens_saved);
  if (Number.isFinite(tokensSaved) && tokensSaved <= 0) {
    setDiagnostic(diagnostics, sanitizeReason(data.skip_reason || "no token saving — keeping original"));
    return null;
  }
  if (Number.isFinite(tokensBefore) && Number.isFinite(tokensAfter)) {
    if (tokensAfter >= tokensBefore * 0.95) {
      setDiagnostic(diagnostics, "phantom savings — keeping original (>95% tokens)");
      return null;
    }
    if (tokensAfter > tokensBefore) {
      setDiagnostic(diagnostics, "conflicting token metrics — keeping original");
      return null;
    }
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
    if (hasErrorToolBlock(body, format)) {
      setDiagnostic(diagnostics, "skipped: error tool result present — headroom not applied");
      return null;
    }

    // Claude shape: send native Claude messages directly (no OpenAI pivot, no retry).
    // system + tools stay local — duplicating them in the proxy payload would
    // double-bill on the response and risk losing them on a lossy round-trip.
    // ponytail: OpenAI pivot helpers kept for legacy consumers, direct path is canonical.
    if (format === "claude") {
      const sourceMessages = Array.isArray(body?.messages) ? body.messages : null;
      if (!sourceMessages) {
        setDiagnostic(diagnostics, "unsupported claude request shape");
        return null;
      }
      const data = await callCompress(url, sourceMessages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      // Validate response preserves identity (count + ordered roles) before commit.
      const compressed = data.messages;
      if (!Array.isArray(compressed) || compressed.length !== sourceMessages.length) {
        setDiagnostic(diagnostics, "proxy response did not preserve Claude message count");
        return null;
      }
      for (let i = 0; i < compressed.length; i++) {
        const expected = sourceMessages[i]?.role;
        const actual = compressed[i]?.role;
        const shaped = typeof compressed[i]?.content === "string" || Array.isArray(compressed[i]?.content);
        if (actual !== expected || !shaped) {
          setDiagnostic(diagnostics, "proxy response did not preserve Claude message shape");
          return null;
        }
      }
      // Byte-gain guard — candidate bytes compared to before snapshot.
      const candidateBytes = jsonBytes({ ...body, messages: compressed });
      const beforeBytes = diagnostics?.before?.bodyBytes ?? jsonBytes(body);
      if (candidateBytes >= beforeBytes * 0.95) {
        setDiagnostic(diagnostics, "phantom savings — keeping original (>95% size)");
        return null;
      }
      body.messages = compressed; // system + tools preserved locally, untouched
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
      // Candidate-before-mutate guard: require >5% byte shrink before committing input rewrite.
      const candidateResponses = openaiToOpenAIResponsesRequest(model, { ...oai, input: undefined, messages: data.messages }, false);
      if (!Array.isArray(candidateResponses?.input)) {
        setDiagnostic(diagnostics, "Responses translation did not produce compressed input");
        return null;
      }
      const beforeBytes = diagnostics?.before?.bodyBytes ?? jsonBytes(body);
      const candidateBytes = jsonBytes({ ...body, input: candidateResponses.input });
      if (candidateBytes >= beforeBytes * 0.95) {
        setDiagnostic(diagnostics, "phantom savings — keeping original (>95% size)");
        return null;
      }
      body.input = candidateResponses.input;
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
      // Byte-shrink guard BEFORE mutating any Kiro state: projected-message sizes
      // proxy for body shrink (targets are unchanged by compression).
      const beforeProjectedBytes = jsonBytes(projection.messages);
      const afterProjectedBytes = jsonBytes(data.messages);
      if (afterProjectedBytes >= beforeProjectedBytes * 0.95) {
        setDiagnostic(diagnostics, "phantom savings — keeping original (>95% size)");
        return null;
      }
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
    const sourceMessages = body[key];
    const data = await callCompress(url, sourceMessages, model, timeoutMs, compressUserMessages, diagnostics || {});
    if (!data) return null;
    // Structural guard BEFORE any byte math or mutation: a buggy/compromised
    // proxy must not be able to drop/reorder/retag history (silent context loss).
    if (!validateOpenAIMessageShape(sourceMessages, data.messages, diagnostics)) return null;
    // Candidate-before-mutate byte guard: require >5% shrink before committing.
    const expectedBeforeBytes = diagnostics?.before?.bodyBytes ?? jsonBytes(body);
    const candidateBytes = jsonBytes({ ...body, [key]: data.messages });
    if (candidateBytes >= expectedBeforeBytes * 0.95) {
      setDiagnostic(diagnostics, "phantom savings — keeping original (>95% size)");
      return null;
    }
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
  const before = diagnostics?.before?.bodyBytes || 0;
  const after = diagnostics?.after?.bodyBytes || 0;
  if (before <= 0 || after <= 0) return false;
  return after >= before * (1 - minShrinkRatio);
}
