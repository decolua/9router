import { createHash } from "crypto";
import { EGRESS_CONFIG, MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { normalizeString, resolveEffectiveProxyUrl } from "./proxyResolution.js";

export const DIRECT_EGRESS_ID = "direct";

const cooldowns = new Map();
// A cooling egress is probed at a growing interval instead of waiting out the
// whole Retry-After, so a recovered address is usable again within minutes.
const probes = new Map();
const directIpCache = {
  ip: null,
  at: 0,
  lastProbeAt: 0,
  inflight: null,
};

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of cooldowns) {
    if (entry.until <= now) cooldowns.delete(id);
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (cleanupTimer.unref) cleanupTimer.unref();

function hashEgress(kind, value) {
  return `${kind}:${sha256(value).slice(0, 32)}`;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function directEgress(ip) {
  return ip
    ? {
      id: `direct:${ip}`,
      kind: "direct",
      confirmed: true,
      ip,
      proxyUrl: null,
      relayUrl: null,
    }
    : {
      id: DIRECT_EGRESS_ID,
      kind: "direct",
      confirmed: false,
      ip: null,
      proxyUrl: null,
      relayUrl: null,
    };
}

export function identifyFixedEgress(targetUrl, proxyOptions = null) {
  const relayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (relayUrl) {
    return {
      id: hashEgress("relay", relayUrl),
      kind: "relay",
      confirmed: true,
      ip: null,
      proxyUrl: null,
      relayUrl,
    };
  }

  const { url: proxyUrl } = resolveEffectiveProxyUrl(targetUrl, proxyOptions);
  if (proxyUrl) {
    return {
      id: hashEgress("proxy", proxyUrl),
      kind: "proxy",
      confirmed: true,
      ip: null,
      proxyUrl,
      relayUrl: null,
    };
  }

  return null;
}

export async function resolveEgress({ targetUrl, proxyOptions = null, forceProbe = false, fresh = false } = {}) {
  const fixed = identifyFixedEgress(targetUrl, proxyOptions);
  if (fixed) return fixed;

  const mode = EGRESS_CONFIG.mode;
  if (mode === "off") return directEgress(cachedDirectIp(false));

  const now = Date.now();
  const age = directIpCache.ip ? now - directIpCache.at : Infinity;

  if (mode === "auto" && !forceProbe) {
    return directEgress(age < EGRESS_CONFIG.ipStaleTtlMs ? directIpCache.ip : null);
  }

  if (mode === "always" && !forceProbe && age < EGRESS_CONFIG.ipCacheTtlMs) {
    return directEgress(directIpCache.ip);
  }

  if (mode === "always" && !forceProbe && age < EGRESS_CONFIG.ipStaleTtlMs) {
    scheduleBackgroundProbe();
    return directEgress(directIpCache.ip);
  }

  if (!fresh && directIpCache.ip) {
    const sinceProbe = now - directIpCache.lastProbeAt;
    if (sinceProbe < EGRESS_CONFIG.directRecheckMs) return directEgress(directIpCache.ip);
  }

  const ip = await probeDirectIpCached();
  return directEgress(ip);
}

function cachedDirectIp(allowStale) {
  if (!directIpCache.ip) return null;
  const age = Date.now() - directIpCache.at;
  return age < (allowStale ? EGRESS_CONFIG.ipStaleTtlMs : EGRESS_CONFIG.ipCacheTtlMs)
    ? directIpCache.ip
    : null;
}

function scheduleBackgroundProbe() {
  if (directIpCache.inflight) return;
  probeDirectIpCached().catch(() => { });
}

function probeDirectIpCached() {
  if (directIpCache.inflight) return directIpCache.inflight;

  directIpCache.inflight = probeDirectIp()
    .then((ip) => {
      const now = Date.now();
      directIpCache.lastProbeAt = now;
      if (ip) {
        directIpCache.ip = ip;
        directIpCache.at = now;
        return ip;
      }
      return cachedDirectIp(true);
    })
    .catch(() => cachedDirectIp(true))
    .finally(() => {
      directIpCache.inflight = null;
    });

  return directIpCache.inflight;
}

async function probeDirectIp() {
  let url;
  try {
    url = new URL(EGRESS_CONFIG.probeUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  let lib;
  try {
    const mod = await import(url.protocol === "http:" ? "node:http" : "node:https");
    lib = mod.default ?? mod;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let req;
    try {
      req = lib.get(url, {
        headers: {
          "user-agent": "9router-egress-probe",
          accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        },
      }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          done(null);
          return;
        }
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (text.length < 4096) text += chunk;
        });
        res.on("end", () => done(parseIpFromProbeText(text)));
        res.on("error", () => done(null));
      });
    } catch {
      done(null);
      return;
    }

    req.on("error", () => done(null));
    req.setTimeout(EGRESS_CONFIG.probeTimeoutMs, () => {
      req.destroy();
      done(null);
    });
  });
}

function parseIpFromProbeText(text) {
  const body = String(text || "").trim();
  if (!body) return null;

  try {
    const json = JSON.parse(body);
    const candidate = json.ip || json.address || json.query || json.YourFuckingIPAddress;
    if (candidate) return sanitizeIp(candidate);
  } catch {
  }

  const kv = body.match(/^ip=(.+)$/im);
  if (kv) return sanitizeIp(kv[1]);

  const first = body.split(/\s+/)[0];
  return sanitizeIp(first);
}

function sanitizeIp(value) {
  const ip = String(value || "").trim().replace(/^["']|["']$/g, "");
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

export function markEgressCooling(egress, retryAfterMs) {
  if (!egress?.id || egress.confirmed !== true) return null;

  const requested = Number(retryAfterMs);
  const hasHint = retryAfterMs !== null && retryAfterMs !== undefined && Number.isFinite(requested) && requested >= 0;
  const ms = Math.min(
    Math.max(hasHint ? requested : EGRESS_CONFIG.defaultCooldownMs, EGRESS_CONFIG.minCooldownMs),
    EGRESS_CONFIG.maxCooldownMs
  );
  const until = Date.now() + ms;
  const existing = cooldowns.get(egress.id);
  if (existing && existing.until >= until) return existing;

  const markedAt = Date.now();
  // A repeated refusal keeps the probe count, so the backoff keeps growing
  // instead of restarting at the first interval on every failed probe.
  const probeCount = existing?.probeCount || 0;
  const entry = { until, retryAfterMs: ms, markedAt, probeCount };
  cooldowns.set(egress.id, entry);
  probes.set(egress.id, markedAt + probeDelay(probeCount));
  return entry;
}

function probeDelay(probeCount) {
  return Math.min(
    EGRESS_CONFIG.recheckIntervalMs * 2 ** Math.max(0, probeCount - 1),
    EGRESS_CONFIG.maxRecheckIntervalMs
  );
}

/**
 * True when a cooling egress is due for one real attempt. The interval doubles
 * per attempt up to maxRecheckIntervalMs, so a limited address costs at most a
 * handful of requests.
 */
export function isEgressProbeDue(egressOrId, now = Date.now()) {
  const id = typeof egressOrId === "string" ? egressOrId : egressOrId?.id;
  if (!id) return false;

  const entry = cooldowns.get(id);
  if (!entry || entry.until <= now) return false;

  const nextAt = probes.get(id) ?? entry.markedAt + probeDelay(entry.probeCount || 0);
  if (now < nextAt) return false;

  entry.probeCount = (entry.probeCount || 0) + 1;
  probes.set(id, now + probeDelay(entry.probeCount));
  return true;
}

/** A request on this egress succeeded: it is healthy, drop every mark. */
export function clearEgressCooldown(egressOrId) {
  const id = typeof egressOrId === "string" ? egressOrId : egressOrId?.id;
  if (!id) return false;
  probes.delete(id);
  return cooldowns.delete(id);
}

export function getEgressCooldown(egressOrId, now = Date.now()) {
  const id = typeof egressOrId === "string" ? egressOrId : egressOrId?.id;
  if (!id) return null;

  const entry = cooldowns.get(id);
  if (!entry) return null;
  if (entry.until <= now) {
    cooldowns.delete(id);
    return null;
  }
  return { ...entry, retryAfterMs: entry.until - now };
}

export function hasActiveDirectCooldown(now = Date.now()) {
  for (const [id, entry] of cooldowns) {
    if (id.startsWith("direct:") && entry.until > now) return true;
  }
  return false;
}

export function hasAlternateEgresses(proxyOptions = null) {
  const alternates = proxyOptions?.connectionProxyAlternates;
  if (!Array.isArray(alternates)) return false;
  return alternates.some((alt) => alt && (alt.connectionProxyUrl || alt.vercelRelayUrl || alt.url));
}

export function alternateToProxyOptions(proxyOptions, alternate) {
  const enabled = alternate?.connectionProxyEnabled === true;
  const proxyUrl = normalizeString(alternate?.connectionProxyUrl ?? alternate?.url);
  const noProxy = normalizeString(alternate?.connectionNoProxy ?? alternate?.noProxy);

  return {
    ...(proxyOptions || {}),
    enabled,
    connectionProxyEnabled: enabled,
    url: proxyUrl,
    connectionProxyUrl: proxyUrl,
    noProxy,
    connectionNoProxy: noProxy,
    vercelRelayUrl: normalizeString(alternate?.vercelRelayUrl),
    proxyPoolId: alternate?.proxyPoolId || null,
    strictProxy: alternate?.strictProxy === true,
    connectionProxyAlternates: proxyOptions?.connectionProxyAlternates || [],
  };
}

export function selectAlternateProxy(proxyOptions, targetUrl, excludeIds = new Set(), now = Date.now()) {
  const alternates = Array.isArray(proxyOptions?.connectionProxyAlternates)
    ? proxyOptions.connectionProxyAlternates
    : [];

  let earliestCooldownMs = null;
  for (const alternate of alternates) {
    const merged = alternateToProxyOptions(proxyOptions, alternate);
    const egress = identifyFixedEgress(targetUrl, merged);
    if (!egress || excludeIds.has(egress.id)) continue;

    const cooldown = getEgressCooldown(egress, now);
    if (cooldown) {
      earliestCooldownMs = earliestCooldownMs == null
        ? cooldown.retryAfterMs
        : Math.min(earliestCooldownMs, cooldown.retryAfterMs);
      continue;
    }

    return { alternate: { proxyOptions: merged, egress }, earliestCooldownMs };
  }

  return { alternate: null, earliestCooldownMs };
}

function headerValue(headers, name) {
  if (!headers) return null;
  const target = name.toLowerCase();

  if (typeof headers.get === "function") {
    const value = headers.get(name);
    if (value != null) return String(value);
  }

  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === target && value != null) return String(value);
    }
  }
  return null;
}

function parseDurationMs(raw, now = Date.now()) {
  if (raw === undefined || raw === null || raw === "") return null;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null;
    if (raw === 0) return 0;
    if (raw > 1e12) return Math.max(0, raw - now);
    if (raw > 1e9) return Math.max(0, raw * 1000 - now);
    return raw * 1000;
  }

  const text = String(raw).trim();
  if (!text) return null;

  if (/^\d+(?:\.\d+)?$/.test(text)) return parseDurationMs(Number(text), now);

  const date = Date.parse(text);
  if (!Number.isNaN(date)) {
    const diff = date - now;
    return diff > 0 ? diff : null;
  }

  const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\b/gi;
  let total = 0;
  let matched = false;
  let match;
  while ((match = re.exec(text))) {
    total += Number(match[1]) * (units[match[2].toLowerCase()] || 0);
    matched = true;
  }
  return matched && total > 0 ? total : null;
}

function parseRetryValue(key, raw, now) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (/(?:_ms|Ms)$/.test(key)) {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return parseDurationMs(raw, now);
}

const RETRY_BODY_KEYS = [
  "retry_after",
  "retryAfter",
  "retry_after_ms",
  "retryAfterMs",
  "reset_after",
  "resetAfter",
  "reset_after_ms",
  "resetAfterMs",
  "resets_at",
  "resetsAt",
  "reset_at",
  "resetAt",
  "retry_at",
  "retryAt",
];

function parseRetryAfterFromBody(bodyText, now) {
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return null;
  }

  const queue = [{ value: json, depth: 0 }];
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || depth > 4) continue;

    for (const key of RETRY_BODY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const parsed = parseRetryValue(key, value[key], now);
        if (parsed != null) return parsed;
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

function parseRetryAfterFromText(bodyText, now) {
  const match = String(bodyText || "").match(
    /(?:retry|reset|try\s+again)\s*(?:after|in)\s*([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds?|s|seconds?|secs?|m|minutes?|mins?|h|hours?|hrs?|d|days?)?/i
  );
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = (match[2] || "s").toLowerCase();
  const multiplier = unit.startsWith("ms") || unit.startsWith("millisecond")
    ? 1
    : unit.startsWith("m") || unit.startsWith("min")
      ? 60_000
      : unit.startsWith("h")
        ? 3_600_000
        : unit.startsWith("d")
          ? 86_400_000
          : 1000;
  return value * multiplier;
}

export function parseRetryAfterMs(headers, bodyText = "", now = Date.now()) {
  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter) {
    const parsed = parseDurationMs(retryAfter, now);
    if (parsed != null) return parsed;
  }

  for (const name of ["x-ratelimit-reset-after", "reset-after", "x-retry-after", "x-ratelimit-reset"]) {
    const raw = headerValue(headers, name);
    if (!raw) continue;
    const parsed = parseDurationMs(raw, now);
    if (parsed != null) return parsed;
  }

  if (!bodyText) return null;
  return parseRetryAfterFromBody(bodyText, now) ?? parseRetryAfterFromText(bodyText, now);
}

export function syntheticRateLimitResponse(retryAfterMs) {
  const value = Number(retryAfterMs);
  const retryAfterSec = Math.max(
    1,
    Math.ceil((Number.isFinite(value) && value > 0 ? value : EGRESS_CONFIG.defaultCooldownMs) / 1000)
  );

  return new Response(JSON.stringify({
    type: "error",
    error: {
      type: "FreeUsageLimitError",
      message: EGRESS_CONFIG.limitMessage,
    },
  }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(retryAfterSec),
    },
  });
}

export function describeEgress(egress) {
  if (!egress) return "unknown";
  if (egress.kind === "relay") return "relay";
  if (egress.kind === "proxy") return "proxy";
  return egress.confirmed ? `direct ${egress.ip}` : "direct (unconfirmed)";
}

export function resetEgressState() {
  cooldowns.clear();
  probes.clear();
  directIpCache.ip = null;
  directIpCache.at = 0;
  directIpCache.lastProbeAt = 0;
}
