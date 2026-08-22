import { gunzipSync, gzipSync } from "node:zlib";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

export const DEVIN_HOST = "https://server.codeium.com";
export const DEVIN_AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
export const DEVIN_CHAT_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";
export const DEVIN_MODEL_CONFIG_PATH = "/exa.api_server_pb.ApiServerService/GetCliModelConfigs";
export const DEVIN_SESSION_TOKEN_PREFIX = "devin-session-token$";
export const MAX_DEVIN_FRAME_PAYLOAD = 16 * 1024 * 1024;

export function normalizeDevinSessionToken(apiKey) {
  const value = String(apiKey ?? "");
  return value.startsWith(DEVIN_SESSION_TOKEN_PREFIX) ? value : `${DEVIN_SESSION_TOKEN_PREFIX}${value}`;
}

export function frameDevinConnect(payload, compressed = true, trailer = false) {
  const data = Buffer.from(compressed ? gzipSync(payload) : payload);
  const frame = Buffer.allocUnsafe(5 + data.length);
  frame[0] = (compressed ? 1 : 0) | (trailer ? 2 : 0);
  frame.writeUInt32BE(data.length, 1);
  data.copy(frame, 5);
  return frame;
}

export function parseDevinConnectFrames(input, maxPayload = MAX_DEVIN_FRAME_PAYLOAD) {
  const buffer = Buffer.from(input);
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const flags = buffer[offset];
    const length = buffer.readUInt32BE(offset + 1);
    if (length > maxPayload) throw new Error(`Devin frame exceeds ${maxPayload} bytes`);
    if (offset + 5 + length > buffer.length) break;
    let payload = buffer.subarray(offset + 5, offset + 5 + length);
    const compressed = Boolean(flags & 1);
    if (compressed) payload = gunzipSync(payload);
    frames.push({ trailer: Boolean(flags & 2), compressed, payload });
    offset += 5 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

export function decodeDevinChatDeltas(payload) {
  const deltas = [];
  for (const field of decodeFields(Buffer.from(payload))) {
    if (field.number === 1 && field.wire === 2) deltas.push({ type: "message", id: fieldText(field.value) });
    else if (field.number === 3 && field.wire === 2) deltas.push({ type: "text", value: fieldText(field.value) });
    else if (field.number === 5 && field.wire === 0) deltas.push({ type: "stop", reason: Number(field.value) });
    else if (field.number === 6 && field.wire === 2) deltas.push(decodeTool(field.value));
    else if (field.number === 7 && field.wire === 2) deltas.push(decodeUsage(field.value));
    else if (field.number === 9 && field.wire === 2) deltas.push({ type: "thinking", value: fieldText(field.value) });
    else if (field.number === 10 && field.wire === 2) {
      const previous = deltas.at(-1);
      if (previous?.type === "thinking") previous.signature = fieldText(field.value);
    }
  }
  return deltas.length ? deltas : [{ type: "unknown" }];
}

export function decodeDevinChatDelta(payload) {
  return decodeDevinChatDeltas(payload)[0];
}

export function decodeDevinTrailer(payload) {
  try {
    const data = JSON.parse(Buffer.from(payload).toString("utf8"));
    return typeof data?.error?.message === "string" ? data.error.message : undefined;
  } catch {
    return undefined;
  }
}

export function buildUserJwtRequest(apiKey) {
  return message(1, encodeMetadata(normalizeDevinSessionToken(apiKey)));
}

export function buildDevinChatRequest({ model, body = {}, apiKey, userJwt, sessionId = crypto.randomUUID() }) {
  const prompts = (Array.isArray(body.messages) ? body.messages : [])
    .flatMap(messageForWire)
    .map((item, index) => message(3, encodePrompt(item, `${sessionId}-${index}`)));
  const tools = (Array.isArray(body.tools) ? body.tools : []).map(encodeTool);
  return Buffer.concat([
    message(1, encodeMetadata(normalizeDevinSessionToken(apiKey), userJwt)),
    systemText(body),
    ...prompts,
    varintField(7, 5n),
    message(8, encodeConfiguration(body)),
    ...tools.map((tool) => message(10, tool)),
    varintField(11, 1n),
    stringField(16, sessionId),
    stringField(17, crypto.randomUUID()),
    varintField(20, 1n),
    stringField(21, model),
    stringField(22, crypto.randomUUID()),
  ]);
}

function encodeMetadata(apiKey, userJwt) {
  return Buffer.concat([
    stringField(1, "windsurf"),
    stringField(2, "1.48.2"),
    stringField(3, apiKey),
    stringField(4, "en"),
    stringField(5, process.platform),
    varintField(9, 1n),
    stringField(10, crypto.randomUUID()),
    stringField(12, "windsurf"),
    stringField(25, crypto.randomUUID()),
    stringField(26, "Unset"),
    stringField(28, "windsurf"),
    userJwt ? stringField(21, userJwt) : Buffer.alloc(0),
  ]);
}

function systemText(body) {
  const text = typeof body.system === "string"
    ? body.system
    : Array.isArray(body.messages)
      ? body.messages.filter((item) => item?.role === "system").map((item) => contentText(item.content)).join("\n")
      : "";
  return text ? stringField(2, text) : Buffer.alloc(0);
}

function encodeConfiguration(body) {
  const maxTokens = Number.isFinite(body.max_tokens) ? body.max_tokens : 64000;
  const temperature = Number.isFinite(body.temperature) ? body.temperature : 0.4;
  return Buffer.concat([
    varintField(1, 1n),
    varintField(2, BigInt(Math.max(1, Math.floor(maxTokens)))),
    varintField(3, 200n),
    doubleField(5, temperature),
    doubleField(6, temperature),
    varintField(7, 50n),
    doubleField(8, 1),
    ...["<|user|>", "<|bot|>", "<|context_request|>", "<|endoftext|>", "<|end_of_turn|>"].map((value) => stringField(9, value)),
    doubleField(11, 1),
  ]);
}

function messageForWire(item) {
  if (item?.role === "system") return [];
  if (item?.role === "user") return [{ role: 1, text: contentText(item.content) }];
  if (item?.role === "tool") return [{ role: 4, text: contentText(item.content), toolCallId: item.tool_call_id }];
  if (item?.role === "assistant" && Array.isArray(item.tool_calls)) {
    return [{
      role: 1,
      text: "",
      toolCalls: item.tool_calls.map((call) => ({
        id: call.id,
        name: call.function?.name || call.name || "tool",
        argumentsJson: call.function?.arguments || JSON.stringify(call.arguments || {}),
      })),
    }];
  }
  const output = [];
  for (const content of Array.isArray(item?.content) ? item.content : [{ type: "text", text: contentText(item?.content) }]) {
    if (content?.type === "text") output.push({ role: 1, text: content.text });
    else if (content?.type === "thinking") output.push({ role: 1, text: content.thinking });
    else if (content?.type === "tool_use") output.push({ role: 1, text: "", toolCalls: [{ id: content.id, name: content.name, argumentsJson: JSON.stringify(content.input ?? {}) }] });
  }
  return output;
}

function encodePrompt(item, id) {
  return Buffer.concat([
    stringField(1, id),
    varintField(2, BigInt(item.role)),
    stringField(3, item.text || ""),
    item.toolCallId ? stringField(7, item.toolCallId) : Buffer.alloc(0),
    ...(item.toolCalls || []).map((call) => message(6, Buffer.concat([
      stringField(1, call.id), stringField(2, call.name), stringField(3, call.argumentsJson),
    ]))),
  ]);
}

function encodeTool(tool) {
  const value = tool?.function || tool;
  return Buffer.concat([
    stringField(1, value?.name || "tool"),
    stringField(2, String(value?.description || "").slice(0, 6998)),
    stringField(3, JSON.stringify(value?.parameters || value?.input_schema || {}) || "{}"),
  ]);
}

function contentText(content) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.filter((item) => item?.type === "text").map((item) => item.text).join("\n") : "";
}

function decodeTool(payload) {
  const values = new Map(decodeFields(payload).filter((field) => field.wire === 2).map((field) => [field.number, fieldText(field.value)]));
  return { type: "tool", id: values.get(1) || crypto.randomUUID(), name: values.get(2) || "tool", argumentsJson: values.get(3) || "" };
}

function decodeUsage(payload) {
  const values = new Map(decodeFields(payload).filter((field) => field.wire === 0).map((field) => [field.number, Number(field.value)]));
  return { type: "usage", input: values.get(2) || 0, output: values.get(3) || 0, cacheWrite: values.get(4) || 0, cacheRead: values.get(5) || 0 };
}

function decodeFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    offset = key.offset;
    const number = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (wire === 0) {
      const value = readVarint(buffer, offset);
      offset = value.offset;
      fields.push({ number, wire, value: value.value });
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      if (end > buffer.length) throw new Error("Invalid Devin protobuf length");
      fields.push({ number, wire, value: buffer.subarray(offset, end) });
      offset = end;
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else {
      throw new Error(`Unsupported Devin protobuf wire type ${wire}`);
    }
  }
  return fields;
}

function readVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  while (offset < buffer.length) {
    const byte = buffer[offset++];
    value |= BigInt(byte & 127) << shift;
    if (!(byte & 128)) return { value, offset };
    shift += 7n;
    if (shift > 70n) throw new Error("Invalid Devin protobuf varint");
  }
  throw new Error("Truncated Devin protobuf varint");
}

function fieldText(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function stringField(number, value) {
  return message(number, Buffer.from(String(value), "utf8"));
}

function varintField(number, value) {
  return Buffer.concat([encodeVarint(BigInt(number << 3)), encodeVarint(value)]);
}

function doubleField(number, value) {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(value);
  return Buffer.concat([encodeVarint(BigInt(number << 3 | 1)), bytes]);
}

function message(number, value) {
  return Buffer.concat([encodeVarint(BigInt(number << 3 | 2)), encodeVarint(BigInt(value.length)), value]);
}

function encodeVarint(value) {
  const bytes = [];
  let current = BigInt(value);
  while (current > 127n) {
    bytes.push(Number(current & 127n) | 128);
    current >>= 7n;
  }
  bytes.push(Number(current));
  return Buffer.from(bytes);
}

export class DevinExecutor extends BaseExecutor {
  constructor() {
    super("devin", PROVIDERS.devin);
  }

  buildUrl() {
    return this.config.baseUrl;
  }

  buildHeaders() {
    return {
      "content-type": "application/connect+proto",
      "connect-protocol-version": "1",
      "connect-content-encoding": "gzip",
      "accept-encoding": "identity",
      "connect-accept-encoding": "gzip",
    };
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions = null, fetchImpl: injectedFetch }) {
    const token = credentials?.accessToken || credentials?.apiKey;
    if (!token) throw new Error("No Devin credential");
    const fetchImpl = injectedFetch || ((url, options) => proxyAwareFetch(url, options, proxyOptions));
    const userJwtResponse = await fetchImpl(`${DEVIN_HOST}${DEVIN_AUTH_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/proto", "connect-protocol-version": "1", accept: "*/*" },
      body: buildUserJwtRequest(token),
      signal,
    });
    if (!userJwtResponse.ok) return { response: userJwtResponse, url: `${DEVIN_HOST}${DEVIN_AUTH_PATH}`, headers: {}, transformedBody: null };
    const userJwt = firstStringField(Buffer.from(await userJwtResponse.arrayBuffer()), 1);
    if (!userJwt) throw new Error("Devin auth returned an empty user JWT");

    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials, stream);
    const transformedBody = frameDevinConnect(buildDevinChatRequest({ model, body, apiKey: token, userJwt, sessionId: credentials?.rawHeaders?.["x-session-id"] }));
    const upstream = await fetchImpl(url, { method: "POST", headers, body: transformedBody, signal });
    if (!upstream.ok) return { response: upstream, url, headers, transformedBody };
    return { response: this.transformToSSE(upstream, model), url, headers, transformedBody };
  }

  transformToSSE(upstream, model) {
    const responseId = `chatcmpl-devin-${Date.now()}`;
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let pending = Buffer.alloc(0);
        let toolCall = null;
        let usage = null;
        let stopReason = 0;
        const emit = (value) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        try {
          const reader = upstream.body?.getReader();
          while (reader) {
            const next = await reader.read();
            if (next.value?.length) pending = Buffer.concat([pending, Buffer.from(next.value)]);
            const complete = parseDevinConnectFrames(pending);
            pending = complete.rest;
            for (const frame of complete.frames) {
              if (frame.trailer) {
                const error = decodeDevinTrailer(frame.payload);
                if (error) emit({ error: { message: error, type: "devin_error" } });
                continue;
              }
              for (const delta of decodeDevinChatDeltas(frame.payload)) {
                if (delta.type === "text") emit(chunk(responseId, model, { content: delta.value }));
                else if (delta.type === "thinking") emit(chunk(responseId, model, { reasoning_content: delta.value }));
                else if (delta.type === "tool") {
                  toolCall = delta;
                  emit(chunk(responseId, model, { tool_calls: [{ index: 0, id: delta.id, type: "function", function: { name: delta.name, arguments: delta.argumentsJson } }] }));
                } else if (delta.type === "usage") usage = delta;
                else if (delta.type === "stop") stopReason = delta.reason;
              }
            }
            if (next.done) break;
          }
          const finish = toolCall ? "tool_calls" : stopReason === 1 || stopReason === 3 ? "length" : "stop";
          const final = chunk(responseId, model, {}, finish);
          if (usage) final.usage = { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output, cache_read_input_tokens: usage.cacheRead, cache_creation_input_tokens: usage.cacheWrite };
          emit(final);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (error) {
          emit({ error: { message: error instanceof Error ? error.message : String(error), type: "devin_error" } });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }
}

function chunk(id, model, delta, finishReason = null) {
  return { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

function firstStringField(payload, number) {
  const field = decodeFields(payload).find((item) => item.number === number && item.wire === 2);
  return field ? fieldText(field.value) : undefined;
}

export default DevinExecutor;
