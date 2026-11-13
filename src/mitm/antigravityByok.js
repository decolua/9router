const fs = require("fs");
const zlib = require("zlib");

const MAX_BYTES = 2 * 1024 * 1024;
const MODEL_PATH = "/v1internal:fetchAvailableModels";
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validModelId = value => typeof value === "string" && value.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
const validTarget = value => typeof value === "string" && value.length <= 256 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._:@-]*)+$/.test(value);

function loadPolicy(file = process.env.ANTIGRAVITY_BYOK_CONFIG) {
  if (!file) return null;
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isObject(policy)) throw new Error("Invalid BYOK policy");
  if (policy.enabled === false) return null;
  if (policy.enabled !== true || !isObject(policy.mappings)) throw new Error("Invalid BYOK policy");
  if (Object.keys(policy).some(key => !["enabled", "mappings", "auxiliaryMappings"].includes(key))) throw new Error("Unknown BYOK policy field");
  const mappings = Object.entries(policy.mappings);
  if (mappings.length === 0 || mappings.length > 32) throw new Error("BYOK requires one to 32 explicit mappings");
  if (policy.auxiliaryMappings !== undefined && !isObject(policy.auxiliaryMappings)) throw new Error("Invalid BYOK auxiliary mappings");
  const auxiliaryMappings = Object.entries(policy.auxiliaryMappings || {});
  if (auxiliaryMappings.length > 16) throw new Error("Too many BYOK auxiliary mappings");
  for (const [model, mapping] of mappings) {
    if (!validModelId(model) || !isObject(mapping) || Object.keys(mapping).some(key => !["target", "label"].includes(key)) || !validTarget(mapping.target) || typeof mapping.label !== "string" || !mapping.label.trim() || mapping.label.length > 120 || /[\x00-\x1f\x7f]/.test(mapping.label)) throw new Error("Invalid BYOK model mapping");
  }
  for (const [model, target] of auxiliaryMappings) if (!validModelId(model) || !validTarget(target)) throw new Error("Invalid BYOK auxiliary mapping");
  for (const [model] of auxiliaryMappings) if (Object.hasOwn(policy.mappings, model)) throw new Error("Duplicate BYOK model mapping");
  // Copy into a null-prototype map so inherited keys can never route requests.
  return { enabled: true, mappings: Object.assign(Object.create(null), policy.mappings), auxiliaryMappings: Object.assign(Object.create(null), policy.auxiliaryMappings || {}) };
}

function resolveTarget(policy, model) {
  if (!policy?.enabled || typeof model !== "string") return null;
  const id = model.startsWith("models/") ? model.slice(7) : model;
  if (Object.hasOwn(policy.mappings, id)) return policy.mappings[id].target;
  return policy.auxiliaryMappings && Object.hasOwn(policy.auxiliaryMappings, id) ? policy.auxiliaryMappings[id] : null;
}

function decode(headers, body) {
  if (!Buffer.isBuffer(body) || body.length > MAX_BYTES) throw new Error("Invalid response size");
  const header = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === "content-encoding");
  const encoding = String(header?.[1] || "identity").trim().toLowerCase();
  const options = { maxOutputLength: MAX_BYTES };
  let decoded;
  switch (encoding) {
    case "":
    case "identity": decoded = body; break;
    case "gzip": decoded = zlib.gunzipSync(body, options); break;
    case "br": decoded = zlib.brotliDecompressSync(body, options); break;
    case "deflate": decoded = zlib.inflateSync(body, options); break;
    default: throw new Error("Unsupported encoding");
  }
  if (decoded.length > MAX_BYTES) throw new Error("Invalid response size");
  return JSON.parse(decoded.toString("utf8"));
}

function modelResponse(data, policy) {
  if (!isObject(data) || !isObject(data.models)) return false;
  const eligible = Object.entries(data.models).filter(([id, model]) => Object.hasOwn(policy.mappings, id) && isObject(model) && model.disabled !== true && isObject(model.quotaInfo));
  if (eligible.length === 0) return false;
  const allowed = new Set(eligible.map(([id]) => id));
  for (const [id, model] of Object.entries(data.models)) {
    if (!isObject(model)) continue;
    if (!allowed.has(id)) {
      if (Object.hasOwn(policy.auxiliaryMappings || {}, id)) continue;
      model.disabled = true;
      continue;
    }
    model.quotaInfo.remainingFraction = 1;
    model.disabled = false;
    if (typeof model.displayName === "string") model.displayName = policy.mappings[id].label;
  }
  return true;
}

function rewriteManagementResponse(path, status, headers, bodyBuffer, policy) {
  const original = { body: bodyBuffer, headers, changed: false };
  if (!policy?.enabled || !Number.isInteger(status) || status < 200 || status >= 300) return original;
  if (path !== MODEL_PATH) return original;
  try {
    const data = decode(headers, bodyBuffer);
    const changed = modelResponse(data, policy);
    if (!changed) return original;
    const body = Buffer.from(JSON.stringify(data));
    if (body.length > MAX_BYTES) return original;
    const updated = {};
    const removed = new Set(["content-length", "content-encoding", "etag", "content-md5", "transfer-encoding"]);
    for (const [key, value] of Object.entries(headers || {})) if (!removed.has(key.toLowerCase())) updated[key] = value;
    updated["content-length"] = String(body.length);
    return { body, headers: updated, changed: true };
  } catch {
    return original;
  }
}

module.exports = { loadPolicy, resolveTarget, rewriteManagementResponse };
