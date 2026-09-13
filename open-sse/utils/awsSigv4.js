// AWS Signature Version 4 for Bedrock. node:crypto only — the AWS SDK is ~10MB
// of dependency for what is four HMACs and a canonical string.
//
// Scope: single-shot signed requests with a fully-known body (no chunked signing,
// no session-token-less presigning). Bedrock streaming signs the whole body up
// front, so that covers both invoke and invoke-with-response-stream.

import crypto from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";

const sha256Hex = (data) => crypto.createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data, "utf8").digest();

// ISO8601 basic: 20260913T120000Z
function amzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

// Query keys/values are encoded per RFC3986 — encodeURIComponent plus the four
// characters it leaves alone.
function encodeQueryComponent(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

// `new URL()` has already percent-encoded anything illegal in a path, so the
// pathname is a valid RFC3986 path and is signed as-is. Notably `:` is a legal
// pchar and must NOT be escaped — Bedrock model ids end in ":0", and encoding
// that to "%3A" signs a path different from the one fetch sends (403).
// ponytail: skips SigV4's "encode each segment twice" rule, which only bites
// paths that already contain literal percent-escapes. Callers validate their
// path inputs (see bedrock.js assertModelId). Add full double-encoding if this
// signer is ever pointed at S3 keys or arbitrary user-supplied paths.
function canonicalPath(pathname) {
  return pathname || "/";
}

function canonicalQuery(searchParams) {
  const pairs = [...searchParams.entries()]
    .map(([k, v]) => [encodeQueryComponent(k), encodeQueryComponent(v)])
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * Sign a request and return the headers to send.
 *
 * @param {object}  req
 * @param {string}  req.url           full request URL
 * @param {string} [req.method]       default "POST"
 * @param {object} [req.headers]      headers to sign alongside host/x-amz-date
 * @param {string} [req.body]         request body (already serialized)
 * @param {string}  req.region        e.g. "us-east-1" — must match the host's region
 * @param {string} [req.service]      default "bedrock"
 * @param {string}  req.accessKeyId
 * @param {string}  req.secretAccessKey
 * @param {string} [req.sessionToken] for temporary STS credentials
 * @param {Date}   [req.date]         injectable for tests
 * @returns {object} headers including Authorization
 */
export function signRequest({
  url,
  method = "POST",
  headers = {},
  body = "",
  region,
  service = "bedrock",
  accessKeyId,
  secretAccessKey,
  sessionToken = null,
  date = new Date(),
}) {
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS SigV4 requires both an access key ID and a secret access key");
  }
  if (!region) throw new Error("AWS SigV4 requires a region");

  const parsed = new URL(url);
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const payloadHash = sha256Hex(body || "");

  // Header names are lowercased and sorted; host and x-amz-date are always signed.
  const signed = {
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])),
    host: parsed.host,
    "x-amz-date": stamp,
  };
  if (sessionToken) signed["x-amz-security-token"] = sessionToken;

  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((n) => `${n}:${signed[n]}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(parsed.pathname),
    canonicalQuery(parsed.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const signature = hmac(
    hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), "aws4_request"),
    stringToSign
  ).toString("hex");

  return {
    ...headers,
    "X-Amz-Date": stamp,
    ...(sessionToken ? { "X-Amz-Security-Token": sessionToken } : {}),
    Authorization: `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export default signRequest;
