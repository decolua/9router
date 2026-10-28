import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 32768;
const SAFE_FIELDS = new Set(["body", "input", "id", "revision", "expectedRevision", "destinations", "outbox",
  "name", "kind", "url", "enabled", "events", "allowPrivateNetwork", "cooldownSeconds", "signingSecret",
  "headers", "clearHeaders", "clearSigningSecret", "limit", "destinationId", "query"]);
const SAFE_CODES = new Set(["invalid_type", "required", "name_required", "name_too_long", "invalid_kind",
  "url_too_long", "invalid_url", "url_protocol", "http_requires_private_opt_in", "url_userinfo", "url_fragment",
  "headers_invalid", "headers_not_supported", "header_count_limit", "header_name_not_allowed", "header_duplicate",
  "header_value_invalid", "header_value_too_long", "cooldown_out_of_range", "events_required", "unknown_event",
  "duplicate_event", "signing_secret_too_long", "conflicting_clear", "internal_field", "unknown_key",
  "not_found", "revision_conflict", "destination_limit", "outbox_full", "storage_error", "internal",
  "invalid_json", "body_too_large", "invalid_content_type", "origin_forbidden", "invalid_revision", "invalid_query"]);

class WebhookInputError extends Error {
  constructor(field, code, status = 400) {
    super(code);
    this.errors = [{ field, code }];
    this.status = status;
  }
}

export function webhookJson(body, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function webhookErrors(errors, status) {
  const safe = errors.map(({ field, code }) => ({
    field: SAFE_FIELDS.has(field) ? field : typeof field === "string" && field.startsWith("headers.") ? "headers" : "input",
    code: SAFE_CODES.has(code) ? code : "internal",
  }));
  const codes = safe.map((entry) => entry.code);
  const mapped = codes.includes("storage_error") ? 500 : codes.includes("not_found") ? 404
    : codes.includes("outbox_full") ? 429 : codes.some((code) => ["revision_conflict", "destination_limit"].includes(code)) ? 409 : 400;
  return webhookJson({ ok: false, errors: safe }, status ?? mapped);
}

export function webhookException(error) {
  return error instanceof WebhookInputError ? webhookErrors(error.errors, error.status)
    : webhookErrors([{ field: "body", code: "storage_error" }]);
}

function checkOrigin(request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new WebhookInputError("body", "origin_forbidden", 403);
  }
  if (origin === null) {
    if ([...request.headers.keys()].some((key) => key.toLowerCase().startsWith("sec-fetch-"))) {
      throw new WebhookInputError("body", "origin_forbidden", 403);
    }
    return;
  }
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin
      || parsed.origin !== new URL(request.url).origin) throw new Error("Origin mismatch");
  } catch {
    throw new WebhookInputError("body", "origin_forbidden", 403);
  }
}

export async function readWebhookMutation(request, { allowEmpty = false } = {}) {
  checkOrigin(request);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new WebhookInputError("body", "invalid_content_type");
  }
  const length = request.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length.trim()) && Number(length) > MAX_BODY_BYTES) {
    throw new WebhookInputError("body", "body_too_large", 413);
  }
  let text = "";
  let bytes = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          reader.cancel().catch(() => {});
          throw new WebhookInputError("body", "body_too_large", 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      if (error instanceof WebhookInputError) throw error;
      throw new WebhookInputError("body", "invalid_json");
    } finally {
      reader.releaseLock();
    }
  }
  if (allowEmpty && bytes === 0) return {};
  try { return JSON.parse(text); }
  catch { throw new WebhookInputError("body", "invalid_json"); }
}

export function webhookRevisionInput(body, { revisionOnly = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WebhookInputError("body", "invalid_type");
  const { expectedRevision, ...patch } = body;
  if (Object.hasOwn(body, "expectedRevision") && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
    throw new WebhookInputError("expectedRevision", "invalid_revision");
  }
  if (revisionOnly && Object.keys(patch).length) throw new WebhookInputError("body", "unknown_key");
  return { patch, options: { expectedRevision } };
}

export function checkWebhookTestInput(request, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WebhookInputError("body", "invalid_type");
  if (Object.keys(body).length) throw new WebhookInputError("body", "unknown_key");
  if (new URL(request.url).search) throw new WebhookInputError("query", "invalid_query");
}

export function webhookDeliveryQuery(request) {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => !["limit", "destinationId"].includes(key))
    || query.getAll("limit").length > 1 || query.getAll("destinationId").length > 1) {
    throw new WebhookInputError("query", "invalid_query");
  }
  const limit = query.get("limit");
  if (limit !== null && (!/^[0-9]+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)) {
    throw new WebhookInputError("limit", "invalid_query");
  }
  const destinationId = query.get("destinationId");
  if (destinationId !== null && (!destinationId || destinationId.length > 2048)) {
    throw new WebhookInputError("destinationId", "invalid_query");
  }
  return { limit: limit === null ? 20 : Number(limit), ...(destinationId === null ? {} : { destinationId }) };
}
