import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import {
  generateCursorBody,
  encodeField,
  wrapConnectRPCFrame,
  decodeMessage,
  parseConnectRPCFrame,
  extractTextFromResponse,
  encodeMcpToolDefinition,
  encodeMcpTools,
  decodeMcpArgs,
  encodeMcpResultSuccess,
} from "../utils/cursorProtobuf.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { estimateUsage } from "../utils/usageTracking.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { FORMATS } from "../translator/formats.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import zlib from "zlib";
import crypto from "crypto";

// Detect cloud environment
const isCloudEnv = () => {
  if (typeof caches !== "undefined" && typeof caches === "object") return true;
  if (typeof EdgeRuntime !== "undefined") return true;
  return false;
};

// Lazy import http2 (only in Node.js environment)
let http2 = null;
if (!isCloudEnv()) {
  try {
    http2 = await import("http2");
  } catch {
    // http2 not available
  }
}

const COMPRESS_FLAG = {
  NONE: 0x00,
  GZIP: 0x01,
  TRAILER: 0x02,
  GZIP_TRAILER: 0x03
};

const AGENT_RUN_PATH = "/agent.v1.AgentService/Run";
const PROTOBUF_LEN = 2;
const PROTOBUF_VARINT = 0;

const CURSOR_AGENT_SESSION_TTL_MS = 5 * 60 * 1000;
const retainedAgentSessions = new Map();
const retainedAgentToolCalls = new Map();

function concatBuffers(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const agentString = (field, value) => encodeField(field, PROTOBUF_LEN, value);
const agentMessage = (field, value) => encodeField(field, PROTOBUF_LEN, value);
const agentBool = (field, value) => encodeField(field, PROTOBUF_VARINT, value ? 1 : 0);

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeAgentToolCallId(value) {
  return String(value || "").split("\n")[0].trim();
}

function agentSessionOwner(credentials, model) {
  const account = credentials?.connectionId
    || credentials?.id
    || credentials?.accessToken
    || credentials?.apiKey
    || "anonymous";
  return crypto.createHash("sha256").update(`${model}\0${account}`).digest("hex");
}

function retainedToolCallKey(owner, toolCallId) {
  return `${owner}\0${normalizeAgentToolCallId(toolCallId)}`;
}

function extractCursorToolResults(body) {
  const results = [];
  for (const message of body?.messages || []) {
    const content = textFromContent(message?.content);
    const blocks = content.matchAll(/<tool_result>([\s\S]*?)<\/tool_result>/g);
    for (const block of blocks) {
      const value = block[1];
      const toolName = value.match(/<tool_name>([\s\S]*?)<\/tool_name>/)?.[1];
      const toolCallId = value.match(/<tool_call_id>([\s\S]*?)<\/tool_call_id>/)?.[1];
      const result = value.match(/<result>([\s\S]*?)<\/result>/)?.[1];
      if (toolName == null || toolCallId == null || result == null) continue;
      const isError = value.match(/<is_error>([\s\S]*?)<\/is_error>/)?.[1];
      results.push({
        toolName: decodeXmlEntities(toolName).trim(),
        toolCallId: normalizeAgentToolCallId(decodeXmlEntities(toolCallId)),
        content: decodeXmlEntities(result),
        isError: decodeXmlEntities(isError).trim() === "true",
      });
    }
  }
  return results;
}

function closeRetainedAgentSession(state) {
  if (!state || state.closed) return;
  state.closed = true;
  clearTimeout(state.timer);
  for (const toolCallId of state.pending.keys()) {
    const key = retainedToolCallKey(state.owner, toolCallId);
    if (retainedAgentToolCalls.get(key) === state) {
      retainedAgentToolCalls.delete(key);
    }
  }
  retainedAgentSessions.delete(state.session);
  try { state.session.close(); } catch {}
}

function retainAgentToolCall(session, owner, toolCallId, execRequest) {
  toolCallId = normalizeAgentToolCallId(toolCallId);
  let state = retainedAgentSessions.get(session);
  if (!state) {
    state = { session, owner, pending: new Map(), buffered: Buffer.alloc(0), closed: false, timer: null };
    retainedAgentSessions.set(session, state);
  }
  const key = retainedToolCallKey(owner, toolCallId);
  const previousState = retainedAgentToolCalls.get(key);
  if (previousState && previousState !== state) {
    closeRetainedAgentSession(previousState);
  }
  state.pending.set(toolCallId, {
    id: extractAgentVarint(execRequest, 1),
    execId: extractAgentString(execRequest, 15),
  });
  retainedAgentToolCalls.set(key, state);
  clearTimeout(state.timer);
  state.timer = setTimeout(() => closeRetainedAgentSession(state), CURSOR_AGENT_SESSION_TTL_MS);
  state.timer.unref?.();
  return state;
}

function acquireRetainedAgentSession(owner, toolResults) {
  if (!toolResults.length) return null;
  const matchedResults = toolResults.filter((result) =>
    retainedAgentToolCalls.has(retainedToolCallKey(owner, result.toolCallId))
  );
  if (!matchedResults.length) return null;
  const state = retainedAgentToolCalls.get(retainedToolCallKey(owner, matchedResults[0].toolCallId));
  if (!state || state.closed) return null;
  if (matchedResults.some((result) =>
    retainedAgentToolCalls.get(retainedToolCallKey(owner, result.toolCallId)) !== state
  )) return null;
  clearTimeout(state.timer);
  return { state, matchedResults };
}

function consumeRetainedToolResults(state, toolResults) {
  for (const result of toolResults) {
    const toolCallId = normalizeAgentToolCallId(result.toolCallId);
    const pending = state.pending.get(toolCallId);
    if (!pending) continue;
    state.session.write(createMcpResultResponse(pending, result.content, result.isError));
    state.pending.delete(toolCallId);
    const key = retainedToolCallKey(state.owner, toolCallId);
    if (retainedAgentToolCalls.get(key) === state) {
      retainedAgentToolCalls.delete(key);
    }
  }
}

function releaseRetainedAgentSession(state, keepOpen) {
  if (!state || state.closed) return;
  if (keepOpen && state.pending.size > 0) {
    state.timer = setTimeout(() => closeRetainedAgentSession(state), CURSOR_AGENT_SESSION_TTL_MS);
    state.timer.unref?.();
    return;
  }
  closeRetainedAgentSession(state);
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function isAgentCapableRequest(body) {
  // Many compatible clients always attach their built-in tool schemas, even
  // for a normal text turn. Cursor's retired ChatService rejects those
  // requests. AgentService accepts text history, declared MCP tools, and prior
  // tool calls/results reconstructed as conversation text.
  return Array.isArray(body?.messages) && body.messages.length > 0 && body.messages.every((message) => {
    if (!["system", "user", "assistant", "tool"].includes(message?.role)) return false;
    const textContent = typeof message?.content === "string"
      || message?.content == null
      || Array.isArray(message?.content) && message.content.every((part) => part?.type === "text" && typeof part.text === "string");
    if (!textContent) return false;
    if (message.role === "assistant" && message.tool_calls != null && !Array.isArray(message.tool_calls)) return false;
    return true;
  });
}

const isAgentTextRequest = isAgentCapableRequest;

function toolCallsFromMessage(message) {
  if (!Array.isArray(message?.tool_calls) || message.tool_calls.length === 0) return "";
  return message.tool_calls.map((toolCall) => {
    const fn = toolCall?.function || {};
    return `[Tool call ${toolCall?.id || ""}: ${fn.name || "tool"}(${fn.arguments || "{}"})]`;
  }).join("\n");
}

function toolResultsFromMessage(message) {
  if (!Array.isArray(message?.tool_results) || message.tool_results.length === 0) return "";
  return message.tool_results.map((result) =>
    `[Tool result ${result?.tool_call_id || ""}${result?.tool_name ? ` (${result.tool_name})` : ""}]\n${result?.result_content || result?.result || ""}`
  ).join("\n");
}

function encodeHistoryMessage(message) {
  const contentParts = [textFromContent(message?.content)];
  if (message?.role === "assistant") contentParts.push(toolCallsFromMessage(message));
  if (message?.role === "assistant") contentParts.push(toolResultsFromMessage(message));
  if (message?.role === "tool") {
    contentParts.unshift(`[Tool result ${message.tool_call_id || ""}${message.name ? ` (${message.name})` : ""}]`);
  }
  const content = contentParts.filter(Boolean).join("\n");
  if (!content) return null;

  // ConversationHistoryMessage.user / .assistant -> repeated content -> text.
  const text = agentString(1, content);
  if (message.role === "assistant") {
    return agentMessage(2, agentMessage(1, agentMessage(1, text)));
  }
  return agentMessage(1, agentMessage(1, agentMessage(1, text)));
}

export function buildAgentRunFrame(messages, model, tools = []) {
  const system = messages
    .filter((message) => message?.role === "system")
    .map((message) => textFromContent(message.content))
    .filter(Boolean)
    .join("\n\n");
  const chatMessages = messages.filter((message) => message?.role !== "system");
  const currentIndex = [...chatMessages].map((message) => message?.role).findLastIndex((role) => role === "user" || role === "tool");
  const current = currentIndex >= 0 ? chatMessages[currentIndex] : chatMessages.at(-1);
  const history = chatMessages
    .slice(0, currentIndex >= 0 ? currentIndex : -1)
    .map(encodeHistoryMessage)
    .filter(Boolean);
  const currentText = current?.role === "tool"
    ? [`[Tool result ${current.tool_call_id || ""}${current.name ? ` (${current.name})` : ""}]`, textFromContent(current.content)].filter(Boolean).join("\n")
    : textFromContent(current?.content);
  const userText = currentText || "Continue.";

  // agent.v1.UserMessageAction.user_message and its optional history.
  const userMessage = concatBuffers(
    agentString(1, userText),
    agentString(2, crypto.randomUUID()),
  );
  const conversationHistory = history.length
    ? concatBuffers(...history.map((entry) => agentMessage(1, entry)))
    : null;
  const userAction = concatBuffers(
    agentMessage(1, userMessage),
    ...(conversationHistory ? [agentMessage(7, conversationHistory)] : []),
  );
  const conversationAction = agentMessage(1, userAction);
  const requestedModel = concatBuffers(agentString(1, model), agentBool(7, true));
  const runRequest = concatBuffers(
    // An empty ConversationStateStructure starts a fresh local agent session.
    agentMessage(1, new Uint8Array()),
    agentMessage(2, conversationAction),
    ...(tools.length ? [agentMessage(4, encodeMcpTools(tools))] : []),
    ...(system ? [agentString(8, system)] : []),
    agentMessage(9, requestedModel),
  );

  // agent.v1.AgentClientMessage.run_request.
  return wrapConnectRPCFrame(agentMessage(1, runRequest));
}

function extractAgentString(message, field) {
  const value = message?.get(field)?.[0]?.value;
  return value instanceof Uint8Array || Buffer.isBuffer(value)
    ? Buffer.from(value).toString("utf8")
    : "";
}

function extractAgentVarint(message, field) {
  const value = message?.get(field)?.[0]?.value;
  return typeof value === "number" ? value : null;
}

function describeAgentFields(message) {
  return [...(message?.entries?.() || [])].map(([field, entries]) => {
    const values = entries.map(({ wireType, value }) => {
      if (wireType === PROTOBUF_VARINT) return `v${value}`;
      if (value instanceof Uint8Array || Buffer.isBuffer(value)) return `l${value.length}`;
      return `w${wireType}`;
    }).join(",");
    return `${field}:${values}`;
  }).join(" ");
}

function decodeAgentFrames(buffer, onFrame) {
  let pending = Buffer.from(buffer || []);
  while (pending.length >= 5) {
    const flags = pending[0];
    const length = pending.readUInt32BE(1);
    if (pending.length < 5 + length) break;
    let payload = pending.subarray(5, 5 + length);
    pending = pending.subarray(5 + length);
    if (flags & COMPRESS_FLAG.GZIP) {
      payload = zlib.gunzipSync(payload);
    }
    if (!(flags & COMPRESS_FLAG.TRAILER) && onFrame(payload) === false) break;
  }
  return pending;
}

function createRequestContextResponse(execRequest, tools = []) {
  // AgentService asks every run for client context. 9router has no IDE file
  // context, so acknowledge with an empty RequestContext.
  const requestContext = tools.length
    ? concatBuffers(...tools.map((tool) => agentMessage(7, encodeMcpToolDefinition(tool))))
    : new Uint8Array();
  const requestContextSuccess = agentMessage(1, requestContext);
  const requestContextResult = agentMessage(1, requestContextSuccess);
  const execClientMessage = concatBuffers(
    ...(extractAgentVarint(execRequest, 1) != null ? [encodeField(1, PROTOBUF_VARINT, extractAgentVarint(execRequest, 1))] : []),
    agentMessage(10, requestContextResult),
    ...(execRequest?.has(15) ? [agentMessage(15, execRequest.get(15)[0].value)] : []),
  );
  return wrapConnectRPCFrame(agentMessage(2, execClientMessage));
}

function createListMcpResourcesResponse(execRequest) {
  // 9router exposes callable MCP tools, but it has no Cursor MCP resource
  // catalogue. Return a successful empty list so the agent can continue.
  const result = agentMessage(1, new Uint8Array());
  const execClientMessage = concatBuffers(
    ...(extractAgentVarint(execRequest, 1) != null ? [encodeField(1, PROTOBUF_VARINT, extractAgentVarint(execRequest, 1))] : []),
    agentMessage(17, result),
    ...(execRequest?.has(15) ? [agentMessage(15, execRequest.get(15)[0].value)] : []),
  );
  return wrapConnectRPCFrame(agentMessage(2, execClientMessage));
}

function createMcpResultResponse(pending, content, isError = false) {
  const mcpResult = encodeMcpResultSuccess({ textItems: [content], isError });
  const execClientMessage = concatBuffers(
    ...(pending.id != null ? [encodeField(1, PROTOBUF_VARINT, pending.id)] : []),
    agentMessage(11, mcpResult),
    ...(pending.execId ? [agentMessage(15, pending.execId)] : []),
  );
  return wrapConnectRPCFrame(agentMessage(2, execClientMessage));
}

const CURSOR_STREAM_DEBUG = process.env.CURSOR_STREAM_DEBUG === "1";
const CURSOR_TRACE_CONTENT = process.env.CURSOR_TRACE_CONTENT === "1";
const debugLog = (...args) => {
  if (CURSOR_STREAM_DEBUG) console.log(...args);
};
const traceLog = (runId, ...args) => {
  if (CURSOR_TRACE_CONTENT) console.log(`[CURSOR TRACE ${runId}]`, ...args);
};

function traceInteractionUpdate(runId, update) {
  for (const [field, entries] of update.entries()) {
    for (const { wireType, value } of entries) {
      if (wireType === PROTOBUF_VARINT) {
        traceLog(runId, `interaction_update field=${field} varint=${value}`);
        continue;
      }

      const bytes = Buffer.from(value || []);
      if (field === 1 || field === 4) {
        const text = extractAgentString(decodeMessage(bytes), 1);
        traceLog(runId, `${field === 1 ? "text_delta" : "thinking_delta"}=${JSON.stringify(text)}`);
      } else if (field === 5 || field === 8) {
        const nested = decodeMessage(bytes);
        traceLog(runId, `${field === 5 ? "thinking_completed" : "token_delta"} fields=${describeAgentFields(nested)}`);
      } else {
        traceLog(
          runId,
          `interaction_update field=${field} length=${bytes.length} base64=${bytes.toString("base64")}`
        );
      }
    }
  }
}

function isComposerModel(model) {
  const modelId = String(model || "").split("/").pop();
  return /^composer(?:-|$)/i.test(modelId);
}

function visibleComposerContentFromThinking(thinking) {
  if (!thinking) return "";
  const endTag = "</think>";
  const endIdx = thinking.lastIndexOf(endTag);
  if (endIdx < 0) return "";
  return thinking.slice(endIdx + endTag.length).trimStart();
}

function decompressPayload(payload, flags) {
  // Check if payload is JSON error (starts with {"error")
  if (payload.length > 10 && payload[0] === 0x7b && payload[1] === 0x22) {
    try {
      const text = payload.toString("utf-8");
      if (text.startsWith('{"error"')) {
        debugLog(`[DECOMPRESS] Detected JSON error, skipping decompression`);
        return payload;
      }
    } catch {}
  }

  if (
    flags === COMPRESS_FLAG.GZIP ||
    flags === COMPRESS_FLAG.TRAILER ||
    flags === COMPRESS_FLAG.GZIP_TRAILER
  ) {
    // Primary: try gzip decompression (standard gzip header 0x1f 0x8b)
    try {
      return zlib.gunzipSync(payload);
    } catch (gzipErr) {
      // Fallback: TRAILER and GZIP_TRAILER frames sometimes use raw zlib deflate format
      try {
        return zlib.inflateSync(payload);
      } catch (deflateErr) {
        // Last resort: try raw deflate (no zlib header)
        try {
          return zlib.inflateRawSync(payload);
        } catch (rawErr) {
          debugLog(
            `[DECOMPRESS ERROR] flags=${flags}, payloadSize=${payload.length}, gzip=${gzipErr.message}, deflate=${deflateErr.message}, raw=${rawErr.message}`
          );
          debugLog(
            `[DECOMPRESS ERROR] First 50 bytes (hex):`,
            payload.slice(0, 50).toString("hex")
          );
          return payload;
        }
      }
    }
  }
  return payload;
}

// Read one cursor protobuf frame: header + bounds + decompress. Returns status + payload + new offset.
function readCursorFrame(buffer, offset, frameNum, tag) {
  if (offset + 5 > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Reached end, offset=${offset}, remaining=${buffer.length - offset}`);
    return { status: "done" };
  }

  const flags = buffer[offset];
  const length = buffer.readUInt32BE(offset + 1);
  debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: flags=0x${flags.toString(16).padStart(2, "0")}, length=${length}`);

  if (offset + 5 + length > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Incomplete frame, offset=${offset}, length=${length}, buffer.length=${buffer.length}`);
    return { status: "done" };
  }

  let payload = buffer.slice(offset + 5, offset + 5 + length);
  const newOffset = offset + 5 + length;
  payload = decompressPayload(payload, flags);
  if (!payload) {
    debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: decompression failed, skipping`);
    return { status: "skip", offset: newOffset };
  }
  return { status: "ok", payload, offset: newOffset };
}

function createErrorResponse(jsonError) {
  const errorMsg = jsonError?.error?.details?.[0]?.debug?.details?.title
    || jsonError?.error?.details?.[0]?.debug?.details?.detail
    || jsonError?.error?.message
    || "API Error";
  
  const isRateLimit = jsonError?.error?.code === "resource_exhausted";
  
  return new Response(JSON.stringify({
    error: {
      message: errorMsg,
      type: isRateLimit ? "rate_limit_error" : "api_error",
      code: jsonError?.error?.details?.[0]?.debug?.error || "unknown"
    }
  }), {
    status: isRateLimit ? HTTP_STATUS.RATE_LIMITED : HTTP_STATUS.BAD_REQUEST,
    headers: { "Content-Type": "application/json" }
  });
}

export class CursorExecutor extends BaseExecutor {
  constructor() {
    super("cursor", PROVIDERS.cursor);
  }

  buildUrl() {
    return `${this.config.baseUrl}${this.config.chatPath}`;
  }

  buildHeaders(credentials) {
    const accessToken = credentials.accessToken;
    const machineId = credentials.providerSpecificData?.machineId;
    const ghostMode = credentials.providerSpecificData?.ghostMode !== false;

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API");
    }

    return buildCursorHeaders(accessToken, machineId, ghostMode);
  }

  transformRequest(model, body, stream, credentials) {
    // Messages are already translated by chatCore (claude→openai→cursor)
    // Do NOT call openaiToCursorRequest again — double-translation drops tool_results
    const messages = body.messages || [];
    const tools = body.tools || [];
    const reasoningEffort = body.reasoning_effort || null;
    // Detect Claude Code UA to force Agent mode (issue #643)
    const ua = credentials?.rawHeaders?.["user-agent"] || "";
    const forceAgentMode = ua.includes("claude-cli") || ua.includes("claude-code") || ua.includes("Claude Code");
    return generateCursorBody(messages, model, tools, reasoningEffort, forceAgentMode);
  }

  async makeFetchRequest(url, headers, body, signal, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body,
      signal
    }, proxyOptions);

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer())
    };
  }

  makeHttp2Request(url, headers, body, signal) {
    if (!http2) {
      throw new Error("http2 module not available");
    }

    const HTTP2_TIMEOUT_MS = 60000; // 60s max — prevent hung sessions

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = http2.connect(`https://${urlObj.host}`);
      const chunks = [];
      let responseHeaders = {};
      let settled = false;

      // Ensure client is always closed on settle
      const finish = (fn) => (...args) => {
        if (settled) return;
        settled = true;
        clearTimeout(hangTimeout);
        client.close();
        fn(...args);
      };

      // Hard timeout: close session if server never responds
      const hangTimeout = setTimeout(finish(() => {
        reject(new Error("HTTP/2 request timed out"));
      }), HTTP2_TIMEOUT_MS);

      client.on("error", finish(reject));

      const req = client.request({
        ":method": "POST",
        ":path": urlObj.pathname,
        ":authority": urlObj.host,
        ":scheme": "https",
        ...headers
      });

      req.on("response", (hdrs) => { responseHeaders = hdrs; });
      req.on("data", (chunk) => { chunks.push(chunk); });
      req.on("end", finish(() => {
        resolve({
          status: responseHeaders[":status"],
          headers: responseHeaders,
          body: Buffer.concat(chunks)
        });
      }));
      req.on("error", finish(reject));

      if (signal) {
        const onAbort = finish(() => reject(new Error("Request aborted")));
        signal.addEventListener("abort", onAbort, { once: true });
      }

      req.write(body);
      req.end();
    });
  }

  /**
   * AgentService (agent.api5.cursor.sh) is HTTP/2-only. Node's fetch/undici speaks
   * HTTP/1.1 and fails with HTTPParserError on the h2 preface — use http2 duplex.
   */
  openAgentHttp2Stream(url, headers, signal) {
    if (!http2) {
      throw new Error("HTTP/2 is required for Cursor AgentService (endpoint is h2-only)");
    }

    const urlObj = new URL(url);
    const client = http2.connect(`https://${urlObj.host}`);
    const chunkQueue = [];
    let waiting = null;
    let ended = false;
    let streamError = null;
    let req = null;

    const wake = (result) => {
      if (!waiting) return;
      const resolve = waiting;
      waiting = null;
      resolve(result);
    };

    const fail = (error) => {
      if (streamError) return;
      streamError = error;
      ended = true;
      wake(null);
    };

    const close = () => {
      try { req?.destroy(); } catch {}
      try { client.close(); } catch {}
    };

    client.on("error", fail);

    req = client.request({
      ":method": "POST",
      ":path": urlObj.pathname,
      ":authority": urlObj.host,
      ":scheme": "https",
      ...headers,
    });

    req.on("error", fail);
    req.on("data", (chunk) => {
      if (waiting) wake({ value: chunk, done: false });
      else chunkQueue.push(chunk);
    });
    req.on("end", () => {
      ended = true;
      wake({ value: undefined, done: true });
    });

    if (signal) {
      const onAbort = () => {
        fail(new Error("Request aborted"));
        close();
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const responseHeaders = new Promise((resolve, reject) => {
      const onEarlyError = (error) => reject(error);
      client.once("error", onEarlyError);
      req.once("error", onEarlyError);
      req.once("response", (hdrs) => {
        client.off("error", onEarlyError);
        req.off("error", onEarlyError);
        resolve(hdrs);
      });
    });

    return {
      responseHeaders,
      write(frame) {
        if (req && !req.destroyed) req.write(Buffer.from(frame));
      },
      end() {
        try { if (req && !req.destroyed) req.end(); } catch {}
      },
      close,
      async read() {
        if (chunkQueue.length) return { value: chunkQueue.shift(), done: false };
        if (ended) {
          if (streamError) throw streamError;
          return { value: undefined, done: true };
        }
        const result = await new Promise((resolve) => { waiting = resolve; });
        if (streamError) throw streamError;
        return result || { value: undefined, done: true };
      },
    };
  }

  async executeAgent({ model, body, stream, credentials, signal }) {
    const agentEndpoint = PROVIDER_OAUTH.cursor?.agentEndpoint;
    if (!agentEndpoint) throw new Error("Cursor AgentService endpoint is not configured");

    const url = `${agentEndpoint}${AGENT_RUN_PATH}`;
    const headers = this.buildHeaders(credentials);
    const runId = crypto.randomUUID().slice(0, 8);
    const requestController = new AbortController();
    if (signal?.addEventListener) {
      if (signal.aborted) requestController.abort(signal.reason);
      else signal.addEventListener("abort", () => requestController.abort(signal.reason), { once: true });
    }

    const toolResults = extractCursorToolResults(body);
    const sessionOwner = agentSessionOwner(credentials, model);
    const retained = acquireRetainedAgentSession(sessionOwner, toolResults);
    let retainedState = retained?.state || null;
    let keepSessionOpen = false;
    let session;
    let responseHeaders;
    const closeRetainedOnAbort = () => {
      if (retainedState) closeRetainedAgentSession(retainedState);
    };
    if (requestController.signal.aborted) closeRetainedOnAbort();
    else requestController.signal.addEventListener("abort", closeRetainedOnAbort, { once: true });
    traceLog(runId, `tool_results=${JSON.stringify(toolResults)} retained=${Boolean(retainedState)}`);
    try {
      if (requestController.signal.aborted) throw new Error("Request aborted");
      if (retainedState) {
        session = retainedState.session;
        consumeRetainedToolResults(retainedState, retained.matchedResults);
        keepSessionOpen = true;
        responseHeaders = { ":status": 200 };
        debugLog(
          `[CURSOR AGENT ${runId}] Resume messages=${body.messages?.length || 0}, `
          + `toolResults=${retained.matchedResults.map((result) => result.toolCallId).join(",")}`
        );
        traceLog(runId, `resume=${JSON.stringify(retained.matchedResults)}`);
      } else {
        session = this.openAgentHttp2Stream(url, headers, requestController.signal);
        debugLog(
          `[CURSOR AGENT ${runId}] Run model=${model}, messages=${body.messages?.length || 0}, `
          + `roles=${(body.messages || []).map((message) => message?.role || "?").join(",")}, `
          + `tools=${body.tools?.length || 0}`
        );
        traceLog(runId, `request=${JSON.stringify({ model, stream, body })}`);
        const runFrame = buildAgentRunFrame(body.messages || [], model, body.tools || []);
        traceLog(runId, `client_frame length=${runFrame.length} base64=${Buffer.from(runFrame).toString("base64")}`);
        session.write(runFrame);
        responseHeaders = await session.responseHeaders;
      }
    } catch (error) {
      if (retainedState) closeRetainedAgentSession(retainedState);
      else try { session?.close(); } catch {}
      throw new Error(`Cursor AgentService request failed: ${error.message}`);
    }

    if (!responseHeaders) {
      try {
        responseHeaders = await session.responseHeaders;
      } catch (error) {
        session.close();
        throw new Error(`Cursor AgentService request failed: ${error.message}`);
      }
    }

    const status = Number(responseHeaders[":status"] || 0);
    if (status !== 200) {
      let errorText = "";
      try {
        while (true) {
          const { done, value } = await session.read();
          if (done) break;
          errorText += Buffer.from(value).toString("utf8");
        }
      } catch {}
      session.close();
      return {
        response: new Response(JSON.stringify({
          error: { message: `Cursor AgentService ${status}: ${errorText || "request failed"}`, type: "api_error" },
        }), { status: status || HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
        url,
        headers,
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
      };
    }

    // The Claude SSE translator derives Anthropic's message ID by stripping
    // `chatcmpl-`. Keep the remaining ID in Anthropic's required `msg_` form
    // so strict clients such as Claude Code accept the completed stream.
    const responseId = `chatcmpl-msg_${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let pending = retainedState?.buffered || Buffer.alloc(0);
    if (retainedState) retainedState.buffered = Buffer.alloc(0);
    let finished = false;

    const consume = async (onEvent) => {
      try {
        while (!finished) {
          pending = decodeAgentFrames(pending, (payload) => {
            // A single read can carry several frames; once the turn is over the
            // remaining complete frames stay buffered for the retained resume.
            if (finished) return false;
            traceLog(runId, `server_frame length=${payload.length} base64=${Buffer.from(payload).toString("base64")}`);
            const serverMessage = decodeMessage(payload);
            debugLog(`[CURSOR AGENT ${runId}] Server fields: ${describeAgentFields(serverMessage)}`);

            // agent.v1.AgentServerMessage.interaction_update
            if (serverMessage.has(1)) {
              const update = decodeMessage(serverMessage.get(1)[0].value);
              traceInteractionUpdate(runId, update);
              if (update.has(1)) {
                const textDelta = extractAgentString(decodeMessage(update.get(1)[0].value), 1);
                if (textDelta) onEvent({ type: "text", value: textDelta });
              }
              // Cursor's AgentService emits internal reasoning without the
              // cryptographic signature required by Anthropic thinking blocks.
              // Forwarding it makes strict Anthropic clients (Claude Code)
              // discard or wait on an otherwise complete response. Keep the
              // reasoning upstream-only and emit the normal answer text.
              if (update.has(14)) {
                finished = true;
                onEvent({ type: "done" });
                return false;
              }
            }

            // AgentService requests IDE context before producing a response.
            // Return an empty context; 9router is not coupled to an editor.
            if (serverMessage.has(2)) {
              const execRequest = decodeMessage(serverMessage.get(2)[0].value);
              traceLog(runId, `exec_request fields=${describeAgentFields(execRequest)}`);
              if (execRequest.has(10)) {
                session.write(createRequestContextResponse(execRequest, body.tools || []));
              } else if (execRequest.has(17)) {
                session.write(createListMcpResourcesResponse(execRequest));
              } else if (execRequest.has(11)) {
                const mcpArgs = decodeMcpArgs(execRequest.get(11)[0].value);
                const correlationId = extractAgentString(execRequest, 15);
                const toolCallId = normalizeAgentToolCallId(
                  mcpArgs.toolCallId || correlationId || `call_${crypto.randomUUID()}`
                );
                const toolName = mcpArgs.toolName || mcpArgs.name || "tool";
                retainedState = retainAgentToolCall(session, sessionOwner, toolCallId, execRequest);
                keepSessionOpen = true;
                traceLog(runId, `mcp_exec tool=${toolName} call_id=${toolCallId} args=${JSON.stringify(mcpArgs.args || {})}`);
                finished = true;
                onEvent({
                  type: "tool_call",
                  value: {
                    id: toolCallId,
                    type: "function",
                    function: {
                      name: toolName,
                      arguments: JSON.stringify(mcpArgs.args || {}),
                    },
                  },
                });
                return false;
              } else {
                // Every other ExecServerMessage variant is an editor-backed tool
                // (shell, read, write, …) that 9router cannot service. Fail the
                // turn rather than narrating protocol state as assistant text.
                debugLog(`[CURSOR AGENT ${runId}] Unsupported exec request fields: ${describeAgentFields(execRequest)}`);
                finished = true;
                onEvent({ type: "error", value: "Cursor AgentService requested an unsupported IDE tool" });
                return false;
              }
            }

            if (serverMessage.has(7)) {
              const query = Buffer.from(serverMessage.get(7)[0].value);
              traceLog(
                runId,
                `interaction_query fields=${describeAgentFields(decodeMessage(query))} base64=${query.toString("base64")}`
              );
            }
            return true;
          });
          if (finished) break;
          const { done, value } = await session.read();
          if (done) break;
          pending = Buffer.concat([pending, Buffer.from(value)]);
        }
      } catch (error) {
        if (retainedState) closeRetainedAgentSession(retainedState);
        throw error;
      } finally {
        traceLog(runId, `consume_finally finished=${finished} pending=${pending.length}`);
        if (keepSessionOpen && retainedState) {
          retainedState.buffered = pending;
          releaseRetainedAgentSession(retainedState, true);
        } else {
          try { session.end(); } catch {}
          try { session.close(); } catch {}
        }
        if (!finished) onEvent({ type: "done" });
      }
    };

    if (stream === false) {
      let content = "";
      let reasoning = "";
      let toolCall = null;
      let agentError = null;
      await consume((event) => {
        if (event.type === "text") content += event.value;
        else if (event.type === "thinking") reasoning += event.value;
        else if (event.type === "tool_call") toolCall = event.value;
        else if (event.type === "error") agentError = event.value;
      });
      if (agentError) {
        return {
          response: new Response(JSON.stringify({ error: { message: agentError, type: "api_error" } }), {
            status: HTTP_STATUS.BAD_REQUEST,
            headers: { "Content-Type": "application/json" },
          }),
          url,
          headers,
          transformedBody: body,
          responseFormat: FORMATS.OPENAI,
        };
      }
      return {
        response: new Response(JSON.stringify({
          id: responseId,
          object: "chat.completion",
          created,
          model,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: content || null,
              ...(reasoning ? { reasoning_content: reasoning } : {}),
              ...(toolCall ? { tool_calls: [toolCall] } : {}),
            },
            finish_reason: toolCall ? "tool_calls" : "stop",
          }],
          usage: estimateUsage(body, content.length, FORMATS.OPENAI),
        }), { headers: { "Content-Type": "application/json" } }),
        url,
        headers,
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
      };
    }

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      start(controller) {
        consume((event) => {
          if (event.type === "text") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: { content: event.value } })));
          } else if (event.type === "thinking") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: { reasoning_content: event.value } })));
          } else if (event.type === "tool_call") {
            controller.enqueue(encoder.encode(chatChunkSse({
              id: responseId,
              created,
              model,
              delta: { tool_calls: [{ index: 0, ...event.value }] },
            })));
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: {}, finishReason: "tool_calls" })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          } else if (event.type === "error") {
            // An SSE error frame, not a content delta: a protocol failure must not
            // be rendered to the user as the assistant's reply, and downstream
            // usage tracking must not record the turn as a success.
            controller.enqueue(encoder.encode(sseChunk({ error: { message: event.value, type: "api_error" } })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          } else if (event.type === "done") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: {}, finishReason: "stop" })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          }
        }).catch((error) => controller.error(error));
      },
      cancel() {
        requestController.abort();
      },
    });

    return {
      response: new Response(responseStream, { headers: SSE_HEADERS }),
      url,
      headers,
      transformedBody: body,
      responseFormat: FORMATS.OPENAI,
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    if (isAgentTextRequest(body)) {
      try {
        return await this.executeAgent({ model, body, stream, credentials, signal });
      } catch (error) {
        return {
          response: new Response(JSON.stringify({
            error: { message: error.message, type: "connection_error", code: "" },
          }), { status: HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
          url: `${PROVIDER_OAUTH.cursor?.agentEndpoint || ""}${AGENT_RUN_PATH}`,
          headers: {},
          transformedBody: body,
        };
      }
    }

    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    try {
      const shouldForceFetch = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true || !!proxyOptions?.vercelRelayUrl;
      const response = (http2 && !shouldForceFetch)
        ? await this.makeHttp2Request(url, headers, transformedBody, signal)
        : await this.makeFetchRequest(url, headers, transformedBody, signal, proxyOptions);

      if (response.status !== 200) {
        const errorText = response.body?.toString() || "Unknown error";
        const errorResponse = new Response(JSON.stringify({
          error: {
            message: `[${response.status}]: ${errorText}`,
            type: "invalid_request_error",
            code: ""
          }
        }), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
        return { response: errorResponse, url, headers, transformedBody: body };
      }

      const transformedResponse = stream !== false
        ? this.transformProtobufToSSE(response.body, model, body)
        : this.transformProtobufToJSON(response.body, model, body);

      return { response: transformedResponse, url, headers, transformedBody: body };
    } catch (error) {
      const errorResponse = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "connection_error",
          code: ""
        }
      }), {
        status: HTTP_STATUS.SERVER_ERROR,
        headers: { "Content-Type": "application/json" }
      });
      return { response: errorResponse, url, headers, transformedBody: body };
    }
  }

  transformProtobufToJSON(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    const toolCalls = [];
    const toolCallsMap = new Map(); // Track streaming tool calls by ID
    const finalizedIds = new Set();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, "");
      if (frame.status === "done") break;
      offset = frame.offset;
      frameCount++;
      if (frame.status === "skip") continue;
      const payload = frame.payload;

      // Check for JSON error frames (byte guard: skip toString on non-JSON frames)
      if (payload.length > 0 && payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;
        } else {
          // New tool call
          toolCallsMap.set(tc.id, { ...tc });
        }

        // Push to final array when isLast is true
        if (tc.isLast) {
          const finalToolCall = toolCallsMap.get(tc.id);
          finalizedIds.add(tc.id);
          toolCalls.push({
            id: finalToolCall.id,
            type: finalToolCall.type,
            function: {
              name: finalToolCall.function.name,
              arguments: finalToolCall.function.arguments
            }
          });
        }
      }

      if (result.text) totalContent += result.text;
      if (result.thinking) totalThinking += result.thinking;
    }

    const visibleComposerContent = isComposerModel(model)
      ? visibleComposerContentFromThinking(totalThinking)
      : "";
    const finalContent = totalContent || visibleComposerContent;

    debugLog(
      `[CURSOR BUFFER] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, finalized toolCalls: ${toolCalls.length}`
    );

    // Finalize all remaining tool calls in map (in case stream ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      // Check if already in final array
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });
      }
    }

    debugLog(`[CURSOR BUFFER] Final toolCalls count: ${toolCalls.length}`);


    const message = {
      role: "assistant",
      content: finalContent || null
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    const usage = estimateUsage(body, finalContent.length, FORMATS.OPENAI);

    const completion = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }],
      usage
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  transformProtobufToSSE(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const chunks = [];
    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    let emittedComposerThinkingContentLength = 0;
    const toolCalls = [];
    const toolCallsMap = new Map(); // Track streaming tool calls by ID
    const finalizedIds = new Set();
    const emittedToolCallIds = new Set();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER SSE] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, " SSE");
      if (frame.status === "done") break;
      offset = frame.offset;
      frameCount++;
      if (frame.status === "skip") continue;
      const payload = frame.payload;

      // Check for JSON error frames (byte-guard: only decode if starts with '{')
      if (payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER SSE] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED SSE] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER SSE] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (chunks.length === 0) {
          chunks.push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
        }

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          const oldArgsLen = existing.function.arguments.length;
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;

          // Stream the delta arguments
          if (tc.function.arguments) {
            emittedToolCallIds.add(tc.id);
            chunks.push(chatChunkSse({
              id: responseId, created, model,
              delta: {
                tool_calls: [
                  {
                    index: existing.index,
                    id: tc.id,
                    type: "function",
                    function: {
                      name: tc.function.name,
                      arguments: tc.function.arguments
                    }
                  }
                ]
              }
            }));
          }
        } else {
          // New tool call - assign index and add to map
          const toolCallIndex = toolCalls.length;
          finalizedIds.add(tc.id);
          toolCalls.push({ ...tc, index: toolCallIndex });
          toolCallsMap.set(tc.id, { ...tc, index: toolCallIndex });

          // Stream initial tool call with name
          emittedToolCallIds.add(tc.id);
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta: {
              tool_calls: [
                {
                  index: toolCallIndex,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }
              ]
            }
          }));
        }
      }

      if (result.text) {
        totalContent += result.text;
        chunks.push(chatChunkSse({
          id: responseId, created, model,
          delta:
            chunks.length === 0 && toolCalls.length === 0
              ? { role: "assistant", content: result.text }
              : { content: result.text }
        }));
      }

      if (isComposerModel(model) && result.thinking) {
        totalThinking += result.thinking;
        const visibleContent = visibleComposerContentFromThinking(totalThinking);
        if (visibleContent.length > emittedComposerThinkingContentLength) {
          const deltaContent = visibleContent.slice(emittedComposerThinkingContentLength);
          emittedComposerThinkingContentLength = visibleContent.length;
          totalContent += deltaContent;
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta:
              chunks.length === 0 && toolCalls.length === 0
                ? { role: "assistant", content: deltaContent }
                : { content: deltaContent }
          }));
        }
      }
    }

    debugLog(
      `[CURSOR BUFFER SSE] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, toolCalls array: ${toolCalls.length}`
    );

    // Finalize all remaining tool calls in map (stream may have ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER SSE] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        const toolCallIndex = toolCalls.length;
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          index: toolCallIndex,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });

        // Emit SSE chunk for the finalized tool call if not already emitted
        if (!emittedToolCallIds.has(tc.id)) {
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta: {
              tool_calls: [
                {
                  index: toolCallIndex,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }
              ]
            }
          }));
        }
      }
    }

    if (chunks.length === 0 && toolCalls.length === 0) {
      chunks.push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
    }

    const usage = estimateUsage(body, totalContent.length, FORMATS.OPENAI);

    chunks.push(
      `data: ${JSON.stringify({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
          }
        ],
        usage
      })}\n\n`
    );
    chunks.push(SSE_DONE);

    return new Response(chunks.join(""), {
      status: 200,
      headers: { ...SSE_HEADERS }
    });
  }

  async refreshCredentials() {
    return null;
  }
}

export default CursorExecutor;
