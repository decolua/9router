// ChatGPT Web image generation over plain HTTP (picture_v2 flow).
//
// No browser: sentinel.js mints the challenge headers, then prepare →
// conversation (SSE) → conversation poll → file download run as ordinary
// fetches with the stored cookie jar.

import { randomUUID } from "node:crypto";
import { SENTINEL_HEADERS, fetchSentinelHeaders } from "./sentinel.js";

const MAX_SSE_BYTES = 16 * 1024 * 1024;
const MAX_CONVERSATION_BYTES = 32 * 1024 * 1024;
const SSE_DEADLINE_MS = 90000;
const POLL_INITIAL_WAIT_MS = 5000;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 240000;
const DOWNLOAD_TIMEOUT_MS = 90000;
const CONTENT_POLICY_RE =
  /(content policy|violat(?:es|ed|ion)|can't create|cannot create|i can't generate|i cannot generate|not able to create|unable to create|safety)/i;

const DEFAULT_TIMEZONE = "UTC";
const DEFAULT_TZ_OFFSET_MIN = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ChatGptWebImageError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ChatGptWebImageError";
    if (status) this.status = status;
  }
}

function fetchWithTimeout(url, options, timeoutMs, outerSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onAbort, { once: true });
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onAbort);
  });
}

/** Strip `; chunk` noise and keep the cookie pairs a request actually needs. */
export function cookieHeader(storageState) {
  const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];
  return cookies
    .filter((cookie) => cookie?.name && typeof cookie.value === "string")
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/** Read an SSE body up to a byte cap, stopping at the deadline. */
async function readSse(response, limit, deadlineMs) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + deadlineMs;
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      text += decoder.decode(value, { stream: true });
      if (text.length > limit) break;
    }
  } catch {
    // A deadline abort lands here — the partial text is what we want.
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

const collectIds = (text, fileIds, sedimentIds) => {
  const addUnique = (list, value) => {
    if (value && !list.includes(value)) list.push(value);
  };
  for (const match of text.matchAll(/file-service:\/\/([A-Za-z0-9_-]+)/g)) addUnique(fileIds, match[1]);
  for (const match of text.matchAll(/\bfile_00000000[a-f0-9]{24}\b/g)) addUnique(fileIds, match[0]);
  for (const match of text.matchAll(/sediment:\/\/([A-Za-z0-9_-]+)/g)) addUnique(sedimentIds, match[1]);
};

function authHeaders({ accessToken, userAgent, cookie, sentinel }) {
  return {
    ...sentinel,
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": userAgent,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

/** prepare → conversation SSE. Returns the conversation id plus any ids seen. */
async function runImageConversation(ctx, prompt, sizeHint, signal) {
  const { baseUrl } = ctx;
  const headers = authHeaders(ctx);

  const prepare = await fetchWithTimeout(`${baseUrl}/backend-api/f/conversation/prepare`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      action: "next",
      fork_from_shared_post: false,
      parent_message_id: randomUUID(),
      model: "auto",
      client_prepare_state: "success",
      timezone_offset_min: DEFAULT_TZ_OFFSET_MIN,
      timezone: DEFAULT_TIMEZONE,
      conversation_mode: { kind: "primary_assistant" },
      system_hints: ["picture_v2"],
      partial_query: {
        id: randomUUID(),
        author: { role: "user" },
        content: { content_type: "text", parts: [prompt] },
      },
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: { app_name: "chatgpt.com" },
    }),
  }, 60000, signal);
  if (!prepare.ok) {
    throw new ChatGptWebImageError(`ChatGPT prepare failed (HTTP ${prepare.status})`, prepare.status || 502);
  }
  const prepareJson = await prepare.json().catch(() => null);
  const conduitToken = prepareJson?.conduit_token || "";

  const text = sizeHint ? `${prompt} (aspect ratio ${sizeHint})` : prompt;
  const conversation = await fetchWithTimeout(`${baseUrl}/backend-api/f/conversation`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Conduit-Token": conduitToken,
      "X-Oai-Turn-Trace-Id": randomUUID(),
    },
    body: JSON.stringify({
      action: "next",
      messages: [{
        id: randomUUID(),
        author: { role: "user" },
        create_time: Date.now() / 1000,
        content: { content_type: "text", parts: [text] },
        metadata: {
          developer_mode_connector_ids: [],
          selected_github_repos: [],
          selected_all_github_repos: false,
          system_hints: ["picture_v2"],
          serialization_metadata: { custom_symbol_offsets: [] },
        },
      }],
      parent_message_id: randomUUID(),
      model: "auto",
      client_prepare_state: "sent",
      timezone_offset_min: DEFAULT_TZ_OFFSET_MIN,
      timezone: DEFAULT_TIMEZONE,
      conversation_mode: { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: ["picture_v2"],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: {
        is_dark_mode: false,
        time_since_loaded: 1200,
        page_height: 1072,
        page_width: 1724,
        pixel_ratio: 1.2,
        screen_height: 1440,
        screen_width: 2560,
        app_name: "chatgpt.com",
      },
      paragen_cot_summary_display_override: "allow",
      force_parallel_switch: "auto",
    }),
  }, SSE_DEADLINE_MS + 15000, signal);
  if (!conversation.ok) {
    throw new ChatGptWebImageError(`ChatGPT conversation failed (HTTP ${conversation.status})`, conversation.status || 502);
  }
  const sseText = await readSse(conversation, MAX_SSE_BYTES, SSE_DEADLINE_MS);

  const conversationId = (sseText.match(/"conversation_id"\s*:\s*"([0-9a-f-]{36})"/) || [])[1] || "";
  const fileIds = [];
  const sedimentIds = [];
  collectIds(sseText, fileIds, sedimentIds);
  return { conversationId, fileIds, sedimentIds };
}

/** Poll the conversation document until an image_gen record shows up. */
async function pollConversationImages(ctx, conversationId, initial, { signal, log }) {
  const started = Date.now();
  const fileIds = [...initial.fileIds];
  const sedimentIds = [...initial.sedimentIds];
  const headers = { ...authHeaders(ctx), Accept: "application/json" };

  await sleep(POLL_INITIAL_WAIT_MS);
  while (Date.now() - started <= POLL_TIMEOUT_MS) {
    if (signal?.aborted) throw new Error("Request aborted");

    const res = await fetchWithTimeout(`${ctx.baseUrl}/backend-api/conversation/${conversationId}`, { headers }, 30000, signal)
      .catch(() => null);
    if (!res?.ok) {
      log?.debug?.("CGPT-WEB-IMG", `conversation poll status ${res?.status ?? "network"}, retrying`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_CONVERSATION_BYTES) {
      throw new ChatGptWebImageError("ChatGPT conversation document is unexpectedly large", 502);
    }
    const text = await res.text().catch(() => "");
    if (text.length > MAX_CONVERSATION_BYTES) {
      throw new ChatGptWebImageError("ChatGPT conversation document is unexpectedly large", 502);
    }

    collectIds(text, fileIds, sedimentIds);
    if (fileIds.length > 0 || sedimentIds.length > 0) {
      return { fileIds: fileIds.filter((id) => id !== "file_upload"), sedimentIds };
    }
    if (CONTENT_POLICY_RE.test(text) && /"is_error"\s*:\s*true/.test(text)) {
      throw new ChatGptWebImageError("ChatGPT refused the image request (content policy)", 400);
    }
    // A depleted account reports a tool-level rate limit instead of an image:
    // fail fast so the shared fallback loop can try the next connection.
    if (/ChatGPTAgentToolRateLimitException|Free plan limit for image generation/i.test(text)) {
      throw new ChatGptWebImageError(
        "ChatGPT account has hit its image generation quota — add another account or wait for the reset",
        429
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new ChatGptWebImageError("ChatGPT image generation timed out", 504);
}

async function downloadUrl(url, signal) {
  const res = await fetchWithTimeout(url, {}, DOWNLOAD_TIMEOUT_MS, signal);
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) return null;
  return {
    b64: buffer.toString("base64"),
    mime: (res.headers.get("content-type") || "image/png").split(";")[0],
  };
}

/** Resolve one generated id into { b64, mime }. */
async function downloadGeneratedImage(ctx, conversationId, { fileIds, sedimentIds }, signal) {
  const jsonHeaders = { ...authHeaders(ctx), Accept: "application/json" };

  for (const fileId of fileIds) {
    const res = await fetchWithTimeout(`${ctx.baseUrl}/backend-api/files/${fileId}/download`, { headers: jsonHeaders }, 60000, signal)
      .catch(() => null);
    if (!res?.ok) continue;
    const body = await res.json().catch(() => null);
    const url = body?.download_url || body?.url || "";
    if (!url) continue;
    const media = await downloadUrl(url, signal);
    if (media) return media;
  }

  for (const sedimentId of sedimentIds) {
    const res = await fetchWithTimeout(
      `${ctx.baseUrl}/backend-api/conversation/${conversationId}/attachment/${sedimentId}/download`,
      { headers: jsonHeaders },
      60000,
      signal
    ).catch(() => null);
    if (!res?.ok) continue;
    const body = await res.json().catch(() => null);
    const url = body?.download_url || body?.url || "";
    if (!url) continue;
    const media = await downloadUrl(url, signal);
    if (media) return media;
  }

  throw new ChatGptWebImageError("ChatGPT image generation produced no downloadable file", 502);
}

/**
 * Generate one image and return base64 bytes. Plain HTTP — no browser.
 *
 * @param {object} options
 * @param {string} options.baseUrl - e.g. https://chatgpt.com
 * @param {string} options.accessToken - from /api/auth/session
 * @param {string} options.cookie - Cookie header from the stored credential
 * @param {string} options.userAgent
 * @param {string} options.prompt
 * @param {string} [options.sizeHint]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{b64: string, mime: string}>}
 */
export async function generateChatGptWebImageHttp({
  baseUrl,
  accessToken,
  cookie,
  userAgent,
  prompt,
  sizeHint,
  signal,
  log,
}) {
  if (!accessToken) throw new ChatGptWebImageError("ChatGPT session has no access token", 401);
  if (signal?.aborted) throw new Error("Request aborted");

  const sentinel = await fetchSentinelHeaders({ baseUrl, accessToken, userAgent, signal });
  const ctx = { baseUrl, accessToken, cookie, userAgent, sentinel };

  const initial = await runImageConversation(ctx, prompt, sizeHint, signal);
  if (!initial.conversationId && initial.fileIds.length === 0 && initial.sedimentIds.length === 0) {
    throw new ChatGptWebImageError("ChatGPT image conversation produced no conversation id", 502);
  }
  const ids = initial.fileIds.length > 0 || initial.sedimentIds.length > 0
    ? initial
    : await pollConversationImages(ctx, initial.conversationId, initial, { signal, log });

  return downloadGeneratedImage(ctx, initial.conversationId, ids, signal);
}

export { SENTINEL_HEADERS };
