// ChatGPT Web attachment extraction + resolution.
//
// 9router variant: data-URL sources only — remote URL fetching is not
// forwarded (the caller can inline remote media as data URLs upstream).
// Images are sniffed for format + dimensions before upload.

import { sniffImageFormat, sniffImageDimensions, MAX_IMAGE_DECODE_EDGE, MAX_IMAGE_PIXELS } from "./imageSniff.js";

export const MAX_CHATGPT_WEB_ATTACHMENTS = 10;
export const MAX_CHATGPT_WEB_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_CHATGPT_WEB_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_CHATGPT_WEB_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const MAX_FILENAME_CHARS = 180;

const IMAGE_EXTENSIONS = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class ChatGptWebAttachmentError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChatGptWebAttachmentError";
    this.status = 400;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeFilename(value, fallback) {
  const leaf = (value ?? "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const safe = leaf || fallback;
  return safe.slice(0, MAX_FILENAME_CHARS);
}

function mimeFromDataUrl(ref) {
  const match = /^data:([^;,]+);base64,/i.exec(ref);
  return match?.[1]?.trim().toLowerCase();
}

function extensionForImageRef(ref) {
  const mime = mimeFromDataUrl(ref);
  if (mime && IMAGE_EXTENSIONS[mime]) return IMAGE_EXTENSIONS[mime];
  try {
    const match = /\.([a-zA-Z0-9]{2,5})$/.exec(new URL(ref).pathname);
    if (match && ["gif", "jpeg", "jpg", "png", "webp"].includes(match[1].toLowerCase())) {
      return match[1].toLowerCase().replace("jpeg", "jpg");
    }
  } catch {
    // Data URLs and malformed URLs fall back to PNG; resolution validates the source later.
  }
  return "png";
}

function filePayload(part) {
  return isRecord(part.file) ? part.file : part;
}

function fileSourceFromPart(part) {
  const file = filePayload(part);
  const fileData = optionalString(file.file_data ?? part.file_data);
  const mimeType = optionalString(file.mime_type ?? part.mime_type)?.toLowerCase();
  let ref = fileData;
  if (!ref) {
    throw new ChatGptWebAttachmentError("ChatGPT Web file input requires base64 file_data");
  }
  if (!ref.toLowerCase().startsWith("data:")) {
    ref = `data:${mimeType ?? "application/octet-stream"};base64,${ref}`;
  }
  return {
    kind: "file",
    ref,
    name: sanitizeFilename(optionalString(file.filename ?? part.filename), "attachment.bin"),
    ...(mimeType ? { mimeType } : {}),
  };
}

export function isChatGptWebAttachmentContentPart(value) {
  if (typeof value === "string") return value.toLowerCase().startsWith("data:image/");
  if (!isRecord(value)) return false;
  const type = optionalString(value.type)?.toLowerCase();
  return ["file", "image", "image_url", "input_file", "input_image"].includes(type ?? "");
}

function extractImageAttachmentSources(messages) {
  const sources = [];
  for (const [messageIndex, message] of (messages || []).entries()) {
    if (!Array.isArray(message?.content)) continue;
    for (const [partIndex, part] of message.content.entries()) {
      if (!isRecord(part)) continue;
      const type = optionalString(part.type)?.toLowerCase();
      let ref;
      if (type === "image_url" && isRecord(part.image_url)) ref = optionalString(part.image_url.url);
      else if (type === "input_image") ref = optionalString(part.image_url ?? part.url);
      else if (type === "image" && typeof part.source === "string") ref = optionalString(part.source);
      if (!ref) continue;
      const explicitName = optionalString(part.filename ?? part.name);
      const index = sources.length + 1;
      const mimeType = mimeFromDataUrl(ref);
      sources.push({
        kind: "image",
        ref,
        name: sanitizeFilename(explicitName, `image-${index}.${extensionForImageRef(ref)}`),
        ...(mimeType ? { mimeType } : {}),
        messageIndex,
        partIndex,
      });
    }
  }
  return sources;
}

function extractFileAttachmentSources(messages) {
  const sources = [];
  for (const message of messages || []) {
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content) {
      if (!isRecord(part)) continue;
      const type = optionalString(part.type)?.toLowerCase();
      if (type === "file" || type === "input_file") sources.push(fileSourceFromPart(part));
    }
  }
  return sources;
}

export function extractChatGptWebAttachmentSources(messages) {
  const sources = [
    ...extractImageAttachmentSources(messages),
    ...extractFileAttachmentSources(messages),
  ];
  if (sources.length > MAX_CHATGPT_WEB_ATTACHMENTS) {
    throw new ChatGptWebAttachmentError(
      `ChatGPT Web accepts at most ${MAX_CHATGPT_WEB_ATTACHMENTS} attachments per request`
    );
  }
  return sources;
}

function decodeDataUrl(ref) {
  const comma = ref.indexOf(",");
  if (comma < 0) throw new ChatGptWebAttachmentError("Attachment data URL is malformed");
  const header = ref.slice(5, comma);
  if (!/(?:^|;)base64(?:;|$)/i.test(header)) {
    throw new ChatGptWebAttachmentError("Attachment data URL must be base64 encoded");
  }
  const mimeType = (header.split(";")[0] || "application/octet-stream").toLowerCase();
  const raw = ref.slice(comma + 1);
  if (raw.length > MAX_CHATGPT_WEB_FILE_BYTES * 2) {
    throw new ChatGptWebAttachmentError("Attachment is too large");
  }
  const normalized = raw.replace(/\s/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new ChatGptWebAttachmentError("Attachment contains invalid base64 data");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (
    !bytes.length ||
    bytes.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")
  ) {
    throw new ChatGptWebAttachmentError("Attachment contains invalid base64 data");
  }
  return { bytes, mimeType };
}

function validateImage(bytes, declaredMimeType) {
  const format = sniffImageFormat(bytes);
  const dimensions = sniffImageDimensions(bytes);
  const detectedMime = format === "jpeg" ? "image/jpeg" : format ? `image/${format}` : undefined;
  if (!detectedMime || !dimensions) {
    throw new ChatGptWebAttachmentError("Image attachment is undecodable or unsupported");
  }
  if (declaredMimeType.startsWith("image/") && declaredMimeType !== detectedMime) {
    const jpegAlias = declaredMimeType === "image/jpg" && detectedMime === "image/jpeg";
    if (!jpegAlias) throw new ChatGptWebAttachmentError("Image attachment type does not match its data");
  }
  if (
    Math.max(dimensions.width, dimensions.height) > MAX_IMAGE_DECODE_EDGE ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new ChatGptWebAttachmentError("Image attachment dimensions are too large");
  }
  return { mimeType: detectedMime, width: dimensions.width, height: dimensions.height };
}

export async function resolveChatGptWebAttachments(sources) {
  if (sources.length > MAX_CHATGPT_WEB_ATTACHMENTS) {
    throw new ChatGptWebAttachmentError(
      `ChatGPT Web accepts at most ${MAX_CHATGPT_WEB_ATTACHMENTS} attachments per request`
    );
  }
  const resolved = [];
  let totalBytes = 0;
  for (const source of sources) {
    const cap = source.kind === "image" ? MAX_CHATGPT_WEB_IMAGE_BYTES : MAX_CHATGPT_WEB_FILE_BYTES;
    if (!source.ref.toLowerCase().startsWith("data:")) {
      throw new ChatGptWebAttachmentError("ChatGPT Web attachments must be data URLs");
    }
    const loaded = decodeDataUrl(source.ref);
    if (!loaded.bytes.length) throw new ChatGptWebAttachmentError("Attachment is empty");
    if (loaded.bytes.length > cap) throw new ChatGptWebAttachmentError("Attachment is too large");
    totalBytes += loaded.bytes.length;
    if (totalBytes > MAX_CHATGPT_WEB_TOTAL_ATTACHMENT_BYTES) {
      throw new ChatGptWebAttachmentError("Combined ChatGPT Web attachments are too large");
    }

    if (source.kind === "image") {
      const image = validateImage(loaded.bytes, source.mimeType ?? loaded.mimeType);
      resolved.push({
        kind: "image",
        name: source.name,
        mimeType: image.mimeType,
        size: loaded.bytes.length,
        data: loaded.bytes,
        width: image.width,
        height: image.height,
      });
      continue;
    }
    resolved.push({
      kind: "file",
      name: source.name,
      mimeType: source.mimeType ?? loaded.mimeType,
      size: loaded.bytes.length,
      data: loaded.bytes,
    });
  }
  return resolved;
}
