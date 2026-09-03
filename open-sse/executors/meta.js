import { DefaultExecutor } from "./default.js";

// Meta Muse Spark encodes the reasoning effort as a model-id suffix. The gateway
// convention for non-Meta providers is "model(level)"; Meta prefers the dash form
// "model-level" (e.g. muse-spark-1.3-xhigh). Accept both — the suffix is stripped
// for the upstream id and translated into reasoning_effort.
const META_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "none"]);

// Strip a trailing reasoning suffix from a Meta model id. Returns the base id
// (upstream-real) plus the level, or { base: model, level: null } when absent.
export function parseMetaSuffix(model) {
  const s = String(model || "");
  const paren = s.match(/\(([^()]+)\)\s*$/);
  if (paren) return { base: s.slice(0, paren.index).trim(), level: paren[1].trim().toLowerCase() };
  const dash = s.match(/-(minimal|low|medium|high|xhigh|max|none)\s*$/);
  if (dash) return { base: s.slice(0, dash.index).trim(), level: dash[1] };
  return { base: s, level: null };
}

export class MetaExecutor extends DefaultExecutor {
  constructor() {
    super("meta");
  }

  transformRequest(model, body, stream, credentials) {
    const { base, level } = parseMetaSuffix(model);
    const t = body && typeof body === "object" ? body : {};

    if (base !== model) {
      // Sent upstream as the real model base; the reasoning suffix only carries effort.
      t.model = base;
      if (level && level !== "none" && META_LEVELS.has(level) && t.reasoning_effort === undefined) {
        // Muse Spark has no "max" (clamp to xhigh); "none" is rejected upstream so omit it.
        t.reasoning_effort = level === "max" ? "xhigh" : level;
      }
    }

    return super.transformRequest(base || model, t, stream, credentials);
  }
}
