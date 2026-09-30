import { BaseExecutor } from "./base.js";

const GEMINI_URL = "https://gemini.google.com/app";
const STREAM_URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

const GEMINI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export function normalizeGeminiCookieInput(raw, cookieName = "__Secure-1PSID") {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const cookies =
        parsed.cookies && typeof parsed.cookies === "object" && !Array.isArray(parsed.cookies)
          ? parsed.cookies
          : parsed;
      const pairs = Object.entries(cookies)
        .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
        .map(([k, v]) => `${k}=${String(v).trim()}`);
      if (pairs.length > 0) return pairs.join("; ");
    } catch {}
  }
  return trimmed.includes("=") ? trimmed : `${cookieName}=${trimmed}`;
}

export function buildGeminiPrompt(messages) {
  const textMessages = (messages || []).filter(
    (m) => typeof m.content === "string" && m.content.trim().length > 0
  );
  const userMessages = textMessages.filter((m) => m.role === "user");
  const lastUser = userMessages[userMessages.length - 1];
  const lastUserContent = lastUser?.content ?? "";
  const lastUserIdx = lastUser ? textMessages.lastIndexOf(lastUser) : -1;
  const priorTurns = textMessages.filter(
    (m, i) => i < lastUserIdx && (m.role === "user" || m.role === "assistant")
  );
  const systemText = textMessages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  if (priorTurns.length === 0 && !systemText) return lastUserContent;
  if (priorTurns.length === 0) return `System:\n${systemText}\n\n${lastUserContent}`;
  const historyLines = priorTurns.map(
    (m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`
  );
  const parts = [];
  if (systemText) parts.push(`System:\n${systemText}`);
  parts.push(`Previous conversation:\n${historyLines.join("\n\n")}`);
  parts.push(`Current user message:\n${lastUserContent}`);
  return parts.join("\n\n");
}

export function parseStreamResponse(raw) {
  const lines = String(raw || "").split("\n");
  let lastText = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === ")]}'" || /^\d+$/.test(line)) continue;
    if (!line.includes("wrb.fr")) continue;
    try {
      const arr = JSON.parse(line);
      if (!Array.isArray(arr) || !Array.isArray(arr[0]) || arr[0][0] !== "wrb.fr") continue;
      const payload = arr[0]?.[2];
      if (typeof payload !== "string") continue;
      const inner = JSON.parse(payload);
      const responseArray = inner?.[4]?.[0]?.[1];
      if (!Array.isArray(responseArray)) continue;
      const text = responseArray.filter((c) => typeof c === "string").join("");
      if (text) lastText = text;
    } catch {}
  }
  return lastText;
}

function parseCookies(raw) {
  return String(raw || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return null;
      const name = part.substring(0, eq).trim();
      const value = part.substring(eq + 1).trim();
      if (!name || !value) return null;
      if (["path", "domain", "expires", "max-age", "secure", "httponly", "samesite"].includes(name.toLowerCase())) {
        return null;
      }
      return { name, value };
    })
    .filter(Boolean);
}

async function fetchSessionParams(cookie) {
  const res = await fetch(GEMINI_URL, {
    headers: {
      Cookie: cookie,
      "User-Agent": GEMINI_USER_AGENT,
      Accept: "text/html",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/"SNlM0e":"([^"]+)"/) || html.match(/SNlM0e\\?":\\?"([^"\\]+)/);
  const bl = html.match(/"cfb2h":"([^"]+)"/) || html.match(/cfb2h\\?":\\?"([^"\\]+)/);
  if (!m) return null;
  return { at: m[1], bl: bl ? bl[1] : "boq_assistant-bard-web-server_20260315.08_p0" };
}

function errorResponse(status, message) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error" } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", { baseUrl: GEMINI_URL });
  }

  async testConnection(credentials) {
    try {
      const raw = credentials?.apiKey || credentials?.cookie || "";
      const cookie = normalizeGeminiCookieInput(raw);
      if (!cookie) return false;
      return parseCookies(cookie).some((p) => p.value.length > 0);
    } catch {
      return false;
    }
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const bodyObj = body || {};
    const rawCreds = credentials || {};
    const cookie = normalizeGeminiCookieInput(rawCreds.apiKey || rawCreds.cookie || "");
    if (!cookie) {
      return {
        response: errorResponse(401, "Missing Gemini cookies (__Secure-1PSID)"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }
    const tools = bodyObj.tools;
    if (Array.isArray(tools) && tools.length > 0) {
      return {
        response: errorResponse(400, "Gemini Web does not support OpenAI function tools"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }
    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    const prompt = buildGeminiPrompt(messages);
    const hasUser = messages.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.trim().length > 0
    );
    if (!prompt || !hasUser) {
      return {
        response: errorResponse(400, "No user message found"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const modelId = String(model || bodyObj.model || "gemini-2.5-pro");

    let session;
    try {
      session = await fetchSessionParams(cookie);
    } catch (err) {
      return {
        response: errorResponse(502, `Gemini session fetch failed: ${err instanceof Error ? err.message : "unknown"}`),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }
    if (!session) {
      return {
        response: errorResponse(401, "Gemini cookie expired or invalid, re-copy __Secure-1PSID from gemini.google.com cookies"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const reqId = Math.floor(Math.random() * 900000) + 100000;
    const rpcBody = `[null,"${prompt.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"]`;
    const params = new URLSearchParams({
      bl: session.bl,
      _reqid: String(reqId),
      rt: "c",
    });

    let upstream;
    try {
      upstream = await fetch(
        `${STREAM_URL}?${params.toString()}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            Cookie: cookie,
            "User-Agent": GEMINI_USER_AGENT,
            Origin: "https://gemini.google.com",
            Referer: GEMINI_URL,
            "x-same-domain": "1",
          },
          body: `f.req=${encodeURIComponent(`[[["SnzQ9e",${JSON.stringify(rpcBody)},null,"generic"]]]`)}&at=${encodeURIComponent(session.at)}&`,
          signal: signal ?? undefined,
        }
      );
    } catch (err) {
      return {
        response: errorResponse(502, `Gemini fetch failed: ${err instanceof Error ? err.message : "unknown"}`),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      log?.error?.("GEMINI-WEB", `Upstream HTTP ${upstream.status}`);
      return {
        response: errorResponse(upstream.status, `Gemini error: ${errText.slice(0, 300)}`),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const raw = await upstream.text().catch(() => "");
    const responseText = parseStreamResponse(raw);
    if (!responseText) {
      return {
        response: errorResponse(502, "No response from Gemini (cookie may be expired or the web endpoint changed)"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    if (stream) {
      const encoder = new TextEncoder();
      const id = `chatcmpl-gwe-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      const chunk = (content, finish) => ({
        id,
        object: "chat.completion.chunk",
        created,
        model: modelId,
        choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }],
      });
      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk(responseText, null))}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk("", "stop"))}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return {
        response: new Response(readable, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    return {
      response: new Response(
        JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [
            { index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      url: GEMINI_URL,
      headers: {},
      transformedBody: body,
    };
  }
}
