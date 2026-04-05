import { platform, arch } from "os";
import { DefaultExecutor } from "./default.js";

/** portal.qwen.ai — aligned with CLIProxyAPI qwen_executor */
const qwenCodeVersion = "0.13.2";
const qwenStainless = {
  runtimeVersion: "v22.17.0",
  lang: "js",
  packageVersion: "5.11.0",
  retryCount: "0",
  runtime: "node"
};
const qwenDefaultSystemMessage = {
  role: "system",
  content: [{ type: "text", text: "", cache_control: { type: "ephemeral" } }]
};

function qwenStainlessOsLabel() {
  const p = platform();
  if (p === "darwin") return "MacOS";
  if (p === "win32") return "Windows";
  if (p === "linux") return "Linux";
  return p;
}

function qwenUserAgent() {
  return `QwenCode/${qwenCodeVersion} (${platform()}; ${arch()})`;
}

function ensureQwenSystemMessage(body) {
  if (!body || typeof body !== "object") return body;
  const next = { ...body };
  if (Array.isArray(next.messages)) {
    next.messages = [qwenDefaultSystemMessage, ...next.messages];
  } else {
    next.messages = [qwenDefaultSystemMessage];
  }
  return next;
}

function buildQwenUpstreamHeaders(credentials, stream = true) {
  const token = credentials?.apiKey || credentials?.accessToken || "";
  const ua = qwenUserAgent();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": ua,
    "X-DashScope-UserAgent": ua,
    "X-Stainless-Runtime-Version": qwenStainless.runtimeVersion,
    "X-Stainless-Lang": qwenStainless.lang,
    "X-Stainless-Arch": arch(),
    "X-Stainless-Package-Version": qwenStainless.packageVersion,
    "X-DashScope-CacheControl": "enable",
    "X-Stainless-Retry-Count": qwenStainless.retryCount,
    "X-Stainless-Os": qwenStainlessOsLabel(),
    "X-DashScope-AuthType": "qwen-oauth",
    "X-Stainless-Runtime": qwenStainless.runtime
  };
  headers.Accept = stream ? "text/event-stream" : "application/json";
  return headers;
}

export class QwenExecutor extends DefaultExecutor {
  constructor() {
    super("qwen");
  }

  buildHeaders(credentials, stream = true) {
    return buildQwenUpstreamHeaders(credentials, stream);
  }

  transformRequest(model, body, stream, credentials) {
    const next = body && typeof body === "object" ? { ...body } : body;
    if (stream && next?.messages && !next.stream_options) {
      next.stream_options = { include_usage: true };
    }
    return ensureQwenSystemMessage(next);
  }
}

export default QwenExecutor;
