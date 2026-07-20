import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, ProxyAgent, Socks5ProxyAgent } from "undici";

import {
  BLOCKED_HOSTS,
  FETCH_TIMEOUT_MS,
  IMAGE_SIGNATURES,
  MAX_IMAGE_BYTES,
  MAX_REMOTE_JSON_BYTES,
} from "../config/mediaConfig.js";

function normalizeHostname(hostname) {
  return String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

const blockedIpv4Addresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
const blockedIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
]) blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");

function isPrivateOrReservedIp(address) {
  const ip = normalizeHostname(address);
  const family = isIP(ip);
  if (family === 4) return blockedIpv4Addresses.check(ip, "ipv4");
  if (family === 6) return blockedIpv6Addresses.check(ip, "ipv6");
  return true;
}

async function resolvePublicAddresses(hostname) {
  const host = normalizeHostname(hostname);
  if (!host || BLOCKED_HOSTS.has(host)) throw new Error("Remote URL host is not allowed");
  const records = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  const list = Array.isArray(records) ? records : [records];
  if (!list.length || list.some((record) => isPrivateOrReservedIp(record?.address))) {
    throw new Error("Remote URL resolved to a private or reserved address");
  }
  return list;
}

function parseRemoteUrl(value, expectedOrigin) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid remote URL");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Remote URL is not allowed");
  }
  if (expectedOrigin) {
    let origin;
    try { origin = new URL(expectedOrigin).origin; } catch { throw new Error("Invalid expected origin"); }
    if (url.origin !== origin) throw new Error("Remote URL origin is not allowed");
  }
  return url;
}

function normalizeProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
}

function pinnedUrl(url, address) {
  const result = new URL(url);
  result.hostname = isIP(address) === 6 ? `[${address}]` : address;
  return result;
}

function directDispatcher(addresses) {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    },
  });
}

function buildDispatcher(url, addresses, proxyOptions) {
  if (proxyOptions?.proxyUnavailable === true || proxyOptions?.source === "unavailable") {
    throw new Error("Selected proxy is unavailable");
  }
  if (proxyOptions?.vercelRelayUrl) {
    throw new Error("Remote media fetch cannot safely pin relay DNS");
  }

  const enabled = proxyOptions?.connectionProxyEnabled === true || proxyOptions?.enabled === true;
  if (!enabled) return { dispatcher: directDispatcher(addresses), requestUrl: url, headers: {} };

  const proxyUrl = normalizeProxyUrl(proxyOptions?.connectionProxyUrl ?? proxyOptions?.url);
  if (!proxyUrl) throw new Error("Selected proxy URL is invalid");
  const requestUrl = pinnedUrl(url, addresses[0].address);
  const requestTls = { servername: normalizeHostname(url.hostname) };
  let dispatcher;
  if (["http:", "https:"].includes(proxyUrl.protocol)) {
    dispatcher = new ProxyAgent({ uri: proxyUrl.toString(), requestTls });
  } else if (["socks:", "socks5:", "socks5h:"].includes(proxyUrl.protocol)) {
    if (proxyUrl.protocol === "socks5h:") proxyUrl.protocol = "socks5:";
    dispatcher = new Socks5ProxyAgent(proxyUrl, { requestTls });
  } else {
    throw new Error("Selected proxy scheme cannot safely pin remote media DNS");
  }
  return { dispatcher, requestUrl, headers: { Host: url.host } };
}

export async function readBoundedResponse(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Remote response is too large");
  if (!response.body?.getReader) throw new Error("Remote response body is unavailable");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Remote response is too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchRemoteBytes(value, {
  expectedOrigin,
  headers = {},
  maxBytes,
  proxyOptions = null,
  signal,
  timeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  const url = parseRemoteUrl(value, expectedOrigin);
  if (proxyOptions?.proxyUnavailable === true || proxyOptions?.source === "unavailable") {
    throw new Error("Selected proxy is unavailable");
  }
  if (proxyOptions?.vercelRelayUrl) {
    throw new Error("Remote media fetch cannot safely pin relay DNS");
  }
  const addresses = await resolvePublicAddresses(url.hostname);
  const { dispatcher, requestUrl, headers: pinnedHeaders } = buildDispatcher(url, addresses, proxyOptions);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestSignal = signal && AbortSignal.any
    ? AbortSignal.any([signal, controller.signal])
    : signal || controller.signal;
  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: { ...headers, ...pinnedHeaders },
      redirect: "manual",
      signal: requestSignal,
      dispatcher,
      proxyOptions: { disableEnvProxy: true },
    });
    if (!response.ok) throw new Error(`Remote fetch failed with HTTP ${response.status}`);
    return await readBoundedResponse(response, maxBytes);
  } finally {
    clearTimeout(timeout);
    await dispatcher.close().catch(() => {});
  }
}

export function detectImageMime(buffer) {
  for (const { sig, offset, mime, verifyWebp } of IMAGE_SIGNATURES) {
    if (buffer.length < offset + sig.length) continue;
    if (!sig.every((byte, index) => buffer[offset + index] === byte)) continue;
    if (verifyWebp && buffer.subarray(8, 12).toString("ascii") !== "WEBP") continue;
    return mime;
  }
  return null;
}

export function validateImageBuffer(value, maxBytes = MAX_IMAGE_BYTES) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!buffer.length || buffer.length > maxBytes || !detectImageMime(buffer)) {
    throw new Error("Remote content is not a valid bounded image");
  }
  return buffer;
}

export function decodeBase64Image(value, maxBytes = MAX_IMAGE_BYTES) {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes * 4 / 3) + 8) {
    throw new Error("Image payload is too large or invalid");
  }
  const encoded = value.trim();
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error("Image payload is too large or invalid");
  }
  const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
  const buffer = Buffer.from(padded, "base64");
  if (buffer.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new Error("Image payload is too large or invalid");
  }
  return validateImageBuffer(buffer, maxBytes);
}

export async function fetchRemoteImage(value, options = {}) {
  const buffer = validateImageBuffer(await fetchRemoteBytes(value, {
    ...options,
    maxBytes: options.maxBytes || MAX_IMAGE_BYTES,
  }), options.maxBytes || MAX_IMAGE_BYTES);
  return { buffer, mimeType: detectImageMime(buffer), base64: buffer.toString("base64") };
}

export async function fetchRemoteJson(value, options = {}) {
  const buffer = await fetchRemoteBytes(value, {
    ...options,
    maxBytes: options.maxBytes || MAX_REMOTE_JSON_BYTES,
  });
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("Remote response is not valid JSON");
  }
}

export async function readBoundedJsonResponse(response, maxBytes = MAX_REMOTE_JSON_BYTES) {
  const buffer = await readBoundedResponse(response, maxBytes);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("Remote response is not valid JSON");
  }
}
