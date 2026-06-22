/**
 * Bulk Import Proxy Resolver
 * 
 * Resolves proxy configuration for bulk import jobs from either:
 * 1. A proxy pool (stored in database)
 * 2. A manually provided proxy URL
 * 
 * Validates proxy URL format and returns a normalized proxy string.
 */

import logger from "@/lib/logger";
import { getProxyPoolById } from "../../../models/index.js";
import getSettings from "../../db/repos/settingsRepo.js";

const RELAY_POOL_TYPES = new Set(["vercel", "cloudflare", "deno"]);
const VALID_PROXY_PREFIXES = ["http://", "https://", "socks4://", "socks5://"];

/**
 * Validate proxy URL format
 * @param {string} proxyUrl - Proxy URL to validate
 * @returns {boolean} True if valid
 */
function isValidProxyUrl(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== 'string') return false;
  const trimmed = proxyUrl.trim();
  return VALID_PROXY_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

/**
 * Resolve proxy configuration for bulk import
 * @param {object} params - Proxy parameters
 * @param {string|null} params.proxyPoolId - ID of proxy pool to use
 * @param {string|null} params.proxyUrl - Manual proxy URL
 * @returns {Promise<{proxyUrl: string|null, error: string|null}>}
 */
export async function resolveBulkImportProxy({ proxyPoolId, proxyUrl }) {
  // If proxyPoolId is provided, fetch from database
  if (proxyPoolId) {
    const pool = await getProxyPoolById(proxyPoolId);
    
    if (!pool) {
      return { proxyUrl: null, error: "Proxy pool not found" };
    }
    
    if (!pool.isActive) {
      return { proxyUrl: null, error: "Proxy pool is not active" };
    }
    
    // Relay pools (Vercel, Cloudflare, Deno) don't provide actual proxies
    if (RELAY_POOL_TYPES.has(pool.type)) {
      return { 
        proxyUrl: null, 
        error: `${pool.type} pools are relay services and don't provide proxy URLs for browser automation` 
      };
    }
    
    // Get proxy URL from pool
    const resolvedProxy = pool.proxyUrl || pool.url;
    if (!resolvedProxy) {
      return { proxyUrl: null, error: "Proxy pool has no proxy URL configured" };
    }
    
    logger.debug("BULK_IMPORT", "Resolved proxy from pool", {
      poolId: proxyPoolId,
      poolType: pool.type,
      hasProxy: !!resolvedProxy
    });
    
    return { proxyUrl: resolvedProxy, error: null };
  }
  
  // If manual proxyUrl is provided, validate it
  if (proxyUrl) {
    const trimmed = proxyUrl.trim();
    
    if (!isValidProxyUrl(trimmed)) {
      return { 
        proxyUrl: null, 
        error: `Invalid proxy URL format. Must start with: ${VALID_PROXY_PREFIXES.join(', ')}` 
      };
    }
    
    logger.debug("BULK_IMPORT", "Using manual proxy URL", {
      hasProxy: true
    });
    
    return { proxyUrl: trimmed, error: null };
  }
  
  // No proxy configured (this is valid - direct connection)
  logger.debug("BULK_IMPORT", "No proxy configured, using direct connection");
  return { proxyUrl: null, error: null };
}

export default resolveBulkImportProxy;
