import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { PROVIDERS } from "../config/providers.js";
import { randomUUID } from "node:crypto";

// WindsurfExecutor — Codeium gRPC-web chat.
//
// Wire protocol: gRPC-web over HTTPS (Content-Type: application/grpc-web+proto).
// Service:  exa.language_server_pb.LanguageServerService
// Method:   GetChatMessage (unary request → streamed CompletionChunk frames)
//
// Auth: credentials.accessToken = Codeium apiKey (sk-ws-... or Firebase-derived)
//       — placed in Metadata.api_key protobuf field of every request + Bearer header.

const WS_BASE_URL = "https://server.codeium.com";
const WS_SERVICE = "exa.language_server_pb.LanguageServerService";
const WS_METHOD_CHAT = "GetChatMessage";
const WS_CHAT_URL = `${WS_BASE_URL}/${WS_SERVICE}/${WS_METHOD_CHAT}`;

const WS_IDE_NAME = "windsurf";
const WS_IDE_VERSION = "3.14.0";
const WS_EXT_VERSION = "3.14.0";
const WS_LOCALE = "en-US";

// ─── Model alias map (catalog name → Windsurf wire name) ─────────────────────
const MODEL_ALIAS_MAP = {
  // ── Cognition SWE ───────────────────────────────────────────────────────
  "swe-1.6-fast": "swe-1-6-fast",
  "swe-1.6": "swe-1-6",
  "swe-1.5-fast": "swe-1-5-fast",
  "swe-1.5": "swe-1-5",
  // ── Claude Opus 4.7 — effort-tiered ─────────────────────────────────────
  "claude-opus-4.7-max": "claude-opus-4-7-max",
  "claude-opus-4.7-xhigh": "claude-opus-4-7-xhigh",
  "claude-opus-4.7-high": "claude-opus-4-7-high",
  "claude-opus-4.7-medium": "claude-opus-4-7-medium",
  "claude-opus-4.7-low": "claude-opus-4-7-low",
  "claude-opus-4.7-review": "opus-4-7-review",
  // ── Claude Opus/Sonnet 4.6 ──────────────────────────────────────────────
  "claude-sonnet-4.6-thinking-1m": "claude-sonnet-4-6-thinking-1m",
  "claude-sonnet-4.6-1m": "claude-sonnet-4-6-1m",
  "claude-sonnet-4.6-thinking": "claude-sonnet-4-6-thinking",
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-opus-4.6-thinking": "claude-opus-4-6-thinking",
  "claude-opus-4.6": "claude-opus-4-6",
  // ── Claude 4.5 ──────────────────────────────────────────────────────────
  "claude-opus-4.5-thinking": "MODEL_CLAUDE_4_5_OPUS_THINKING",
  "claude-opus-4.5": "MODEL_CLAUDE_4_5_OPUS",
  "claude-sonnet-4.5-thinking": "MODEL_PRIVATE_3",
  "claude-sonnet-4.5": "MODEL_PRIVATE_2",
  "claude-haiku-4.5": "MODEL_PRIVATE_11",
  // ── GPT-5.5 ─────────────────────────────────────────────────────────────
  "gpt-5.5-xhigh-fast": "gpt-5-5-xhigh-priority",
  "gpt-5.5-high-fast": "gpt-5-5-high-priority",
  "gpt-5.5-medium-fast": "gpt-5-5-medium-priority",
  "gpt-5.5-low-fast": "gpt-5-5-low-priority",
  "gpt-5.5-none-fast": "gpt-5-5-none-priority",
  "gpt-5.5-xhigh": "gpt-5-5-xhigh",
  "gpt-5.5-high": "gpt-5-5-high",
  "gpt-5.5-medium": "gpt-5-5-medium",
  "gpt-5.5-low": "gpt-5-5-low",
  "gpt-5.5-none": "gpt-5-5-none",
  "gpt-5.5-review": "gpt-5-5-review",
  "gpt-5.5": "gpt-5-5-medium",
  // ── GPT-5.4 ─────────────────────────────────────────────────────────────
  "gpt-5.4-xhigh-fast": "gpt-5-4-xhigh-priority",
  "gpt-5.4-high-fast": "gpt-5-4-high-priority",
  "gpt-5.4-medium-fast": "gpt-5-4-medium-priority",
  "gpt-5.4-low-fast": "gpt-5-4-low-priority",
  "gpt-5.4-none-fast": "gpt-5-4-none-priority",
  "gpt-5.4-xhigh": "gpt-5-4-xhigh",
  "gpt-5.4-high": "gpt-5-4-high",
  "gpt-5.4-medium": "gpt-5-4-medium",
  "gpt-5.4-low": "gpt-5-4-low",
  "gpt-5.4-none": "gpt-5-4-none",
  "gpt-5.4-mini-xhigh": "gpt-5-4-mini-xhigh",
  "gpt-5.4-mini-high": "gpt-5-4-mini-high",
  "gpt-5.4-mini-medium": "gpt-5-4-mini-medium",
  "gpt-5.4-mini-low": "gpt-5-4-mini-low",
  "gpt-5.4": "gpt-5-4-medium",
  // ── GPT-5.3-Codex ───────────────────────────────────────────────────────
  "gpt-5.3-codex-xhigh-fast": "gpt-5-3-codex-xhigh-priority",
  "gpt-5.3-codex-high-fast": "gpt-5-3-codex-high-priority",
  "gpt-5.3-codex-medium-fast": "gpt-5-3-codex-medium-priority",
  "gpt-5.3-codex-low-fast": "gpt-5-3-codex-low-priority",
  "gpt-5.3-codex-xhigh": "gpt-5-3-codex-xhigh",
  "gpt-5.3-codex-high": "gpt-5-3-codex-high",
  "gpt-5.3-codex-medium": "gpt-5-3-codex-medium",
  "gpt-5.3-codex-low": "gpt-5-3-codex-low",
  "gpt-5.3-codex": "gpt-5-3-codex-medium",
  // ── GPT-5.2 ─────────────────────────────────────────────────────────────
  "gpt-5.2-xhigh": "MODEL_GPT_5_2_XHIGH",
  "gpt-5.2-high": "MODEL_GPT_5_2_HIGH",
  "gpt-5.2-medium": "MODEL_GPT_5_2_MEDIUM",
  "gpt-5.2-low": "MODEL_GPT_5_2_LOW",
  "gpt-5.2-none": "MODEL_GPT_5_2_NONE",
  "gpt-5.2": "MODEL_GPT_5_2_MEDIUM",
  // ── GPT-5 ───────────────────────────────────────────────────────────────
  "gpt-5": "gpt-5",
  // ── GPT-4.1 / 4o ────────────────────────────────────────────────────────
  "gpt-4.1": "MODEL_CHAT_GPT_4_1_2025_04_14",
  "gpt-4.1-mini": "gpt-4.1-mini",
  "gpt-4o": "MODEL_CHAT_GPT_4O_2024_08_06",
  // ── Gemini ──────────────────────────────────────────────────────────────
  "gemini-3.1-pro-high": "gemini-3-1-pro-high",
  "gemini-3.1-pro-low": "gemini-3-1-pro-low",
  "gemini-3.1-pro": "gemini-3-1-pro-high",
  "gemini-3.0-flash-high": "MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH",
  "gemini-3.0-flash-medium": "MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM",
  "gemini-3.0-flash-low": "MODEL_GOOGLE_GEMINI_3_0_FLASH_LOW",
  "gemini-3.0-flash-minimal": "MODEL_GOOGLE_GEMINI_3_0_FLASH_MINIMAL",
  "gemini-3.0-flash": "MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH",
  "gemini-2.5-pro": "MODEL_GOOGLE_GEMINI_2_5_PRO",
  // ── Others ──────────────────────────────────────────────────────────────
  "deepseek-v4": "deepseek-v4",
  "kimi-k2.6": "kimi-k2-6",
  "kimi-k2.5": "kimi-k2-5",
  "glm-5.1": "glm-5-1",
};

export function resolveWsModelId(model) {
  return MODEL_ALIAS_MAP[model] ?? model;
}

// ─── Minimal protobuf encoder ────────────────────────────────────────────────
// Wire types: 0 = varint, 2 = length-delimited.

function encodeVarint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

function concatBytes(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

const TEXT_ENC = new TextEncoder();
const TEXT_DEC = new TextDecoder();

function encodeField(fieldNum, payload) {
  const tag = encodeVarint((fieldNum << 3) | 2);
  const len = encodeVarint(payload.length);
  return concatBytes([tag, len, payload]);
}

function encodeString(fieldNum, value) {
  return encodeField(fieldNum, TEXT_ENC.encode(value));
}

function encodeMessage(fieldNum, msg) {
  return encodeField(fieldNum, msg);
}

// ─── Protobuf message builders ───────────────────────────────────────────────

function buildMetadata(apiKey, sessionId) {
  return concatBytes([
    encodeString(1, apiKey),
    encodeString(2, WS_IDE_NAME),
    encodeString(3, WS_IDE_VERSION),
    encodeString(4, WS_EXT_VERSION),
    encodeString(5, sessionId),
    encodeString(6, WS_LOCALE),
  ]);
}

function buildModelOrAlias(model) {
  return encodeString(1, model);
}

function buildChatMessage(msg) {
  const parts = [encodeString(1, msg.role), encodeString(2, msg.content)];
  if (msg.toolCallId) parts.push(encodeString(3, msg.toolCallId));
  return concatBytes(parts);
}

export function buildGetChatMessageRequest(apiKey, model, messages) {
  const sessionId = randomUUID();
  const cascadeId = randomUUID();

  const parts = [
    encodeMessage(1, buildMetadata(apiKey, sessionId)), // metadata
    encodeString(2, cascadeId), // cascade_id
    encodeMessage(3, buildModelOrAlias(model)), // model_or_alias
  ];

  for (const msg of messages) {
    parts.push(encodeMessage(4, buildChatMessage(msg))); // repeated messages
  }

  return concatBytes(parts);
}

// ─── gRPC-web framing ────────────────────────────────────────────────────────

export function grpcWebFrame(payload) {
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = 0x00; // no compression
  const view = new DataView(frame.buffer);
  view.setUint32(1, payload.length, false); // big-endian length
  frame.set(payload, 5);
  return frame;
}

// ─── Protobuf response decoder ───────────────────────────────────────────────
// CompletionChunk (oneof):
//   field 1 → ContentChunk { field 1: string text }
//   field 2 → ToolCallChunk (skipped)
//   field 3 → DoneChunk    { field 1: UsageStats{ field1: prompt, field2: completion } }
//   field 4 → ErrorChunk   { field 1: string message }

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  while (offset < buf.length) {
    const b = buf[offset++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, offset];
}

function decodeStringField(buf, targetField) {
  let offset = 0;
  while (offset < buf.length) {
    let tag;
    [tag, offset] = readVarint(buf, offset);
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      let len;
      [len, offset] = readVarint(buf, offset);
      const payload = buf.slice(offset, offset + len);
      offset += len;
      if (fieldNum === targetField) return TEXT_DEC.decode(payload);
    } else if (wireType === 0) {
      let v;
      [v, offset] = readVarint(buf, offset);
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return null;
}

function decodeDoneChunk(buf) {
  // DoneChunk: field 1 = UsageStats (nested)
  // UsageStats: field 1 = prompt_tokens (varint), field 2 = completion_tokens (varint)
  let offset = 0;
  let usageBytes = null;
  while (offset < buf.length) {
    let tag;
    [tag, offset] = readVarint(buf, offset);
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      let len;
      [len, offset] = readVarint(buf, offset);
      if (fieldNum === 1) usageBytes = buf.slice(offset, offset + len);
      offset += len;
    } else if (wireType === 0) {
      let v;
      [v, offset] = readVarint(buf, offset);
    } else {
      break;
    }
  }
  if (!usageBytes) return [0, 0];
  let promptTokens = 0;
  let completionTokens = 0;
  offset = 0;
  while (offset < usageBytes.length) {
    let tag;
    [tag, offset] = readVarint(usageBytes, offset);
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      let v;
      [v, offset] = readVarint(usageBytes, offset);
      if (fieldNum === 1) promptTokens = v;
      else if (fieldNum === 2) completionTokens = v;
    } else if (wireType === 2) {
      let len;
      [len, offset] = readVarint(usageBytes, offset);
      offset += len;
    } else {
      break;
    }
  }
  return [promptTokens, completionTokens];
}

export function decodeCompletionChunk(buf) {
  let offset = 0;
  while (offset < buf.length) {
    let tag;
    [tag, offset] = readVarint(buf, offset);
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) {
      let len;
      [len, offset] = readVarint(buf, offset);
      const payload = buf.slice(offset, offset + len);
      offset += len;

      if (fieldNum === 1) {
        const text = decodeStringField(payload, 1);
        if (text !== null) return { kind: "content", text };
      } else if (fieldNum === 3) {
        const usage = decodeDoneChunk(payload);
        return { kind: "done", promptTokens: usage[0], completionTokens: usage[1] };
      } else if (fieldNum === 4) {
        const msg = decodeStringField(payload, 1);
        return { kind: "error", message: msg ?? "unknown windsurf error" };
      }
      // field 2 = ToolCallChunk — not yet handled; skip
    } else if (wireType === 0) {
      let v;
      [v, offset] = readVarint(buf, offset);
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return { kind: "unknown" };
}

// ─── OpenAI messages → Windsurf wire ─────────────────────────────────────────

function openAIMessagesToWs(messages) {
  const out = [];
  for (const m of messages) {
    const role = String(m.role || "user");
    let content = "";
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part && typeof part === "object" && part.type === "text") {
          content += String(part.text || "");
        }
      }
    }
    out.push({ role, content, toolCallId: m.tool_call_id });
  }
  return out;
}

// ─── WindsurfExecutor ────────────────────────────────────────────────────────

export class WindsurfExecutor extends BaseExecutor {
  constructor() {
    super("windsurf", PROVIDERS.windsurf || { id: "windsurf", baseUrl: WS_CHAT_URL });
  }

  buildUrl() {
    return WS_CHAT_URL;
  }

  buildHeaders(credentials, stream = true) {
    const token = credentials?.accessToken || credentials?.apiKey || "";
    return {
      "Content-Type": "application/grpc-web+proto",
      Accept: "application/grpc-web+proto",
      // Codeium apiKey also goes in Metadata.api_key (protobuf field) — see request body.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": `windsurf/${WS_IDE_VERSION}`,
      "X-Grpc-Web": "1",
    };
  }

  // Request body is built manually in execute() — requires model + messages.
  transformRequest() {
    return null;
  }

  async execute({ model, body, stream, credentials, signal, log, upstreamExtraHeaders, proxyOptions = null }) {
    const apiKey = credentials?.accessToken || credentials?.apiKey || "";
    const wsModel = resolveWsModelId(model);

    const b = body ?? {};
    const rawMessages = Array.isArray(b.messages) ? b.messages : [];
    let wsMessages = openAIMessagesToWs(rawMessages);
    if (wsMessages.length === 0) {
      wsMessages.push({ role: "user", content: "" });
    }

    const protoPayload = buildGetChatMessageRequest(apiKey, wsModel, wsMessages);
    const framedPayload = grpcWebFrame(protoPayload);

    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials);
    if (upstreamExtraHeaders) Object.assign(headers, upstreamExtraHeaders);

    log?.debug?.("WS", `Windsurf → ${wsModel} (${wsMessages.length} messages)`);

    const upstream = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: framedPayload,
      signal,
    }, proxyOptions);

    if (!upstream.ok && upstream.status !== 200) {
      return { response: upstream, url, headers, transformedBody: protoPayload };
    }

    const sseResponse = this.transformToSSE(upstream, model);
    return { response: sseResponse, url, headers, transformedBody: protoPayload };
  }

  // Convert a gRPC-web binary response into an OpenAI-compatible SSE stream.
  transformToSSE(upstream, model) {
    const responseId = `chatcmpl-ws-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const executor = this;

    const sseStream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        let roleEmitted = false;
        let totalText = "";
        let promptTokens = 0;
        let completionTokens = 0;
        let hadError = null;

        const emit = (data) => controller.enqueue(enc.encode(data));

        try {
          let pending = new Uint8Array(0);
          const reader = upstream.body?.getReader();

          const handleFrame = (flag, payload) => {
            if (flag === 0x80) {
              // Trailer frame — contains grpc-status, grpc-message
              const trailer = TEXT_DEC.decode(payload);
              const statusMatch = /grpc-status:\s*(\d+)/i.exec(trailer);
              if (statusMatch && statusMatch[1] !== "0") {
                const msgMatch = /grpc-message:\s*(.+)/i.exec(trailer);
                hadError = msgMatch
                  ? decodeURIComponent(msgMatch[1].trim())
                  : `gRPC status ${statusMatch[1]}`;
              }
              return;
            }
            if (flag !== 0x00) return; // skip unknown flags

            const chunk = executor.constructor.decodeCompletionChunk
              ? executor.constructor.decodeCompletionChunk(payload)
              : decodeCompletionChunk(payload);

            if (chunk.kind === "content" && chunk.text) {
              totalText += chunk.text;
              if (!roleEmitted) {
                emit(`data: ${JSON.stringify({
                  id: responseId, object: "chat.completion.chunk", created, model,
                  choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
                })}\n\n`);
                roleEmitted = true;
              }
              emit(`data: ${JSON.stringify({
                id: responseId, object: "chat.completion.chunk", created, model,
                choices: [{ index: 0, delta: { content: chunk.text }, finish_reason: null }],
              })}\n\n`);
            } else if (chunk.kind === "done") {
              promptTokens = chunk.promptTokens;
              completionTokens = chunk.completionTokens;
            } else if (chunk.kind === "error") {
              hadError = chunk.message;
            }
          };

          const drainFrames = () => {
            let offset = 0;
            while (offset + 5 <= pending.length) {
              const flag = pending[offset];
              const len =
                (pending[offset + 1] << 24) |
                (pending[offset + 2] << 16) |
                (pending[offset + 3] << 8) |
                pending[offset + 4];
              if (len < 0 || offset + 5 + len > pending.length) break;
              handleFrame(flag, pending.slice(offset + 5, offset + 5 + len));
              offset += 5 + len;
            }
            if (offset > 0) pending = pending.slice(offset);
          };

          if (reader) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value) continue;
                pending = pending.length === 0 ? value : concatBytes([pending, value]);
                drainFrames();
              }
            } finally {
              reader.releaseLock();
            }
          }
          drainFrames();

          if (hadError) {
            emit(`data: ${JSON.stringify({
              error: { message: hadError, type: "windsurf_error", code: "upstream_error" },
            })}\n\n`);
            emit("data: [DONE]\n\n");
            controller.close();
            return;
          }

          // Unary fallback: nothing streamed but text decoded → emit as one chunk.
          if (!roleEmitted && totalText) {
            emit(`data: ${JSON.stringify({
              id: responseId, object: "chat.completion.chunk", created, model,
              choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
            })}\n\n`);
            emit(`data: ${JSON.stringify({
              id: responseId, object: "chat.completion.chunk", created, model,
              choices: [{ index: 0, delta: { content: totalText }, finish_reason: null }],
            })}\n\n`);
          }

          const finishPayload = {
            id: responseId, object: "chat.completion.chunk", created, model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          };
          if (promptTokens > 0 || completionTokens > 0) {
            finishPayload.usage = {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            };
          }
          emit(`data: ${JSON.stringify(finishPayload)}\n\n`);
          emit("data: [DONE]\n\n");
        } catch (err) {
          const msg = err?.message ? String(err.message) : String(err);
          emit(`data: ${JSON.stringify({
            error: { message: `Windsurf stream error: ${msg}`, type: "windsurf_error" },
          })}\n\n`);
          emit("data: [DONE]\n\n");
        }

        controller.close();
      },
    });

    return new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // apiKey is long-lived (Firebase-derived or Devin ide_token); refresh handled out-of-band.
  async refreshCredentials() {
    return null;
  }
}

export default WindsurfExecutor;
