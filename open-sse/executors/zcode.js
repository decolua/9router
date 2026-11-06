import { randomUUID, randomBytes, createHash } from "node:crypto";
import { release } from "node:os";
import { DefaultExecutor } from "./default.js";
import { refreshZcodeJwt, resolveZcodeAuth } from "../services/zcodePlan.js";
import { ZCODE_SYSTEM_PROMPTS } from "../services/zcodePrompt.js";
import { zcodeTlsFetch } from "../services/zcodeTlsClient.js";
import { hasNativeZcodeBinary, forwardToZcodeDaemon } from "../services/zcodeServiceBridge.js";
import { FORMATS } from "../translator/formats.js";

const ZCODE_APP_VERSION = "3.16.3";
const ZCODE_THIRD_SYSTEM_BLOCK = "Follow the user's instructions and use the available tools when helpful.";

function platformTag() {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  return { platform: `${process.platform}-${process.arch}`, category: os };
}

function stableDeviceMid(credentials) {
  const seed = String(credentials?.providerSpecificData?.userId || credentials?.connectionId || credentials?.id || "zcode");
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

// Convert OpenAI-style tools to Anthropic-style tools
function normalizeZcodeTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const result = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    const fn = tool.function || (tool.type === "function" ? tool : null);
    const name = (fn?.name || tool.name || "").trim();
    if (!name) continue;
    const description = fn?.description || tool.description || "";
    const rawSchema = fn?.parameters || tool.input_schema || tool.parameters || { type: "object", properties: {} };
    const input_schema = typeof rawSchema === "object" && rawSchema !== null ? { ...rawSchema } : { type: "object", properties: {} };
    delete input_schema.strict;
    delete input_schema.$schema;

    result.push({
      name,
      ...(description ? { description } : {}),
      input_schema,
    });
  }
  return result.length > 0 ? result : undefined;
}

// Convert OpenAI tool_choice to Anthropic tool_choice
function normalizeZcodeToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === "string") {
    if (toolChoice === "auto") return { type: "auto" };
    if (toolChoice === "required") return { type: "any" };
    if (toolChoice === "none") return undefined;
    return undefined;
  }
  if (typeof toolChoice === "object" && !Array.isArray(toolChoice)) {
    if (toolChoice.type === "function" && (toolChoice.function?.name || toolChoice.name)) {
      return { type: "tool", name: toolChoice.function?.name || toolChoice.name };
    }
    if (toolChoice.type === "tool" && toolChoice.name) {
      return toolChoice;
    }
    if (["auto", "any"].includes(toolChoice.type)) {
      return toolChoice;
    }
  }
  return undefined;
}

// Convert OpenAI tool messages & assistant tool_calls to Anthropic blocks
function normalizeZcodeMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  const result = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;

    // Preserve system messages for alignZcodeSystem
    if (msg.role === "system") {
      result.push(msg);
      continue;
    }

    // Role: 'tool' (OpenAI tool output) -> Anthropic user message with tool_result block
    if (msg.role === "tool") {
      const toolUseId = msg.tool_call_id || msg.id || "call_unknown";
      let content = msg.content;
      if (typeof content !== "string") {
        try {
          content = JSON.stringify(content ?? "");
        } catch {
          content = String(content ?? "");
        }
      }
      result.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content,
          },
        ],
      });
      continue;
    }

    // Role: 'assistant' with tool_calls
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const blocks = [];
      if (typeof msg.content === "string" && msg.content) {
        blocks.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part === "object") blocks.push(part);
        }
      }

      for (const tc of msg.tool_calls) {
        const fn = tc.function || tc;
        let input = {};
        if (typeof fn.arguments === "string") {
          try {
            input = JSON.parse(fn.arguments);
          } catch {
            input = { raw: fn.arguments };
          }
        } else if (typeof fn.arguments === "object" && fn.arguments !== null) {
          input = fn.arguments;
        }
        blocks.push({
          type: "tool_use",
          id: tc.id || `call_${randomUUID().slice(0, 8)}`,
          name: fn.name || "unknown_tool",
          input,
        });
      }

      result.push({
        role: "assistant",
        content: blocks,
      });
      continue;
    }

    result.push(msg);
  }

  // Anthropic requires strictly alternating user/assistant messages after system is stripped
  const merged = [];
  for (const msg of result) {
    if (msg.role === "system") {
      merged.push(msg);
      continue;
    }
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role && last.role !== "system") {
      const toBlocks = (c) => {
        if (typeof c === "string") return [{ type: "text", text: c }];
        if (Array.isArray(c)) return c;
        return [{ type: "text", text: String(c ?? "") }];
      };
      last.content = [...toBlocks(last.content), ...toBlocks(msg.content)];
    } else {
      merged.push(msg);
    }
  }

  return merged;
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
function withStartPlanOptions(body, accountUserId, deviceMid = "", sessionId = "") {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? { ...body.metadata }
    : {};

  metadata.user_id = JSON.stringify({
    device_id: deviceMid || accountUserId || "unknown",
    account_uuid: "",
    session_id: sessionId || "",
  });

  return { ...body, metadata };
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
      // Map 1005 (quota) AND 3009 (concurrency limit) to 429 so router fails over
      const status = (code === 1005 || code === 3009) ? 429 : code === 3006 || code === 3001 ? 400 : 502;
      return new Response(text, { status, statusText: String(message).slice(0, 120), headers: response.headers });
    })
    .catch(() => response);
}

class KeyedMutex {
  constructor() {
    this.chains = new Map();
  }

  async acquire(key, signal) {
    if (signal?.aborted) {
      throw new Error("Request aborted before acquiring lock");
    }

    let releaseCurrent;
    const currentPromise = new Promise((resolve) => {
      releaseCurrent = resolve;
    });

    const previousPromise = this.chains.get(key) || Promise.resolve();
    this.chains.set(key, previousPromise.then(() => currentPromise, () => currentPromise));

    let abortListener;
    try {
      if (signal) {
        await Promise.race([
          previousPromise,
          new Promise((_, reject) => {
            abortListener = () => reject(new Error("Request aborted in queue"));
            signal.addEventListener("abort", abortListener, { once: true });
          }),
        ]);
      } else {
        await previousPromise;
      }
    } catch (err) {
      releaseCurrent();
      if (this.chains.get(key) === currentPromise) {
        this.chains.delete(key);
      }
      throw err;
    } finally {
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    }

    let released = false;
    return () => {
      if (!released) {
        released = true;
        // Pacing delay 1500ms before next queued request can acquire
        setTimeout(() => {
          releaseCurrent();
          if (this.chains.get(key) === currentPromise) {
            this.chains.delete(key);
          }
        }, 1500);
      }
    };
  }
}

const zcodeMutex = new KeyedMutex();

function hookStreamRelease(response, release, abortCtrl) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") {
    release();
    return response;
  }

  const reader = body.getReader();
  let doneOrCancelled = false;

  const doRelease = () => {
    if (!doneOrCancelled) {
      doneOrCancelled = true;
      release();
    }
  };

  const hookedBody = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          doRelease();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        doRelease();
        controller.error(err);
      }
    },
    async cancel(reason) {
      try {
        abortCtrl?.abort(reason || "client_cancelled");
        await reader.cancel(reason);
      } catch {
        // ignore
      } finally {
        doRelease();
      }
    }
  });

  return new Response(hookedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export class ZCodeExecutor extends DefaultExecutor {
  constructor(providerName = "zcode") {
    super(providerName);
  }

  async execute(args) {
    const lockKey = String(
      args.credentials?.providerSpecificData?.userId ||
      args.credentials?.providerSpecificData?.zcodeJwtToken ||
      args.credentials?.accessToken ||
      args.credentials?.apiKey ||
      args.credentials?.connectionId ||
      "zcode_default"
    );

    const upstreamAbortCtrl = new AbortController();
    if (args.signal) {
      if (args.signal.aborted) {
        upstreamAbortCtrl.abort(args.signal.reason);
      } else {
        args.signal.addEventListener("abort", () => upstreamAbortCtrl.abort(args.signal.reason), { once: true });
      }
    }

    const releaseLock = await zcodeMutex.acquire(lockKey, upstreamAbortCtrl.signal);
    let releaseCalled = false;
    const safeRelease = () => {
      if (!releaseCalled) {
        releaseCalled = true;
        releaseLock();
      }
    };

    try {
      const resolved = await resolveZcodeAuth(args.credentials, { log: args.log });
      if (args.credentials) {
        args.credentials.providerSpecificData = {
          ...(args.credentials.providerSpecificData || {}),
          ...resolved.persist,
          __zcodeAuth: resolved,
        };
      }

      const proxyOptions = args.proxyOptions;
      const proxyUrl = (proxyOptions?.connectionProxyEnabled && proxyOptions?.connectionProxyUrl)
        ? proxyOptions.connectionProxyUrl
        : (args.credentials?.providerSpecificData?.connectionProxyEnabled && args.credentials?.providerSpecificData?.connectionProxyUrl)
          ? args.credentials.providerSpecificData.connectionProxyUrl
          : "";

      // OPTION B: If native stripped ZCode binary engine is present and no proxy required,
      // execute via native ZCode headless daemon bridge on port 29999.
      const customFetch = (url, options, extra = {}) => {
        const p = extra?.proxyUrl || options?.proxyUrl || proxyUrl;
        if (!p && hasNativeZcodeBinary()) {
          return forwardToZcodeDaemon(url, options.headers, options.body, options.signal).catch((err) => {
            console.warn("[ZCodeExecutor] Native binary daemon failed, falling back to zcodeTlsFetch:", err.message);
            return zcodeTlsFetch(url, {
              method: options.method,
              headers: options.headers,
              body: options.body,
            }, {
              signal: options.signal,
              proxy: p,
              timeoutMs: args.stream ? 0 : undefined,
            });
          });
        }
        return zcodeTlsFetch(url, {
          method: options.method,
          headers: options.headers,
          body: options.body,
        }, {
          signal: options.signal,
          proxy: p,
          timeoutMs: args.stream ? 0 : undefined,
        });
      };

      const execArgs = {
        ...args,
        signal: upstreamAbortCtrl.signal,
        directFetch: customFetch,
        directFetchProxy: true,
      };

      let result = await super.execute(execArgs);
      result.response = await normalizeStartPlanResponse(result.response);
      result.responseFormat = FORMATS.CLAUDE;

      // The edge occasionally answers a legitimate start-plan request with a
      // transient 405/3012 anti-abuse block. Retry with backoff and a fresh
      // session id and device mid.
      if (resolved.lane === "start") {
        const backoffMs = [2000, 6000];
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
              userId: randomUUID(),
            };
          }
          result = await super.execute(execArgs);
          result.response = await normalizeStartPlanResponse(result.response);
          result.responseFormat = FORMATS.CLAUDE;
        }
      }

      if (!result?.response?.ok) {
        safeRelease();
        return result;
      }

      result.response = hookStreamRelease(result.response, safeRelease, upstreamAbortCtrl);
      return result;
    } catch (err) {
      safeRelease();
      throw err;
    }
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const resolved = credentials?.providerSpecificData?.__zcodeAuth;
    const base = resolved?.baseUrl || credentials?.providerSpecificData?.zcodeBaseUrl || this.config.baseUrl;
    return `${base.replace(/\/$/, "")}/v1/messages`;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (transformed && typeof transformed === "object") {
      const rawModel = transformed?.model || model || "GLM-5.3-Flash";
      if (typeof rawModel === "string") {
        const lower = rawModel.toLowerCase();
        if (lower.includes("flash")) transformed.model = "GLM-5.3-Flash";
        else if (lower.includes("5.2")) transformed.model = "GLM-5.2";
        else if (lower.includes("turbo")) transformed.model = "GLM-5-Turbo";
        else if (lower.includes("5.3")) transformed.model = "GLM-5.3";
        else transformed.model = "GLM-5.3-Flash";
      }
    }

    // Normalize messages if needed (tool results, assistant tool_calls, alternating roles)
    if (Array.isArray(transformed.messages)) {
      transformed.messages = normalizeZcodeMessages(transformed.messages);
    }

    const aligned = alignZcodeSystem(transformed);
    delete aligned.context_management;

    // Normalize tools to Anthropic schema
    if (Array.isArray(aligned.tools)) {
      aligned.tools = normalizeZcodeTools(aligned.tools);
    }

    // Normalize tool_choice
    if (aligned.tool_choice) {
      aligned.tool_choice = normalizeZcodeToolChoice(aligned.tool_choice);
    }

    // Anthropic requirement: max_tokens must be set
    aligned.max_tokens = aligned.max_tokens || aligned.max_completion_tokens || 4096;
    delete aligned.max_completion_tokens;

    // Strip OpenAI-only fields
    delete aligned.stream_options;
    delete aligned.presence_penalty;
    delete aligned.frequency_penalty;
    delete aligned.logit_bias;
    delete aligned.user;
    delete aligned.n;
    delete aligned.seed;

    const resolved = credentials?.providerSpecificData?.__zcodeAuth;
    if (resolved?.lane === "start") {
      const mid = stableDeviceMid(credentials);
      const sid = sessionTag(credentials?.connectionId, credentials?.providerSpecificData?.__zcodeSessionSalt);
      return withStartPlanOptions(aligned, credentials?.providerSpecificData?.userId, mid, sid);
    }
    return aligned;
  }

  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);
    delete headers["anthropic-beta"];
    delete headers["Anthropic-Beta"];
    const resolved = credentials?.providerSpecificData?.__zcodeAuth;
    const apiKey = resolved?.apiKey || credentials?.apiKey || credentials?.accessToken;
    if (apiKey) {
      if (resolved?.lane === "start") {
        delete headers["x-api-key"];
        headers.Authorization = `Bearer ${apiKey}`;
      } else {
        headers["x-api-key"] = apiKey;
        headers.Authorization = `Bearer ${apiKey}`;
        const zcodeJwt = credentials?.providerSpecificData?.zcodeJwtToken;
        if (zcodeJwt) {
          headers["X-ZCode-Authorization"] = `Bearer ${zcodeJwt}`;
        }
      }
    }

    const version = resolved?.clientVersion || ZCODE_APP_VERSION;
    const { platform, category } = platformTag();
    const sessionId = sessionTag(credentials?.connectionId, credentials?.providerSpecificData?.__zcodeSessionSalt);

    if (credentials?.providerSpecificData?.__daemonTargetBaseUrl) {
      headers["x-target-base-url"] = credentials.providerSpecificData.__daemonTargetBaseUrl;
      headers["x-user-id"] = credentials.providerSpecificData.userId || "";
      headers["x-device-mid"] = stableDeviceMid(credentials);
    }

    if (resolved?.lane === "start") {
      // Start Plan gateway requires the lightweight 4-header client profile with 3.16.3 UA
      Object.assign(headers, {
        "User-Agent": `ZCode/${version} ai-sdk/anthropic/3.0.81`,
      });
      delete headers["anthropic-beta"];
      delete headers["Anthropic-Beta"];
    } else {
      Object.assign(headers, {
        "Origin": "https://zcode.z.ai",
        "Referer": "https://zcode.z.ai/",
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
        "x-device-mid": stableDeviceMid(credentials),
        "x-zcode-session-type": "main",
        "x-zcode-trace-id": randomUUID(),
        "x-query-id": uuidv7(),
        "x-zcode-query-source": "main_turn",
        "x-session-id": sessionId,
      });
    }

    if (resolved?.headers) Object.assign(headers, resolved.headers);
    return headers;
  }

  async refreshCredentials(credentials, log) {
    const psd = credentials?.providerSpecificData || {};
    const family = psd.family === "bigmodel" ? "bigmodel" : "zai";
    const businessToken = psd.oauthAccessToken || credentials?.accessToken;
    if (family !== "zai" || !businessToken) return null;

    try {
      const refreshed = await refreshZcodeJwt(businessToken, { log });
      if (!refreshed?.zcodeJwtToken) return null;

      const nextPsd = { ...psd, zcodeJwtToken: refreshed.zcodeJwtToken };
      const resolved = await resolveZcodeAuth(
        { ...credentials, providerSpecificData: nextPsd },
        { log, force: true }
      );

      return {
        accessToken: credentials.accessToken,
        providerSpecificData: { ...nextPsd, ...resolved.persist },
      };
    } catch (error) {
      log?.warn?.("ZCODE", `credential refresh failed: ${error?.message || error}`);
      return null;
    }
  }
}

export default ZCodeExecutor;
