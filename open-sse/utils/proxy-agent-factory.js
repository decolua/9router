/**
 * Proxy Agent Factory
 *
 * Creates and caches proxy agents for HTTP/HTTPS and SOCKS protocols.
 * Supports proxy authentication via URL credentials.
 *
 * Usage:
 *   import { getProxyAgent, shouldUseProxy } from './proxy-agent-factory.js'
 *   const agent = getProxyAgent('http://user:pass@proxy.com:8080')
 */

// LRU cache with max size limit to prevent memory leaks
const MAX_CACHE_SIZE = 100;
const agentCache = new Map();

/**
 * Evict oldest entry if cache is full (LRU eviction)
 */
function evictIfFull() {
  if (agentCache.size >= MAX_CACHE_SIZE) {
    const firstKey = agentCache.keys().next().value;
    agentCache.delete(firstKey);
  }
}

/**
 * Parse proxy URL into components
 * @param {string} proxyUrl - Proxy URL (e.g., "http://user:pass@host:port")
 * @returns {object} Parsed proxy config
 */
function parseProxyUrl(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== 'string') {
    return null;
  }

  try {
    const url = new URL(proxyUrl);
    const protocol = url.protocol.replace(':', '');

    if (!['http', 'https', 'socks', 'socks4', 'socks5'].includes(protocol)) {
      throw new Error(`Unsupported proxy protocol: ${protocol}`);
    }

    return {
      protocol,
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : null,
      username: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
    };
  } catch (error) {
    throw new Error(`Invalid proxy URL: ${error.message}`);
  }
}

/**
 * Validate proxy URL format
 * @param {string} proxyUrl - Proxy URL to validate
 * @returns {boolean} True if valid
 */
function validateProxyUrl(proxyUrl) {
  try {
    const config = parseProxyUrl(proxyUrl);
    return config !== null && config.host && config.port;
  } catch {
    return false;
  }
}

/**
 * Get or create proxy agent for given URL
 * @param {string} proxyUrl - Proxy URL
 * @returns {Promise<Agent|null>} Proxy agent or null for direct connection
 */
async function getProxyAgent(proxyUrl) {
  if (!proxyUrl) {
    return null;
  }

  // Normalize URL for cache key (remove credentials for security)
  const config = parseProxyUrl(proxyUrl);
  if (!config) {
    return null;
  }

  // Validate port is present
  if (!config.port) {
    throw new Error(`Proxy URL must include port: ${proxyUrl}`);
  }

  const cacheKey = `${config.protocol}://${config.host}:${config.port}`;

  if (agentCache.has(cacheKey)) {
    // LRU: delete and re-add to mark as recently used
    const agent = agentCache.get(cacheKey);
    agentCache.delete(cacheKey);
    agentCache.set(cacheKey, agent);
    return agent;
  }

  // Evict oldest entry if cache is full
  evictIfFull();

  let agent;

  if (config.protocol.startsWith('socks')) {
    const { SocksProxyAgent } = await import('socks-proxy-agent');
    agent = new SocksProxyAgent(proxyUrl);
  } else {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    agent = new HttpsProxyAgent(proxyUrl);
  }

  agentCache.set(cacheKey, agent);
  return agent;
}

/**
 * Check if target URL should bypass proxy
 * @param {string} targetUrl - Target URL to check
 * @param {string[]} bypassPatterns - NO_PROXY patterns (e.g., ["*.local", "localhost"])
 * @returns {boolean} True if should bypass proxy
 */
function shouldBypassProxy(targetUrl, bypassPatterns = []) {
  if (!bypassPatterns || bypassPatterns.length === 0) {
    return false;
  }

  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();

    return bypassPatterns.some(pattern => {
      const p = pattern.trim().toLowerCase();

      if (p === '*') return true;
      if (p.startsWith('.')) {
        return hostname.endsWith(p) || hostname === p.slice(1);
      }
      return hostname === p || hostname.endsWith(`.${p}`);
    });
  } catch {
    return false;
  }
}

/**
 * Determine if proxy should be used for target URL
 * @param {string} targetUrl - Target URL
 * @param {object|null} proxyConfig - Proxy config with {url, bypass}
 * @param {string} globalNoProxy - Global NO_PROXY env var
 * @returns {Promise<Agent|null>} Agent or null
 */
async function shouldUseProxy(targetUrl, proxyConfig, globalNoProxy = '') {
  if (!proxyConfig?.url) {
    return null;
  }

  const bypassPatterns = [
    ...(globalNoProxy || '').split(',').filter(Boolean),
    ...(proxyConfig.bypass || []),
  ];

  if (shouldBypassProxy(targetUrl, bypassPatterns)) {
    return null;
  }

  return getProxyAgent(proxyConfig.url);
}

/**
 * Clear proxy agent cache (useful for testing or config reload)
 */
function clearProxyCache() {
  agentCache.clear();
}

export {
  parseProxyUrl,
  validateProxyUrl,
  getProxyAgent,
  shouldBypassProxy,
  shouldUseProxy,
  clearProxyCache,
};
