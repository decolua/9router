// Pure webhook destination/event validation. No DB, network or globals.
// Every function returns a structured result instead of throwing on bad input.
import {
  DEFAULT_WEBHOOK_EVENTS, WEBHOOK_DESTINATION_KINDS, WEBHOOK_ERROR_CLASSES,
  WEBHOOK_EVENT_CATALOG, WEBHOOK_FORBIDDEN_HEADER_NAMES, WEBHOOK_INTERNAL_INPUT_KEYS,
  WEBHOOK_LIMITS, WEBHOOK_RESERVED_HEADER_PREFIXES, WEBHOOK_SCHEMA_VERSION,
} from "@/shared/constants/webhooks.js";

const CREATE_KEYS = new Set(["name", "kind", "url", "enabled", "events",
  "allowPrivateNetwork", "cooldownSeconds", "signingSecret", "headers"]);
const PATCH_ONLY_KEYS = new Set(["clearSigningSecret", "clearHeaders"]);
const EVENT_DATA_KEYS = new Set(["requestId", "modality", "provider", "model",
  "connectionId", "statusCode", "errorClass", "partialResponse"]);
const EVENT_STRING_KEYS = new Set(["requestId", "modality", "provider", "model", "connectionId"]);
const ENVELOPE_KEYS = new Set(["id", "type", "schema_version", "occurred_at", "severity", "data"]);
const DESTINATION_KINDS = new Set(WEBHOOK_DESTINATION_KINDS);
const ERROR_CLASSES = new Set(WEBHOOK_ERROR_CLASSES);
const FORBIDDEN_HEADERS = new Set(WEBHOOK_FORBIDDEN_HEADER_NAMES);
const INTERNAL_KEYS = new Set(WEBHOOK_INTERNAL_INPUT_KEYS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;
const CRLF = /[\r\n]/;
const encoder = new TextEncoder();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const error = (field, code) => ({ field, code });
const failed = (errors) => ({ ok: false, errors });

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateUrl(raw, { mode, allowPrivateNetwork, allowPrivateNetworkProvided }) {
  if (typeof raw !== "string") return [error("url", "invalid_type")];
  const errors = [];
  if (raw.length > WEBHOOK_LIMITS.urlMaxLength) errors.push(error("url", "url_too_long"));
  if (CONTROL_OR_SPACE.test(raw)) errors.push(error("url", "invalid_url"));
  if (errors.length > 0) return errors;
  let parsed;
  try { parsed = new URL(raw); }
  catch { return [error("url", "invalid_url")]; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    errors.push(error("url", "url_protocol"));
  } else if (parsed.protocol === "http:") {
    const mustDecide = mode === "create" || allowPrivateNetworkProvided;
    if (mustDecide && allowPrivateNetwork !== true) {
      errors.push(error("url", "http_requires_private_opt_in"));
    }
  }
  if (parsed.username || parsed.password) errors.push(error("url", "url_userinfo"));
  if (parsed.hash) errors.push(error("url", "url_fragment"));
  return errors;
}

function validateHeaders(headers, kind) {
  if (!isPlainObject(headers)) return { errors: [error("headers", "headers_invalid")] };
  const errors = [];
  const names = Object.keys(headers);
  if (kind && kind !== "generic" && names.length > 0) {
    errors.push(error("headers", "headers_not_supported"));
  }
  if (names.length > WEBHOOK_LIMITS.maxHeaders) errors.push(error("headers", "header_count_limit"));
  const seen = new Set();
  /** @type {Record<string, string>} */
  const value = {};
  for (const name of names) {
    const field = `headers.${name}`;
    const lower = name.toLowerCase();
    if (!HEADER_NAME_PATTERN.test(name)) {
      errors.push(error(field, "header_name_not_allowed"));
      continue;
    }
    if (seen.has(lower)) {
      errors.push(error(field, "header_duplicate"));
      continue;
    }
    seen.add(lower);
    const allowed = lower === "authorization" || lower.startsWith("x-");
    const reserved = FORBIDDEN_HEADERS.has(lower)
      || WEBHOOK_RESERVED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix));
    if (!allowed || reserved) {
      errors.push(error(field, "header_name_not_allowed"));
      continue;
    }
    const raw = headers[name];
    if (typeof raw !== "string" || CRLF.test(raw)) {
      errors.push(error(field, "header_value_invalid"));
      continue;
    }
    if (raw.length > WEBHOOK_LIMITS.headerValueMaxLength) {
      errors.push(error(field, "header_value_too_long"));
      continue;
    }
    value[name] = raw;
  }
  return { errors, value };
}

export function validateDestinationInput(input, options = {}) {
  const mode = options.mode === "patch" ? "patch" : "create";
  if (!isPlainObject(input)) return failed([error("input", "invalid_type")]);
  const errors = [];
  /** @type {Record<string, any>} */
  const value = {};
  const check = (bad, field, code) => {
    if (bad) errors.push(error(field, code));
    return bad;
  };
  const allowed = mode === "patch" ? new Set([...CREATE_KEYS, ...PATCH_ONLY_KEYS]) : CREATE_KEYS;
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      errors.push(error(key, INTERNAL_KEYS.has(key) ? "internal_field" : "unknown_key"));
    }
  }
  if (!own(input, "name") && mode === "create") errors.push(error("name", "required"));
  if (own(input, "name")) {
    const name = typeof input.name === "string" ? input.name.trim() : null;
    check(name === null, "name", "invalid_type")
      || check(name.length === 0, "name", "name_required")
      || check(name.length > WEBHOOK_LIMITS.nameMaxLength, "name", "name_too_long")
      || (value.name = name);
  }
  if (!own(input, "kind") && mode === "create") errors.push(error("kind", "required"));
  if (own(input, "kind")) {
    check(typeof input.kind !== "string" || !DESTINATION_KINDS.has(input.kind), "kind", "invalid_kind")
      || (value.kind = input.kind);
  }
  const allowProvided = own(input, "allowPrivateNetwork");
  const allow = allowProvided ? input.allowPrivateNetwork : undefined;
  if (!own(input, "url") && mode === "create") errors.push(error("url", "required"));
  if (allowProvided) check(typeof allow !== "boolean", "allowPrivateNetwork", "invalid_type");
  if (own(input, "url")) {
    const urlErrors = validateUrl(input.url, {
      mode, allowPrivateNetwork: allow, allowPrivateNetworkProvided: allowProvided,
    });
    errors.push(...urlErrors);
    if (urlErrors.length === 0) value.url = input.url;
  }
  if (own(input, "enabled")) {
    check(typeof input.enabled !== "boolean", "enabled", "invalid_type") || (value.enabled = input.enabled);
  } else if (mode === "create") value.enabled = true;
  if (allowProvided) {
    if (typeof allow === "boolean") value.allowPrivateNetwork = allow;
  } else if (mode === "create") value.allowPrivateNetwork = false;
  if (own(input, "cooldownSeconds")) {
    const cooldown = input.cooldownSeconds;
    const valid = Number.isInteger(cooldown)
      && cooldown >= WEBHOOK_LIMITS.cooldownMinSeconds
      && cooldown <= WEBHOOK_LIMITS.cooldownMaxSeconds;
    check(!valid, "cooldownSeconds", "cooldown_out_of_range") || (value.cooldownSeconds = cooldown);
  } else if (mode === "create") value.cooldownSeconds = WEBHOOK_LIMITS.cooldownDefaultSeconds;
  if (own(input, "events")) {
    const events = input.events;
    if (!Array.isArray(events)) errors.push(error("events", "invalid_type"));
    else if (events.length === 0) errors.push(error("events", "events_required"));
    else {
      const seen = new Set();
      const accepted = [];
      for (const type of events) {
        if (typeof type !== "string") errors.push(error("events", "invalid_type"));
        else if (!own(WEBHOOK_EVENT_CATALOG, type)) errors.push(error("events", "unknown_event"));
        else if (seen.has(type)) errors.push(error("events", "duplicate_event"));
        else {
          seen.add(type);
          accepted.push(type);
        }
      }
      value.events = accepted;
    }
  } else if (mode === "create") value.events = [...DEFAULT_WEBHOOK_EVENTS];
  if (own(input, "headers")) {
    const result = validateHeaders(input.headers, own(input, "kind") ? input.kind : undefined);
    errors.push(...result.errors);
    if (result.errors.length === 0) value.headers = result.value;
  }
  if (own(input, "signingSecret")) {
    const secret = input.signingSecret;
    check(typeof secret !== "string" || secret.trim().length === 0, "signingSecret", "invalid_type")
      || check(secret.length > WEBHOOK_LIMITS.signingSecretMaxLength, "signingSecret", "signing_secret_too_long")
      || (value.signingSecret = secret);
  }
  for (const flag of PATCH_ONLY_KEYS) {
    if (!own(input, flag)) continue;
    check(typeof input[flag] !== "boolean", flag, "invalid_type") || (value[flag] = input[flag]);
  }
  if (value.clearSigningSecret === true && own(input, "signingSecret")) {
    errors.push(error("clearSigningSecret", "conflicting_clear"));
  }
  if (value.clearHeaders === true && own(input, "headers")) {
    errors.push(error("clearHeaders", "conflicting_clear"));
  }
  return errors.length > 0 ? failed(errors) : { ok: true, value };
}

export function toSafeDestination(destination) {
  if (!isPlainObject(destination)) return null;
  let url = null;
  if (typeof destination.url === "string") {
    try {
      const parsed = new URL(destination.url);
      url = { scheme: parsed.protocol.replace(/:$/, ""), host: parsed.host };
    } catch { url = null; }
  }
  const headerNames = isPlainObject(destination.headers) ? Object.keys(destination.headers) : [];
  return {
    id: destination.id ?? null,
    revision: Number.isInteger(destination.revision) ? destination.revision : null,
    name: typeof destination.name === "string" ? destination.name : "",
    kind: typeof destination.kind === "string" ? destination.kind : null,
    enabled: destination.enabled === true,
    events: Array.isArray(destination.events) ? [...destination.events] : [],
    allowPrivateNetwork: destination.allowPrivateNetwork === true,
    cooldownSeconds: Number.isInteger(destination.cooldownSeconds)
      ? destination.cooldownSeconds : WEBHOOK_LIMITS.cooldownDefaultSeconds,
    url, urlConfigured: url !== null,
    hasSigningSecret: typeof destination.signingSecret === "string" && destination.signingSecret.length > 0,
    headerNames, headerCount: headerNames.length,
    createdAt: destination.createdAt ?? null, updatedAt: destination.updatedAt ?? null,
  };
}

export function validateEventData(data) {
  if (!isPlainObject(data)) return failed([error("data", "invalid_type")]);
  const errors = [];
  /** @type {Record<string, any>} */
  const value = {};
  for (const key of Object.keys(data)) {
    const entry = data[key];
    if (!EVENT_DATA_KEYS.has(key)) errors.push(error(key, "unknown_key"));
    else if (EVENT_STRING_KEYS.has(key)) {
      if (typeof entry !== "string") errors.push(error(key, "invalid_type"));
      else if (entry.length > WEBHOOK_LIMITS.eventStringMaxLength) errors.push(error(key, "field_too_long"));
      else value[key] = entry;
    } else if (key === "statusCode") {
      if (!Number.isInteger(entry) || entry < 100 || entry > 599) {
        errors.push(error(key, "invalid_status_code"));
      } else value[key] = entry;
    } else if (key === "partialResponse") {
      if (typeof entry !== "boolean") errors.push(error(key, "invalid_type"));
      else value[key] = entry;
    } else if (!ERROR_CLASSES.has(entry)) errors.push(error(key, "invalid_error_class"));
    else value[key] = entry;
  }
  return errors.length > 0 ? failed(errors) : { ok: true, value };
}

export function validateEventEnvelope(envelope) {
  if (!isPlainObject(envelope)) return failed([error("envelope", "invalid_type")]);
  const errors = [];
  for (const key of Object.keys(envelope)) if (!ENVELOPE_KEYS.has(key)) errors.push(error(key, "unknown_key"));
  if (typeof envelope.id !== "string" || !UUID_PATTERN.test(envelope.id)) {
    errors.push(error("id", "invalid_envelope"));
  }
  const catalogEntry = typeof envelope.type === "string" && own(WEBHOOK_EVENT_CATALOG, envelope.type)
    ? WEBHOOK_EVENT_CATALOG[envelope.type] : null;
  if (!catalogEntry) errors.push(error("type", "unknown_event"));
  if (envelope.schema_version !== WEBHOOK_SCHEMA_VERSION) {
    errors.push(error("schema_version", "invalid_envelope"));
  }
  if (typeof envelope.occurred_at !== "string" || !Number.isFinite(Date.parse(envelope.occurred_at))) {
    errors.push(error("occurred_at", "invalid_envelope"));
  }
  if (typeof envelope.severity !== "string") errors.push(error("severity", "invalid_envelope"));
  else if (catalogEntry && envelope.severity !== catalogEntry.severity) {
    errors.push(error("severity", "severity_mismatch"));
  }
  const dataResult = validateEventData(envelope.data);
  if (!dataResult.ok) {
    for (const entry of dataResult.errors) errors.push(error(`data.${entry.field}`, entry.code));
  }
  if (errors.length > 0) return failed(errors);
  return { ok: true, value: {
    id: envelope.id, type: envelope.type, schema_version: envelope.schema_version,
    occurred_at: envelope.occurred_at, severity: envelope.severity, data: dataResult.value,
  } };
}

export function checkDestinationCapacity(count) {
  if (!Number.isInteger(count) || count < 0) return failed([error("count", "invalid_type")]);
  if (count > WEBHOOK_LIMITS.maxDestinations) return failed([error("count", "destination_limit")]);
  return { ok: true };
}

export function validatePayloadSize(payload) {
  let text;
  if (typeof payload === "string") text = payload;
  else {
    try { text = JSON.stringify(payload); }
    catch { return failed([error("payload", "payload_unserializable")]); }
    if (typeof text !== "string") return failed([error("payload", "invalid_type")]);
  }
  const bytes = encoder.encode(text).byteLength;
  if (bytes > WEBHOOK_LIMITS.maxPayloadBytes) return failed([error("payload", "payload_too_large")]);
  return { ok: true, bytes };
}
