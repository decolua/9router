const fs = require("fs");
const zlib = require("zlib");

// This is intentionally opt-in: the proxy must never depend on audit output.
const AUDIT_ENV = "ANTIGRAVITY_BYOK_AUDIT_FILE";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FIELDS = 500;
const MAX_DEPTH = 32;
const HOSTS = new Set(["cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com"]);
const PATHS = new Set([
  "/v1internal:loadCodeAssist",
  "/v1internal:fetchAvailableModels",
  "/v1internal:retrieveUserQuotaSummary",
  "/v1internal:retrieveUserQuota",
]);
// Only schema names are printed. In particular, keys in maps can be model IDs,
// project IDs, or arbitrary user data and must never be copied to the audit.
const SCHEMA_KEYS = new Set([
  "models", "quotaInfo", "quotaSummary", "groups", "buckets", "availableCredits",
  "credits", "creditAmount", "minimumCreditAmountForUsage", "creditType",
  "remainingFraction", "disabled", "currentTier", "paidTier", "allowedTiers",
  "userStatus", "planInfo",
]);
const NUMERIC_FIELDS = new Set(["remainingFraction", "creditAmount", "minimumCreditAmountForUsage"]);

function requestTarget(req) {
  const rawHost = req?.headers?.host;
  if (typeof rawHost !== "string") return null;
  const host = rawHost.toLowerCase().replace(/:443$/, "").replace(/\.$/, "");
  const rawUrl = typeof req.url === "string" ? req.url : "";
  const path = rawUrl.split("?", 1)[0];
  return HOSTS.has(host) && PATHS.has(path) ? { host, path } : null;
}

function appendAudit(file, event) {
  try {
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Diagnostics must not change the proxy response.
  }
}

function decodeResponse(buffer, headers) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_RESPONSE_BYTES) throw new Error("invalid response");
  const encoding = String(headers?.["content-encoding"] || headers?.["Content-Encoding"] || "identity").toLowerCase().trim();
  const options = { maxOutputLength: MAX_RESPONSE_BYTES };
  let decoded;
  switch (encoding) {
    case "":
    case "identity": decoded = buffer; break;
    case "gzip": decoded = zlib.gunzipSync(buffer, options); break;
    case "br": decoded = zlib.brotliDecompressSync(buffer, options); break;
    case "deflate": decoded = zlib.inflateSync(buffer, options); break;
    default: throw new Error("unsupported encoding");
  }
  if (decoded.length > MAX_RESPONSE_BYTES) throw new Error("response too large");
  return JSON.parse(decoded.toString("utf8"));
}

function safeFields(data) {
  const fields = [];
  function visit(value, path, depth) {
    if (!value || typeof value !== "object" || depth > MAX_DEPTH || fields.length >= MAX_FIELDS) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, `${path}[]`, depth + 1);
        if (fields.length >= MAX_FIELDS) break;
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      // Unknown keys are map keys, not diagnostic data.
      const next = SCHEMA_KEYS.has(key) ? (path ? `${path}.${key}` : key) : `${path}[]`;
      if (NUMERIC_FIELDS.has(key) && (typeof child === "number" && Number.isFinite(child) || typeof child === "string" && /^-?\d{1,30}(?:\.\d{1,20})?$/.test(child))) {
        fields.push({ path: next, value: child });
      } else if (key === "disabled" && typeof child === "boolean") {
        fields.push({ path: next, value: child });
      } else if (key === "creditType" && child === "GOOGLE_ONE_AI") {
        fields.push({ path: next, value: "GOOGLE_ONE_AI" });
      } else {
        visit(child, next, depth + 1);
      }
      if (fields.length >= MAX_FIELDS) break;
    }
  }
  visit(data, "", 0);
  return fields;
}

function createAntigravityObserver(req) {
  const file = process.env[AUDIT_ENV];
  const target = file && requestTarget(req);
  if (!target) return null;
  return (responseBuffer, headers, status) => {
    try {
      const event = { ...target, status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null };
      try {
        const data = decodeResponse(responseBuffer, headers);
        event.topLevelKeys = data && typeof data === "object" && !Array.isArray(data)
          ? [...new Set(Object.keys(data).map(key => SCHEMA_KEYS.has(key) ? key : "[]"))].sort()
          : [];
        event.fields = safeFields(data);
      } catch {
        event.parseError = true;
      }
      appendAudit(file, event);
    } catch {
      // Malformed inputs must not affect forwarding either.
    }
  };
}

module.exports = { createAntigravityObserver };
