// Ported faithfully from OmniRoute open-sse/executors/trae.ts.
// TraeExecutor — Trae's solo_agent_remote API (solo.trae.ai). JWT auth
// (Authorization: Cloud-IDE-JWT <token>), SSE events stream with plan_item
// cumulative thoughts. Self-contained (REST+SSE, no external deps).

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

// Inlined from OmniRoute base.ts (fork's BaseExecutor doesn't export it).
function mergeUpstreamExtraHeaders(headers, extra) {
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) headers[k] = v;
  }
}
// Inlined from OmniRoute utils/error.ts (fork doesn't export sanitizeErrorMessage).
function sanitizeErrorMessage(msg) {
  return String(msg ?? "").slice(0, 500);
}

const STREAM_TIMEOUT_MS = parseInt(process.env.TRAE_STREAM_TIMEOUT_MS || "300000", 10);

function flattenQuery(messages) {
  const parts = [];
  for (const m of messages) {
    let content = "";
    if (typeof m.content === "string") content = m.content;
    else if (Array.isArray(m.content)) {
      content = m.content
        .map((p) => {
          if (typeof p === "string") return p;
          if (p && typeof p === "object") return String(p.text ?? "");
          return "";
        })
        .join("");
    }
    if (m.role === "system") parts.push(`[System]\n${content}`);
    else if (m.role === "assistant") parts.push(`[Assistant]\n${content}`);
    else parts.push(content);
  }
  const text = parts.join("\n\n");
  return JSON.stringify([{ type: "text", data: { content: text } }]);
}

export class TraeExecutor extends BaseExecutor {
  constructor() {
    super("trae", PROVIDERS["trae"]);
  }

  base() {
    return (this.config.baseUrl || "https://core-normal.trae.ai/api/remote/v1").replace(/\/$/, "");
  }

  buildHeaders(credentials) {
    const token = credentials.accessToken || "";
    const psd = credentials.providerSpecificData || {};
    return {
      Authorization: `Cloud-IDE-JWT ${token}`,
      "Content-Type": "application/json",
      "X-Trae-Client-Type": "web",
      "X-Preferenced-Language": psd.appLanguage || "en",
      "x-user-region": psd.userRegion || "US",
      Referer: "https://solo.trae.ai/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    };
  }

  resolveMode(model) {
    const m = (model || "").trim().toLowerCase();
    if (m === "work" || m === "auto-work" || m === "solo-work") {
      return { mode: "work", strategy: "auto", modelName: "" };
    }
    const auto = !m || m === "auto";
    return { mode: "code", strategy: auto ? "auto" : "manual", modelName: auto ? "" : model };
  }

  commonParams(psd, mode, sessionId) {
    const cp = {
      language: "en-us",
      app_language: psd.appLanguage || "en",
      quality: "stable",
      app_version: psd.appVersion || "1.0.0.1229",
      web_id: psd.webId || "",
      user_identity: psd.userIdentity || "Free",
      is_freshman: "0",
      biz_user_id: psd.bizUserId || "",
      user_unique_id: psd.userUniqueId || "",
      scope: psd.scope || "marscode-us",
      tenant: psd.tenant || "marscode",
      region: psd.region || "US-East",
      aiRegion: psd.aiRegion || psd.region || "US-East",
      is_privacy_mode: 0,
      privacy_mode: "off",
      solo_chat_mode: mode,
    };
    if (sessionId) cp.biz_session_id = sessionId;
    return JSON.stringify(cp);
  }

  async createSession(headers, query, model, psd, signal) {
    const { mode, strategy, modelName } = this.resolveMode(model);
    const body = {
      mode,
      environment_id: "default",
      initial_message: {
        chat_session_id: "",
        content: [],
        query,
        model_name: modelName,
        agent_type: "solo_agent_remote",
        model_selection_strategy: strategy,
        common_params: this.commonParams(psd, mode),
      },
      env: "remote",
      auto_create_project: false,
      origin: "web",
    };
    const res = await fetch(`${this.base()}/chat_sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal || undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`[${res.status}] ${text}`);
    const json = JSON.parse(text);
    if (json?.code !== 0) throw new Error(`Trae create_session: ${JSON.stringify(json)}`);
    return { sessionId: json.data.chat_session_id, messageId: json.data.message_id };
  }

  async streamEvents(headers, sessionId, replyTo, onEvent, signal) {
    const url = `${this.base()}/chat_sessions/${sessionId}/events?reply_to_message_id=${encodeURIComponent(replyTo)}`;
    const ctrl = new AbortController();
    if (signal?.aborted) ctrl.abort();
    const timer = setTimeout(() => ctrl.abort(new Error("trae stream timeout")), STREAM_TIMEOUT_MS);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, { method: "GET", headers, signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`[${res.status}] events stream failed`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let ev = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            let data;
            try {
              data = JSON.parse(payload);
            } catch {
              data = { _raw: payload };
            }
            if (onEvent(ev, data)) {
              await reader.cancel().catch(() => {});
              return;
            }
          } else if (line === "") ev = null;
        }
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  async execute({ model, body, stream, credentials, signal, upstreamExtraHeaders }) {
    const headers = this.buildHeaders(credentials);
    mergeUpstreamExtraHeaders(headers, upstreamExtraHeaders);
    const psd = credentials.providerSpecificData || {};
    const reqBody = body;
    const query = flattenQuery(reqBody.messages || []);
    const responseId = `chatcmpl-trae-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const errResponse = (status, message) =>
      new Response(
        JSON.stringify({ error: { message: sanitizeErrorMessage(message), type: "api_error", code: "" } }),
        { status, headers: { "Content-Type": "application/json" } }
      );

    let session;
    try {
      session = await this.createSession(headers, query, model, psd, signal);
    } catch (err) {
      return { response: errResponse(502, err instanceof Error ? err.message : String(err)), url: this.base(), headers, transformedBody: body };
    }

    const order = [];
    const thoughts = {};
    let sent = 0;
    let usage = null;
    let errorEvent = null;
    const renderNewText = (data) => {
      const pid = data.id;
      if (!pid) return "";
      if (!(pid in thoughts)) order.push(pid);
      const t = data.thought || "";
      if (t.length >= (thoughts[pid] || "").length) thoughts[pid] = t;
      const full = order.map((i) => thoughts[i]).join("");
      const piece = full.slice(sent);
      sent = full.length;
      return piece;
    };

    if (stream !== false) {
      const enc = new TextEncoder();
      const sse = new ReadableStream({
        async start(controller) {
          const emit = (obj) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
          try {
            emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
            await this.streamEvents(
              headers,
              session.sessionId,
              session.messageId,
              (ev, data) => {
                if (ev === "error") { errorEvent = data; return true; }
                if (ev === "token_usage") usage = data;
                if (ev === "plan_item") {
                  const piece = renderNewText(data);
                  if (piece) emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
                }
                return ev === "done";
              },
              signal
            );
            if (errorEvent) {
              emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [], error: { message: `trae ${errorEvent.code}: ${errorEvent.message}`, type: "api_error" } });
            } else {
              emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
              if (usage) emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [], usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 } });
            }
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });
      return {
        response: new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
        url: this.base(), headers, transformedBody: body,
      };
    }

    // Non-streaming
    try {
      await this.streamEvents(
        headers, session.sessionId, session.messageId,
        (ev, data) => { if (ev === "error") { errorEvent = data; return true; } if (ev === "token_usage") usage = data; if (ev === "plan_item") renderNewText(data); return ev === "done"; },
        signal
      );
    } catch (err) {
      return { response: errResponse(502, err instanceof Error ? err.message : String(err)), url: this.base(), headers, transformedBody: body };
    }
    if (errorEvent) {
      return { response: errResponse(502, `trae ${errorEvent.code}: ${errorEvent.message}`), url: this.base(), headers, transformedBody: body };
    }
    const content = order.map((i) => thoughts[i]).join("");
    const out = { id: responseId, object: "chat.completion", created, model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
    if (usage) out.usage = { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 };
    return { response: new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } }), url: this.base(), headers, transformedBody: body };
  }

  async refreshCredentials(credentials) {
    const psd = credentials?.providerSpecificData || {};
    const refreshToken = credentials?.refreshToken;
    if (!refreshToken) return null;
    const host = ((psd.host) || "https://api-us-east.trae.ai").replace(/\/$/, "");
    const clientId = psd.clientId || "en1oxy7wnw8j9n";
    const url = `${host}/cloudide/api/v3/trae/oauth/ExchangeToken`;
    const body = { ClientID: clientId, RefreshToken: refreshToken, ClientSecret: "-", UserID: "" };

    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Trae ExchangeToken HTTP ${res.status}: ${text.slice(0, 200)}`);
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error("Trae ExchangeToken: response was not JSON"); }
    const errCode = parsed?.ResponseMetadata?.Error?.Code;
    if (errCode) throw new Error(`Trae ExchangeToken error: ${errCode}`);
    const result = parsed?.Result;
    if (!result?.Token) throw new Error("Trae ExchangeToken: response missing Result.Token");
    return {
      accessToken: result.Token,
      refreshToken: result.RefreshToken || refreshToken,
      expiresAt: result.TokenExpireAt ? new Date(Number(result.TokenExpireAt)).toISOString() : undefined,
    };
  }
}

export default TraeExecutor;
