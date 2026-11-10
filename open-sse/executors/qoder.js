/**
 * QoderExecutor — sends OpenAI-format chat requests to Qoder's COSY-signed
 * inference endpoint at api3.qoder.sh, then unwraps Qoder's `{statusCodeValue,
 * body}` SSE envelope back into plain OpenAI SSE for the rest of the pipeline.
 *
 * Differences vs the previous placeholder:
 *   - URL is api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation
 *     with `&Encode=1` so we can ship the body through the WAF-bypass
 *     encoder.
 *   - Authentication is COSY (RSA + AES + MD5 + ~17 Cosy-* headers), not
 *     a static HMAC.
 *   - The request shape Qoder expects is non-trivial (chat_context with
 *     mirrored modelConfig, business block with stable IDs, system text
 *     hoisted out of the messages array). All ported from the reference.
 *   - Model identifier is one of the canonical Qoder keys (auto / ultimate /
 *     performance / efficient / lite + frontier "*model" ids); the
 *     translator layer feeds us "qoder/<key>" so we strip the prefix.
 *   - Per-model `model_config` is fetched live from /algo/api/v2/model/list
 *     and cached. Sending the wrong block silently downgrades to a
 *     different model upstream, so a missing entry is a hard error.
 */

import { qoderEncodeBody } from "../shared/qoder/encoding.js";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { FETCH_CONNECT_TIMEOUT_MS, HTTP_STATUS } from "../config/runtimeConfig.js";
import {
  QODER_CHAT_SIG_PATH,
  QODER_CONTEXT_TIER_ENV,
  getQoderStaticModelConfig,
  qoderChatModelConfig,
  qoderInferenceBase,
  qoderQuotaUsageUrl,
} from "../shared/qoder/constants.js";
import { getQoderModelConfig, resolveQoderModels, isQoderPat, resolveQoderCredentials, invalidateQoderJobToken } from "../services/qoderModels.js";
import { OPENAI_BLOCK, CLAUDE_BLOCK } from "../translator/schema/blocks.js";
import { encodeDataUri } from "../translator/concerns/image.js";
import { buildCosyHeaders, deriveMachineId } from "../shared/qoder/cosy.js";
import {
  computeQoderQueueDelayMs,
  isQoderQueuedBody,
  parseQoderQueueInfo,
  parseQoderQueueStatus,
  qoderQueueMaxWaitMs,
  qoderQueueStatusUrl,
} from "../shared/qoder/queue.js";
import { createQoderSseCoalescer } from "../shared/qoder/sse.js";
import { dispatchQoderGrpc, qoderBodyBytes, qoderTransportOverride, resolveQoderTransport } from "./qoder-grpc.js";
import { rewriteQoderMessageAttachments } from "../shared/qoder/attachments.js";
import { resolveQoderContextTier, applyQoderContextTier } from "../shared/qoder/contextTier.js";

/**
 * Hoist role:"system" messages out of the messages array (Qoder rejects
 * system in messages) and flatten multipart content arrays — EXCEPT image
 * blocks, which are preserved (see normalizeContent).
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], systemText: "" };
  }
  const systemParts = [];
  const out = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.role === "system") {
      const text = extractText(msg.content);
      if (text) systemParts.push(text);
      continue;
    }
    const cloned = { ...msg };
    cloned.content = normalizeContent(msg.content);
    out.push(cloned);
  }
  return { messages: out, systemText: systemParts.join("\n\n") };
}

/**
 * Normalize one message's content for Qoder.
 *
 * Text-only content is flattened to a plain string (Qoder's historical
 * shape). When images are present the content stays an array and image
 * blocks are kept as OpenAI-style `image_url` parts. Native qodercli
 * uploads inlined bytes to `/api/v2/image/upload` first and then sends
 * the OSS URL — `buildQoderRequestBody` does that rewrite before this
 * runs. Tiny leftover data URIs are still accepted. The legacy
 * top-level `image_urls` / `chat_context.imageUrls` slots stay null —
 * qodercli leaves them null too.
 *
 * Claude-style `{type:"image", source:{...}}` blocks are converted to
 * `image_url`. File/document blocks that survived rewrite become short
 * stubs so 30MB PDFs never land in agent_chat_generation.
 */
function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content)) return String(content);

  const blocks = [];
  const textParts = [];
  let hasImage = false;

  const pushText = (text) => {
    if (!text) return;
    if (hasImage || blocks.length) blocks.push({ type: OPENAI_BLOCK.TEXT, text });
    else textParts.push(text);
  };

  const imageUrlOf = (item) => {
    if (typeof item.image_url === "string" && item.image_url) return item.image_url;
    if (typeof item.image_url?.url === "string" && item.image_url.url) return item.image_url.url;
    return null;
  };

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const imageUrl = item.type === OPENAI_BLOCK.IMAGE_URL ? imageUrlOf(item) : null;
    if (imageUrl) {
      blocks.push({ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: imageUrl } });
      hasImage = true;
    } else if (item.type === CLAUDE_BLOCK.IMAGE && item.source) {
      // Claude base64/url image → OpenAI image_url equivalent.
      const src = item.source;
      const url = src.type === "base64" && src.data
        ? encodeDataUri(src.media_type || "image/png", src.data)
        : typeof src.url === "string" && src.url ? src.url : null;
      if (url) {
        blocks.push({ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url } });
        hasImage = true;
      }
    } else if (item.type === OPENAI_BLOCK.FILE) {
      const name = item.file?.filename || item.file?.name || "file";
      pushText(`[file omitted: ${name} — Qoder reads documents via its file API, not inlined bytes]`);
    } else if (item.type === CLAUDE_BLOCK.DOCUMENT) {
      const name = item.title || "document";
      pushText(`[file omitted: ${name} — Qoder reads documents via its file API, not inlined bytes]`);
    } else if (typeof item.text === "string" && item.text) {
      pushText(item.text);
    }
  }

  if (!hasImage) return textParts.join("\n");
  // Prepend any text collected before the first image block.
  if (textParts.length) blocks.unshift({ type: OPENAI_BLOCK.TEXT, text: textParts.join("\n") });
  return blocks;
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (item && typeof item === "object") {
        if (item.type === "text" && typeof item.text === "string") {
          parts.push(item.text);
        } else if (typeof item.text === "string") {
          parts.push(item.text);
        }
      }
    }
    return parts.join("\n");
  }
  return String(content);
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return extractText(m.content);
  }
  return "";
}

function stableHash(prefix, ...parts) {
  const h = createHash("sha256");
  h.update(prefix);
  for (const p of parts) {
    h.update("\0");
    h.update(String(p ?? ""));
  }
  return h.digest("hex").slice(0, 16);
}

function stableChatRecordId(model, messages, tools, maxTokens) {
  const h = createHash("sha256");
  h.update("qoder-record\0");
  h.update(String(model));
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.role) { h.update("\0"); h.update(m.role); }
    if (typeof m.content === "string" && m.content) {
      h.update("\0"); h.update(m.content);
    } else if (Array.isArray(m.content)) {
      // Include image refs so the same prompt with a different image gets
      // a distinct chat_record_id.
      h.update("\0");
      try { h.update(JSON.stringify(m.content)); } catch {}
    }
  }
  if (tools) {
    h.update("\0");
    try { h.update(JSON.stringify(tools)); } catch {}
  }
  h.update(`\0mt=${maxTokens}`);
  return h.digest("hex").slice(0, 16);
}

/**
 * Sleep that aborts with the caller's signal, so a client hanging up during a
 * long queue wait releases the request instead of holding it for the budget.
 */
function sleep(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function truncate(s, n) {
  return s && s.length > n ? `${s.slice(0, n)}...` : s || "";
}

/**
 * Resolves the live catalog entry for one model key, with the static roster as
 * the last resort. Shared by the transport decision and the request builder so
 * one dispatch never resolves the same key twice.
 */
async function resolveQoderModelConfig({ qoderKey, credentials, log, proxyOptions, signal, region = "intl" }) {
  const modelConfig = await getQoderModelConfig(credentials, qoderKey, { log, proxyOptions, signal, region });
  if (modelConfig) return modelConfig;

  // Try a forced refresh once before giving up — the cache may simply not be
  // populated yet on first ever call for this credential.
  const refreshed = await resolveQoderModels(credentials, { forceRefresh: true, log, proxyOptions, signal, region });
  const retried = refreshed?.rawConfigs.get(qoderKey);
  if (retried) return { ...retried, key: qoderKey };

  // Last resort: a static block for models the per-account catalog omits.
  // Sonus (smodel) / Cantus (cmodel) are the known cases — the chat endpoint
  // accepts them even when /model/list never mentions them, so refusing here
  // would make an available model look broken.
  const staticConfig = getQoderStaticModelConfig(qoderKey);
  if (!staticConfig) {
    throw new Error(
      `qoder: model_config for "${qoderKey}" not yet known (run a model list fetch or check upstream connectivity)`,
    );
  }
  log?.info?.("QODER", `using static model_config for "${qoderKey}" (absent from the account catalog)`);
  return staticConfig;
}

async function buildQoderRequestBody({ model, body, credentials, log, proxyOptions, signal, uploadFn = null, region = "intl", modelConfig: preResolvedConfig = null }) {
  const qoderKey = String(model || "").replace(/^qoder\//, "");

  // The catalog entry carries the wire config the request must echo (window,
  // reasoning flag, tier list). It is resolved here unless the caller already
  // did so for the transport decision.
  const modelConfig = preResolvedConfig
    || await resolveQoderModelConfig({ qoderKey, credentials, log, proxyOptions, signal, region });

  const incoming = Array.isArray(body.messages)
    ? body.messages.map((m) => {
      if (!m || typeof m !== "object") return m;
      return {
        ...m,
        content: Array.isArray(m.content)
          ? m.content.map((b) => (b && typeof b === "object" ? { ...b } : b))
          : m.content,
      };
    })
    : [];
  try {
    await rewriteQoderMessageAttachments(incoming, {
      credentials,
      log,
      proxyOptions,
      signal,
      uploadFn,
    });
  } catch (err) {
    log?.warn?.("QODER", `attachment rewrite failed: ${err.message}`);
  }

  const { messages, systemText } = normalizeMessages(incoming);
  // Images live in message content as image_url blocks (the CLI's own shape);
  // their presence decides whether model_config keeps `source` (see below).
  const hasImages = messages.some(
    (m) =>
      Array.isArray(m?.content) &&
      m.content.some((b) => b && typeof b === "object" && b.type === OPENAI_BLOCK.IMAGE_URL),
  );
  // The catalog entry has no `source`, so a vision request must inject it:
  // `source: "system"` marks the model as system-provided, and only then does
  // the server actually read the image parts (verified: same payload with
  // source -> "Red", without -> "NOIMAGE").
  const chatModelConfig = hasImages
    ? { ...qoderChatModelConfig(modelConfig, { keepSource: true }), source: modelConfig?.source || "system" }
    : qoderChatModelConfig(modelConfig);
  const tools = body.tools;
  const isReasoning = !!modelConfig.is_reasoning;
  const maxOutputTokens = Number(modelConfig.max_output_tokens) || 0;

  let maxTokens = 32_768;
  if (maxOutputTokens > 0) maxTokens = maxOutputTokens;
  if (typeof body.max_tokens === "number" && body.max_tokens > 0 && body.max_tokens < maxTokens) {
    maxTokens = body.max_tokens;
  }
  if (typeof body.max_completion_tokens === "number" && body.max_completion_tokens > 0 && body.max_completion_tokens < maxTokens) {
    maxTokens = body.max_completion_tokens;
  }

  const lastUser = lastUserText(messages);
  const psd = credentials.providerSpecificData || {};
  const sessionId = stableHash("qoder-session", psd.userId, qoderKey);
  const recordId = stableChatRecordId(qoderKey, messages, tools, maxTokens);

  // Context-window tier (200K/400K/1M): the IDE picks one from model_config.context_config;
  // qodercli-style requests default to the smallest. Escalate when the prompt no longer fits.
  const tierChoice = resolveQoderContextTier(
    modelConfig,
    { system: systemText, messages, tools },
    { preference: process.env[QODER_CONTEXT_TIER_ENV] },
  );
  if (tierChoice) {
    log?.info?.(
      "QODER",
      `context tier ${tierChoice.tier.name} (${tierChoice.tier.tokenCount} tokens, ${tierChoice.reason}) for ~${tierChoice.estimatedTokens} prompt tokens`,
    );
  }

  const built = {
    qoderKey,
    payload: {
      request_id: uuidv4(),
      request_set_id: recordId,
      chat_record_id: recordId,
      session_id: sessionId,
      stream: true,
      chat_task: "FREE_INPUT",
      is_reply: true,
      is_retry: false,
      source: 1,
      version: "3",
      session_type: "qodercli",
      agent_id: "agent_common",
      task_id: "common",
      code_language: "",
      chat_prompt: "",
      image_urls: null,
      aliyun_user_type: "",
      system: systemText,
      messages,
      tools: Array.isArray(tools) ? tools : [],
      parameters: { max_tokens: maxTokens },
      chat_context: {
        chatPrompt: "",
        imageUrls: null,
        extra: {
          context: [],
          modelConfig: { key: qoderKey, is_reasoning: isReasoning },
          originalContent: lastUser,
        },
        features: [],
        text: lastUser,
      },
      // Echoed without `source`: that field selects Qoder's managed lane, which
      // parks the request with 10605/queueType=p3 while it is busy. The
      // X-Model-Source header below still reports the catalog value.
      //
      // Exception: a request carrying images MUST keep `source`. Dropping it
      // makes the server ignore the image parts entirely and answer as if no
      // image was attached ("NOIMAGE"), which is how vision looked broken
      // upstream. Verified against a live account: identical payload with
      // source -> "Red", without -> "NOIMAGE".
      model_config: chatModelConfig,
      business: {
        product: "cli",
        version: "1.0.0",
        type: "agent",
        stage: "start",
        id: uuidv4(),
        name: truncate(lastUser, 30),
        begin_at: Date.now(),
      },
    },
    modelConfig,
  };
  if (tierChoice) applyQoderContextTier(built.payload, tierChoice.tier);
  return built;
}

/**
 * Check if a qoder error message indicates a billing/quota block.
 *
 * Signatures: code 110 (billing daily count exceeded), code 112 (quota
 * exhausted), or a `pricingUrl` field.
 *
 * Code 10605 is deliberately NOT here. It is the model-queue throttle
 * (`isQueued` / `RESOURCE_LIMIT`), a transient capacity signal: the model is
 * briefly unavailable and the very same request succeeds once it drains. The
 * billing branch turns the frame into a 403, chatCore reads 403 as
 * insufficient_quota and locks the model for minutes, so a queued request used
 * to fail permanently instead of waiting ~30s. See shared/qoder/queue.js.
 */
/**
 * Upstream body for an auth-invalidated credential: {"code":"105","message":"Login expired"}.
 * The gateway answers it with HTTP 403 whenever the jt-/dt- it was given is no
 * longer accepted — server-side early invalidation the local expiresAt cannot
 * see. Detected at any frame position so both the first-frame peek and the
 * mid-stream envelope path recognise it.
 */
function isLoginExpiredFrame(inner, statusVal) {
  if (statusVal === 401) return true;
  if (!inner || typeof inner !== "string") return false;
  if (statusVal === 403) {
    try {
      const parsed = JSON.parse(inner);
      if (String(parsed?.code) === "105") return true;
    } catch { /* not JSON */ }
    return inner.toLowerCase().includes("login expired");
  }
  return false;
}

/**
 * Enrich a billing-block error message with the account's live quota and the
 * next daily-reset boundary. Upstream's `110` body carries no timestamp (the
 * quota API's `expiresAt` is the *subscription* expiry, not the daily reset),
 * so the reset time is computed: Qoder's billing day rolls at midnight UTC.
 * Best-effort with a short timeout — a quota-fetch failure must never delay
 * or fail the error response itself.
 */
/**
 * Billing-block message enrichment.
 *
 * Upstream's `110` body carries no timestamp and the quota API exposes plan
 * credits only — NOT the daily request count that `110` actually means. So the
 * message must not imply credits caused the block; they are plan context. The
 * reset line is an ESTIMATE (next midnight UTC, the only boundary observed so
 * far) and is labelled as such.
 *
 * The quota read is cached for QUOTA_CACHE_TTL_MS: a billing block usually
 * repeats for every request in the window, and re-fetching per request only
 * adds latency to an already-failing path.
 */
const QUOTA_CACHE_TTL_MS = 60 * 1000;
const quotaCache = new Map();

async function fetchQoderQuota(credentials, region, log) {
  const psd = credentials?.providerSpecificData || {};
  const key = psd.userId || credentials?.connectionId || credentials?.accessToken || "anon";
  const cached = quotaCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.body;

  const token = credentials?.accessToken;
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), 4000);
    let body = null;
    try {
      const res = await proxyAwareFetch(
        qoderQuotaUsageUrl(region || "intl"),
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "qodercli/1.0.0",
            // The quota endpoint is authenticated like every other openApi
            // call: without the job/device token it answers 401 and the whole
            // enrichment silently degrades to the bare upstream message.
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        },
        null,
      );
      if (res.ok) body = await res.json().catch(() => null);
    } finally {
      clearTimeout(timer);
    }
    if (body) {
      quotaCache.set(key, { body, expiresAt: Date.now() + QUOTA_CACHE_TTL_MS });
      if (quotaCache.size > 100) {
        const oldest = quotaCache.keys().next().value;
        quotaCache.delete(oldest);
      }
    }
    return body;
  } catch (e) {
    log?.debug?.("QODER", `quota fetch for error message failed: ${e?.message || e}`);
    return null;
  }
}

async function describeQoderDailyQuota(inner, credentials, region, log) {
  const base = inner && typeof inner === "string" ? inner : "qoder billing block";
  const body = await fetchQoderQuota(credentials, region, log);

  const parts = [];
  if (body) {
    const uq = body.userQuota || {};
    if (typeof uq.used === "number" && typeof uq.total === "number") {
      parts.push(`${uq.used}/${uq.total} plan credits used`);
    }
    if (body.userType) parts.push(`plan ${body.userType}`);
  }
  const planClause = parts.length > 0 ? ` (${parts.join(", ")}; credits are not the limit here)` : "";

  // Next midnight UTC — the only daily boundary observed so far. Explicitly an
  // estimate: the real window may roll sooner (observed recovery inside ~1h).
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const mins = Math.max(1, Math.round((reset.getTime() - now.getTime()) / 60000));
  const span = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

  return `${base}${planClause}; daily request window resets by ~${span} at the latest (est., ${reset.toISOString().replace("T", " ").slice(0, 16)} UTC)`;
}

function isBillingBlock(inner) {
  if (!inner || typeof inner !== "string") return false;
  const lowerMsg = inner.toLowerCase();
  if (lowerMsg.includes("pricingurl")) return true;
  // Parsed code preferred over regex: matches numeric or string "110"/"112".
  try {
    const parsed = JSON.parse(inner);
    const code = String(parsed?.code ?? "");
    if (code === "110" || code === "112") return true;
  } catch { /* not JSON — fall through to legacy shape match */ }
  // Match legacy exact shape: {"code":"112",...}.
  return /"code"\s*:\s*"112"/.test(inner);
}

/**
 * Peek the first SSE data line to detect upstream errors before piping.
 * Returns { isError, isBilling, statusVal, message, consumed } — `consumed` is every
 * byte read so far (including the peeked line) so the caller can re-process
 * it and nothing is dropped from the stream.
 */
async function peekFirstQoderFrame(reader, decoder) {
  let consumed = "";
  let offset = 0;
  let upstreamDone = false;
  while (true) {
    let nl = consumed.indexOf("\n", offset);
    if (nl === -1 && !upstreamDone) {
      const { done, value } = await reader.read();
      upstreamDone = done;
      consumed += done ? decoder.decode() : decoder.decode(value, { stream: true });
      continue;
    }
    if (offset >= consumed.length) return { isError: false, consumed, upstreamDone };
    if (nl === -1) nl = consumed.length;

    const line = consumed.slice(offset, nl).replace(/\r$/, "").trim();
    offset = nl + 1;
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trimStart();
    if (data === "[DONE]") return { isError: false, consumed, upstreamDone };

    let envelope;
    try { envelope = JSON.parse(data); } catch { return { isError: false, consumed, upstreamDone }; }

    // statusCodeValue is documented numeric, but accept numeric strings defensively.
    const raw = Number(envelope?.statusCodeValue);
    const statusVal = Number.isNaN(raw) ? 200 : raw;
    const inner = typeof envelope?.body === "string"
      ? envelope.body
      : envelope?.body != null ? JSON.stringify(envelope.body) : "";

    if (statusVal !== 200) {
      return { isError: true, isBilling: isBillingBlock(inner), statusVal, message: inner || `upstream status ${statusVal}` };
    }
    return { isError: false, consumed, upstreamDone };
  }
}

/**
 * Wrap the upstream's `{statusCodeValue, body}` SSE envelope into plain
 * OpenAI SSE chunks the rest of the chatCore pipeline understands.
 *
 * Each upstream line looks like:
 *   data: {"statusCodeValue":200,"body":"{\"choices\":[{\"delta\":{...}}]}"}
 * The inner body is an OpenAI streaming chunk (or "[DONE]"). We unwrap it
 * and re-emit as `data: <inner>\n\n`. First-frame errors become HTTP errors;
 * errors after streaming starts retain the synthetic chunk + [DONE] path.
 *
 * Critical: Qoder's SSE often keeps the socket open after the terminal
 * [DONE]/error frame (agent keepalive). Non-streaming clients drain via
 * response.text() which hangs until the socket closes — so on terminal
 * events we cancel the upstream reader and close our stream immediately.
 *
 * Usage: Qoder puts finish_reason on `delta` and sends token counts on a
 * later `choices: []` frame. Downstream OpenAI/Claude clients only read
 * usage from the finish chunk, so we coalesce those two frames (see
 * createQoderSseCoalescer) before forwarding.
 *
 * Peek the first frame for errors before committing to HTTP 200. Preserve
 * upstream error statuses so chatCore can handle failures instead of recording
 * error text as a successful completion. Billing blocks retain the existing
 * 403 mapping for quota/account fallback.
 */
async function wrapQoderSSE(response, model, log = null, describeBilling = null) {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  // Detect errors before returning a successful streaming response.
  const peek = await peekFirstQoderFrame(reader, decoder);
  if (peek.isError) {
    await reader.cancel().catch(() => {});
    const status = peek.isBilling
      ? HTTP_STATUS.FORBIDDEN
      : Number.isInteger(peek.statusVal) && peek.statusVal >= HTTP_STATUS.BAD_REQUEST && peek.statusVal <= 599
        ? peek.statusVal : HTTP_STATUS.BAD_GATEWAY;
    return new Response(
      JSON.stringify({ error: { message: peek.message, code: peek.statusVal } }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }

  // Normal flow: re-process every byte the peek consumed, then continue.
  let buffer = peek.consumed || "";
  const upstreamDrained = peek.upstreamDone === true;
  const encoder = new TextEncoder();
  let doneEmitted = false;
  const coalescer = createQoderSseCoalescer({ model, encoder, sseDone: SSE_DONE });

  const syncDone = () => {
    if (coalescer.doneEmitted) doneEmitted = true;
  };

  // Process one already-extracted SSE line (no trailing newline).
  const processLine = async (line, controller) => {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("data:")) return;
    if (doneEmitted) return;

    const data = trimmed.slice(5).trimStart();
    if (data === "[DONE]") {
      coalescer.flush(controller);
      syncDone();
      return;
    }

    let envelope;
    try { envelope = JSON.parse(data); } catch { return; }
    const statusVal = Number(envelope.statusCodeValue) || 200;
    const inner = typeof envelope.body === "string"
      ? envelope.body
      : envelope.body != null ? JSON.stringify(envelope.body) : "";
    if (statusVal !== 200) {
      // Always visible: error envelopes are rare and worth one stderr line at
        // any log level (response bodies carry no credentials).
      try {
        console.error(`[QODER] error envelope status=${statusVal} statusType=${typeof envelope.statusCodeValue} bodyType=${typeof envelope.body} body=${truncate(inner, 300)}`);
      } catch { /* logging must not break the stream */ }
      if (isBillingBlock(inner)) {
        // Billing/quota envelope at any stream position (peek only covers the
        // first frame): emit a structured error chunk, not fake assistant text.
        // parseSSEToOpenAIResponse understands chunk.error and turns it into a
        // non-200 result so chat.js locks the model and falls back. Streaming
        // clients receive a real SSE error instead of "[qoder error ...]" text.
        let billingMessage = inner || `qoder billing block (${statusVal})`;
        if (typeof describeBilling === "function") {
          try {
            billingMessage = await describeBilling(inner);
          } catch { /* keep the plain upstream message */ }
        }
        const errObj = JSON.stringify({
          error: {
            message: billingMessage,
            code: "qoder_billing_block",
            status: 403,
            type: "quota_error",
          },
        });
        controller.enqueue(encoder.encode(`data: ${errObj}\n\n`));
        controller.enqueue(encoder.encode(SSE_DONE));
        doneEmitted = true;
        return;
      }
      const msg = inner || `upstream status ${statusVal}`;
      const errChunk = JSON.stringify({
        id: `qoder-error-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { content: `\n[qoder error ${statusVal}: ${truncate(msg, 200)}]` }, finish_reason: "stop" }],
      });
      controller.enqueue(encoder.encode(`data: ${errChunk}\n\n`));
      controller.enqueue(encoder.encode(SSE_DONE));
      doneEmitted = true;
      return;
    }
    if (!inner) return;
    coalescer.handleInner(inner, controller);
    syncDone();
  };

  const stream = new ReadableStream({
    // Use start()+loop (not pull): a pull that buffers a partial line without
    // enqueueing would never be re-invoked, hanging consumers like .text().
    async start(controller) {
      try {
        // Drain whatever the peek already pulled off the socket first.
        let nlSeed;
        while ((nlSeed = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlSeed);
          buffer = buffer.slice(nlSeed + 1);
          await processLine(line, controller);
          if (doneEmitted) {
            await reader.cancel().catch(() => {});
            controller.close();
            return;
          }
        }
        if (upstreamDrained) {
          // Peek hit end-of-stream: flush any trailing partial line.
          buffer += decoder.decode();
          if (buffer.length > 0) {
            await processLine(buffer, controller);
            buffer = "";
          }
        }

        while (!doneEmitted && !upstreamDrained) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer.length > 0) {
              await processLine(buffer, controller);
              buffer = "";
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            await processLine(line, controller);
            if (doneEmitted) {
              // Terminal frame received — drop upstream keepalive and end.
              await reader.cancel().catch(() => {});
              controller.close();
              return;
            }
          }
        }
      } catch {
        // fall through to terminal [DONE] + close
      } finally {
        if (!doneEmitted) {
          try {
            coalescer.flush(controller);
            doneEmitted = true;
          } catch { /* already closed */ }
        }
        try { controller.close(); } catch { /* already closed */ }
        await reader.cancel().catch(() => {});
      }
    },
    cancel() {
      return reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export class QoderExecutor extends BaseExecutor {
  constructor(provider = "qoder") {
    super(provider, PROVIDERS[provider]);
    this.region = provider === "qoder-cn" ? "cn" : "intl";
  }

  buildUrl(credentials) {
    return `${qoderInferenceBase(credentials, this.region)}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
  }

  // Override execute entirely — Qoder needs:
  //   - body built from translated chat completion payload
  //   - body encoded with QoderEncodeBody before signing
  //   - COSY headers built from the *encoded* body bytes
  //   - response stream re-wrapped from {statusCodeValue, body} to OpenAI SSE
  //
  // Wraps _executeAttempt with a single login-expired recovery: when upstream
  // rejects the cached job token (403/code 105 "Login expired" — a
  // server-side early invalidation the local expiresAt bookkeeping cannot
  // see), drop the cached jt- and retry once with a freshly exchanged one.
  // Before this, an invalidated jt- was treated as a transient 403: the
  // account got a 2-minute cooldown, the client retried into the same dead
  // token, and the loop repeated forever.
  async execute(params) {
    const result = await this._executeAttempt(params);
    if (!(await this._isLoginExpiredResult(result))) return result;

    const { log, credentials } = params;
    log?.warn?.("QODER", "upstream rejected the job token (Login expired); re-exchanging and retrying once");
    invalidateQoderJobToken(credentials);
    try {
      const retry = await this._executeAttempt(params);
      return retry;
    } catch (err) {
      log?.warn?.("QODER", `retry after job-token re-exchange failed: ${err.message}`);
      return result;
    }
  }

  /**
   * True when an executor result's response is the login-expired rejection:
   * HTTP 403/401 whose body carries Qoder code 105 (or the literal message).
   * Error responses from _executeAttempt are built from a JSON string, so the
   * body is safe to read. Successful streams (Response.ok) never reach the
   * body read.
   */
  async _isLoginExpiredResult(result) {
    const resp = result?.response;
    if (!resp || resp.ok) return false;
    if (resp.status !== 403 && resp.status !== 401) return false;
    // Read a CLONE: chatCore's parseUpstreamError consumes the original body
    // later, and a Response body can only be read once. Reading the original
    // here left the client-facing error with an empty body ("HTTP 403" with no
    // upstream message) for every non-105 403 — billing blocks included.
    let text = "";
    try { text = await resp.clone().text(); } catch { return false; }
    return isLoginExpiredFrame(text, resp.status);
  }

  async _executeAttempt({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    // PAT (pt-...) → exchange for short-lived job token + resolve userId so
    // downstream COSY signing + catalog fetch work. Device tokens (dt-...) and
    // job tokens (jt-...) skip this and are used directly.
    const rawToken = credentials?.apiKey || credentials?.accessToken;
    if (isQoderPat(rawToken)) {
      try {
        credentials = await resolveQoderCredentials(credentials, proxyOptions, signal, this.region);
      } catch (err) {
        log?.error?.("QODER", `PAT exchange failed: ${err.message}`);
        const fakeResp = new Response(
          JSON.stringify({ error: { message: `qoder PAT exchange failed: ${err.message}` } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
        return { response: fakeResp, url: this.buildUrl(credentials), headers: {}, transformedBody: body };
      }
    }

    const url = this.buildUrl(credentials);
    const psd = credentials?.providerSpecificData || {};
    if (!psd.userId) {
      // No user id → no way to sign. Surface a 401 so the dashboard nudges
      // the user back to OAuth.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: "qoder credential is missing userId; reconnect the account" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }
    if (!credentials?.accessToken) {
      // Same shape as the userId guard — clean 401 so chatCore reports
      // "reconnect" rather than bubbling cosy.js's synchronous throw as 500.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: "qoder credential is missing accessToken; reconnect the account" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    // Transport selection. COSY is the default; a body above 200 KiB is upgraded
    // to gRPC, which answers large requests in seconds where COSY takes minutes
    // or never answers (measured: 280K chars 73s → 5.1s, 1.2M chars >300s →
    // 16.3s). Free-tier rows stay on COSY (gRPC refuses them with 116), and any
    // gRPC failure falls through to the COSY path below, so a request that works
    // today cannot start failing.
    const qoderKey = String(model || "").replace(/^qoder\//, "");
    let modelConfig = null;
    try {
      modelConfig = await resolveQoderModelConfig({ qoderKey, credentials, log, proxyOptions, signal, region: this.region });
    } catch (err) {
      const fakeResp = new Response(
        JSON.stringify({ error: { message: err.message } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const bodyBytes = qoderBodyBytes(body);
    const transport = resolveQoderTransport(qoderTransportOverride(), modelConfig, bodyBytes, qoderKey);
    if (transport === "grpc") {
      log?.info?.("QODER", `dispatching ${qoderKey} over gRPC (body ${Math.round(bodyBytes / 1024)} KiB is past the 200 KiB HTTP threshold)`);
      try {
        return await dispatchQoderGrpc({
          modelId: qoderKey,
          body,
          credentials,
          region: this.region,
          signal,
          log,
          userId: psd.userId,
          machineId: psd.machineId || deriveMachineId(psd.userId),
        });
      } catch (err) {
        // Missing @grpc/* (optional deps) or a client that cannot be built:
        // the COSY path below still serves anything under its own cap.
        log?.warn?.("QODER", `gRPC transport unavailable (${err.message}); falling back to COSY`);
      }
    }

    let payload;
    try {
      ({ payload } = await buildQoderRequestBody({
        model,
        body,
        credentials,
        log,
        proxyOptions,
        signal,
        region: this.region,
        modelConfig,
      }));
    } catch (err) {
      const fakeResp = new Response(
        JSON.stringify({ error: { message: err.message } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const plainBody = Buffer.from(JSON.stringify(payload), "utf8");
    const encodedBodyStr = qoderEncodeBody(plainBody);
    const encodedBodyBuf = Buffer.from(encodedBodyStr, "latin1");

    let cosyHeaders;
    try {
      cosyHeaders = buildCosyHeaders(
        encodedBodyBuf,
        url,
        {
          userId: psd.userId,
          authToken: credentials.accessToken,
          name: credentials.displayName || "",
          email: credentials.email || "",
          // PAT connections store no machine id. A random uuid per request
          // makes each call look like a brand-new device, and a new device
          // rejoins the back of the model queue. Derive a stable one instead.
          machineId: psd.machineId || deriveMachineId(psd.userId),
        },
      );
    } catch (err) {
      // cosy.js throws synchronously on missing userId/authToken — surface
      // as 401 so chatCore prompts re-auth instead of returning a 500.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: `qoder cosy signing failed: ${err.message}` } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const modelSource = (payload.model_config && payload.model_config.source) || "system";
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Model-Key": qoderKey,
      "X-Model-Source": modelSource,
      // gzip triggers signature validation on Qoder's CDN; force identity.
      "Accept-Encoding": "identity",
      ...cosyHeaders,
    };

    const label = `${this.provider}/${qoderKey}`;

    /**
     * One signed attempt. COSY signs the body, so every replay needs a fresh
     * signature — reusing one reuses its requestId and upstream answers
     * 403/code 103.
     */
    const sendOnce = async (attemptPayload) => {
      const attemptPlain = Buffer.from(JSON.stringify(attemptPayload), "utf8");
      const attemptEncoded = Buffer.from(qoderEncodeBody(attemptPlain), "latin1");

      let attemptHeaders;
      try {
        attemptHeaders = buildCosyHeaders(attemptEncoded, url, {
          userId: psd.userId,
          authToken: credentials.accessToken,
          name: credentials.displayName || "",
          email: credentials.email || "",
          machineId: psd.machineId || deriveMachineId(psd.userId),
        });
      } catch (err) {
        const fakeResp = new Response(
          JSON.stringify({ error: { message: `qoder cosy signing failed: ${err.message}` } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
        return { error: fakeResp, url, headers: {}, transformedBody: body };
      }

      const attemptHeadersFull = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Model-Key": qoderKey,
        "X-Model-Source": (attemptPayload.model_config && attemptPayload.model_config.source) || "system",
        // gzip triggers signature validation on Qoder's CDN; force identity.
        "Accept-Encoding": "identity",
        ...attemptHeaders,
      };

      // Abort if upstream doesn't return response headers within connect timeout.
      const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
      const connectCtrl = new AbortController();
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      let response;
      try {
        response = await proxyAwareFetch(
          url,
          { method: "POST", headers: attemptHeadersFull, body: attemptEncoded, signal: mergedSignal },
          // A failed proxy request may already have reached Qoder. Replaying
          // the same COSY signature directly reuses its requestId and returns
          // 403/code 103. Let the caller retry through execute() with fresh signing.
          { ...proxyOptions, strictProxy: true },
        );
      } catch (err) {
        // strictProxy wraps transport errors; retain caller cancellation semantics.
        if (mergedSignal.aborted) throw mergedSignal.reason;
        throw err;
      } finally {
        clearTimeout(connectTimer);
      }

      return { response, url, headers: attemptHeadersFull, transformedBody: attemptPayload };
    };

    /**
     * Poll the model-queue status endpoint qodercli uses. Returns
     * `{ endpointOk, info }`; endpointOk=false means "fall back to timed
     * replays" (endpoint missing, erroring, or answering an unknown shape).
     */
    const fetchQueueStatus = async (modelKey, queueType, requestSetId, requestId, sessionId) => {
      const statusUrl = qoderQueueStatusUrl(qoderInferenceBase(credentials, this.region), {
        requestSetId,
        modelKey,
        queueType,
      });
      try {
        const statusResponse = await proxyAwareFetch(
          statusUrl,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "Accept-Encoding": "identity",
              // qodercli correlates the poll with the original inference.
              "X-Request-ID": requestId,
              "X-Session-ID": sessionId || "",
              ...buildCosyHeaders(Buffer.alloc(0), statusUrl, {
                userId: psd.userId,
                authToken: credentials.accessToken,
                name: credentials.displayName || "",
                email: credentials.email || "",
                machineId: psd.machineId || deriveMachineId(psd.userId),
              }),
            },
            signal,
          },
          proxyOptions,
        );
        if (!statusResponse.ok) return { endpointOk: false, info: null };
        const info = parseQoderQueueStatus(await statusResponse.text().catch(() => ""));
        return info ? { endpointOk: true, info } : { endpointOk: false, info: null };
      } catch (err) {
        if (signal?.aborted) throw err;
        return { endpointOk: false, info: null };
      }
    };

    // While a model is out of capacity the inference endpoint answers
    // 10605/isQueued instead of a completion. qodercli does not treat that as
    // fatal and does not replay blindly: it polls the queue-status endpoint
    // (keyed by the request set id) and replays only once that reports
    // isQueued:false, honouring the server's retryAfterSeconds. The poll is a
    // cheap GET that does not consume a queue slot.
    const maxQueueWaitMs = qoderQueueMaxWaitMs();
    const waitStartedAt = Date.now();
    let lastQueueInfo = null;
    let statusPollsEnabled = true;
    // Guards the "status says ready" fast path: one free replay, then stop
    // believing an endpoint that has already been contradicted.
    let readyReplayUsed = false;
    // The queue is keyed by request_set_id, and qodercli keeps ONE request_id
    // for the whole recovery. A fresh id per replay makes the status poll look
    // at a queue entry nobody is waiting on, so it reports queued forever.
    let attemptPayload = payload;

    for (;;) {
      const sent = await sendOnce(attemptPayload);
      if (sent.error) return { response: sent.error, url: sent.url, headers: sent.headers, transformedBody: sent.transformedBody };
      if (!sent.response.ok) {
        // Pass error response through unchanged so chatCore can capture it.
        return { response: sent.response, url: sent.url, headers: sent.headers, transformedBody: sent.transformedBody };
      }

      // Peek the first frame without consuming the stream: a queued model
      // announces itself there, and wrapQoderSSE would read the body to
      // completion — which loses the ability to hand the same response back
      // when it turns out to be a normal completion.
      const reader = sent.response.body.getReader();
      const decoder = new TextDecoder();
      const peek = await peekFirstQoderFrame(reader, decoder);

      const queueInfo = peek.isError
        ? parseQoderQueueInfo(peek.message || "")
        : null;

      if (!queueInfo) {
        // Not a queue signal. A first-frame error is a genuine failure (billing
        // block, upstream error) — surface it so chatCore can fall back. A
        // successful peek means we consumed the head of a real completion, so
        // replay to get an intact stream.
        if (peek.isError) {
          const status = peek.isBilling ? HTTP_STATUS.FORBIDDEN
            : Number.isInteger(peek.statusVal) && peek.statusVal >= 400 && peek.statusVal <= 599
              ? peek.statusVal : HTTP_STATUS.BAD_GATEWAY;
          // Billing blocks get the live quota and the daily-reset boundary
          // appended, so the client sees WHY and UNTIL WHEN instead of a bare
          // "Billing daily count exceeded".
          const message = peek.isBilling
            ? await describeQoderDailyQuota(peek.message, credentials, this.region, log)
            : peek.message || "qoder upstream error";
          return {
            response: new Response(
              JSON.stringify({ error: { message, code: peek.statusVal } }),
              { status, headers: { "Content-Type": "application/json" } },
            ),
            url: sent.url,
            headers: sent.headers,
            transformedBody: sent.transformedBody,
          };
        }
        // Clean stream. The peek consumed the head, so hand the already-read
        // bytes back instead of re-sending — one upstream call per attempt.
        const reconstructed = new Response(
          new ReadableStream({
            start(controller) {
              // The consumer may close or cancel before we finish pumping (it
              // stops at the terminal frame), so every controller call has to
              // be guarded — close() twice throws ERR_INVALID_STATE.
              let closed = false;
              const finish = () => {
                if (closed) return;
                closed = true;
                try { controller.close(); } catch { /* already closed */ }
              };
              const push = (chunk) => {
                if (closed) return false;
                try {
                  controller.enqueue(chunk);
                  return true;
                } catch {
                  closed = true;
                  return false;
                }
              };

              const enc = new TextEncoder();
              if (peek.consumed && !push(enc.encode(peek.consumed))) return;
              if (peek.upstreamDone) {
                finish();
                return;
              }
              // Forward the remainder untouched.
              const pump = () => {
                if (closed) return;
                reader.read().then(({ done, value }) => {
                  if (done) { finish(); return; }
                  if (!push(value)) return;
                  pump();
                }).catch(() => finish());
              };
              pump();
            },
            cancel() {
              return reader.cancel().catch(() => {});
            },
          }),
          { status: sent.response.status, statusText: sent.response.statusText, headers: sent.response.headers },
        );
        const wrapped = await wrapQoderSSE(reconstructed, label, log, (inner) =>
          describeQoderDailyQuota(inner, credentials, this.region, log));
        return { response: wrapped, url: sent.url, headers: sent.headers, transformedBody: sent.transformedBody };
      }

      lastQueueInfo = queueInfo;
      const waitedMs = Date.now() - waitStartedAt;
      if (waitedMs >= maxQueueWaitMs) {
        log?.warn?.(
          "QODER",
          `model queue wait timed out after ${Math.round(waitedMs / 1000)}s for ${label} ` +
            `(queueType=${lastQueueInfo.queueType || "?"}, waitTime=${lastQueueInfo.waitTime ?? "?"}s)`,
        );
        const budgetResp = new Response(
          JSON.stringify({
            error: {
              message: `qoder model "${qoderKey}" is still queued after ${Math.round(waitedMs / 1000)}s ` +
                `(queueType=${lastQueueInfo.queueType || "?"}); retry shortly`,
              code: "qoder_model_queued",
              type: "rate_limit_error",
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
        return { response: budgetResp, url: sent.url, headers: sent.headers, transformedBody: sent.transformedBody };
      }

      let delayMs = computeQoderQueueDelayMs(queueInfo);

      if (statusPollsEnabled) {
        const requestSetId = attemptPayload.request_set_id;
        const polled = await fetchQueueStatus(
          queueInfo.modelKey || qoderKey,
          queueInfo.queueType,
          requestSetId,
          attemptPayload.request_id,
          attemptPayload.session_id,
        );
        if (!polled.endpointOk) {
          // No usable status endpoint — keep the old timed-replay behaviour.
          statusPollsEnabled = false;
        } else if (polled.info.isQueued === false) {
          // The status endpoint says ready, but it has been observed saying that
          // while the inference call is still refused. Replay once, and if that
          // is refused too, stop trusting the endpoint and fall back to timed
          // replays — otherwise we spin on a hint that will never be true.
          if (readyReplayUsed) {
            statusPollsEnabled = false;
            log?.info?.(
              "QODER",
              `queue status claims ready but "${qoderKey}" is still refused; falling back to timed replays`,
            );
          } else {
            readyReplayUsed = true;
            log?.info?.(
              "QODER",
              `model "${qoderKey}" reported ready (queueType=${polled.info.queueType || "?"}); replaying`,
            );
            delayMs = 0;
          }
        } else {
          delayMs = computeQoderQueueDelayMs(polled.info, { fromStatus: true });
          log?.info?.(
            "QODER",
            `model "${qoderKey}" still queued (queueType=${polled.info.queueType || "?"}, ` +
              `queueCount=${polled.info.queueCount ?? "?"}); rechecking in ${Math.round(delayMs / 1000)}s`,
          );
        }
      }

      if (delayMs > 0) await sleep(delayMs, signal);
    }
  }

  // Qoder device tokens don't refresh through OAuth — the upstream returns
  // 403 for our flow. Surfacing failure via 401-on-chat is enough; the
  // dashboard tells users to re-login when their token expires (~30 days).
  async refreshCredentials() {
    return null;
  }

  needsRefresh() {
    return false;
  }
}

export default QoderExecutor;

// Internals exposed for unit tests. Not part of the public API — callers
// should import QoderExecutor and use its public methods.
export const __test__ = {
  normalizeMessages,
  wrapQoderSSE,
  buildQoderRequestBody,
  isBillingBlock,
};
