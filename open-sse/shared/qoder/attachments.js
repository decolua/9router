/**
 * Native qodercli does NOT stuff image/PDF bytes into agent_chat_generation.
 * It PUTs them to /algo/api/v2/image/upload (COSY-signed multipart) and then
 * sends the returned OSS URL. Agents like Claude Code send OpenAI/Claude
 * data-URIs instead, which 9router previously forwarded verbatim — 10MB
 * images become 30MB+ JSON and upstream 413s even though the model window
 * is ~200k tokens.
 *
 * This module:
 *   1. Uploads inlined images to Qoder's file API (cached by sha256).
 *   2. Replaces huge non-image file blocks with a short stub.
 *   3. Caps leftover data-URIs so the chat JSON stays small.
 */

import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseDataUri } from "../../translator/concerns/image.js";
import { OPENAI_BLOCK, CLAUDE_BLOCK } from "../../translator/schema/blocks.js";
import { MAX_IMAGE_BYTES } from "../../config/mediaConfig.js";
import { buildCosyHeaders } from "./cosy.js";
import {
  QODER_IMAGE_UPLOAD_SIG_PATH,
  QODER_INLINE_FALLBACK_MAX_BYTES,
  QODER_MAX_PAYLOAD_BYTES,
  qoderInferenceBase,
} from "./constants.js";

const IMAGE_MIME_RE = /^image\//i;
const DATA_URI_RE = /data:[^;]+;base64,[A-Za-z0-9+/=\s]+/g;

function mimeExt(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  if (m.includes("bmp")) return "bmp";
  if (m.includes("pdf")) return "pdf";
  return "bin";
}

function decodedBytes(b64) {
  if (typeof b64 !== "string" || !b64) return 0;
  const compact = b64.replace(/\s/g, "");
  return Math.floor(compact.length * 3 / 4);
}

function stubText({ name, mime, bytes, reason }) {
  const label = name || mime || "attachment";
  const size = bytes ? `, ${bytes} bytes` : "";
  return `[file omitted: ${label}${size} — ${reason}]`;
}

export function buildMultipartFile(buffer, { fieldName = "file", fileName, mediaType } = {}) {
  const boundary = `----9routerQoder${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const filename = fileName || `upload.${mimeExt(mediaType)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mediaType || "application/octet-stream"}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, buffer, tail]);
  return { boundary, body };
}

function extractUrlFromUploadResponse(json) {
  if (!json || typeof json !== "object") return null;
  const result = json.result && typeof json.result === "object" ? json.result : json;
  const arrays = [result.imageUrls, result.image_urls, json.imageUrls, json.image_urls];
  for (const arr of arrays) {
    if (Array.isArray(arr) && typeof arr[0] === "string" && arr[0]) return arr[0];
  }
  const keys = ["imageUrl", "image_url", "url", "ossUrl", "oss_url", "originalUrl", "originUrl", "link", "image"];
  for (const key of keys) {
    const v = result[key] ?? json[key];
    if (typeof v === "string" && v) return v;
  }
  if (typeof json.body === "string") {
    try { return extractUrlFromUploadResponse(JSON.parse(json.body)); } catch { /* ignore */ }
  }
  return null;
}

async function defaultUploadImage({ buffer, mediaType, credentials, proxyOptions, signal }) {
  const requestId = uuidv4();
  const url = `${qoderInferenceBase(credentials)}${`/algo${QODER_IMAGE_UPLOAD_SIG_PATH}`}?request_id=${requestId}`;
  const { boundary, body } = buildMultipartFile(buffer, {
    fileName: `image.${mimeExt(mediaType)}`,
    mediaType: mediaType || "application/octet-stream",
  });
  const psd = credentials?.providerSpecificData || {};
  const cosyHeaders = buildCosyHeaders(body, url, {
    userId: psd.userId,
    authToken: credentials.accessToken,
    name: credentials.displayName || "",
    email: credentials.email || "",
    machineId: psd.machineId || "",
  });
  const headers = {
    ...cosyHeaders,
    Accept: "application/json",
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": String(body.length),
    "AI-CLIENT-TIMESTAMP": String(Math.floor(Date.now() / 1000)),
    "Accept-Encoding": "identity",
  };
  const res = await proxyAwareFetch(
    url,
    { method: "PUT", headers, body, signal },
    proxyOptions,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  const json = await res.json().catch(() => null);
  const uploaded = extractUrlFromUploadResponse(json);
  if (!uploaded) throw new Error("upload response missing url");
  return uploaded;
}

async function uploadImageData({ base64, mediaType, credentials, proxyOptions, signal, log, uploadFn, cache }) {
  const compact = String(base64 || "").replace(/\s/g, "");
  if (!compact) return null;
  const bytes = decodedBytes(compact);
  if (bytes > MAX_IMAGE_BYTES) {
    log?.warn?.("QODER", `image ${bytes} bytes exceeds upload cap, stubbing`);
    return { stub: true, bytes, mime: mediaType };
  }
  let buffer;
  try {
    buffer = Buffer.from(compact, "base64");
  } catch {
    return { stub: true, bytes, mime: mediaType };
  }
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (cache?.has(digest)) return { url: cache.get(digest), bytes, mime: mediaType };

  const doUpload = uploadFn || defaultUploadImage;
  try {
    const url = await doUpload({ buffer, mediaType, credentials, proxyOptions, signal });
    if (typeof url === "string" && url) {
      cache?.set(digest, url);
      return { url, bytes, mime: mediaType };
    }
  } catch (err) {
    log?.warn?.("QODER", `image upload failed (${err.message}); ${bytes <= QODER_INLINE_FALLBACK_MAX_BYTES ? "keeping inline" : "stubbing"}`);
  }
  if (bytes <= QODER_INLINE_FALLBACK_MAX_BYTES) return { keep: true, bytes, mime: mediaType };
  return { stub: true, bytes, mime: mediaType };
}

function imageUrlBlock(url) {
  return { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url } };
}

async function rewriteBlock(block, ctx) {
  if (!block || typeof block !== "object") return block;

  if (block.type === OPENAI_BLOCK.IMAGE_URL) {
    const raw = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
    if (typeof raw !== "string" || !raw) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return imageUrlBlock(raw);
    const parsed = parseDataUri(raw);
    if (!parsed) return { type: OPENAI_BLOCK.TEXT, text: stubText({ name: "attachment", reason: "unreadable data URI" }) };
    if (!IMAGE_MIME_RE.test(parsed.mimeType)) {
      return { type: OPENAI_BLOCK.TEXT, text: stubText({ name: "file", mime: parsed.mimeType, bytes: decodedBytes(parsed.base64), reason: "non-image bytes are not inlined into Qoder context" }) };
    }
    const up = await uploadImageData({ ...ctx, base64: parsed.base64, mediaType: parsed.mimeType });
    if (up?.url) return imageUrlBlock(up.url);
    if (up?.keep) return imageUrlBlock(raw);
    return { type: OPENAI_BLOCK.TEXT, text: stubText({ name: "image", mime: parsed.mimeType, bytes: up?.bytes, reason: "upload failed; not inlined" }) };
  }

  if (block.type === OPENAI_BLOCK.IMAGE || block.type === CLAUDE_BLOCK.IMAGE) {
    const src = block.source || {};
    if (src.type === "url" && typeof src.url === "string") return imageUrlBlock(src.url);
    if (src.type === "base64" && src.data) {
      const mime = src.media_type || "image/png";
      const up = await uploadImageData({ ...ctx, base64: src.data, mediaType: mime });
      if (up?.url) return imageUrlBlock(up.url);
      if (up?.keep) return imageUrlBlock(`data:${mime};base64,${src.data}`);
      return { type: OPENAI_BLOCK.TEXT, text: stubText({ name: "image", mime, bytes: up?.bytes, reason: "upload failed; not inlined" }) };
    }
  }

  if (block.type === OPENAI_BLOCK.FILE && block.file) {
    const file = block.file;
    const name = file.filename || file.name || "file";
    const dataUri = typeof file.file_data === "string" ? file.file_data : null;
    const parsed = dataUri ? parseDataUri(dataUri) : null;
    const b64 = parsed?.base64 || (typeof file.file_data === "string" && !file.file_data.startsWith("data:") ? file.file_data : null);
    const mime = parsed?.mimeType || file.format || "application/octet-stream";
    if (b64 && IMAGE_MIME_RE.test(mime)) {
      const up = await uploadImageData({ ...ctx, base64: b64, mediaType: mime });
      if (up?.url) return imageUrlBlock(up.url);
    }
    return { type: OPENAI_BLOCK.TEXT, text: stubText({ name, mime, bytes: decodedBytes(b64 || ""), reason: "Qoder reads documents via its file API, not inlined bytes" }) };
  }

  if (block.type === CLAUDE_BLOCK.DOCUMENT && block.source) {
    const src = block.source;
    const name = block.title || "document";
    if (src.type === "base64" && src.data) {
      const mime = src.media_type || "application/pdf";
      if (IMAGE_MIME_RE.test(mime)) {
        const up = await uploadImageData({ ...ctx, base64: src.data, mediaType: mime });
        if (up?.url) return imageUrlBlock(up.url);
      }
      return { type: OPENAI_BLOCK.TEXT, text: stubText({ name, mime, bytes: decodedBytes(src.data), reason: "Qoder reads documents via its file API, not inlined bytes" }) };
    }
  }

  if (typeof block.text === "string" && block.text.includes("data:") && block.text.length > 8192) {
    const next = block.text.replace(DATA_URI_RE, (m) => {
      const parsed = parseDataUri(m.trim());
      const bytes = parsed ? decodedBytes(parsed.base64) : m.length;
      if (bytes <= QODER_INLINE_FALLBACK_MAX_BYTES) return m;
      return stubText({ mime: parsed?.mimeType, bytes, reason: "inlined data URI stripped from Qoder context" });
    });
    return { ...block, text: next };
  }

  return block;
}

async function rewriteContent(content, ctx) {
  if (typeof content === "string") {
    if (content.includes("data:") && content.length > 8192) {
      return content.replace(DATA_URI_RE, (m) => {
        const parsed = parseDataUri(m.trim());
        const bytes = parsed ? decodedBytes(parsed.base64) : m.length;
        if (bytes <= QODER_INLINE_FALLBACK_MAX_BYTES) return m;
        return stubText({ mime: parsed?.mimeType, bytes, reason: "inlined data URI stripped from Qoder context" });
      });
    }
    return content;
  }
  if (!Array.isArray(content)) return content;
  const out = [];
  for (const block of content) {
    const next = await rewriteBlock(block, ctx);
    if (next == null) continue;
    out.push(next);
  }
  return out.length ? out : "";
}

function payloadBytes(messages) {
  try {
    return Buffer.byteLength(JSON.stringify(messages), "utf8");
  } catch {
    return 0;
  }
}

function stripRemainingDataUris(messages) {
  for (const msg of messages || []) {
    if (typeof msg?.content === "string" && msg.content.includes("data:")) {
      msg.content = msg.content.replace(DATA_URI_RE, (m) =>
        stubText({ bytes: m.length, reason: "payload over Qoder size budget" }),
      );
    } else if (Array.isArray(msg?.content)) {
      msg.content = msg.content.map((block) => {
        if (block?.type === OPENAI_BLOCK.IMAGE_URL) {
          const raw = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
          if (typeof raw === "string" && raw.startsWith("data:")) {
            return { type: OPENAI_BLOCK.TEXT, text: stubText({ name: "image", reason: "payload over Qoder size budget" }) };
          }
        }
        if (typeof block?.text === "string" && block.text.includes("data:")) {
          return { ...block, text: block.text.replace(DATA_URI_RE, (m) =>
            stubText({ bytes: m.length, reason: "payload over Qoder size budget" }),
          ) };
        }
        return block;
      });
    }
  }
}

/**
 * Rewrite OpenAI-shaped messages in place: upload images, stub huge files.
 * @returns {Promise<{imageUrls: string[], uploaded: number, stubbed: number}>}
 */
export async function rewriteQoderMessageAttachments(messages, {
  credentials,
  log,
  proxyOptions = null,
  signal = null,
  uploadFn = null,
} = {}) {
  const stats = { imageUrls: [], uploaded: 0, stubbed: 0 };
  if (!Array.isArray(messages) || messages.length === 0) return stats;

  const ctx = { credentials, log, proxyOptions, signal, uploadFn, cache: new Map() };

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    if (Array.isArray(msg.images)) {
      // Ollama-style sidecar; fold into content so normalizeMessages can see them.
      const extras = msg.images.map((url) => imageUrlBlock(String(url)));
      msg.content = Array.isArray(msg.content)
        ? [...msg.content, ...extras]
        : [{ type: OPENAI_BLOCK.TEXT, text: typeof msg.content === "string" ? msg.content : "" }, ...extras];
      delete msg.images;
    }
    msg.content = await rewriteContent(msg.content, ctx);
  }

  // Collect surviving http(s) image URLs for callers that want image_urls.
  for (const msg of messages) {
    if (!Array.isArray(msg?.content)) continue;
    for (const block of msg.content) {
      const url = block?.type === OPENAI_BLOCK.IMAGE_URL
        ? (typeof block.image_url === "string" ? block.image_url : block.image_url?.url)
        : null;
      if (typeof url === "string" && /^https?:\/\//i.test(url)) stats.imageUrls.push(url);
      if (block?.type === OPENAI_BLOCK.TEXT && typeof block.text === "string" && block.text.startsWith("[file omitted:")) stats.stubbed += 1;
    }
  }
  stats.uploaded = stats.imageUrls.length;

  if (payloadBytes(messages) > QODER_MAX_PAYLOAD_BYTES) {
    log?.warn?.("QODER", `request still ${payloadBytes(messages)} bytes after rewrite; stripping leftover data URIs`);
    stripRemainingDataUris(messages);
  }

  return stats;
}

/** Test helper kept for callers; upload memo is now per-request. */
export function clearQoderUploadCache() {}

export const __test__ = {
  extractUrlFromUploadResponse,
  decodedBytes,
  stubText,
  payloadBytes,
};
