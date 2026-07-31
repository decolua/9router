/**
 * OpenAI Chat Completions → Qoder private request payload.
 *
 * Practical-minimal convert (not “text-only micro”):
 *   ACTIVE — shell, system hoist, text, Chat image_url, official binary,
 *            tools / tool_calls / tool_call_id / name, reasoning_effort,
 *            max_tokens, tool_choice, context_length, shell image lists.
 *   COMMENTED — rare client shims (Anthropic source, unknown parts, legacy
 *            function_call/refusal). Uncomment when needed; do not delete.
 *   Never strip vision/tools because a model “might not support them”.
 */

import { createHash, randomUUID } from "crypto";
import { getQoderModelConfig, resolveQoderModels } from "./catalog.js";
import { resolveProfile } from "./profile.js";
import { resolveSessionId } from "../../utils/sessionManager.js";

/** Official free-chat shell (awA). */
const SHELL = {
  chat_task: "FREE_INPUT",
  stream: true,
  is_reply: true,
  is_retry: false,
  source: 1,
  version: "3",
  agent_id: "agent_common",
  task_id: "common",
  aliyun_user_type: "",
};


/** Message-level fields kept when present (core Chat / wire overlap). */
const MESSAGE_PASSTHROUGH = [
  "name",
  "tool_calls",
  "tool_call_id",
  "reasoning_content",
  // Secondary / legacy — uncomment if clients send them:
  // "function_call",
  // "refusal",
];

function pushImageUrl(list, url) {
  if (typeof url === "string" && url && !list.includes(url)) list.push(url);
}

/**
 * Official ContentPart: text | image_url{url,detail} | binary{data,mime_type}.
 * @returns {{ content: string|object[], imageUrls: string[] }}
 */
function convertContent(content) {
  if (typeof content === "string") return { content, imageUrls: [] };
  if (content == null) return { content: "", imageUrls: [] };

  if (!Array.isArray(content) && typeof content === "object") {
    return convertContent([content]);
  }
  if (!Array.isArray(content)) {
    return { content: String(content), imageUrls: [] };
  }

  const parts = [];
  const imageUrls = [];

  for (const item of content) {
    if (item == null) continue;
    if (typeof item === "string") {
      parts.push({ type: "text", text: item });
      continue;
    }
    if (typeof item !== "object") continue;

    const type = typeof item.type === "string" ? item.type : "";

    // --- ACTIVE: text ---
    if (type === "text" || (typeof item.text === "string" && !type && !item.image_url && !item.binary)) {
      if (typeof item.text === "string") parts.push({ type: "text", text: item.text });
      continue;
    }

    // --- ACTIVE: Chat / official image_url ---
    if (type === "image_url" || item.image_url) {
      const raw = item.image_url ?? item;
      let url = "";
      let detail;
      if (typeof raw === "string") {
        url = raw;
      } else if (raw && typeof raw === "object") {
        url = typeof raw.url === "string" ? raw.url : "";
        if (typeof raw.detail === "string" && raw.detail) detail = raw.detail;
      }
      if (!url && typeof item.url === "string") url = item.url;
      if (!url) continue;
      const image_url = detail ? { url, detail } : { url };
      parts.push({ type: "image_url", image_url });
      pushImageUrl(imageUrls, url);
      continue;
    }

    // --- ACTIVE: official binary ---
    if (type === "binary" || item.binary || (typeof item.data === "string" && (item.mime_type || item.mimeType))) {
      const bin = item.binary && typeof item.binary === "object" ? item.binary : item;
      const data = typeof bin.data === "string" ? bin.data : "";
      const mime_type =
        (typeof bin.mime_type === "string" && bin.mime_type) ||
        (typeof bin.mimeType === "string" && bin.mimeType) ||
        "";
      if (!data || !mime_type) continue;
      parts.push({ type: "binary", binary: { data, mime_type } });
      if (data.startsWith("data:")) pushImageUrl(imageUrls, data);
      continue;
    }

    // --- COMMENTED: rare client shims (keep for later; not on practical-minimal path) ---
    // // Anthropic-like: { type:"image", source:{ type:"base64", data, media_type } }
    // if ((type === "image" || item.source?.type === "base64") && typeof item.source?.data === "string") {
    //   const mime =
    //     (typeof item.source.media_type === "string" && item.source.media_type) ||
    //     (typeof item.source.mediaType === "string" && item.source.mediaType) ||
    //     "image/png";
    //   const dataUrl = item.source.data.startsWith("data:")
    //     ? item.source.data
    //     : `data:${mime};base64,${item.source.data}`;
    //   parts.push({ type: "image_url", image_url: { url: dataUrl } });
    //   pushImageUrl(imageUrls, dataUrl);
    //   continue;
    // }
    // // Bare data: URL on item.url
    // if (typeof item.url === "string" && /^data:image\//i.test(item.url)) {
    //   parts.push({ type: "image_url", image_url: { url: item.url } });
    //   pushImageUrl(imageUrls, item.url);
    //   continue;
    // }
    // // Content-level tool_call / tool_response parts (Chat usually uses message-level tool_calls)
    // if (type === "tool_call" || type === "tool_response" || item.tool_call || item.tool_response) {
    //   parts.push({ ...item });
    //   continue;
    // }
    // // Unknown typed part passthrough
    // if (type) {
    //   parts.push({ ...item });
    // }
  }

  if (parts.length === 0) return { content: "", imageUrls: [] };
  // Text-only multipart → string (official accepts string content)
  if (imageUrls.length === 0 && parts.every((p) => p.type === "text" && typeof p.text === "string")) {
    return { content: parts.map((p) => p.text).join("\n"), imageUrls: [] };
  }
  return { content: parts, imageUrls };
}

/** Text-only extraction (system hoist / chat_context.text). */
function extractText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.text === "string") parts.push(item.text);
    }
    return parts.join("\n");
  }
  if (typeof content === "object" && typeof content.text === "string") return content.text;
  return String(content);
}

function pickMessageFields(msg) {
  const out = { role: msg.role };
  for (const k of MESSAGE_PASSTHROUGH) {
    if (msg[k] !== undefined) out[k] = msg[k];
  }
  return out;
}

/**
 * @returns {{ messages: object[], systemText: string, imageUrls: string[] }}
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], systemText: "", imageUrls: [] };
  }
  const systemParts = [];
  const out = [];
  const allImageUrls = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;

    // Chat: system + developer → top-level system string (RENAME).
    if (msg.role === "system" || msg.role === "developer") {
      const text = extractText(msg.content);
      if (text) systemParts.push(text);
      continue;
    }

    const { content, imageUrls } = convertContent(msg.content);
    for (const u of imageUrls) pushImageUrl(allImageUrls, u);

    const next = pickMessageFields(msg);
    next.content = content;
    out.push(next);
  }

  return {
    messages: out,
    systemText: systemParts.join("\n\n"),
    imageUrls: allImageUrls,
  };
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const t = extractText(m.content);
    if (t) return t;
    if (Array.isArray(m.content) && m.content.length) return "";
    if (typeof m.content === "string") return m.content;
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

function truncate(s, n) {
  return s && s.length > n ? `${s.slice(0, n)}...` : s || "";
}

/**
 * Resolve Chat reasoning_effort → Qoder parameters.reasoning_effort (pure passthrough).
 * Accepts whatever the client sends and forwards it verbatim; only normalizes the
 * common disabled/off→none alias and drops auto/empty (server default). No filtering.
 * @returns {string|undefined}
 */
function resolveReasoningEffort(body) {
  if (!body || typeof body !== "object") return undefined;
  let raw = body.reasoning_effort;
  if (raw == null && body.reasoning && typeof body.reasoning === "object") {
    raw = body.reasoning.effort;
  }
  if (raw == null) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (!v) return undefined;
  if (v === "disabled" || v === "off") return "none";
  if (v === "x-high") return "xhigh";
  if (v === "auto") return undefined;
  return v;
}

/**
 * Build chat_context (official GhI shape).
 * imageUrls: URL list when vision parts present; else null.
 */
function buildChatContext(lastUser, qoderKey, isReasoning, imageUrls = null) {
  return {
    text: lastUser,
    features: [],
    extra: {
      context: [],
      modelConfig: { key: qoderKey, is_reasoning: !!isReasoning },
      originalContent: lastUser,
    },
    chatPrompt: "",
    imageUrls: imageUrls && imageUrls.length ? imageUrls : null,
  };
}

/**
 * Resolve the context window to advertise as parameters.context_length when the
 * client does not pass one. Mirrors CN desktop: pick from the model's
 * context_config tiers (e.g. 200K/400K/1M); we use the LARGEST tier so long
 * conversations are not prematurely compacted. Falls back to max_input_tokens.
 * @param {object} modelConfig - live model_config block (has context_config / max_input_tokens)
 * @returns {number|undefined}
 */
function resolveMaxContextLen(modelConfig) {
  const cc = modelConfig?.context_config;
  if (cc && typeof cc === "object") {
    let max = 0;
    for (const tier of Object.values(cc)) {
      const n = Number(tier?.token_count);
      if (Number.isFinite(n) && n > max) max = n;
    }
    if (max > 0) return max;
  }
  const mit = Number(modelConfig?.max_input_tokens);
  return Number.isFinite(mit) && mit > 0 ? mit : undefined;
}

/**
 * @param {object} opts
 * @param {string} opts.model
 * @param {object} opts.body - OpenAI chat body
 * @param {object} opts.credentials
 * @param {object|null} [opts.modelConfig] - inject: skip catalog when set
 * @param {boolean} [opts.includeBusiness=false] - awA treats business as optional
 * @param {any} [opts.profile]
 */
async function buildQoderRequestBody({
  model,
  body,
  credentials,
  log,
  proxyOptions,
  signal,
  profile = null,
  modelConfig: modelConfigInject = null,
  includeBusiness = false,
}) {
  const p = resolveProfile(profile);
  const qoderKey = String(model || "").replace(/^qoder\//, "");

  let modelConfig = modelConfigInject;
  if (!modelConfig) {
    modelConfig = await getQoderModelConfig(credentials, qoderKey, {
      log,
      proxyOptions,
      signal,
      profile: p,
    });
    if (!modelConfig) {
      const refreshed = await resolveQoderModels(credentials, {
        forceRefresh: true,
        log,
        proxyOptions,
        signal,
        profile: p,
      });
      const retried = refreshed?.rawConfigs.get(qoderKey);
      if (!retried) {
        throw new Error(
          `qoder: model_config for "${qoderKey}" not yet known (inject modelConfig or fetch model list)`,
        );
      }
      modelConfig = { ...retried, key: qoderKey };
    }
  } else if (!modelConfig.key) {
    modelConfig = { ...modelConfig, key: qoderKey };
  }

  const { messages, systemText, imageUrls } = normalizeMessages(body?.messages || []);
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const isReasoning = !!modelConfig.is_reasoning;
  const maxOutputTokens = Number(modelConfig.max_output_tokens) || 0;

  let maxTokens = 32_768;
  if (maxOutputTokens > 0) maxTokens = maxOutputTokens;
  if (typeof body?.max_tokens === "number" && body.max_tokens > 0 && body.max_tokens < maxTokens) {
    maxTokens = body.max_tokens;
  }
  if (
    typeof body?.max_completion_tokens === "number" &&
    body.max_completion_tokens > 0 &&
    body.max_completion_tokens < maxTokens
  ) {
    maxTokens = body.max_completion_tokens;
  }

  // Prefer original body for last-user text (pre-normalize) so text+image still yields text.
  const lastUser = lastUserText(body?.messages || messages);
  const psd = credentials?.providerSpecificData || {};
  // awA: request_id / request_set_id / chat_record_id share one id by default.
  const requestId = randomUUID();
  // Conversation-stable session id: client-provided id > assistant-text fingerprint > connection fallback.
  // Mirrors CN desktop (one UUID per conversation) as closely as Chat Completions allows.
  const sessionId = resolveSessionId({
    headers: credentials?.rawHeaders,
    body,
    connectionId: credentials?.connectionId || psd.userId || qoderKey,
    scope: "qoder",
  });

  const parameters = { max_tokens: maxTokens };
  const effort = resolveReasoningEffort(body);
  if (effort !== undefined) parameters.reasoning_effort = effort;
  else if (isReasoning) parameters.reasoning_effort = "high"; // default when client omits
  // CN: max_thinking_tokens only sent when is_reasoning && thinkingBudget defined.
  if (isReasoning && typeof body?.max_thinking_tokens === "number") {
    parameters.max_thinking_tokens = body.max_thinking_tokens;
  }
  if (typeof body?.tool_choice !== "undefined") parameters.tool_choice = body.tool_choice;
  // Context window (official: parameters.context_length). Client value wins; else the
  // model's largest context_config tier (CN desktop sends its selected tier here).
  if (typeof body?.context_length === "number" && body.context_length > 0) {
    parameters.context_length = body.context_length;
  } else if (typeof body?.contextWindow === "number" && body.contextWindow > 0) {
    parameters.context_length = body.contextWindow;
  } else {
    const ctxLen = resolveMaxContextLen(modelConfig);
    if (ctxLen) parameters.context_length = ctxLen;
  }

  const shellImageUrls = imageUrls.length ? imageUrls : null;

  // CN desktop (JnI) trims model_config to 10 fields; strip garbage before sending.
  const trimmedModelConfig = {
    key: modelConfig.key || qoderKey,
    display_name: modelConfig.display_name || modelConfig.displayName || qoderKey,
    model: "",
    format: modelConfig.format || "openai",
    is_vl: !!modelConfig.is_vl,
    is_reasoning: !!modelConfig.is_reasoning,
    api_key: "",
    url: "",
    source: modelConfig.source || "system",
    max_input_tokens: modelConfig.max_input_tokens ?? 200000,
  };

  const payload = {
    request_id: requestId,
    request_set_id: requestId,
    chat_record_id: requestId,
    session_id: sessionId,
    ...SHELL,
    session_type: p.sessionType,
    model_config: trimmedModelConfig,
    system: systemText,
    messages,
    tools,
    parameters,
    chat_context: buildChatContext(lastUser, qoderKey, isReasoning, shellImageUrls),
  };

  // awA spreads business only when present — default omit (ADD optional).
  if (includeBusiness || p.includeBusiness) {
    payload.business = {
      product: p.businessProduct,
      version: p.businessVersion,
      type: p.businessType || "agent",
      stage: "init",
      id: randomUUID(),
      name: truncate(lastUser, 30),
      begin_at: Date.now(),
    };
  }

  return { qoderKey, payload, modelConfig };
}

/**
 * @param {object} opts
 */
export async function buildChatPayload(opts) {
  return buildQoderRequestBody(opts);
}

export { normalizeMessages, buildQoderRequestBody, resolveReasoningEffort, SHELL };
