const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

let cachedConfigKey = null;
let cachedRules = null;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isDigits(value) {
  return /^[0-9]+$/.test(value);
}

function stripIpDecorators(value) {
  let normalized = normalizeString(value)
    .replace(/^for=/i, "")
    .replace(/^"|"$/g, "")
    .replace(/^\[|\]$/g, "");

  const zoneIndex = normalized.indexOf("%");
  if (zoneIndex !== -1) {
    normalized = normalized.slice(0, zoneIndex);
  }

  if (normalized.toLowerCase() === "unknown") return "";

  if (normalized.startsWith("[") && normalized.includes("]")) {
    const endIndex = normalized.indexOf("]");
    return normalized.slice(1, endIndex);
  }

  const colonCount = (normalized.match(/:/g) || []).length;
  if (colonCount === 1 && normalized.includes(".")) {
    const [host, port] = normalized.split(":");
    if (isDigits(port)) return host;
  }

  if (normalized.toLowerCase().startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (parseIpv4(mapped)) return mapped;
  }

  return normalized;
}

function parseIpv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  const bytes = [];
  for (const part of parts) {
    if (!isDigits(part)) return null;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    bytes.push(num);
  }
  return Uint8Array.from(bytes);
}

function parseIpv6(ip) {
  if (!ip.includes(":")) return null;

  const compressed = ip.split("::");
  if (compressed.length > 2) return null;

  const left = compressed[0] ? compressed[0].split(":").filter(Boolean) : [];
  const right = compressed.length === 2 && compressed[1]
    ? compressed[1].split(":").filter(Boolean)
    : [];

  const totalGroups = left.length + right.length;
  if (compressed.length === 1 && totalGroups !== 8) return null;
  if (compressed.length === 2 && totalGroups >= 8) return null;

  const groups = [...left];
  if (compressed.length === 2) {
    for (let i = 0; i < 8 - totalGroups; i++) groups.push("0");
  }
  groups.push(...right);

  if (groups.length !== 8) return null;

  const bytes = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const num = Number.parseInt(group, 16);
    bytes.push((num >> 8) & 0xff, num & 0xff);
  }

  return Uint8Array.from(bytes);
}

function parseIp(ip) {
  const normalized = stripIpDecorators(ip);
  if (!normalized) return null;
  return parseIpv4(normalized) || parseIpv6(normalized);
}

function parseRule(rawRule) {
  const normalizedRule = normalizeString(rawRule);
  if (!normalizedRule) return null;

  const [rawIp, rawPrefix] = normalizedRule.split("/");
  const bytes = parseIp(rawIp);
  if (!bytes) {
    throw new Error(`Invalid IP allowlist entry: ${normalizedRule}`);
  }

  if (rawPrefix === undefined) {
    return { type: "exact", bytes };
  }

  if (!isDigits(rawPrefix)) {
    throw new Error(`Invalid CIDR prefix in IP allowlist entry: ${normalizedRule}`);
  }

  const prefix = Number(rawPrefix);
  const maxPrefix = bytes.length * 8;
  if (prefix < 0 || prefix > maxPrefix) {
    throw new Error(`CIDR prefix out of range in IP allowlist entry: ${normalizedRule}`);
  }

  return { type: "cidr", bytes, prefix };
}

function matchesCidr(ipBytes, ruleBytes, prefix) {
  const fullBytes = Math.floor(prefix / 8);
  const remainderBits = prefix % 8;

  for (let i = 0; i < fullBytes; i++) {
    if (ipBytes[i] !== ruleBytes[i]) return false;
  }

  if (remainderBits === 0) return true;

  const mask = (0xff << (8 - remainderBits)) & 0xff;
  return (ipBytes[fullBytes] & mask) === (ruleBytes[fullBytes] & mask);
}

function getAllowlistRules() {
  const enabled = process.env.IP_ALLOWLIST_ENABLED === "true";
  if (!enabled) return [];

  const rawAllowlist = normalizeString(process.env.IP_ALLOWLIST);
  const cacheKey = `${process.env.IP_ALLOWLIST_ENABLED}:${rawAllowlist}`;

  if (cachedConfigKey === cacheKey && cachedRules) {
    return cachedRules;
  }

  if (!rawAllowlist) {
    throw new Error("IP_ALLOWLIST_ENABLED=true but IP_ALLOWLIST is empty");
  }

  const rules = rawAllowlist
    .split(/[\n,]/)
    .map((entry) => normalizeString(entry))
    .filter(Boolean)
    .map(parseRule);

  if (rules.length === 0) {
    throw new Error("IP_ALLOWLIST_ENABLED=true but IP_ALLOWLIST has no valid entries");
  }

  cachedConfigKey = cacheKey;
  cachedRules = rules;
  return rules;
}

function getHostName(request) {
  const host = request?.headers?.get?.("host") || "";
  return host.split(":")[0].toLowerCase();
}

function getFirstForwardedForIp(headerValue) {
  const forwardedValue = normalizeString(headerValue);
  if (!forwardedValue) return null;

  const entries = forwardedValue.split(",");
  for (const entry of entries) {
    const ip = stripIpDecorators(entry);
    if (parseIp(ip)) return ip;
  }

  return null;
}

function getForwardedHeaderIp(headerValue) {
  const forwardedValue = normalizeString(headerValue);
  if (!forwardedValue) return null;

  const entries = forwardedValue.split(",");
  for (const entry of entries) {
    const parts = entry.split(";");
    for (const part of parts) {
      const [key, value] = part.split("=");
      if (normalizeString(key).toLowerCase() !== "for") continue;
      const ip = stripIpDecorators(value);
      if (parseIp(ip)) return ip;
    }
  }

  return null;
}

export function getClientIpFromHeaders(headers) {
  return getFirstForwardedForIp(headers.get("x-forwarded-for"))
    || (() => {
      const ip = stripIpDecorators(headers.get("x-real-ip"));
      return parseIp(ip) ? ip : null;
    })()
    || getForwardedHeaderIp(headers.get("forwarded"));
}

export function getForwardedClientHeaders(request) {
  const headers = {};
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const forwarded = request.headers.get("forwarded");

  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  if (realIp) headers["x-real-ip"] = realIp;
  if (forwarded) headers.forwarded = forwarded;

  return headers;
}

export function evaluateIpAllowlist(request) {
  const enabled = process.env.IP_ALLOWLIST_ENABLED === "true";
  if (!enabled) {
    return { allowed: true, enabled: false, clientIp: null, reason: "disabled" };
  }

  const hostName = getHostName(request);
  if (LOOPBACK_HOSTS.has(hostName)) {
    return { allowed: true, enabled: true, clientIp: hostName, reason: "loopback" };
  }

  const rules = getAllowlistRules();
  const clientIp = getClientIpFromHeaders(request.headers);

  if (!clientIp) {
    return { allowed: false, enabled: true, clientIp: null, reason: "missing_client_ip" };
  }

  const ipBytes = parseIp(clientIp);
  if (!ipBytes) {
    return { allowed: false, enabled: true, clientIp, reason: "invalid_client_ip" };
  }

  const matched = rules.some((rule) => {
    if (rule.bytes.length !== ipBytes.length) return false;
    if (rule.type === "exact") return bytesEqual(rule.bytes, ipBytes);
    return matchesCidr(ipBytes, rule.bytes, rule.prefix);
  });

  return {
    allowed: matched,
    enabled: true,
    clientIp,
    reason: matched ? "allowlist_match" : "allowlist_block",
  };
}
