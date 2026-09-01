import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const DEFAULT_ROOT = "https://gitlab.com";
const MAX_PROMPT = 24000;

function rootFor(credentials) {
  return String(
    credentials?.providerSpecificData?.baseUrl || DEFAULT_ROOT
  ).replace(/\/+$/, "");
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text") return String(part.text || "");
    return "";
  }).join("");
}

function renderMessages(messages) {
  if (!Array.isArray(messages)) return "";
  const rendered = messages.map((m) => {
    const role = String(m?.role || "user").toUpperCase();
    let text = textOf(m?.content);

    if (Array.isArray(m?.tool_calls) && m.tool_calls.length) {
      const calls = m.tool_calls.map((c) => ({
        id: c?.id,
        name: c?.function?.name,
        arguments: c?.function?.arguments,
      }));
      text += `\nTool calls: ${JSON.stringify(calls)}`;
    }

    if (m?.tool_call_id) {
      text = `Tool result (${m.tool_call_id}): ${text}`;
    }

    return `${role}: ${text}`;
  }).join("\n\n");

  return rendered.length > MAX_PROMPT
    ? rendered.slice(rendered.length - MAX_PROMPT)
    : rendered;
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({
    error: {
      message,
      type:
        status === 401 || status === 403
          ? "authentication_error"
          : status === 429
            ? "rate_limit_error"
            : "api_error",
    },
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extractCompletion(payload) {
  const first = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  return (
    first?.text ??
    first?.message?.content ??
    payload?.content ??
    payload?.completion ??
    payload?.text ??
    ""
  );
}

function openAIJson(content, model) {
  return {
    id: `chatcmpl-gitlab-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: String(content || "") },
      finish_reason: "stop",
    }],
  };
}

function openAIStream(content, model) {
  const id = `chatcmpl-gitlab-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{
      index: 0,
      delta: { role: "assistant", content: String(content || "") },
      finish_reason: null,
    }],
  };
  const end = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: "stop",
    }],
  };

  return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`;
}

export class GitLabDuoExecutor extends BaseExecutor {
  constructor() {
    super("gitlab-duo", {
      baseUrl: `${DEFAULT_ROOT}/api/v4/code_suggestions/completions`,
      timeoutMs: 120000,
    });
  }

  buildUrl(_model, _stream, _urlIndex = 0, credentials = null) {
    return `${rootFor(credentials)}/api/v4/code_suggestions/completions`;
  }

  buildHeaders(credentials) {
    const token = credentials?.accessToken || credentials?.apiKey;
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  transformRequest(_model, body, _stream, credentials) {
    const prompt = renderMessages(body?.messages);
    const psd = credentials?.providerSpecificData || {};
    const fileName =
      typeof psd.fileName === "string" && psd.fileName.trim()
        ? psd.fileName.trim()
        : "snippet.txt";

    return {
      current_file: {
        file_name: fileName,
        content_above_cursor: prompt,
        content_below_cursor: "",
      },
      intent: "generation",
      generation_type: "small_file",
      stream: false,
      ...(psd.projectPath ? { project_path: psd.projectPath } : {}),
      ...(prompt ? { user_instruction: prompt.slice(-4000) } : {}),
    };
  }

  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
    upstreamExtraHeaders = null,
  }) {
    if (!credentials?.accessToken && !credentials?.apiKey) {
      return { response: errorResponse(401, "GitLab Duo access token is required") };
    }

    const prompt = renderMessages(body?.messages);
    if (!prompt) {
      return { response: errorResponse(400, "GitLab Duo requires at least one message") };
    }

    const url = this.buildUrl(model, false, 0, credentials);
    const headers = this.buildHeaders(credentials);
    if (upstreamExtraHeaders && typeof upstreamExtraHeaders === "object") {
      Object.assign(headers, upstreamExtraHeaders);
    }

    const transformedBody = this.transformRequest(model, body, false, credentials);

    let upstream;
    try {
      upstream = await proxyAwareFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(transformedBody),
        signal,
      }, proxyOptions);
    } catch (error) {
      return {
        response: errorResponse(502, `GitLab Duo connection failed: ${error.message}`),
        url,
        headers,
        transformedBody,
      };
    }

    if (!upstream.ok) {
      const text = await upstream.text();
      return {
        response: errorResponse(
          upstream.status,
          upstream.status === 429
            ? "GitLab Duo rate limited the request"
            : `GitLab Duo request failed (${upstream.status}): ${text.slice(0, 1000)}`
        ),
        url,
        headers,
        transformedBody,
      };
    }

    const payload = await upstream.json();
    const content = extractCompletion(payload);

    const response = stream
      ? new Response(openAIStream(content, model), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      : new Response(JSON.stringify(openAIJson(content, model)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

    return { response, url, headers, transformedBody };
  }

  async refreshCredentials(credentials, log) {
    if (!credentials?.refreshToken) return null;

    const psd = credentials.providerSpecificData || {};
    const clientId = psd.clientId || process.env.GITLAB_DUO_OAUTH_CLIENT_ID || "";
    if (!clientId) return null;

    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: clientId,
    });

    const clientSecret =
      psd.clientSecret ||
      process.env.GITLAB_DUO_OAUTH_CLIENT_SECRET ||
      "";
    if (clientSecret) form.set("client_secret", clientSecret);

    try {
      const response = await fetch(`${rootFor(credentials)}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form,
      });
      if (!response.ok) return null;

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || credentials.refreshToken,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      log?.error?.("TOKEN", `GitLab Duo refresh error: ${error.message}`);
      return null;
    }
  }

  needsRefresh(credentials) {
    if (!credentials?.accessToken && credentials?.refreshToken) return true;
    return super.needsRefresh(credentials);
  }
}

export default GitLabDuoExecutor;
