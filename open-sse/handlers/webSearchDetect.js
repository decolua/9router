/**
 * Pure detection helpers for the server-side web-search shim.
 *
 * Deliberately dependency-free so it can be unit-tested in isolation and imported
 * from either the request shim or a test harness. No IO, no aliases, no side effects.
 */

// Anthropic validates server_tool_use ids against this pattern; a foreign id makes the
// client reject the whole turn. Mirrors translator/formats/claude.js.
export const SERVER_TOOL_USE_ID = /^srvtoolu_[a-zA-Z0-9_]+$/;

export const SEARCH_TOOL_TYPES = /^web_search(_\d{8})?$/;
export const SEARCH_TOOL_NAMES = /^web_search$/;

export const DEFAULT_MAX_RESULTS = 5;
export const HARD_MAX_RESULTS = 20;

/** Generate an id that satisfies SERVER_TOOL_USE_ID. */
export function serverToolUseId() {
  const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  const id = `srvtoolu_${hex()}${hex()}${hex()}`;
  return SERVER_TOOL_USE_ID.test(id) ? id : `srvtoolu_${Date.now().toString(36)}_a`;
}

/**
 * The client puts the search query in the final user turn. Keep the last text block
 * only — earlier turns are conversation context, not the query.
 */
export function extractSearchQuery(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") {
      const q = content.trim();
      if (q) return q;
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        return block.text.trim();
      }
    }
  }
  return null;
}

/**
 * Is this request a forced single web-search turn?
 *
 * Only fires when the client FORCED a single search tool. Pass-through chat traffic
 * carrying web_search among many tools must stay untouched, which keeps the blast
 * radius small for every other connection sharing the router.
 *
 * @returns {{name:string, query:string, maxResults:number}|null}
 */
export function detectForcedWebSearch(body) {
  if (!body || typeof body !== "object") return null;

  const choice = body.tool_choice;
  if (!choice || typeof choice !== "object" || choice.type !== "tool") return null;

  const name = choice.name;
  if (typeof name !== "string" || !SEARCH_TOOL_NAMES.test(name)) return null;

  // Confirm the client actually declared it as a web-search tool. Tolerate the
  // `custom` type some clients emit, and a missing declaration (older clients).
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const declared = tools.find((t) => t && t.name === name);
  if (declared) {
    const type = String(declared.type || "");
    if (type && type !== "custom" && !SEARCH_TOOL_TYPES.test(type)) return null;
  }

  const query = extractSearchQuery(body);
  if (!query) return null;

  const declaredMax = Number(declared?.max_uses);
  const maxResults = Number.isFinite(declaredMax) && declaredMax > 0
    ? Math.min(declaredMax, HARD_MAX_RESULTS)
    : DEFAULT_MAX_RESULTS;

  return { name, query, maxResults };
}
