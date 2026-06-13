import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { createHash } from "crypto";
import os from "os";

const BOOTSTRAP_URL = "https://api.xiaomimimo.com/api/free-ai/bootstrap";
const CHAT_URL = "https://api.xiaomimimo.com/api/free-ai/openai/chat";
const SESSION_AFFINITY_PREFIX = "ses_";

// In-memory JWT cache
let cachedJwt = null;
let jwtExpiresAt = 0;

function getClientFingerprint() {
  const cpu = os.cpus()[0]?.model ?? "unknown-cpu";
  const username = os.userInfo().username;
  const seed = [os.hostname(), process.platform, process.arch, cpu, username].join("|");
  const fingerprint = createHash("sha256").update(seed).digest("hex");
  return fingerprint;
}

function getJwtExpiry(jwt) {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return 0;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    if (payload && typeof payload.exp === "number") {
      return payload.exp * 1000; // Convert to milliseconds
    }
  } catch (e) {
    // ignore
  }
  return 0;
}

function generateSessionId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = SESSION_AFFINITY_PREFIX;
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

async function bootstrapJwt(proxyOptions = null) {
  // Return cached JWT if still valid (with 5-minute buffer)
  if (cachedJwt && Date.now() < jwtExpiresAt - 300000) {
    return cachedJwt;
  }

  const clientHash = getClientFingerprint();
  const response = await proxyAwareFetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "mimocode/latest/local/cli",
      "Accept": "*/*",
    },
    body: JSON.stringify({ client: clientHash }),
  }, proxyOptions);

  if (!response.ok) {
    throw new Error(`MiMo bootstrap failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.jwt) {
    throw new Error("MiMo bootstrap returned no JWT");
  }

  cachedJwt = data.jwt;
  const expiry = getJwtExpiry(data.jwt);
  jwtExpiresAt = expiry || (Date.now() + 3600000); // fallback to 1 hour cache

  return cachedJwt;
}

export class MimoFreeExecutor extends BaseExecutor {
  constructor() {
    super("mimo-free", PROVIDERS["mimo-free"]);
    this.sessionId = generateSessionId();
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return CHAT_URL;
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "X-Mimo-Source": "mimocode-cli-free",
      "x-session-affinity": this.sessionId,
      "User-Agent": "mimocode/latest/local/cli",
      "HTTP-Referer": "https://mimo.xiaomi.com/coder/",
      "Referer": "https://mimo.xiaomi.com/coder/",
      "x-opencode-client": "cli",
      "Accept": stream ? "text/event-stream" : "application/json",
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    // Get JWT via bootstrap
    let jwt;
    try {
      jwt = await bootstrapJwt(proxyOptions);
    } catch (error) {
      log?.error?.("AUTH", `MiMo bootstrap failed: ${error.message}`);
      throw error;
    }

    const url = this.buildUrl(model, stream);
    const transformedBody = this.transformRequest(model, body);
    const headers = {
      ...this.buildHeaders(credentials, stream),
      "Authorization": `Bearer ${jwt}`,
    };

    const bodyStr = JSON.stringify(transformedBody);
    log?.debug?.("FETCH", `MIMO-FREE → ${url} | body=${bodyStr.length}B`);

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
      signal,
    }, proxyOptions);

    // If 401, invalidate cache and retry once
    if (response.status === 401) {
      log?.debug?.("AUTH", "MiMo JWT expired, re-bootstrapping...");
      cachedJwt = null;
      jwtExpiresAt = 0;
      try {
        jwt = await bootstrapJwt(proxyOptions);
      } catch (error) {
        throw error;
      }
      headers["Authorization"] = `Bearer ${jwt}`;
      const retryResponse = await proxyAwareFetch(url, {
        method: "POST",
        headers,
        body: bodyStr,
        signal,
      }, proxyOptions);
      return { response: retryResponse, url, headers, transformedBody };
    }

    return { response, url, headers, transformedBody };
  }

  transformRequest(model, body) {
    const transformed = { ...body };
    if (!transformed.messages) {
      transformed.messages = [];
    }

    const signature = "You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.";
    const hasSignature = transformed.messages.some(msg => 
      msg.role === "system" && msg.content && msg.content.includes(signature)
    );

    if (!hasSignature) {
      const systemIndex = transformed.messages.findIndex(msg => msg.role === "system");
      if (systemIndex !== -1) {
        const currentContent = transformed.messages[systemIndex].content || "";
        transformed.messages[systemIndex].content = currentContent ? `${signature}\n${currentContent}` : signature;
      } else {
        transformed.messages.unshift({
          role: "system",
          content: signature
        });
      }
    }

    transformed.model = "mimo-auto";
    return transformed;
  }
}

export default MimoFreeExecutor;
