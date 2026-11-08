// Operational webhook adapters: Discord, Slack and Standard Webhooks signed JSON.
// Pure formatting/classification only. No DB, network, timers or globals.
// Three destination builders plus one response classifier; not a plugin framework.
import { createHmac } from "node:crypto";
import { WEBHOOK_LIMITS } from "@/shared/constants/webhooks.js";

const ENVELOPE_FIELDS = ["id", "type", "schema_version", "occurred_at", "severity", "data"];
const DATA_FIELDS = ["requestId", "modality", "provider", "model", "connectionId",
  "statusCode", "errorClass", "partialResponse"];
const DETAIL_FIELDS = ["provider", "model", "modality", "connectionId", "requestId",
  "statusCode", "errorClass", "partialResponse"];
const FIELD_LIMIT = 256;
const DISCORD_CONTENT_LIMIT = 2000;
const DISCORD_TITLE_LIMIT = 256;
const DISCORD_DESCRIPTION_LIMIT = 4096;
const DISCORD_EMBED_TOTAL_LIMIT = 6000;
const SLACK_TEXT_LIMIT = 3000;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function neutralize(value) {
  // Zero-width break keeps the text readable while making Discord/Slack mention
  // tokens such as @everyone, <@123> and <!channel> non-executable.
  return String(value).replace(/</g, "<\u200B").replace(/@/g, "@\u200B");
}

function truncateCodePoints(value, max) {
  if (value.length <= max) return value;
  return Array.from(value).slice(0, max).join("");
}

function truncateUtf16Units(value, max) {
  if (value.length <= max) return value;
  let end = Math.max(0, max);
  if (end > 0) {
    const last = value.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return value.slice(0, end);
}

function safeText(value, limit = FIELD_LIMIT) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "";
  return truncateUtf16Units(neutralize(value), limit);
}

function detailLines(event) {
  const data = event?.data;
  if (!data || typeof data !== "object") return [];
  const lines = [];
  for (const key of DETAIL_FIELDS) {
    if (!own(data, key)) continue;
    const value = safeText(data[key]);
    if (value.length > 0) lines.push(`${key}: ${value}`);
  }
  return lines;
}

// JSON body must stay inside the 16 KiB outbox limit even for defensive callers
// that bypass validation and pass very large emoji/backslash strings.
function fitPayload(payload, shave) {
  let body = JSON.stringify(payload);
  while (Buffer.byteLength(body, "utf8") > WEBHOOK_LIMITS.maxPayloadBytes) {
    if (!shave()) break;
    body = JSON.stringify(payload);
  }
  return body;
}

function shaveUtf16(value) {
  if (value.length === 0) return null;
  return truncateUtf16Units(value, Math.max(0, value.length - 512));
}

export function buildDiscordPayload(event) {
  const severity = safeText(event?.severity, 32);
  const type = safeText(event?.type, DISCORD_TITLE_LIMIT);
  const content = truncateUtf16Units(
    truncateCodePoints(`[${severity}] ${type}`.trim(), DISCORD_CONTENT_LIMIT),
    DISCORD_CONTENT_LIMIT,
  );
  const description = truncateCodePoints(detailLines(event).join("\n"), DISCORD_DESCRIPTION_LIMIT);
  const payload = {
    content,
    allowed_mentions: { parse: [] },
    embeds: [{
      title: truncateUtf16Units(type, DISCORD_TITLE_LIMIT),
      description: truncateUtf16Units(
        description,
        Math.max(0, DISCORD_EMBED_TOTAL_LIMIT - Math.min(type.length, DISCORD_TITLE_LIMIT)),
      ),
    }],
  };
  const body = fitPayload(payload, () => {
    const next = shaveUtf16(payload.embeds[0].description);
    if (next === null) return false;
    payload.embeds[0].description = next;
    return true;
  });
  return { body, headers: { "content-type": "application/json" }, query: { wait: "true" } };
}

export function buildSlackPayload(event) {
  const severity = safeText(event?.severity, 32);
  const type = safeText(event?.type, FIELD_LIMIT);
  const lines = [`[${severity}] ${type}`.trim(), ...detailLines(event)];
  const text = truncateUtf16Units(
    truncateCodePoints(lines.join("\n"), SLACK_TEXT_LIMIT),
    SLACK_TEXT_LIMIT,
  );
  const payload = { text };
  const body = fitPayload(payload, () => {
    const next = shaveUtf16(payload.text);
    if (next === null) return false;
    payload.text = next;
    return true;
  });
  return { body, headers: { "content-type": "application/json" }, query: {} };
}

function projectEnvelope(event) {
  const projected = {};
  for (const key of ENVELOPE_FIELDS) {
    if (key === "data") {
      const data = {};
      const source = event?.data;
      for (const field of DATA_FIELDS) {
        if (source && typeof source === "object" && own(source, field)) data[field] = source[field];
      }
      projected.data = data;
    } else if (event && own(event, key)) {
      projected[key] = event[key];
    }
  }
  return projected;
}

function resolveSigningKey(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("generic webhook requires a signing secret");
  }
  if (!secret.startsWith("whsec_")) {
    // Explicit non-prefixed secrets are preserved and signed as raw UTF-8 bytes,
    // never silently base64-decoded.
    return Buffer.from(secret, "utf8");
  }
  const encoded = secret.slice("whsec_".length);
  if (encoded.length === 0 || !BASE64_PATTERN.test(encoded)) {
    throw new TypeError("invalid whsec_ signing secret");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length === 0) throw new TypeError("invalid whsec_ signing secret");
  return key;
}

function resolveTimestamp(value) {
  const timestamp = value === undefined ? Math.floor(Date.now() / 1000) : value;
  if (!Number.isInteger(timestamp) || timestamp < 0) {
    throw new TypeError("webhook timestamp must be non-negative integer seconds");
  }
  return String(timestamp);
}

export function buildGenericPayload(event, options = {}) {
  const key = resolveSigningKey(options.signingSecret);
  const webhookId = options.webhookId ?? event?.id;
  if (typeof webhookId !== "string" || webhookId.length === 0) {
    throw new TypeError("generic webhook requires a webhook id");
  }
  const timestamp = resolveTimestamp(options.timestamp);
  const body = JSON.stringify(projectEnvelope(event));
  const signed = `${webhookId}.${timestamp}.${body}`;
  const signature = createHmac("sha256", key).update(signed).digest("base64");
  return {
    body,
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    query: {},
  };
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

function retryAfterSeconds(headers, now) {
  const raw = headerValue(headers, "retry-after");
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

function retry(reason, headers, now) {
  const seconds = retryAfterSeconds(headers, now);
  if (seconds === undefined) return { outcome: "retry", reason };
  return { outcome: "retry", reason, retryAfterSeconds: seconds };
}

function ackOutcome(kind, response, status) {
  // Production transport parses the volatile ack body and exposes only a boolean.
  if (typeof response?.acknowledged === "boolean") {
    return response.acknowledged
      ? { outcome: "delivered", reason: "delivered" }
      : { outcome: "terminal", reason: "invalid_ack" };
  }
  // Pure-function fixtures may still carry the small ack body directly.
  if (kind === "discord") {
    if (status !== 200 || typeof response?.body !== "string") {
      return { outcome: "terminal", reason: "invalid_ack" };
    }
    let parsed;
    try { parsed = JSON.parse(response.body); } catch { parsed = null; }
    const valid = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      && typeof parsed.id === "string" && parsed.id.length > 0;
    return valid ? { outcome: "delivered", reason: "delivered" } : { outcome: "terminal", reason: "invalid_ack" };
  }
  if (kind === "slack") {
    const valid = status === 200 && typeof response?.body === "string" && response.body.trim() === "ok";
    return valid ? { outcome: "delivered", reason: "delivered" } : { outcome: "terminal", reason: "invalid_ack" };
  }
  return { outcome: "terminal", reason: "invalid_kind" };
}

export function classifyResponse(kind, response, options = {}) {
  const status = response?.status;
  const headers = response?.headers ?? {};
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return { outcome: "terminal", reason: "invalid_response" };
  }
  if (status === 429) return retry("rate_limited", headers, now);
  if (status === 408) return retry("timeout", headers, now);
  if (status >= 500) return retry("server_error", headers, now);
  if (status >= 300) return { outcome: "terminal", reason: "http_error" };
  if (status < 200) return { outcome: "terminal", reason: "invalid_response" };
  if (kind === "generic") return { outcome: "delivered", reason: "delivered" };
  return ackOutcome(kind, response, status);
}
