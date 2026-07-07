// Aggregator: per-instance tool lists are merged into a single namespaced
// tool catalog exposed by the gateway. Tool names are prefixed with
// `${instanceSlug}__` so multiple of the same kind (Jira X vs Jira Y)
// coexist on the gateway. tools/call() splits on the FIRST `__` to find
// the target instance and strips the prefix before dispatching.

import { clientFor } from "./client";
import { filterToolsByGrants, isToolAllowed } from "./grants";
import { isRecord } from "./guards";

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
 * Aggregate tools from all granted instances.
 * @param {Array<object>} instances parsed instance rows
 * @param {Array<{instanceId: string, slug?: string | null, toolAllowlist: string[] | null}>} [grants]
 * @returns {Promise<{tools: object[], errors: Array<{slug: string, message: string}>}>}
 */
export async function aggregateTools(instances, grants = []) {
  const tools = [];
  const errors = [];
  const results = await Promise.allSettled(
    instances.map(async (i) => ({ slug: i.slug, tools: await clientFor(i).listTools(i) }))
  );
  for (let idx = 0; idx < results.length; idx++) {
    const r = results[idx];
    if (!r) continue;
    const slug = instances[idx]?.slug || "?";
    if (r.status === "fulfilled") {
      const list = Array.isArray(r.value.tools) ? r.value.tools : [];
      for (const t of list) {
        if (!isRecord(t) || !t.name) continue;
        const name = t.name;
        if (typeof name !== "string") continue;
        tools.push({
          name: prefixName(slug, name),
          description: typeof t.description === "string" ? t.description : "",
          inputSchema: t.inputSchema || { type: "object", properties: {} },
          _instance: slug,
        });
      }
    } else {
      const reason = r.reason;
      const message = isRecord(reason) && typeof reason.message === "string" ? reason.message : String(reason);
      errors.push({ slug, message });
      console.warn(`[mcp-gw] listTools failed for ${slug}: ${message}`);
    }
  }
  return { tools: filterToolsByGrants(tools, grants), errors };
}

/**
 * Dispatch a namespaced tool call to the owning upstream instance.
 * @param {Array<object>} instances
 * @param {Array<object>} grants
 * @param {string} prefixedName
 * @param {Record<string, unknown>} args
 * @returns {Promise<{instance: object, result: unknown}>}
 */
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
  if (grants && grants.length > 0 && !isToolAllowed(bareName, slug, grants)) {
    const err = new Error(`not authorized for tool: ${bareName}`);
    err.code = -32602;
    throw err;
  }
  const result = await clientFor(instance).callTool(instance, bareName, args);
  return { instance, result };
}

export { prefixName, splitPrefixedName };
