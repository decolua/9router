import { randomUUID, randomBytes, createHash } from "node:crypto";
import { release } from "node:os";
import { DefaultExecutor } from "./default.js";
import { refreshZcodeJwt, resolveZcodeAuth } from "../services/zcodePlan.js";
import { ZCODE_SYSTEM_PROMPTS } from "../services/zcodePrompt.js";

const ZCODE_APP_VERSION = "3.17.1";
const ZCODE_THIRD_SYSTEM_BLOCK = "Follow the user's instructions and use the available tools when helpful.";

function platformTag() {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  return { platform: `${process.platform}-${process.arch}`, category: os };
}

function sessionTag(connectionId, salt = "") {
  const hash = createHash("sha256").update(`${connectionId || "zcode"}:${salt}`).digest("hex");
  return `session_${hash.slice(0, 32)}`;
}

// The desktop client sends a time-ordered UUIDv7 as x-query-id; random v4 ids
// stand out from its traffic profile.
function uuidv7() {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// The plan gateway only accepts the desktop client's three-block system shape;
// a fourth block is answered with HTTP 405 code 3012. Fold every client system
// block (plus any system-role messages) into the single third block so the
// request always carries at most [prompt, prompt, client system].
function alignZcodeSystem(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const parts = [];
  const existing = body.system;
  if (Array.isArray(existing)) {
    for (const block of existing) {
      const text = typeof block === "string" ? block : block?.type === "text" ? block.text : "";
      if (typeof text === "string" && text) parts.push(text);
    }
  } else if (typeof existing === "string" && existing) {
    parts.push(existing);
  }

  const messages = [];
  let hadSystemMessages = false;
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (message && message.role === "system") {
        hadSystemMessages = true;
        if (Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block && block.type === "text" && block.text) parts.push(block.text);
          }
        } else if (typeof message.content === "string" && message.content) {
          parts.push(message.content);
        }
      } else {
        messages.push(message);
      }
    }
  }

  const blocks = ZCODE_SYSTEM_PROMPTS.map((text) => ({ type: "text", text }));
  blocks.push({ type: "text", text: parts.length ? parts.join("\n\n") : ZCODE_THIRD_SYSTEM_BLOCK });
  const next = { ...body, system: blocks };
  if (hadSystemMessages) next.messages = messages;
  return next;
}

// Carry the account identity on the start-plan body (the thinking shape and
// output_config.effort are produced by the unified thinking translator).
function withStartPlanOptions(body, accountUserId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? { ...body.metadata }
    : {};
  if (accountUserId) metadata.user_id = accountUserId;
  return Object.keys(metadata).length ? { ...body, metadata } : body;
}

// The start-plan gateway fingerprints the stock ZCode system prompt and rejects
// other shapes with HTTP 405 "unusual activity". Prepend the real blocks while
// keeping the caller's own system content after them, and keep the thinking
// shape identical to the desktop client ({"type":"enabled"}, no budget/display).
function withStartPlanSystem(body, accountUserId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const blocks = ZCODE_SYSTEM_PROMPTS.map((text) => ({ type: "text", text }));
  const existing = body.system;

  let next = body;
  if (Array.isArray(existing)) {
    const present = new Set(
      existing
        .map((entry) => (typeof entry === "string" ? entry : entry?.text))
        .filter((text) => typeof text === "string")
    );
    if (!ZCODE_SYSTEM_PROMPTS.every((text) => present.has(text))) {
      next = { ...body, system: [...blocks, ...existing] };
    }
  } else if (typeof existing === "string" && existing.trim()) {
    next = { ...body, system: [...blocks, { type: "text", text: existing }] };
  } else if (!Array.isArray(existing)) {
    next = { ...body, system: blocks };
  }

  const thinking = next.thinking;
  if (thinking && typeof thinking === "object" && !Array.isArray(thinking)) {
    const type = String(thinking.type || "").toLowerCase();
    if (type === "enabled" || type === "adaptive") next = { ...next, thinking: { type: "enabled" } };
    else if (type === "disabled") next = { ...next, thinking: { type: "disabled" } };
  }

  // The desktop body carries the account identity and a max effort hint; both
  // are part of what the edge sees on genuine traffic.
  const metadata = next.metadata && typeof next.metadata === "object" && !Array.isArray(next.metadata)
    ? { ...next.metadata }
    : {};
  if (accountUserId) metadata.user_id = accountUserId;
  if (Object.keys(metadata).length) next = { ...next, metadata };
  if (next.output_config === undefined) next = { ...next, output_config: { effort: "max" } };

  return next;
}

function isGatewayActivityBlock(response) {
  if (response?.status !== 405) return false;
  return response
    .clone()
    .text()
    .then((text) => /"code"\s*:\s*"?3012"?/.test(text) || /unusual activity/i.test(text))
    .catch(() => false);
}

// The plan gateway reports business failures inside an HTTP 200 JSON envelope
// (e.g. {"code":1005,"msg":"exceed quota limit"}); surface them as real errors
// so the router can fail over instead of streaming an empty body.
export function normalizeStartPlanResponse(response) {
  const contentType = response?.headers?.get?.("content-type") || "";
  if (!response?.ok || contentType.includes("event-stream") || !contentType.includes("json")) {
    return response;
  }
  return response
    .clone()
    .text()
    .then((text) => {
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        return response;
      }
      const code = typeof json?.code === "number" ? json.code : null;
      const failed = (code !== null && code !== 0 && code !== 200) || json?.success === false || json?.type === "error";
      if (!failed) return response;
      const message = json?.msg || json?.message || json?.error?.message || text;
      const status = code === 1005 ? 429 : code === 3006 || code === 3001 ? 400 : 502;
      return new Response(text, { status, statusText: String(message).slice(0, 120), headers: response.headers });
    })
    .catch(() => response);
}

export class ZCodeExecutor extends DefaultExecutor {
  constructor() {
    super("zcode");
  }

  async execute(args) {
    const resolved = await resolveZcodeAuth(args.credentials, { log: args.log });
    if (args.credentials) {
      args.credentials.providerSpecificData = {
        ...(args.credentials.providerSpecificData || {}),
        ...resolved.persist,
        __zcodeAuth: resolved,
      };
    }

    let result = await super.execute(args);
    result.response = await normalizeStartPlanResponse(result.response);

    // The edge occasionally answers a legitimate start-plan request with a
    // transient 405/3012 anti-abuse block. Retry twice with backoff and a fresh
    // session id so a session-keyed window clears without touching the body.
    if (resolved.lane === "start") {
      const backoffMs = [2000, 8000];
      for (let attempt = 0; attempt < backoffMs.length; attempt += 1) {
        if (!(await isGatewayActivityBlock(result.response))) break;
        try {
          await result.response.body?.cancel?.();
        } catch {
          // Already consumed/closed.
        }
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
        if (args.credentials) {
          args.credentials.providerSpecificData = {
            ...(args.credentials.providerSpecificData || {}),
            __zcodeSessionSalt: randomBytes(8).toString("hex"),
          };
        }
        result = await super.execute(args);
        result.response = await normalizeStartPlanResponse(result.response);
      }
    }

    return result;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const resolved = credentials?.providerSpecificData?.__zcodeAuth;
    const base = resolved?.baseUrl || credentials?.providerSpecificData?.zcodeBaseUrl || this.config.baseUrl;
    return `${base.replace(/\/$/, "")}/v1/messages`;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    const aligned = alignZcodeSystem(transformed);
    const resolved = credentials?.providerSpecificData?.__zcodeAuth;
    if (resolved?.lane === "start") {
      return withStartPlanOptions(aligned, credentials?.providerSpecificData?.userId);
    }
    return aligned;
  }

  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);
    const resolved = credentials?.providerSpecificData?.__zcodeAuth;
    const apiKey = resolved?.apiKey || credentials?.apiKey || credentials?.accessToken;
    if (apiKey) {
      if (resolved?.lane === "start") {
        // The plan gateway expects the raw zcode JWT as a Bearer token only;
        // an extra x-api-key is answered with the same 405 block as unknown clients.
        delete headers["x-api-key"];
        headers.Authorization = `Bearer ${apiKey}`;
      } else {
        // Project tokens are accepted with both headers on api.z.ai.
        headers["x-api-key"] = apiKey;
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    const version = resolved?.clientVersion || ZCODE_APP_VERSION;
    const { platform, category } = platformTag();
    const sessionId = sessionTag(credentials?.connectionId, credentials?.providerSpecificData?.__zcodeSessionSalt);
    Object.assign(headers, {
      "HTTP-Referer": "https://zcode.z.ai",
      "User-Agent": `ZCode/${version}`,
      "x-zcode-app-version": version,
      "x-title": "Z Code@electron",
      "x-release-channel": "production",
      "x-client-language": "en-US",
      "x-client-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      "x-zcode-agent": "glm",
      "x-platform": platform,
      "x-os-category": category,
      "x-os-version": release(),
      "x-request-id": randomUUID(),
      "x-zcode-session-type": "main",
      "x-zcode-trace-id": randomUUID(),
      "x-query-id": uuidv7(),
      "x-zcode-query-source": "main_turn",
      "x-session-id": sessionId,
    });

    if (resolved?.headers) Object.assign(headers, resolved.headers);
    return headers;
  }

  async refreshCredentials(credentials, log) {
    const psd = credentials?.providerSpecificData || {};
    const family = psd.family === "bigmodel" ? "bigmodel" : "zai";
    if (family !== "zai" || !psd.oauthAccessToken) return null;

    try {
      const refreshed = await refreshZcodeJwt(psd.oauthAccessToken, { log });
      if (!refreshed?.zcodeJwtToken) return null;

      const nextPsd = { ...psd, zcodeJwtToken: refreshed.zcodeJwtToken };
      const resolved = await resolveZcodeAuth(
        { ...credentials, providerSpecificData: nextPsd },
        { log, force: true }
      );

      return {
        // chatCore only retries after a refresh that carries a token; the
        // access token itself is unchanged, the refreshed zcode JWT rides in psd.
        accessToken: credentials.accessToken,
        providerSpecificData: { ...nextPsd, ...resolved.persist },
      };
    } catch (error) {
      // The business token is optional for start-plan traffic; a failed
      // rotation must not break usage/quota reads.
      log?.debug?.("ZCODE", `credential refresh skipped: ${error?.message || error}`);
      return null;
    }
  }
}

export default ZCodeExecutor;
