import http from "node:http";
import https from "node:https";
import { lookup as nativeLookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  WEBHOOK_FORBIDDEN_HEADER_NAMES, WEBHOOK_LIMITS, WEBHOOK_RESERVED_HEADER_PREFIXES,
} from "@/shared/constants/webhooks.js";

const MAX_RESPONSE_BYTES = 8192;
const TIMEOUT_MS = 10_000;
const METADATA_HOSTS = new Set([
  "metadata.google.internal", "metadata.goog", "instance-data.ec2.internal", "instance-data",
]);
const GENERATED_HEADERS = new Set([
  "content-type", "webhook-id", "webhook-timestamp", "webhook-signature",
]);
const FORBIDDEN_HEADERS = new Set(WEBHOOK_FORBIDDEN_HEADER_NAMES);

function transportError(code) {
  return Object.assign(new Error({
    WEBHOOK_POLICY: "Webhook destination rejected by policy",
    WEBHOOK_TIMEOUT: "Webhook deadline exceeded",
    WEBHOOK_ABORTED: "Webhook request aborted",
    WEBHOOK_NETWORK: "Webhook network request failed",
  }[code]), { code });
}

function allowedV4(address, privateNetwork) {
  const [a, b, c, d] = address.split(".").map(Number);
  if (a === 0 || a >= 224 || (a === 169 && b === 254)
    || (a === 100 && b === 100 && c === 100 && d === 200)) return false;
  if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)) return privateNetwork;
  return !(a === 100 && b >= 64 && b <= 127)
    && !(a === 192 && b === 0 && (c === 0 || c === 2))
    && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    && !(a === 203 && b === 0 && c === 113);
}

function allowedAddress(address, privateNetwork) {
  if (typeof address !== "string" || address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return allowedV4(address, privateNetwork);
  if (family !== 6) return false;
  // URL canonicalization turns embedded dotted IPv4 into hex; isIP validates first.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const words = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  const bits = words.reduce((value, word) => (value << 16n) | BigInt(`0x${word}`), 0n);
  if ((bits >> 32n) === 0xffffn) {
    const v4 = [24n, 16n, 8n, 0n].map((shift) => Number((bits >> shift) & 255n)).join(".");
    return allowedV4(v4, privateNetwork);
  }
  if (bits === 0xfd000ec2000000000000000000000254n) return false;
  if (bits === 1n) return privateNetwork;
  const first = Number(bits >> 112n);
  if ((first & 0xfe00) === 0xfc00) return privateNetwork;
  // Fail closed outside global unicast; exclude transition and documentation space.
  return (first & 0xe000) === 0x2000 && first !== 0x2002
    && (bits >> 96n) !== 0x20010000n && (bits >> 96n) !== 0x20010db8n;
}

function prepare(input) {
  const reject = () => { throw transportError("WEBHOOK_POLICY"); };
  if (!input || typeof input.url !== "string" || input.url.length > WEBHOOK_LIMITS.urlMaxLength
    || /[\u0000-\u0020\u007f]/.test(input.url)) reject();
  let url;
  try { url = new URL(input.url); } catch { reject(); }
  const privateNetwork = input.allowPrivateNetwork === true;
  if ((input.allowPrivateNetwork !== undefined && typeof input.allowPrivateNetwork !== "boolean")
    || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash
    || (url.protocol === "http:" && !privateNetwork)) reject();
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const normalizedHost = hostname.toLowerCase().replace(/\.$/, "");
  if (METADATA_HOSTS.has(normalizedHost) || (!privateNetwork
    && (normalizedHost === "localhost" || normalizedHost.endsWith(".localhost")))) reject();
  if (typeof input.body !== "string" || Buffer.byteLength(input.body) > WEBHOOK_LIMITS.maxPayloadBytes) reject();
  const timeoutMs = input.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > TIMEOUT_MS) reject();
  if (input.acknowledgementKind !== undefined
    && !["discord", "slack"].includes(input.acknowledgementKind)) reject();
  const headers = Object.create(null);
  const supplied = input.headers ?? {};
  if (typeof supplied !== "object" || supplied === null || Array.isArray(supplied)) reject();
  for (const [name, value] of Object.entries(supplied)) {
    const lower = name.toLowerCase();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || Object.hasOwn(headers, lower)
      || typeof value !== "string" || /[\r\n]/.test(value)
      || value.length > WEBHOOK_LIMITS.headerValueMaxLength) reject();
    try { http.validateHeaderValue(name, value); } catch { reject(); }
    if (!GENERATED_HEADERS.has(lower) && (FORBIDDEN_HEADERS.has(lower)
      || WEBHOOK_RESERVED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
      || (lower !== "authorization" && !lower.startsWith("x-")))) reject();
    headers[lower] = value;
  }
  headers["content-type"] = "application/json";
  headers["content-length"] = String(Buffer.byteLength(input.body));
  headers.host = url.host;
  return { url, hostname, privateNetwork, timeoutMs, headers };
}

function acknowledged(kind, status, bytes) {
  if (status !== 200) return false;
  const text = bytes.toString("utf8");
  if (kind === "slack") return text.trim() === "ok";
  try {
    const value = JSON.parse(text);
    return value !== null && !Array.isArray(value) && typeof value.id === "string" && value.id.length > 0;
  } catch { return false; }
}

// lookup is an internal test seam, never a saved destination or API option.
export async function sendWebhook(input, { lookup = nativeLookup } = {}) {
  if (input?.signal?.aborted) throw transportError("WEBHOOK_ABORTED");
  const { url, hostname, privateNetwork, timeoutMs, headers } = prepare(input);
  return new Promise((resolve, reject) => {
    let outgoing;
    let incoming;
    let settled = false;
    let chunks = [];
    let received = 0;
    const finish = (code, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      for (const chunk of chunks) chunk.fill(0);
      chunks = [];
      incoming?.destroy();
      outgoing?.destroy();
      if (code) reject(transportError(code));
      else resolve(result);
    };
    const abort = () => finish("WEBHOOK_ABORTED");
    const timer = setTimeout(() => finish("WEBHOOK_TIMEOUT"), timeoutMs);
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) { abort(); return; }

    const respond = (complete) => {
      const result = { status: incoming.statusCode, headers: incoming.headers };
      if (input.acknowledgementKind !== undefined) {
        result.acknowledged = false;
        if (complete && received <= MAX_RESPONSE_BYTES) {
          const bytes = Buffer.concat(chunks);
          result.acknowledged = acknowledged(input.acknowledgementKind, result.status, bytes);
          bytes.fill(0);
        }
      }
      finish(null, result);
    };

    const connect = async () => {
      const literal = isIP(hostname);
      const answers = literal ? [{ address: hostname, family: literal }] : await lookup(hostname, { all: true });
      if (settled) return;
      if (!Array.isArray(answers) || answers.length === 0 || answers.some((answer) =>
        !answer || !allowedAddress(answer.address, privateNetwork) || isIP(answer.address) !== answer.family)) {
        finish("WEBHOOK_POLICY");
        return;
      }
      const selected = answers[0];
      const options = {
        protocol: url.protocol, hostname, port: url.port || undefined,
        path: url.pathname + url.search, method: "POST", headers, agent: false,
        family: selected.family,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        },
      };
      if (url.protocol === "https:") {
        options.servername = literal ? undefined : hostname;
        options.rejectUnauthorized = true;
      }
      outgoing = (url.protocol === "https:" ? https : http).request(options);
      outgoing.once("error", () => finish("WEBHOOK_NETWORK"));
      outgoing.once("close", () => { if (!incoming) finish("WEBHOOK_NETWORK"); });
      outgoing.once("response", (response) => {
        incoming = response;
        if (settled) { response.destroy(); return; }
        response.once("error", () => finish("WEBHOOK_NETWORK"));
        response.once("aborted", () => finish("WEBHOOK_NETWORK"));
        response.once("close", () => { if (!settled) finish("WEBHOOK_NETWORK"); });
        response.once("end", () => respond(true));
        response.on("data", (chunk) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += bytes.length;
          if (input.acknowledgementKind !== undefined && received <= MAX_RESPONSE_BYTES) {
            chunks.push(Buffer.from(bytes));
          }
          if (received >= MAX_RESPONSE_BYTES) {
            const length = response.headers["content-length"];
            respond(received === MAX_RESPONSE_BYTES && length === "8192");
          }
        });
      });
      outgoing.end(input.body);
    };
    connect().catch(() => finish("WEBHOOK_NETWORK"));
  });
}
