import { getProxyPoolById } from "../../../models/index.js";
import { getSettings } from "../../db/repos/settingsRepo.js";

const RELAY_POOL_TYPES = new Set(["vercel", "cloudflare", "deno"]);
const VALID_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);

export function splitBulkImportProxyUrls(value) {
  return String(value || "")
    .split(/[\s,;]+(?=(?:https?:\/\/|socks[45]:\/\/))/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function validateProxyUrls(proxyUrls) {
  for (const proxyUrl of proxyUrls) {
    let parsed;
    try {
      parsed = new URL(proxyUrl);
    } catch {
      return "proxyUrl must be a valid URL";
    }
    if (!VALID_PROXY_PROTOCOLS.has(parsed.protocol)) {
      return "proxyUrl must start with http://, https://, socks4://, or socks5://";
    }
    if (!parsed.hostname) return "proxyUrl must include a host";
  }
  return null;
}

function buildResolvedProxy(proxyUrls, source) {
  const urls = [...new Set(proxyUrls)];
  return {
    proxyUrl: urls[0] || null,
    proxyUrls: urls,
    proxyMode: urls.length > 1 ? "round-robin" : (urls.length === 1 ? "single" : "none"),
    proxyPoolId: source?.proxyPoolId || null,
    proxySource: source?.proxySource || null,
    error: null,
  };
}

/**
 * Resolve a launchable proxy URL from bulk-import request body.
 *
 * Priority:
 *   1. proxyPoolId (lookup pool, reject relay types and inactive pools)
 *   2. proxyUrl (freeform, basic prefix validation)
 *   3. settings.useOutboundProxyForAutomation + settings.outboundProxyUrl fallback
 *
 * Returns { proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, error }.
 * When error is non-null the caller should respond with 400.
 */
export async function resolveBulkImportProxy({ proxyPoolId, proxyUrl, useSettingsFallback = true } = {}) {
  if (proxyPoolId) {
    const pool = await getProxyPoolById(proxyPoolId);
    if (!pool) {
      return { proxyUrl: null, proxyUrls: [], proxyMode: "none", proxyPoolId, proxySource: "pool", error: "Proxy pool not found" };
    }
    if (!pool.isActive) {
      return { proxyUrl: null, proxyUrls: [], proxyMode: "none", proxyPoolId, proxySource: "pool", error: "Proxy pool is inactive" };
    }
    if (RELAY_POOL_TYPES.has(pool.type)) {
      return {
        proxyUrl: null,
        proxyUrls: [],
        proxyMode: "none",
        proxyPoolId,
        proxySource: "pool",
        error: `Proxy pool type "${pool.type}" is a URL-rewriting relay and cannot be used for browser launch`,
      };
    }
    const proxyUrls = splitBulkImportProxyUrls(pool.proxyUrl);
    const validationError = validateProxyUrls(proxyUrls);
    if (validationError) {
      return { proxyUrl: null, proxyUrls: [], proxyMode: "none", proxyPoolId, proxySource: "pool", error: validationError };
    }
    return buildResolvedProxy(proxyUrls, { proxyPoolId, proxySource: "pool" });
  }

  if (proxyUrl) {
    const proxyUrls = splitBulkImportProxyUrls(proxyUrl);
    if (!proxyUrls.length) return buildResolvedProxy([], { proxySource: "custom" });
    const validationError = validateProxyUrls(proxyUrls);
    if (validationError) {
      return {
        proxyUrl: null,
        proxyUrls: [],
        proxyMode: "none",
        proxyPoolId: null,
        proxySource: "custom",
        error: validationError,
      };
    }
    return buildResolvedProxy(proxyUrls, { proxySource: "custom" });
  }

  // Fallback: check settings for outbound proxy automation opt-in
  if (useSettingsFallback) {
    try {
      const settings = await getSettings();
      if (settings.useOutboundProxyForAutomation === true && settings.outboundProxyUrl) {
        const proxyUrls = splitBulkImportProxyUrls(settings.outboundProxyUrl);
        const validationError = validateProxyUrls(proxyUrls);
        if (validationError) {
          return { proxyUrl: null, proxyUrls: [], proxyMode: "none", proxyPoolId: null, proxySource: "settings", error: validationError };
        }
        return buildResolvedProxy(proxyUrls, { proxySource: "settings" });
      }
    } catch {
      // Settings unavailable; proceed without proxy
    }
  }

  return buildResolvedProxy([], { proxySource: null });
}
