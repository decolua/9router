// Aggregator: per-instance tool lists are merged into a single namespaced
// tool catalog exposed by the gateway. Tool names are prefixed with
// `${instanceSlug}__` so multiple of the same kind (Jira X vs Jira Y)
// coexist on the gateway. tools/call() splits on the FIRST `__` to find
// the target instance and strips the prefix before dispatching.
//
// Failures from individual instances are logged and skipped — one broken
// upstream MUST NOT take down the whole gateway. A slug that doesn't
// resolve to a granted instance yields a JSON-RPC -32602 "unknown tool".

import { clientFor } from "./client.js";
import { filterToolsByGrants, isToolAllowed } from "./grants.js";
export const TOOL_PREFIX_SEP = "__";

function prefixName(slug, name) {
  return `${slug}${TOOL_PREFIX_SEP}${name}`;
}

function splitPrefixedName(prefixed) {
  const idx = prefixed.indexOf(TOOL_PREFIX_SEP);
  if (idx <= 0) return null;
  return {
    slug: prefixed.slice(0, idx),
    bareName: prefixed.slice(idx + TOOL_PREFIX_SEP.length),
  };
}

/**
 * @param {Array<object>} instances parsed instance rows
 * @param {Array<{instanceId, slug, toolAllowlist}>} [grants] per-key grants
 *   with per-instance slug and optional tool allowlist. Empty/undefined =
 *   no filtering (used by tests and internal tools/list only).
 * @returns {Promise<{ tools: object[], errors: Array<{slug, message}> }>}
 */
export async function aggregateTools(instances, grants = []) {
  const tools = [];
  const errors = [];
  const results = await Promise.allSettled(
    instances.map(async (i) => ({ slug: i.slug, tools: await clientFor(i).listTools(i) }))
  );
  for (let idx = 0; idx < results.length; idx++) {
    const r = results[idx];
    const slug = instances[idx]?.slug || "?";
    if (r.status === "fulfilled") {
      const list = Array.isArray(r.value.tools) ? r.value.tools : [];
      for (const t of list) {
        if (!t?.name) continue;
        tools.push({
          name: prefixName(slug, t.name),
          description: t.description || "",
          inputSchema: t.inputSchema || { type: "object", properties: {} },
          // Preserve the original name for harnesses that introspect.
          _instance: slug,
        });
      }
    } else {
      const message = r.reason?.message || String(r.reason);
      errors.push({ slug, message });
      console.warn(`[mcp-gw] listTools failed for ${slug}: ${message}`);
    }
  }
  return { tools: filterToolsByGrants(tools, grants), errors };
}

export async function dispatchToolCall(instances, grants, prefixedName, args) {
  const split = splitPrefixedName(prefixedName);
  if (!split) {
    const err = new Error(`unknown tool: ${prefixedName} (missing ${TOOL_PREFIX_SEP} separator)`);
    err.code = -32602;
    throw err;
  }
  const { slug, bareName } = split;
  const instance = instances.find((i) => i.slug === slug);
  if (!instance) {
    const err = new Error(`unknown tool: ${prefixedName} (no instance with slug "${slug}")`);
    err.code = -32602;
    throw err;
  }
  // Defense in depth: the caller's allowlist must include this tool, even
  // if the slug is granted. filterToolsByGrants already hides it from
  // tools/list, but a misbehaving client could still guess and call.
  if (grants && grants.length > 0 && !isToolAllowed(bareName, slug, grants)) {
    const err = new Error(`not authorized for tool: ${bareName}`);
    err.code = -32602;
    throw err;
  }
  const result = await clientFor(instance).callTool(instance, bareName, args);
  return { instance, result };
}

export { prefixName, splitPrefixedName };
