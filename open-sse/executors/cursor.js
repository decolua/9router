/**
 * CursorExecutor - Executor for Cursor AI IDE
 * Uses ConnectRPC/protobuf protocol with HTTP/2 for streaming chat
 */

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/constants.js";
import {
  generateCursorBody,
  parseConnectRPCFrame,
  extractTextFromResponse
} from "../utils/cursorProtobuf.js";
import crypto from "crypto";
import { v5 as uuidv5 } from "uuid";
import http2 from "http2";

export class CursorExecutor extends BaseExecutor {
  constructor() {
    super("cursor", PROVIDERS.cursor);
  }

  /**
   * Build URL for Cursor API
   */
  buildUrl() {
    return `${this.config.baseUrl}${this.config.chatPath}`;
  }

  /**
   * Generate Cursor checksum (jyh cipher) - timestamp integer version
   * This is the format that works with Cursor API
   */
  generateChecksum(machineId) {
    // Use timestamp / 1e6 format (same as Python demo that works)
    const timestamp = Math.floor(Date.now() / 1000000);

    // Create 6-byte big-endian array
    const byteArray = new Uint8Array([
      (timestamp >> 40) & 0xFF,
      (timestamp >> 32) & 0xFF,
      (timestamp >> 24) & 0xFF,
      (timestamp >> 16) & 0xFF,
      (timestamp >> 8) & 0xFF,
      timestamp & 0xFF
    ]);

    // Jyh cipher obfuscation
    let t = 165;
    for (let i = 0; i < byteArray.length; i++) {
      byteArray[i] = ((byteArray[i] ^ t) + (i % 256)) & 0xFF;
      t = byteArray[i];
    }

    // URL-safe base64 encode (without padding)
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

  /**
   * Generate client key from token
   */
  generateClientKey(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Generate session ID
   */
  generateSessionId(token) {
    return uuidv5(token, uuidv5.DNS);
  }

  /**
   * Build headers with Cursor checksum authentication
   */
  buildHeaders(credentials) {
    const accessToken = credentials.accessToken;
    const machineId = credentials.providerSpecificData?.machineId;
    const ghostMode = credentials.providerSpecificData?.ghostMode !== false;

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API");
    }

    const cleanToken = accessToken.includes("::")
      ? accessToken.split("::")[1]
      : accessToken;

    return {
      "authorization": `Bearer ${cleanToken}`,
      "connect-accept-encoding": "gzip",
      "connect-protocol-version": "1",
      "content-type": "application/connect+proto",
      "user-agent": "connect-es/1.6.1",
      "x-amzn-trace-id": `Root=${crypto.randomUUID()}`,
      "x-client-key": this.generateClientKey(cleanToken),
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
      "x-session-id": this.generateSessionId(cleanToken),
    };
  }

  /**
   * Convert OpenAI-format messages to Cursor format
   */
  convertMessages(body) {
    const messages = body.messages || [];
    const result = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({
          role: "user",
          content: `[System Instructions]\n${msg.content}`
        });
        continue;
      }

      if (msg.role === "user" || msg.role === "assistant") {
        let content = "";

        if (typeof msg.content === "string") {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") {
              content += part.text;
            }
          }
        }

        if (content) {
          result.push({ role: msg.role, content });
        }
      }
    }

    return result;
  }

  /**
   * Make HTTP/2 request to Cursor API
   */
  makeHttp2Request(url, headers, body, signal) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = http2.connect(`https://${urlObj.host}`);

      const chunks = [];
      let responseHeaders = {};

      client.on("error", (err) => {
        reject(err);
      });

      const req = client.request({
        ":method": "POST",
        ":path": urlObj.pathname,
        ":authority": urlObj.host,
        ":scheme": "https",
        ...headers
      });

      req.on("response", (hdrs) => {
        responseHeaders = hdrs;
      });

      req.on("data", (chunk) => {
        chunks.push(chunk);
      });

      req.on("end", () => {
        client.close();
        const data = Buffer.concat(chunks);
        resolve({
          status: responseHeaders[":status"],
          headers: responseHeaders,
          body: data
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

  /**
   * Custom execute for Cursor - handles protobuf binary protocol with HTTP/2
   */
  async execute({ model, body, stream, credentials, signal, log }) {
    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials);

    // Convert messages and build protobuf body
    const messages = this.convertMessages(body);
    const cursorBody = generateCursorBody(messages, model);

    log?.debug?.("CURSOR", `Sending ${messages.length} messages to ${model}, stream=${stream}`);

    try {
      // Use HTTP/2 for Cursor API (required)
      const response = await this.makeHttp2Request(url, headers, cursorBody, signal);

      if (response.status !== 200) {
        // Create error response
        const errorResponse = new Response(JSON.stringify({
          error: {
            message: `[${response.status}]: ${response.body.toString() || "Unknown error"}`,
            type: "invalid_request_error",
            code: ""
          }
        }), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
        return { response: errorResponse, url, headers, transformedBody: body };
      }

      // Transform based on stream parameter
      const transformedResponse = stream !== false
        ? this.transformProtobufToSSE(response.body, model)
        : this.transformProtobufToJSON(response.body, model);

      return { response: transformedResponse, url, headers, transformedBody: body };
    } catch (error) {
      log?.error?.("CURSOR", `Request failed: ${error.message}`);
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

  /**
   * Transform ConnectRPC protobuf buffer to JSON Response (non-streaming)
   */
  transformProtobufToJSON(buffer, model) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    // Parse all frames and collect content
    let offset = 0;
    let totalContent = "";

    while (offset < buffer.length) {
      if (offset + 5 > buffer.length) break;

      const flags = buffer[offset];
      const length = buffer.readUInt32BE(offset + 1);

      if (offset + 5 + length > buffer.length) break;

      let payload = buffer.slice(offset + 5, offset + 5 + length);
      offset += 5 + length;

      // Decompress if gzip (flags 0x01 or 0x03)
      if (flags === 0x01 || flags === 0x03) {
        try {
          const zlib = require("zlib");
          payload = zlib.gunzipSync(payload);
        } catch {
          continue;
        }
      }

      // Check if payload is JSON error (ConnectRPC error format)
      try {
        const text = payload.toString("utf-8");
        if (text.startsWith("{") && text.includes('"error"')) {
          const jsonError = JSON.parse(text);
          const errorMsg = jsonError?.error?.details?.[0]?.debug?.details?.title
            || jsonError?.error?.details?.[0]?.debug?.details?.detail
            || jsonError?.error?.message
            || "API Error";
          return new Response(JSON.stringify({
            error: {
              message: errorMsg,
              type: jsonError?.error?.code === "resource_exhausted" ? "rate_limit_error" : "api_error",
              code: jsonError?.error?.details?.[0]?.debug?.error || "unknown"
            }
          }), {
            status: jsonError?.error?.code === "resource_exhausted" ? 429 : 400,
            headers: { "Content-Type": "application/json" }
          });
        }
      } catch {}

      // Extract text or error from protobuf
      const result = extractTextFromResponse(new Uint8Array(payload));

      if (result.error) {
        // Return error response
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

      if (result.text) {
        totalContent += result.text;
      }
    }

    // Build non-streaming response
    const estimatedPromptTokens = 10;
    const estimatedCompletionTokens = Math.max(1, Math.floor(totalContent.length / 4));

    const completion = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: totalContent
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: estimatedPromptTokens,
        completion_tokens: estimatedCompletionTokens,
        total_tokens: estimatedPromptTokens + estimatedCompletionTokens
      }
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  /**
   * Transform ConnectRPC protobuf buffer to SSE Response
   */
  transformProtobufToSSE(buffer, model) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    // Parse all frames from buffer
    const chunks = [];
    let offset = 0;
    let totalContent = "";

    while (offset < buffer.length) {
      if (offset + 5 > buffer.length) break;

      const flags = buffer[offset];
      const length = buffer.readUInt32BE(offset + 1);

      if (offset + 5 + length > buffer.length) break;

      let payload = buffer.slice(offset + 5, offset + 5 + length);
      offset += 5 + length;

      // Decompress if gzip (flags 0x01 or 0x03)
      if (flags === 0x01 || flags === 0x03) {
        try {
          const zlib = require("zlib");
          payload = zlib.gunzipSync(payload);
        } catch {
          continue;
        }
      }

      // Check if payload is JSON error (ConnectRPC error format)
      try {
        const text = payload.toString("utf-8");
        if (text.startsWith("{") && text.includes('"error"')) {
          const jsonError = JSON.parse(text);
          const errorMsg = jsonError?.error?.details?.[0]?.debug?.details?.title
            || jsonError?.error?.details?.[0]?.debug?.details?.detail
            || jsonError?.error?.message
            || "API Error";
          return new Response(JSON.stringify({
            error: {
              message: errorMsg,
              type: jsonError?.error?.code === "resource_exhausted" ? "rate_limit_error" : "api_error",
              code: jsonError?.error?.details?.[0]?.debug?.error || "unknown"
            }
          }), {
            status: jsonError?.error?.code === "resource_exhausted" ? 429 : 400,
            headers: { "Content-Type": "application/json" }
          });
        }
      } catch {}

      // Extract text or error from protobuf
      const result = extractTextFromResponse(new Uint8Array(payload));

      if (result.error) {
        // Return error response
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

      if (result.text) {
        totalContent += result.text;
        const chunk = {
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: chunks.length === 0
              ? { role: "assistant", content: result.text }
              : { content: result.text },
            finish_reason: null
          }]
        };
        chunks.push(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    }

    // Add finish chunk
    const estimatedTokens = Math.max(1, Math.floor(totalContent.length / 4));
    const finishChunk = {
      id: responseId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: estimatedTokens,
        total_tokens: estimatedTokens
      }
    };
    chunks.push(`data: ${JSON.stringify(finishChunk)}\n\n`);
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

  /**
   * Cursor doesn't support standard OAuth refresh
   */
  async refreshCredentials() {
    return null;
  }
}

export default CursorExecutor;
