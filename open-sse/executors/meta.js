import { DefaultExecutor } from "./default.js";
import { isMuseSparkModel } from "../providers/models/helpers.js";

// Meta Muse Spark encodes the reasoning effort as a model-id suffix. The gateway
// convention for non-Meta providers is "model(level)"; Meta prefers the dash form
// "model-level" (e.g. muse-spark-1.3-xhigh). Accept both — the suffix is stripped
// for the upstream id and translated into reasoning effort.
const META_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "none"]);

// Muse Spark models are served by the Responses API (/v1/responses), which exposes a
// reasoning summary (response.reasoning_summary_text.*) and stateless encrypted replay.
// Non-Muse Spark models stay on the Chat Completions endpoint.
function isResponsesModel(model) {
  return isMuseSparkModel(model);
}

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

// Normalize a Meta effort string to its upstream-valid value. Muse Spark rejects
// "none" (HTTP 400) and has no upstream "max" (clamped to xhigh, see registry).
// Returns null when no effort should be sent (upstream default applies).
function normalizeMetaEffort(effort) {
  if (typeof effort !== "string") return null;
  const e = effort.toLowerCase().trim();
  if (e === "none" || e === "off") return null;
  if (e === "ultra" || e === "max") return "xhigh";
  return e; // minimal | low | medium | high | xhigh pass through
}

export class MetaExecutor extends DefaultExecutor {
  constructor() {
    super("meta");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const { base } = parseMetaSuffix(model);
    if (isResponsesModel(base)) {
      // Muse Spark → Responses API; everything else keeps the Chat Completions endpoint.
      return this.config.baseUrl.replace(/\/chat\/completions$/, "/responses");
    }
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  transformRequest(model, body, stream, credentials) {
    const { base, level } = parseMetaSuffix(model);
    const t = body && typeof body === "object" ? body : {};

    if (base !== model) t.model = base;

    if (isResponsesModel(base)) {
      // The Responses API names the output cap max_output_tokens and nests effort as
      // reasoning:{effort,summary} — normalize the Chat fields at this boundary. The
      // request translator already did this, but applyThinking re-writes reasoning_effort
      // (chat-shaped) afterward, so re-derive the Responses reasoning here.
      if (t.max_output_tokens === undefined) {
        if (t.max_completion_tokens !== undefined) t.max_output_tokens = t.max_completion_tokens;
        else if (t.max_tokens !== undefined) t.max_output_tokens = t.max_tokens;
      }
      delete t.max_tokens;
      delete t.max_completion_tokens;

      const current = t.reasoning && typeof t.reasoning === "object" && !Array.isArray(t.reasoning) ? t.reasoning : null;
      const raw = level
        || (typeof t.reasoning_effort === "string" ? t.reasoning_effort : null)
        || current?.effort;
      const effort = normalizeMetaEffort(raw);
      if (effort) {
        t.reasoning = { ...current, effort };
        if (!t.reasoning.summary) t.reasoning.summary = "auto";
      }
      delete t.reasoning_effort;
    } else {
      // Chat Completions path: the suffix only carries effort.
      if (level && level !== "none" && META_LEVELS.has(level) && t.reasoning_effort === undefined) {
        t.reasoning_effort = level === "max" ? "xhigh" : level;
      }
    }

    return super.transformRequest(base || model, t, stream, credentials);
  }
}
