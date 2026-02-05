import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/constants.js";
import {
  generateCursorBody,
  parseConnectRPCFrame,
  extractTextFromResponse
} from "../utils/cursorProtobuf.js";
import crypto from "crypto";
import { v5 as uuidv5 } from "uuid";
import zlib from "zlib";

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
  GZIP_ALT: 0x02,
  GZIP_BOTH: 0x03
};

function decompressPayload(payload, flags) {
  if (flags === COMPRESS_FLAG.GZIP || flags === COMPRESS_FLAG.GZIP_ALT || flags === COMPRESS_FLAG.GZIP_BOTH) {
    try {
      return zlib.gunzipSync(payload);
    } catch {
      return null;
    }
  }
  return payload;
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
    status: isRateLimit ? 429 : 400,
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

  // Jyh cipher checksum for Cursor API authentication
  generateChecksum(machineId) {
    const timestamp = Math.floor(Date.now() / 1000000);
    const byteArray = new Uint8Array([
      (timestamp >> 40) & 0xFF,
      (timestamp >> 32) & 0xFF,
      (timestamp >> 24) & 0xFF,
      (timestamp >> 16) & 0xFF,
      (timestamp >> 8) & 0xFF,
      timestamp & 0xFF
    ]);

    let t = 165;
    for (let i = 0; i < byteArray.length; i++) {
      byteArray[i] = ((byteArray[i] ^ t) + (i % 256)) & 0xFF;
      t = byteArray[i];
    }

    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let encoded = "";

    for (let i = 0; i < byteArray.length; i += 3) {
      const a = byteArray[i];
      const b = i + 1 < byteArray.length ? byteArray[i + 1] : 0;
      const c = i + 2 < byteArray.length ? byteArray[i + 2] : 0;

      encoded += alphabet[a >> 2];
      encoded += alphabet[((a & 3) << 4) | (b >> 4)];

      if (i + 1 < byteArray.length) {
        encoded += alphabet[((b & 15) << 2) | (c >> 6)];
      }
      if (i + 2 < byteArray.length) {
        encoded += alphabet[c & 63];
      }
    }

    return `${encoded}${machineId}`;
  }

  buildHeaders(credentials) {
    const accessToken = credentials.accessToken;
    const machineId = credentials.providerSpecificData?.machineId;
    const ghostMode = credentials.providerSpecificData?.ghostMode !== false;

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API");
    }

    const cleanToken = accessToken.includes("::") ? accessToken.split("::")[1] : accessToken;

    return {
      "authorization": `Bearer ${cleanToken}`,
      "connect-accept-encoding": "gzip",
      "connect-protocol-version": "1",
      "content-type": "application/connect+proto",
      "user-agent": "connect-es/1.6.1",
      "x-amzn-trace-id": `Root=${crypto.randomUUID()}`,
      "x-client-key": crypto.createHash("sha256").update(cleanToken).digest("hex"),
      "x-cursor-checksum": this.generateChecksum(machineId),
      "x-cursor-client-version": "2.3.41",
      "x-cursor-client-type": "ide",
      "x-cursor-client-os": process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
      "x-cursor-client-arch": process.arch === "arm64" ? "aarch64" : "x64",
      "x-cursor-client-device-type": "desktop",
      "x-cursor-config-version": crypto.randomUUID(),
      "x-cursor-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      "x-ghost-mode": ghostMode ? "true" : "false",
      "x-request-id": crypto.randomUUID(),
      "x-session-id": uuidv5(cleanToken, uuidv5.DNS),
    };
  }

  transformRequest(model, body, stream, credentials) {
    const messages = body.messages || [];
    const tools = body.tools || [];
    const reasoningEffort = body.reasoning_effort || null;
    return generateCursorBody(messages, model, tools, reasoningEffort);
  }

  async makeFetchRequest(url, headers, body, signal) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal
    });

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

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = http2.connect(`https://${urlObj.host}`);
      const chunks = [];
      let responseHeaders = {};

      client.on("error", reject);

      const req = client.request({
        ":method": "POST",
        ":path": urlObj.pathname,
        ":authority": urlObj.host,
        ":scheme": "https",
        ...headers
      });

      req.on("response", (hdrs) => { responseHeaders = hdrs; });
      req.on("data", (chunk) => { chunks.push(chunk); });
      req.on("end", () => {
        client.close();
        resolve({
          status: responseHeaders[":status"],
          headers: responseHeaders,
          body: Buffer.concat(chunks)
        });
      });
      req.on("error", (err) => {
        client.close();
        reject(err);
      });

      if (signal) {
        signal.addEventListener("abort", () => {
          req.close();
          client.close();
          reject(new Error("Request aborted"));
        });
      }

      req.write(body);
      req.end();
    });
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    try {
      const response = http2 
        ? await this.makeHttp2Request(url, headers, transformedBody, signal)
        : await this.makeFetchRequest(url, headers, transformedBody, signal);

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
        ? this.transformProtobufToSSE(response.body, model)
        : this.transformProtobufToJSON(response.body, model);

      return { response: transformedResponse, url, headers, transformedBody: body };
    } catch (error) {
      const errorResponse = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "connection_error",
          code: ""
        }
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
      return { response: errorResponse, url, headers, transformedBody: body };
    }
  }

  transformProtobufToJSON(buffer, model) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let offset = 0;
    let totalContent = "";
    const toolCalls = [];

    while (offset < buffer.length) {
      if (offset + 5 > buffer.length) break;

      const flags = buffer[offset];
      const length = buffer.readUInt32BE(offset + 1);

      if (offset + 5 + length > buffer.length) break;

      let payload = buffer.slice(offset + 5, offset + 5 + length);
      offset += 5 + length;

      payload = decompressPayload(payload, flags);
      if (!payload) continue;

      try {
        const text = payload.toString("utf-8");
        if (text.startsWith("{") && text.includes('"error"')) {
          return createErrorResponse(JSON.parse(text));
        }
      } catch {}

      const result = extractTextFromResponse(new Uint8Array(payload));

      if (result.error) {
        return new Response(JSON.stringify({
          error: {
            message: result.error,
            type: "rate_limit_error",
            code: "rate_limited"
          }
        }), {
          status: 429,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (result.toolCall) toolCalls.push(result.toolCall);
      if (result.text) totalContent += result.text;
    }

    const message = {
      role: "assistant",
      content: totalContent || null
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

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
      usage: {
        prompt_tokens: 10,
        completion_tokens: Math.max(1, Math.floor(totalContent.length / 4)),
        total_tokens: 10 + Math.max(1, Math.floor(totalContent.length / 4))
      }
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  transformProtobufToSSE(buffer, model) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const chunks = [];
    let offset = 0;
    let totalContent = "";
    const toolCalls = [];

    while (offset < buffer.length) {
      if (offset + 5 > buffer.length) break;

      const flags = buffer[offset];
      const length = buffer.readUInt32BE(offset + 1);

      if (offset + 5 + length > buffer.length) break;

      let payload = buffer.slice(offset + 5, offset + 5 + length);
      offset += 5 + length;

      payload = decompressPayload(payload, flags);
      if (!payload) continue;

      try {
        const text = payload.toString("utf-8");
        if (text.startsWith("{") && text.includes('"error"')) {
          return createErrorResponse(JSON.parse(text));
        }
      } catch {}

      const result = extractTextFromResponse(new Uint8Array(payload));

      if (result.error) {
        return new Response(JSON.stringify({
          error: {
            message: result.error,
            type: "rate_limit_error",
            code: "rate_limited"
          }
        }), {
          status: 429,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (result.toolCall) {
        toolCalls.push(result.toolCall);
        
        if (chunks.length === 0) {
          chunks.push(`data: ${JSON.stringify({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null
            }]
          })}\n\n`);
        }
        
        chunks.push(`data: ${JSON.stringify({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: { tool_calls: [{ index: toolCalls.length - 1, ...result.toolCall }] },
            finish_reason: null
          }]
        })}\n\n`);
      }

      if (result.text) {
        totalContent += result.text;
        chunks.push(`data: ${JSON.stringify({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: chunks.length === 0 && toolCalls.length === 0
              ? { role: "assistant", content: result.text }
              : { content: result.text },
            finish_reason: null
          }]
        })}\n\n`);
      }
    }

    if (chunks.length === 0 && toolCalls.length === 0) {
      chunks.push(`data: ${JSON.stringify({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null
        }]
      })}\n\n`);
    }

    chunks.push(`data: ${JSON.stringify({
      id: responseId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: Math.max(1, Math.floor(totalContent.length / 4)),
        total_tokens: Math.max(1, Math.floor(totalContent.length / 4))
      }
    })}\n\n`);
    chunks.push("data: [DONE]\n\n");

    return new Response(chunks.join(""), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
  }

  async refreshCredentials() {
    return null;
  }
}

export default CursorExecutor;
