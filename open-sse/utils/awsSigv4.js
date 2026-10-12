import crypto from "node:crypto";

import { AWS_SIGV4 } from "../config/awsConstants.js";

/**
 * AWS Signature Version 4 request signing.
 *
 * Hand-rolled on node:crypto rather than pulling @aws-sdk/signature-v4, because every request
 * we sign is a single POST with a JSON body and no query string — the canonicalisation cases
 * that make SigV4 error-prone (multi-value headers, query ordering) never arise here.
 * Verified against AWS's published test vector in tests/unit/aws-sigv4.test.js.
 */

/**
 * Percent-encode per RFC 3986, leaving only the unreserved set alone.
 * encodeURIComponent is not enough on its own: it leaves !'()* unescaped, which AWS escapes.
 */
export function escapeUri(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256Hex(payload) {
  return crypto
    .createHash("sha256")
    .update(payload ?? "", "utf8")
    .digest("hex");
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * "20150830T123600Z" and "20150830" — SigV4 wants both forms of the same instant.
 */
function formatSigningDate(date) {
  const amzDate = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Canonical URI. Every service except S3 expects each path segment escaped a *second* time,
 * so a Bedrock model id that reaches the wire as "...v1%3A0" is signed as "...v1%253A0".
 * Getting this wrong is the single most common cause of a Bedrock SignatureDoesNotMatch.
 */
function canonicalPath(pathname, doubleEncodePath) {
  if (!doubleEncodePath) return pathname || "/";
  const segments = (pathname || "/")
    .split("/")
    .map((segment) => escapeUri(segment));
  return segments.join("/") || "/";
}

/**
 * Canonical headers block plus the matching SignedHeaders list. Names lowercased, values
 * trimmed with internal whitespace runs collapsed, both sorted by name.
 */
function canonicalizeHeaders(headers) {
  const entries = Object.entries(headers)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => [
      name.toLowerCase(),
      String(value).trim().replace(/\s+/g, " "),
    ])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    canonicalHeaders: entries
      .map(([name, value]) => `${name}:${value}\n`)
      .join(""),
    signedHeaders: entries.map(([name]) => name).join(";"),
  };
}

/**
 * Sign a request and return the headers to send with it.
 *
 * @param {object} opts
 * @param {string} opts.method - HTTP method, e.g. "POST".
 * @param {string} opts.url - Absolute URL. Its path must already be escaped once.
 * @param {object} [opts.headers] - Headers to sign alongside the required host/x-amz-date.
 * @param {string} [opts.body] - Request body, already serialised.
 * @param {string} opts.region - e.g. "us-east-1".
 * @param {string} opts.service - e.g. "bedrock".
 * @param {object} opts.credentials - { accessKeyId, secretAccessKey, sessionToken? }.
 * @param {boolean} [opts.doubleEncodePath=true] - False only for S3-style services.
 * @param {Date} [opts.date] - Injectable for deterministic tests.
 * @returns {object} Headers including Authorization, X-Amz-Date and any session token.
 */
export function signAwsRequest({
  method,
  url,
  headers = {},
  body = "",
  region,
  service,
  credentials,
  doubleEncodePath = true,
  date = new Date(),
}) {
  const { accessKeyId, secretAccessKey, sessionToken } = credentials || {};
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS SigV4 requires both accessKeyId and secretAccessKey");
  }

  const parsed = new URL(url);

  // Query canonicalisation is deliberately NOT implemented. SigV4 requires the query sorted by
  // percent-encoded name with AWS-style escaping, while URLSearchParams preserves insertion
  // order and encodes a space as "+". Every caller here signs a query-less POST, so rather than
  // ship a subtly wrong canonical request for some future caller, refuse the input outright.
  if (parsed.search) {
    throw new Error(
      `AWS SigV4 signing does not support query strings (got ${JSON.stringify(parsed.search)}). ` +
        "Move the parameters into the request body, or add proper query canonicalisation first.",
    );
  }

  const { amzDate, dateStamp } = formatSigningDate(date);
  const payloadHash = sha256Hex(body);

  // The signed set always includes host and x-amz-date; a session token must be signed too,
  // otherwise STS/SSO credentials fail with SignatureDoesNotMatch.
  const headersToSign = {
    ...headers,
    host: parsed.host,
    [AWS_SIGV4.dateHeader]: amzDate,
    ...(sessionToken ? { [AWS_SIGV4.securityTokenHeader]: sessionToken } : {}),
  };
  const { canonicalHeaders, signedHeaders } =
    canonicalizeHeaders(headersToSign);

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(parsed.pathname, doubleEncodePath),
    // Always empty: the guard above rejects any URL carrying a query string.
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/${AWS_SIGV4.terminator}`;
  const stringToSign = [
    AWS_SIGV4.algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = [dateStamp, region, service, AWS_SIGV4.terminator].reduce(
    (key, part) => hmac(key, part),
    `${AWS_SIGV4.keyPrefix}${secretAccessKey}`,
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    ...headersToSign,
    Authorization:
      `${AWS_SIGV4.algorithm} Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
