/**
 * Qoder model-server gRPC transport.
 *
 * The COSY surface Qoder chat normally leaves through accepts large bodies, but
 * pays for them: measured against a live account with the same model, a
 * 280K-character request answered in 73s and a 1.2M-character request had not
 * answered after 300s, while the roster advertises 200K/400K/1M context tiers.
 * The model-server gRPC surface carries the same requests in 5.1s and 16.3s, so
 * it is the only surface that makes those windows usable in practice rather than
 * nominally.
 *
 * This module is that transport: it builds the proto request, streams chunks
 * back as OpenAI `chat.completion.chunk` SSE (so the rest of the pipeline needs
 * no Qoder-specific response handling), and maps gRPC status onto the HTTP
 * statuses the failover layer already classifies.
 *
 * Free-tier rows (`lite`) are refused on this surface with `116 quota exceeded`
 * and must stay on the COSY surface — see `resolveQoderTransport`.
 *
 * The proto (`proto/chat.proto`) comes from the unpacked Qoder desktop client
 * (worker runtime 1.1.81). It is embedded as a string and materialised to a temp
 * file on first use, because the proto loader only accepts a path.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  QODER_GRPC_HOSTS,
  QODER_GRPC_SERVICE_PATH,
  QODER_REGION_INTL,
  isQoderFreeTier,
} from "../shared/qoder/constants.js";
import { CHAT_PROTO_SOURCE } from "../shared/qoder/chat-proto.js";

/** `QODER_TRANSPORT=cosy` forces the legacy HTTP surface for every row. */
const TRANSPORT_ENV = "QODER_TRANSPORT";

/**
 * Body size above which a request is upgraded to gRPC.
 *
 * The COSY surface does not refuse large bodies — it slows down on them: 280K
 * characters answered in 73s and 1.2M characters had not answered after 300s,
 * against 5.1s and 16.3s on gRPC for the same requests. The limit counts total
 * body bytes rather than tokens, so it is checked on the serialized request, and
 * the margin keeps a body that grows slightly after this decision — extra
 * fields, escaping — from landing right on the edge.
 */
const QODER_HTTP_BODY_LIMIT_BYTES = 200 * 1024;

/** How long to wait for the first chunk before giving up on the gRPC call. */
const FIRST_CHUNK_TIMEOUT_MS = 120_000;

const REASONING_EFFORT = Object.freeze({
  none: "REASONING_EFFORT_NONE",
  minimal: "REASONING_EFFORT_LOW",
  low: "REASONING_EFFORT_LOW",
  medium: "REASONING_EFFORT_MEDIUM",
  high: "REASONING_EFFORT_HIGH",
  xhigh: "REASONING_EFFORT_XHIGH",
  max: "REASONING_EFFORT_MAX",
});

let protoPathCache = null;
let chatServiceCache = null;

/**
 * Which transport one dispatch uses.
 *
 * The COSY surface is the default: it is simpler, faster for small requests, and
 * works for every row. It degrades badly as the body grows (280K characters: 73s;
 * 1.2M: no answer after 300s), so a request is upgraded to gRPC once its body
 * passes 200 KiB.
 *
 * Free-tier rows stay on COSY regardless: gRPC refuses them with
 * `116 quota exceeded`. `QODER_TRANSPORT=grpc|cosy` forces either surface, for
 * probing and for callers who know their upstream behaviour.
 */
export function resolveQoderTransport(envOverride, modelConfig, bodyBytes = 0, modelKey = "") {
  const forced = typeof envOverride === "string" ? envOverride.trim().toLowerCase() : "";
  if (forced === "cosy") return "cosy";
  if (isQoderFreeTier(modelConfig, modelKey)) return "cosy";
  if (forced === "grpc") return "grpc";
  return bodyBytes > QODER_HTTP_BODY_LIMIT_BYTES ? "grpc" : "cosy";
}

/** Size of a request body as it goes on the wire, for the transport decision. */
export function qoderBodyBytes(body) {
  if (body == null) return 0;
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  try {
    return Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    return 0;
  }
}

/** Transport override from the environment (read per call so tests can set it). */
export function qoderTransportOverride() {
  return process.env[TRANSPORT_ENV];
}

/**
 * Stable per-account, per-model session id.
 *
 * Qoder keys prompt-cache routing on the session id, so a random one per request
 * would defeat the cache; the client derives it once per conversation. 32 hex
 * characters, the shape the desktop client sends.
 */
export function qoderGrpcSessionId(userId, modelId) {
  return createHash("sha256").update(`qoder-session:${userId}:${modelId}`).digest("hex").slice(0, 32);
}

/** Joins the text-bearing parts of one message into the proto's `text_content`. */
function flattenContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content)) return String(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      // Claude-style tool results arrive as their own block type.
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

/** Maps one OpenAI message onto the proto `ChatMessage` shape. */
function mapMessage(message) {
  const out = { role: String(message?.role || "user") };
  const text = flattenContent(message?.content);
  if (text.length > 0) out.text_content = text;
  if (typeof message?.name === "string" && message.name) out.name = { value: message.name };
  if (typeof message?.tool_call_id === "string" && message.tool_call_id) {
    out.tool_call_id = { value: message.tool_call_id };
  }
  if (typeof message?.reasoning_content === "string" && message.reasoning_content) {
    out.reasoning_content = message.reasoning_content;
  }
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
    out.tool_calls = message.tool_calls.map((call) => ({
      ...(typeof call?.id === "string" ? { id: { value: call.id } } : {}),
      ...(typeof call?.type === "string" ? { type: { value: call.type } } : {}),
      function: {
        name: String(call?.function?.name || ""),
        arguments: parseArguments(call?.function?.arguments),
      },
    }));
  }
  return out;
}

/** Tool-call arguments travel as a protobuf Value, i.e. already-parsed JSON. */
function parseArguments(raw) {
  if (raw == null) return jsonToValue({});
  if (typeof raw === "string") {
    try {
      return jsonToValue(JSON.parse(raw));
    } catch {
      return jsonToValue({});
    }
  }
  return jsonToValue(raw);
}

/**
 * JSON → `google.protobuf.Value`.
 *
 * protobuf's well-known types are not plain JSON on the wire: a Value carries a
 * `kind` oneof and a Struct carries `fields`, so handing the serializer a raw
 * object silently drops it. Tool schemas and tool-call arguments are exactly
 * these types, so the conversion has to be explicit.
 */
export function jsonToValue(value) {
  if (value === null || value === undefined) return { kind: "nullValue", nullValue: 0 };
  if (typeof value === "number") return { kind: "numberValue", numberValue: value };
  if (typeof value === "string") return { kind: "stringValue", stringValue: value };
  if (typeof value === "boolean") return { kind: "boolValue", boolValue: value };
  if (Array.isArray(value)) {
    return { kind: "listValue", listValue: { values: value.map(jsonToValue) } };
  }
  return { kind: "structValue", structValue: jsonToStruct(value) };
}

/** JSON object → `google.protobuf.Struct`. */
export function jsonToStruct(value) {
  const fields = {};
  for (const [key, entry] of Object.entries(value || {})) {
    fields[key] = jsonToValue(entry);
  }
  return { fields };
}

/** `google.protobuf.Value` → JSON, for the response direction. */
export function valueToJson(value) {
  if (!value || typeof value !== "object") return value;
  switch (value.kind) {
    case "nullValue":
      return null;
    case "numberValue":
      return value.numberValue;
    case "stringValue":
      return value.stringValue;
    case "boolValue":
      return value.boolValue;
    case "listValue":
      return (value.listValue?.values || []).map(valueToJson);
    case "structValue":
      return structToJson(value.structValue);
    default:
      return value;
  }
}

/** `google.protobuf.Struct` → plain JSON object. */
export function structToJson(struct) {
  const out = {};
  for (const [key, entry] of Object.entries(struct?.fields || {})) {
    out[key] = valueToJson(entry);
  }
  return out;
}

/** Maps the OpenAI tool list onto the proto `Tool` shape. */
function mapTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: String(tool?.type || "function"),
    function: {
      name: String(tool?.function?.name || ""),
      ...(typeof tool?.function?.description === "string"
        ? { description: { value: tool.function.description } }
        : {}),
      ...(tool?.function?.parameters && typeof tool.function.parameters === "object"
        ? { parameters: jsonToStruct(tool.function.parameters) }
        : {}),
      ...(typeof tool?.function?.strict === "boolean" ? { strict: { value: tool.function.strict } } : {}),
    },
  }));
}

/**
 * Builds the gRPC `ChatCompletionRequest`.
 *
 * The proto has no context-length field, so the window is bounded by the
 * transport rather than declared per request — which is exactly why the HTTP
 * surface could never serve it.
 */
export function buildQoderGrpcRequest(modelId, body, { userId = "" } = {}) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const request = {
    model: modelId,
    messages: messages.map(mapMessage),
    // proto: `bool stream = 6;`
    stream: true,
    // proto: `StreamOptions stream_options = 20;` with a BoolValue include_usage
    stream_options: { include_usage: { value: true } },
    metadata: {
      context: {
        request_id: randomUUID(),
        session_id: qoderGrpcSessionId(userId, modelId),
        task_id: "common",
        request_set_id: randomUUID(),
        client_type: "5",
        source_session_id: "",
      },
      business: { product: "cli", type: "agent", version: "1.1.81", stage: "start" },
      user: { user_id: userId },
    },
  };

  if (Number.isFinite(body?.max_tokens)) request.max_tokens = { value: Math.trunc(body.max_tokens) };
  else if (Number.isFinite(body?.max_completion_tokens)) {
    request.max_tokens = { value: Math.trunc(body.max_completion_tokens) };
  }
  if (Number.isFinite(body?.temperature)) request.temperature = { value: body.temperature };
  if (Number.isFinite(body?.top_p)) request.top_p = { value: body.top_p };

  const effort = REASONING_EFFORT[String(body?.reasoning_effort || "").trim().toLowerCase()];
  if (effort) request.reasoning = { effort };

  const tools = mapTools(body?.tools);
  if (tools) request.tools = tools;

  return request;
}

/**
 * gRPC metadata: the same Bearer credential the COSY surface uses, plus the
 * client identity headers the desktop client sends on every call.
 */
export function qoderGrpcMetadataValues(auth, modelId) {
  return {
    authorization: `Bearer ${auth.token}`,
    "x-request-id": randomUUID(),
    "x-session-id": qoderGrpcSessionId(auth.userId || "", modelId),
    "cosy-clienttype": "5",
    "cosy-machineos": auth.machineOs || "aarch64_macos",
    "cosy-machinetype": "5",
    "cosy-machinetoken": auth.machineId || "",
  };
}

/**
 * gRPC status → the HTTP status the failover layer already understands.
 *
 * `retryable` mirrors how those statuses are classified elsewhere: an
 * unauthenticated or malformed call will not fix itself, while an unavailable
 * upstream is worth another attempt.
 */
export function mapGrpcStatusToHttp(code, details = "") {
  const text = String(details || "");
  if (code === 16) return { status: 401, retryable: false };
  if (text.includes("413")) return { status: 413, retryable: false };
  if (code === 13 && /quota/i.test(text)) return { status: 429, retryable: false };
  if (code === 14) return { status: 502, retryable: true };
  if (code === 4) return { status: 504, retryable: true };
  return { status: 502, retryable: false };
}

/**
 * One proto chunk → one OpenAI `chat.completion.chunk`, or null when the chunk
 * carries nothing a client could act on (role-only or empty deltas).
 */
export function translateGrpcChunk(chunk, modelId) {
  const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
  const out = [];
  for (const choice of choices) {
    const delta = choice?.delta || {};
    const translated = {};
    if (typeof delta.role === "string" && delta.role) translated.role = delta.role;
    if (typeof delta.content === "string" && delta.content) translated.content = delta.content;
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      translated.reasoning_content = delta.reasoning_content;
    }
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      // proto carries these as `google.protobuf.Struct`, which decodes to
      // `{ fields: … }`; clients expect plain objects.
      translated.tool_calls = delta.tool_calls.map((call) =>
        call && typeof call === "object" && "fields" in call ? structToJson(call) : call,
      );
    }
    const finish = typeof choice?.finish_reason === "string" && choice.finish_reason ? choice.finish_reason : null;
    if (Object.keys(translated).length === 0 && finish === null) continue;
    out.push({ index: choice?.index ?? 0, delta: translated, finish_reason: finish });
  }

  const usage = chunk?.usage && typeof chunk.usage === "object" ? normaliseUsage(chunk.usage) : undefined;
  if (out.length === 0 && !usage) return null;

  const created = Number(chunk?.created);
  return {
    id: chunk?.id || `chatcmpl-${randomUUID()}`,
    object: "chat.completion.chunk",
    created: Number.isFinite(created) && created > 0 ? created : Math.floor(Date.now() / 1000),
    model: chunk?.model || modelId,
    choices: out,
    ...(usage ? { usage } : {}),
  };
}

/** proto `Usage` → the OpenAI usage shape, dropping empty detail blocks. */
function normaliseUsage(usage) {
  const out = {
    prompt_tokens: Number(usage.prompt_tokens) || 0,
    completion_tokens: Number(usage.completion_tokens) || 0,
    total_tokens: Number(usage.total_tokens) || 0,
  };
  const promptDetails = usage.prompt_tokens_details;
  if (promptDetails && (promptDetails.cached_tokens || promptDetails.cacheable_tokens)) {
    out.prompt_tokens_details = {
      cached_tokens: Number(promptDetails.cached_tokens) || 0,
      cacheable_tokens: Number(promptDetails.cacheable_tokens) || 0,
    };
  }
  const completionDetails = usage.completion_tokens_details;
  if (completionDetails?.reasoning_tokens) {
    out.completion_tokens_details = { reasoning_tokens: Number(completionDetails.reasoning_tokens) || 0 };
  }
  return out;
}

/** Materialises the embedded proto to a temp file the loader can read. */
function chatProtoPath() {
  if (protoPathCache) return protoPathCache;
  const dir = mkdtempSync(join(tmpdir(), "9router-qoder-grpc-"));
  const path = join(dir, "chat.proto");
  writeFileSync(path, CHAT_PROTO_SOURCE);
  protoPathCache = path;
  process.on("exit", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A leftover temp file is harmless; never fail a request over cleanup.
    }
  });
  return path;
}

/**
 * Loads the gRPC client constructor once.
 *
 * Both modules are optional dependencies: a host that installed without them
 * keeps working on the COSY surface, so the import is dynamic and the caller
 * treats a throw as "transport unavailable".
 */
async function loadChatService() {
  if (chatServiceCache) return chatServiceCache;
  const [{ loadPackageDefinition, credentials, Metadata }, protoLoader] = await Promise.all([
    import("@grpc/grpc-js"),
    import("@grpc/proto-loader"),
  ]);
  const definition = protoLoader.loadSync(chatProtoPath(), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const pkg = loadPackageDefinition(definition);
  const service = pkg?.model?.chat?.ChatService;
  if (!service) throw new Error("Qoder gRPC proto did not resolve model.chat.ChatService");
  chatServiceCache = { ChatService: service, credentials, Metadata };
  return chatServiceCache;
}

/** SSE frame for one OpenAI chunk. */
function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Dispatches one chat request over gRPC and returns the executor contract:
 * `{ response, url, headers, transformedBody, responseFormat }`.
 *
 * The first chunk is awaited before the Response is built, so an auth or quota
 * refusal surfaces as a real HTTP status instead of an in-band error inside a
 * 200 stream — that is what lets the account/combo fallback act on it.
 */
export async function dispatchQoderGrpc({
  modelId,
  body,
  credentials,
  region = QODER_REGION_INTL,
  signal,
  log = null,
  userId = "",
  machineId = "",
  machineOs = "",
}) {
  const host = QODER_GRPC_HOSTS[region] || QODER_GRPC_HOSTS[QODER_REGION_INTL];
  const url = `grpc://${host}${QODER_GRPC_SERVICE_PATH}`;
  const { ChatService, credentials: grpcCredentials, Metadata } = await loadChatService();
  const client = new ChatService(`${host}:443`, grpcCredentials.createSsl());

  const metadata = new Metadata();
  const values = qoderGrpcMetadataValues(
    { token: credentials?.accessToken || credentials?.apiKey, userId, machineId, machineOs },
    modelId,
  );
  for (const [key, value] of Object.entries(values)) {
    if (value) metadata.set(key, value);
  }

  const request = buildQoderGrpcRequest(modelId, body, { userId });
  const call = client.ChatCompletionStream(request, metadata);
  const iterator = call[Symbol.asyncIterator]();

  const abortHandler = () => {
    try {
      call.cancel();
    } catch {
      // cancel() on a finished call throws; nothing to do.
    }
  };
  if (signal) signal.addEventListener("abort", abortHandler, { once: true });

  const cleanup = () => {
    if (signal) signal.removeEventListener("abort", abortHandler);
    try {
      call.destroy?.();
    } catch {
      // ignore
    }
    try {
      client.close();
    } catch {
      // ignore
    }
  };

  // Await the first chunk: this is where auth/quota/413 refusals surface, and
  // they have to become an HTTP status rather than a stream event.
  let first;
  try {
    first = await withTimeout(iterator.next(), FIRST_CHUNK_TIMEOUT_MS, signal);
  } catch (error) {
    cleanup();
    const mapped = mapGrpcStatusToHttp(error?.code, error?.details || error?.message || "");
    log?.warn?.("QODER", `gRPC dispatch failed (${error?.code ?? "?"}: ${error?.details || error?.message}) → HTTP ${mapped.status}`);
    return {
      response: new Response(
        JSON.stringify({
          error: {
            message: `Qoder gRPC: ${error?.details || error?.message || "transport failed"}`,
            code: error?.code ?? null,
          },
        }),
        { status: mapped.status, headers: { "Content-Type": "application/json" } },
      ),
      url,
      headers: {},
      transformedBody: body,
    };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (chunk) => {
        const translated = translateGrpcChunk(chunk, modelId);
        if (translated) controller.enqueue(encoder.encode(sseFrame(translated)));
      };
      try {
        if (!first.done && first.value) emit(first.value);
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          emit(next.value);
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        // The status line is already sent, so a mid-stream failure rides the
        // stream as an error frame the client can see.
        log?.warn?.("QODER", `gRPC stream failed mid-flight (${error?.code ?? "?"}: ${error?.details || error?.message})`);
        controller.enqueue(
          encoder.encode(
            sseFrame({ error: { message: error?.details || error?.message || "Qoder stream failed", code: error?.code ?? null } }),
          ),
        );
      } finally {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      cleanup();
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    }),
    url,
    headers: {},
    transformedBody: body,
    // The stream is already OpenAI-shaped, so the pipeline must not run a
    // Qoder-specific response unwrap on it.
    responseFormat: "openai",
  };
}

/** Awaits a promise, rejecting on timeout or abort so a dead call cannot hang. */
function withTimeout(promise, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Qoder gRPC first-chunk timeout")), timeoutMs);
    const onAbort = () => reject(Object.assign(new Error("aborted"), { code: 1 }));
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
