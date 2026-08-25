/**
 * Fan-out aggregation across every active MCP server.
 *
 * Every gateway `*_list` endpoint (tools, prompts, resources, templates) needs
 * to call the same method on every active upstream server, prefix each
 * returned item by the server's short prefix, and merge everything into one
 * response. This module owns that pattern so the individual handlers stay
 * small and consistent.
 */

import { sendToMcpServer } from "../serverManager/transports.js";
import { invalidateActiveServersCache } from "../activeServers.js";
import { getServerPrefix } from "../prefix.js";

// ─── Tools/list short-lived cache ──────────────────────────────────────────
//
// A cold aggregation can take many seconds while upstream connections warm up.
// Caching the raw aggregated tools list makes repeated calls (reopening the
// combo modal, or successive gateway `tools/list` calls) effectively instant.
// The cache is combo-agnostic — combo filtering runs per-call after the cache.

const TOOLS_LIST_TTL_MS = 30_000;
let _toolsListCache = { key: null, tools: null, expires: 0 };

/**
 * Invalidate every cache that depends on the set of MCP servers. Call this
 * whenever a server is created / updated / deleted so both the tools/list
 * fan-out cache and the short-lived active-servers cache drop stale entries.
 */
export function invalidateToolsListCache() {
  _toolsListCache = { key: null, tools: null, expires: 0 };
  invalidateActiveServersCache();
}

function cacheKeyForServers(servers) {
  return servers
    .map((s) => s.id)
    .sort()
    .join(",");
}

/**
 * Aggregate prefixed tools from every active server. Caches successful,
 * non-empty results when `params` is empty so pagination-less calls stay fast.
 *
 * A single upstream failure never blocks the aggregation — the offending
 * server is logged and skipped.
 */
export async function aggregateAllTools(servers, params) {
  const hasParams = params && Object.keys(params).length > 0;
  const cacheKey = cacheKeyForServers(servers);

  if (
    !hasParams &&
    _toolsListCache.tools &&
    _toolsListCache.key === cacheKey &&
    _toolsListCache.expires > Date.now()
  ) {
    return _toolsListCache.tools;
  }

  const tools = await aggregateFromServers(servers, {
    method: "tools/list",
    idPrefix: "tools-list",
    params,
    pluck: (result) => result?.tools,
    mapItem: (tool, prefix) => ({
      name: `${prefix}__${tool.name}`,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }),
  });

  // Only cache successful, non-empty aggregations — a transient upstream
  // failure shouldn't pin an empty list for the full TTL.
  if (!hasParams && tools.length > 0) {
    _toolsListCache = {
      key: cacheKey,
      tools,
      expires: Date.now() + TOOLS_LIST_TTL_MS,
    };
  }

  return tools;
}

/**
 * Generic fan-out helper. Sends `method` to every active server in parallel,
 * plucks a list out of each response, prefixes items with the server's short
 * prefix, and returns the merged list.
 *
 * @param {object[]} servers
 * @param {object}   opts
 * @param {string}   opts.method     JSON-RPC method to call
 * @param {string}   opts.idPrefix   Human-readable id prefix for logs/tracing
 * @param {object}   [opts.params]   Params forwarded to the upstream request
 * @param {(result: object) => any[] | undefined} opts.pluck  Extract the list
 * @param {(item: any, prefix: string) => object} opts.mapItem  Prefix an item
 * @returns {Promise<object[]>}
 */
export async function aggregateFromServers(servers, opts) {
  const { method, idPrefix, params, pluck, mapItem } = opts;
  const merged = [];

  const promises = servers.map(async (server) => {
    try {
      const response = await sendToMcpServer(server, {
        jsonrpc: "2.0",
        id: `${idPrefix}-${server.id}`,
        method,
        params: params || {},
      });

      const items = pluck(response?.result);
      if (!Array.isArray(items)) return;
      const prefix = getServerPrefix(server);
      for (const item of items) merged.push(mapItem(item, prefix));
    } catch (err) {
      console.error(
        `[mcp-gateway] ${method} failed for ${server.name}:`,
        err.message,
      );
    }
  });

  await Promise.all(promises);
  return merged;
}
