import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";

const CHAT_URL = "https://zenmux.ai/api/anthropic/v1/messages";
const FRONTEND_BASE = "https://zenmux.ai/api/frontend/chat";
const INFO_URL = "https://zenmux.ai/api/user/info";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function buildCookieHeader(apiKey) {
  return apiKey || "";
}

function extractCtoken(cookieStr) {
  const m = cookieStr.match(/ctoken=([^;]+)/);
  return m ? m[1] : "";
}

async function zmGet(url, ctoken, cookieStr, proxyOptions) {
  const u = new URL(url);
  u.searchParams.set("ctoken", ctoken);
  return proxyAwareFetch(u.toString(), {
    headers: { Cookie: cookieStr, "User-Agent": UA, Origin: "https://zenmux.ai" },
  }, proxyOptions);
}

async function handleExecute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
  const cookieStr = buildCookieHeader(credentials?.apiKey);
  const ctoken = extractCtoken(cookieStr);
  if (!ctoken) throw new Error("ctoken not found in cookies");

  const msgs = body?.messages || [];
  const userMsg = msgs.find(m => m.role === "user");
  const sysMsg = msgs.find(m => m.role === "system");
  const question = userMsg?.content || "Hello";
  const fullText = sysMsg ? `${sysMsg.content}\n\n${question}` : question;

  const reqId = randomUUID().replace(/-/g, "");

  const mkH = (extra = {}) => ({
    Cookie: cookieStr, Origin: "https://zenmux.ai", "User-Agent": UA,
    Referer: "https://zenmux.ai/platform/chat", ...extra,
  });

  // Step 1: addRound
  const chatId = "9r_" + Date.now();
  const subId = randomUUID().replace(/-/g, "");
  let roundId = null;
  try {
    const ru = new URL(`${FRONTEND_BASE}/addRound`);
    ru.searchParams.set("ctoken", ctoken);
    const r1 = await proxyAwareFetch(ru.toString(), {
      method: "POST", headers: mkH({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        chatId, chatRequestId: reqId, question: fullText, answer: "\u200b",
        extra: JSON.stringify({ subChatId: subId, chatRequestId: reqId, status: "sending" }),
      }), signal,
    }, proxyOptions);
    if (r1.ok) { const d = await r1.json(); roundId = d.id; }
  } catch {}

  // Step 2: anthropic
  const claudeBody = {
    model: "deepseek/deepseek-v4-pro:streamlake",
    max_tokens: body.max_tokens || 4096,
    messages: [{ role: "user", content: [{ type: "text", text: fullText }] }],
    stream: true,
  };
  if (body.temperature !== undefined) claudeBody.temperature = body.temperature;

  log?.debug?.("FETCH", `ZENMUX → ${model}`);

  const pu = new URL(CHAT_URL);
  pu.searchParams.set("ctoken", ctoken);
  const response = await proxyAwareFetch(pu.toString(), {
    method: "POST",
    headers: mkH({
      "Content-Type": "application/json", "anthropic-version": "2023-06-01",
      "chat-request-id": reqId, "x-zenmux-accept-processing": "true, true",
      "x-zenmux-apikey-source": "subscription", Accept: "text/event-stream",
    }),
    body: JSON.stringify(claudeBody),
    signal,
  }, proxyOptions);

  if (!response.ok) {
    const eb = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) throw Object.assign(new Error("ZenMux: cookies expired"), { statusCode: 401 });
    if (response.status === 402) throw Object.assign(new Error("ZenMux: quota exhausted"), { statusCode: 402 });
    throw Object.assign(new Error(`ZenMux: HTTP ${response.status}`), { statusCode: response.status });
  }

  // Step 3: updateRound fire & forget
  if (roundId) {
    (async () => {
      try {
        const txt = await _collectText(response.clone().body);
        if (!txt) return;
        const uu = new URL(`${FRONTEND_BASE}/updateRound`);
        uu.searchParams.set("ctoken", ctoken);
        await proxyAwareFetch(uu.toString(), {
          method: "POST", headers: mkH({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            chatId, chatRoundId: roundId, question: fullText, answer: txt,
            extra: JSON.stringify({ subChatId: subId, chatRequestId: reqId, status: "success", modelInfo: { slug: "deepseek/deepseek-v4-pro" } }),
            chatRequestId: reqId, status: "success", finishReason: "success",
          }),
        }, proxyOptions).catch(() => {});
      } catch {}
    })();
  }

  const cid = `chatcmpl-zmf-${randomUUID().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1000);

  let finalResponse;
  if (stream) {
    finalResponse = new Response(buildSSEStream(response.body, model, cid, created), {
      status: 200, headers: SSE_HEADERS_NO_BUFFER,
    });
  } else {
    const txt = await _collectText(response.body);
    finalResponse = new Response(JSON.stringify({
      id: cid, object: "chat.completion", created, model,
      choices: [{ index: 0, message: { role: "assistant", content: txt }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: Math.ceil(txt.length / 4), total_tokens: 0 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return { response: finalResponse, url: CHAT_URL, headers: {}, transformedBody: claudeBody };
}

async function _collectText(body) {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "", txt = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const ln of lines) {
      const t = ln.trim();
      if (!t.startsWith("data: ")) continue;
      try {
        const d = JSON.parse(t.slice(6));
        if (d.type === "content_block_delta" && d.delta) txt += d.delta.text || d.delta.thinking || "";
      } catch {}
    }
  }
  return txt;
}

function buildSSEStream(body, model, cid, created) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buf = "", aid = cid;

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        })));

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const ln of lines) {
            const t = ln.trim();
            if (!t.startsWith("data: ")) continue;
            try {
              const d = JSON.parse(t.slice(6));
              if (d.type === "content_block_delta" && d.delta) {
                const text = d.delta.text || d.delta.thinking || "";
                if (text) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: aid, object: "chat.completion.chunk", created, model,
                    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
                  })));
                }
              } else if (d.type === "message_delta" && d.delta) {
                controller.enqueue(encoder.encode(sseChunk({
                  id: aid, object: "chat.completion.chunk", created, model,
                  choices: [{ index: 0, delta: {}, finish_reason: d.delta.stop_reason || "stop" }],
                })));
              }
            } catch {}
          }
        }
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: { content: `[Error: ${err.message}]` }, finish_reason: "stop" }],
        })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally { controller.close(); }
    },
  });
}

/** Validate cookies by calling user info endpoint. Used by credential validation in 9router. */
export async function validateCookies(cookieStr) {
  const ctoken = extractCtoken(cookieStr);
  if (!ctoken) return { valid: false, error: "no ctoken" };
  try {
    const u = new URL(INFO_URL);
    u.searchParams.set("ctoken", ctoken);
    const resp = await fetch(u.toString(), {
      headers: { Cookie: cookieStr, "User-Agent": UA },
    });
    if (!resp.ok) return { valid: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    if (!data.success || !data.data) return { valid: false, error: "session expired" };
    return { valid: true, user: data.data.displayName, email: data.data.email };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

export class ZenmuxFreeExecutor extends BaseExecutor {
  constructor() {
    super("zenmux-free", PROVIDERS["zenmux-free"]);
  }
  async execute(opts) {
    try {
      return await handleExecute(opts);
    } catch (err) {
      const status = err.statusCode || 502;
      const body = JSON.stringify({ error: { message: err.message, type: "upstream_error", code: `HTTP_${status}` } });
      return { response: new Response(body, { status, headers: { "Content-Type": "application/json" } }), url: CHAT_URL, headers: {}, transformedBody: opts.body };
    }
  }
}
export default ZenmuxFreeExecutor;
