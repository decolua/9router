import { BaseExecutor } from "./base.js";

const BASE_URL = "https://www.kimi.ai";
const CHAT_URL = `${BASE_URL}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`;
const REFRESH_URL = `${BASE_URL}/api/auth/token/refresh`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const MAX_FRAME_LEN = 8 * 1024 * 1024;

const MODEL_CONFIGS = {
  k3: {
    scenario: "SCENARIO_K2D5",
    supportedReasoningEfforts: ["REASONING_EFFORT_NONE", "REASONING_EFFORT_LOW"],
    defaultReasoningEffort: "REASONING_EFFORT_NONE",
  },
  k2d6: {
    scenario: "SCENARIO_K2D5",
    supportedReasoningEfforts: ["REASONING_EFFORT_NONE", "REASONING_EFFORT_LOW"],
    defaultReasoningEffort: "REASONING_EFFORT_NONE",
  },
};

export function extractKimiAccessToken(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      const access = parsed?.access_token || parsed?.token || "";
      if (access && typeof access === "string") return access.trim();
    } catch {}
  }
  const bearer = raw.match(/^(?:authorization:\s*)?bearer\s+([^;\s]+)/i);
  if (bearer) return bearer[1];
  for (const key of ["access_token", "kimi-auth"]) {
    const m = raw.match(new RegExp(`(?:^|[\\s;])${key}=([^;\\s]+)`));
    if (m) return m[1];
  }
  return !raw.includes("=") && !raw.includes(";") ? raw : "";
}

export function extractKimiRefreshToken(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.refresh_token && typeof parsed.refresh_token === "string") {
        return parsed.refresh_token.trim();
      }
    } catch {}
  }
  const m = raw.match(/(?:^|[\s;])refresh_token=([^;\s]+)/);
  return m ? m[1] : "";
}

export function frameConnectMessage(json) {
  const payload = new TextEncoder().encode(json);
  const framed = new Uint8Array(5 + payload.length);
  framed[0] = 0;
  const len = payload.length;
  framed[1] = (len >>> 24) & 0xff;
  framed[2] = (len >>> 16) & 0xff;
  framed[3] = (len >>> 8) & 0xff;
  framed[4] = len & 0xff;
  framed.set(payload, 5);
  return framed;
}

export function decodeConnectFrame(buf, byteOffset) {
  if (byteOffset + 5 > buf.length) return { consumed: 0, frame: null };
  const flags = buf[byteOffset];
  const len =
    (buf[byteOffset + 1] << 24) |
    (buf[byteOffset + 2] << 16) |
    (buf[byteOffset + 3] << 8) |
    buf[byteOffset + 4];
  const msgLen = len < 0 ? len + 0x100000000 : len;
  if (msgLen > MAX_FRAME_LEN) return { consumed: -1, frame: null };
  if (byteOffset + 5 + msgLen > buf.length) return { consumed: 0, frame: null };
  if ((flags & ~0x03) !== 0) {
    throw new Error(`Kimi Connect frame used unsupported flags: ${flags}`);
  }
  if ((flags & 0x01) !== 0) {
    throw new Error("Kimi Connect compressed frames are not supported");
  }
  const payload = buf.subarray(byteOffset + 5, byteOffset + 5 + msgLen);
  let message = null;
  if (msgLen > 0) {
    try {
      message = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      throw new Error("Kimi Connect frame contained invalid JSON");
    }
  }
  return { consumed: 5 + msgLen, frame: { flags, message } };
}

function getConnectEndStreamError(frame) {
  if ((frame.flags & 0x02) === 0) return null;
  const error = frame.message?.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const code = typeof error.code === "string" ? error.code : "unknown";
  const message = typeof error.message === "string" ? error.message : "upstream error";
  return `${code}: ${message}`;
}

export function extractDelta(msg) {
  if (!msg) return null;
  const op = String(msg.op ?? "");
  const mask = String(msg.mask ?? "");
  const block = msg.block ?? {};
  if (op === "append") {
    if (mask === "block.text.content") {
      const text = String(block.text?.content ?? "");
      return text ? { kind: "text", text } : null;
    }
    if (mask === "block.think.content") {
      const text = String(block.think?.content ?? "");
      return text ? { kind: "think", text } : null;
    }
    return null;
  }
  if (op === "set") {
    if (mask === "block.text") {
      const text = String(block.text?.content ?? "");
      return text ? { kind: "text", text } : null;
    }
    if (mask === "block.think") {
      const text = String(block.think?.content ?? "");
      return text ? { kind: "think", text } : null;
    }
  }
  return null;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("Kimi Web only supports text message content");
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        throw new Error("Kimi Web only supports text message content");
      }
      if ((part.type === "text" || part.type === "input_text") && typeof part.text === "string") {
        return part.text;
      }
      throw new Error("Kimi Web does not support image, audio, file, or tool content");
    })
    .join("");
}

export function foldMessages(messages) {
  const systemParts = [];
  const conversationParts = [];
  for (const message of messages || []) {
    if (message.role === "tool" || message.role === "function") {
      throw new Error("Kimi Web does not support tool result messages");
    }
    if (message.tool_calls !== undefined) {
      throw new Error("Kimi Web does not support assistant tool calls");
    }
    const text = textFromContent(message.content);
    if (message.role === "system" || message.role === "developer") {
      if (text) systemParts.push(text);
    } else if (message.role === "user") {
      if (text) conversationParts.push(conversationParts.length > 0 ? `User: ${text}` : text);
    } else if (message.role === "assistant") {
      if (text) conversationParts.push(`Assistant: ${text}`);
    } else {
      throw new Error(`Kimi Web does not support message role ${message.role}`);
    }
  }
  return {
    prompt: conversationParts.join("\n\n").trim(),
    systemPrompt: systemParts.join("\n\n").trim(),
  };
}

function errorResult(status, message, body) {
  return {
    response: new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
    url: CHAT_URL,
    headers: {},
    transformedBody: body,
  };
}

async function exchangeRefreshToken(refreshToken) {
  const clean = String(refreshToken ?? "").trim();
  if (!clean) return { success: false };
  try {
    const resp = await fetch(REFRESH_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${clean}`,
        Accept: "application/json, text/plain, */*",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        "User-Agent": USER_AGENT,
      },
    });
    if (!resp.ok) return { success: false };
    const data = await resp.json().catch(() => null);
    const access = data?.access_token;
    if (!access || typeof access !== "string") return { success: false };
    return { success: true, accessToken: access };
  } catch {
    return { success: false };
  }
}

export class KimiWebExecutor extends BaseExecutor {
  constructor() {
    super("kimi-web", { baseUrl: BASE_URL });
  }

  buildKimiHeaders(accessToken) {
    const headers = {
      "Content-Type": "application/connect+json",
      Accept: "*/*",
      "User-Agent": USER_AGENT,
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      "connect-protocol-version": "1",
    };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    return headers;
  }

  buildRequestBody(folded, config, reasoningEffort) {
    const options = {
      thinking: true,
      enable_plugin: false,
      ...(folded.systemPrompt ? { system_prompt: folded.systemPrompt } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };
    return JSON.stringify({
      chat_id: "",
      scenario: config.scenario,
      tools: [],
      message: {
        id: "",
        parent_id: "",
        children_message_ids: [],
        role: "user",
        blocks: [{ id: "", message_id: "", text: { content: folded.prompt } }],
        scenario: config.scenario,
        labels: [],
        references: [],
        is_goal: false,
      },
      options,
      project_id: "",
    });
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const bodyObj = body || {};
    const rawCreds = credentials || {};
    const rawCredential = String(rawCreds.accessToken || rawCreds.apiKey || "").trim();
    let accessToken = extractKimiAccessToken(rawCredential);
    if (!accessToken) {
      return errorResult(
        400,
        "Invalid credentials: paste your access_token from www.kimi.ai (DevTools -> Application -> Local Storage)",
        body
      );
    }

    const modelId = String(model || bodyObj.model || "");
    const config = MODEL_CONFIGS[modelId];
    if (!config) {
      return errorResult(400, `Unsupported Kimi Web model: ${modelId}`, body);
    }

    const tools = bodyObj.tools;
    if (Array.isArray(tools) && tools.length > 0) {
      return errorResult(400, "Kimi Web does not support OpenAI function tools", body);
    }

    let folded;
    try {
      const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
      folded = foldMessages(messages);
      if (!folded.prompt) throw new Error("Kimi Web requires a non-empty user message");
    } catch (err) {
      return errorResult(400, err instanceof Error ? err.message : "Invalid Kimi Web request", body);
    }

    const reqBody = this.buildRequestBody(folded, config, config.defaultReasoningEffort);
    const framedBody = frameConnectMessage(reqBody);

    let upstream;
    try {
      upstream = await fetch(CHAT_URL, {
        method: "POST",
        headers: this.buildKimiHeaders(accessToken),
        body: framedBody,
        signal: signal ?? undefined,
      });
    } catch (err) {
      return errorResult(502, `Kimi fetch failed: ${err instanceof Error ? err.message : "unknown"}`, body);
    }

    if (upstream.status === 401) {
      const refreshToken =
        extractKimiRefreshToken(rawCredential) ||
        rawCreds.refreshToken ||
        rawCreds.providerSpecificData?.refreshToken;
      if (refreshToken && typeof refreshToken === "string") {
        const refreshed = await exchangeRefreshToken(refreshToken);
        if (refreshed.success && refreshed.accessToken) {
          accessToken = refreshed.accessToken;
          try {
            upstream = await fetch(CHAT_URL, {
              method: "POST",
              headers: this.buildKimiHeaders(accessToken),
              body: frameConnectMessage(reqBody),
              signal: signal ?? undefined,
            });
          } catch {}
        }
      }
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      const hint =
        upstream.status === 401
          ? " (token expired or invalid, re-copy access_token from www.kimi.ai localStorage)"
          : "";
      return errorResult(upstream.status, `Kimi error: ${errText.slice(0, 300)}${hint}`, body);
    }

    const encoder = new TextEncoder();
    const id = `chatcmpl-kimi-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const reqHeaders = this.buildKimiHeaders(accessToken);

    const emitChunk = (controller, delta, finish = null) => {
      const chunk = {
        id,
        object: "chat.completion.chunk",
        created,
        model: modelId,
        choices: [{ index: 0, delta, finish_reason: finish }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    };

    const collectFrames = async (reader) => {
      let buffer = new Uint8Array(0);
      let answer = "";
      let reasoning = "";
      let sawEnd = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer, 0);
        merged.set(value, buffer.length);
        buffer = merged;
        let offset = 0;
        while (offset < buffer.length) {
          const { consumed, frame } = decodeConnectFrame(buffer, offset);
          if (consumed === -1) throw new Error("Kimi Connect frame exceeded size limit");
          if (consumed === 0) break;
          offset += consumed;
          if (!frame) continue;
          if ((frame.flags & 0x02) !== 0) {
            const endErr = getConnectEndStreamError(frame);
            if (endErr) throw new Error(`Kimi Connect EndStream error: ${endErr}`);
            sawEnd = true;
            break;
          }
          if (!frame.message) continue;
          const delta = extractDelta(frame.message);
          if (delta) {
            if (delta.kind === "think") reasoning += delta.text;
            else answer += delta.text;
          }
        }
        buffer = buffer.subarray(offset);
        if (sawEnd) break;
      }
      if (!sawEnd) throw new Error("Kimi Connect stream ended without EndStream frame");
      return { answer, reasoning };
    };

    const sourceStream = upstream.body ?? new ReadableStream({ start: (c) => c.close() });

    if (stream) {
      const outStream = new ReadableStream({
        start: async (controller) => {
          const reader = sourceStream.getReader();
          let emittedRole = false;
          try {
            let buffer = new Uint8Array(0);
            let done2 = false;
            while (!done2) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value) continue;
              const merged = new Uint8Array(buffer.length + value.length);
              merged.set(buffer, 0);
              merged.set(value, buffer.length);
              buffer = merged;
              let offset = 0;
              while (offset < buffer.length) {
                const { consumed, frame } = decodeConnectFrame(buffer, offset);
                if (consumed === -1) throw new Error("Kimi Connect frame exceeded size limit");
                if (consumed === 0) break;
                offset += consumed;
                if (!frame) continue;
                if ((frame.flags & 0x02) !== 0) {
                  const endErr = getConnectEndStreamError(frame);
                  if (endErr) throw new Error(`Kimi Connect EndStream error: ${endErr}`);
                  done2 = true;
                  break;
                }
                if (!frame.message) continue;
                const delta = extractDelta(frame.message);
                if (delta) {
                  if (!emittedRole) {
                    emittedRole = true;
                    emitChunk(controller, { role: "assistant", content: "" });
                  }
                  if (delta.kind === "think") emitChunk(controller, { reasoning_content: delta.text });
                  else emitChunk(controller, { content: delta.text });
                }
              }
              buffer = buffer.subarray(offset);
            }
            if (!done2) throw new Error("Kimi Connect stream ended without EndStream frame");
            if (!emittedRole) emitChunk(controller, { role: "assistant", content: "" });
            emitChunk(controller, {}, "stop");
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            if (signal?.aborted) {
              try { controller.close(); } catch {}
            } else {
              try { controller.error(err); } catch {}
            }
          }
        },
      });
      return {
        response: new Response(outStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        url: CHAT_URL,
        headers: reqHeaders,
        transformedBody: JSON.parse(reqBody),
      };
    }

    try {
      const { answer, reasoning } = await collectFrames(sourceStream.getReader());
      const message = { role: "assistant", content: answer };
      if (reasoning) message.reasoning_content = reasoning;
      return {
        response: new Response(
          JSON.stringify({
            id,
            object: "chat.completion",
            created,
            model: modelId,
            choices: [{ index: 0, message, finish_reason: "stop" }],
          }),
          { headers: { "Content-Type": "application/json" } }
        ),
        url: CHAT_URL,
        headers: reqHeaders,
        transformedBody: JSON.parse(reqBody),
      };
    } catch (err) {
      log?.error?.("KIMI-WEB", `Collect failed: ${err instanceof Error ? err.message : String(err)}`);
      return errorResult(502, `Kimi protocol error: ${err instanceof Error ? err.message : "unknown"}`, body);
    }
  }
}
