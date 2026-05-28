// Prefix Cache Awareness: add Anthropic cache_control hints to stable prefix content.
// Runs BEFORE caveman + compact-policy injectors so their inserts land inside
// the cached prefix (those injectors splice before the last cache_control block).
//
// Scope:
//   - Anthropic / Claude format only — OpenAI and Gemini use automatic
//     server-side prefix caching and have no per-request hint.
//   - Touches body.system (last block) and body.tools (last tool).
//   - If client already set any cache_control on those fields, we no-op there.
//   - Never modifies body.messages — message stability is the client's call.

import { FORMATS } from "../translator/formats.js";

const EPHEMERAL = { type: "ephemeral" };

export function applyPrefixCacheHints(body, format) {
  if (!body || format !== FORMATS.CLAUDE) return null;

  const stats = { system: false, tools: false, clientPreMarked: false };
  markSystem(body, stats);
  markTools(body, stats);

  // Credit attribution whenever prefix caching is in effect — whether we marked it,
  // or the client already had markers in place. Both produce cache hits at Anthropic.
  if (!stats.system && !stats.tools && !stats.clientPreMarked) return null;
  return stats;
}

function markSystem(body, stats) {
  if (!body.system) return;

  if (typeof body.system === "string") {
    if (body.system.length === 0) return;
    body.system = [{ type: "text", text: body.system, cache_control: { ...EPHEMERAL } }];
    stats.system = true;
    return;
  }

  if (!Array.isArray(body.system) || body.system.length === 0) return;

  if (body.system.some((b) => b && b.cache_control)) {
    stats.clientPreMarked = true;
    return;
  }

  const last = body.system[body.system.length - 1];
  if (!last) return;
  last.cache_control = { ...EPHEMERAL };
  stats.system = true;
}

function markTools(body, stats) {
  if (!Array.isArray(body.tools) || body.tools.length === 0) return;

  if (body.tools.some((t) => t && t.cache_control)) {
    stats.clientPreMarked = true;
    return;
  }

  const last = body.tools[body.tools.length - 1];
  if (!last) return;
  last.cache_control = { ...EPHEMERAL };
  stats.tools = true;
}

export function formatPrefixCacheLog(stats) {
  if (!stats) return null;
  const marked = [];
  if (stats.system) marked.push("system");
  if (stats.tools) marked.push("tools");
  if (marked.length > 0) return `[PREFIX-CACHE] marked: ${marked.join(",")}`;
  if (stats.clientPreMarked) return `[PREFIX-CACHE] client pre-marked (no-op)`;
  return null;
}
