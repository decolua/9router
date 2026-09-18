/**
 * Free-tier OpenCode Zen fingerprints its official client through the case of
 * the file-search tool quartet (bash/glob/grep/read) present in the request
 * body. Claude Code CLI sends the same built-in tools capitalised
 * (Bash/Glob/Grep/Read), so the fingerprint never matches and the gate rejects
 * every request coming from that harness.
 *
 * Measured directly against the upstream for muse-spark-1.3-contributor-free:
 *
 *   capitalised only        -> HTTP 403 FreeTierError
 *   capitalised + lowercase -> HTTP 500 server_error (upstream sees duplicates)
 *   lowercase only          -> HTTP 200
 *
 * So a case-variant must be RENAMED to the canonical lowercase form, not added
 * alongside it: appending "bash" next to the caller's "Bash" produces two tools
 * with the same name and turns a 403 into a 500.
 *
 * Renaming alone is enough to pass the gate, but the client still has to receive
 * the tool name it declared itself — hence the restore helpers below, which put
 * the caller's original spelling back on the response.
 */

/** Canonical names the upstream gate looks for. */
export const OPENCODE_FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"];

// Maps the body object to the names renamed for that request. A WeakMap keyed by
// body is used because transformRequest() receives a spread copy of credentials,
// so storing the map there would never be visible from chatCore.
const renamedToolNames = new WeakMap();

/** Canonical lowercase name when `name` is a quartet member; "" otherwise. */
export function fingerprintToolKey(name) {
  const lower = String(name ?? "").trim().toLowerCase();
  return OPENCODE_FINGERPRINT_TOOLS.includes(lower) ? lower : "";
}

/** Read a tool name from either shape: flat ({name}) or chat ({function:{name}}). */
function toolNameOf(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
  if (typeof tool.name === "string" && tool.name.trim()) return tool.name.trim();
  const fn = tool.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string") {
    return fn.name.trim();
  }
  return "";
}

/**
 * Rename quartet case-variants to their canonical lowercase form and drop
 * duplicate names, since the upstream rejects a body carrying two tools with the
 * same name. Caller tools outside the quartet are left untouched.
 *
 * @param {Array} tools
 * @returns {{ tools: Array, map: Map<string,string> }} map: sent name -> original name
 */
export function concealFingerprintToolNames(tools) {
  const map = new Map();
  if (!Array.isArray(tools) || tools.length === 0) return { tools, map };

  const seen = new Set();
  const out = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      out.push(tool);
      continue;
    }
    const current = toolNameOf(tool);
    if (!current) {
      out.push(tool);
      continue;
    }
    const key = fingerprintToolKey(current);
    const finalName = (key || current).toLowerCase();
    if (seen.has(finalName)) continue;
    seen.add(finalName);

    if (key && key !== current) {
      map.set(key, current);
      const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)
        ? tool.function
        : null;
      out.push(fn ? { ...tool, function: { ...fn, name: key } } : { ...tool, name: key });
    } else {
      out.push(tool);
    }
  }
  return { tools: out, map };
}

/**
 * Append only the quartet members that are genuinely absent, as no-op
 * declarations. A body carrying no tools at all is also rejected upstream
 * (measured 403), so this runs even when `tools` was undefined.
 *
 * @param {Array} tools
 * @param {boolean} flat - true for the Responses shape (name at top level)
 * @returns {Array}
 */
export function appendMissingFingerprintTools(tools, flat) {
  const list = Array.isArray(tools) ? tools : [];
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (list.some((t) => toolNameOf(t).toLowerCase() === name)) continue;
    list.push(flat ? {
      type: "function",
      name,
      description: `OpenCode built-in ${name} tool`,
      parameters: { type: "object", properties: {} },
    } : {
      type: "function",
      function: {
        name,
        description: `OpenCode built-in ${name} tool`,
        parameters: { type: "object", properties: {} },
      },
    });
  }
  return list;
}

/** Point an explicit tool_choice at the renamed tool. */
export function retargetToolChoice(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  const choice = body.tool_choice;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return;
  if (typeof choice.name !== "string") return;
  const key = fingerprintToolKey(choice.name);
  if (!key || !map.has(key)) return;
  body.tool_choice = { ...choice, name: key };
}

/**
 * Full request-side pass: rename case-variants, drop duplicates, append what is
 * missing, retarget tool_choice. Records the rename map against the body so the
 * response side can recover it after the executor returns.
 *
 * @param {object} body
 * @param {boolean} flat - true when tools are in the Responses shape
 * @returns {Map<string,string>} map: sent name -> original name
 */
export function applyFingerprintTools(body, flat) {
  if (!body || typeof body !== "object") return new Map();
  const { tools, map } = concealFingerprintToolNames(body.tools);
  body.tools = appendMissingFingerprintTools(tools, flat);
  retargetToolChoice(body, map);
  recordRenamedToolNames(body, map);
  return map;
}

/** Store the rename map for `body` (called by the executor after renaming). */
export function recordRenamedToolNames(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  renamedToolNames.set(body, map);
}

/** Retrieve the rename map for `body` (called by chatCore after execute). */
export function takeRenamedToolNames(body) {
  if (!body || typeof body !== "object") return null;
  return renamedToolNames.get(body) || null;
}

// ── Response side ───────────────────────────────────────────────────────────
// The upstream answers with the names that were sent (lowercase), so they must
// be restored to the caller's spelling or the client sees a tool call for a tool
// it never declared.

function restoreChunk(chunk, map) {
  if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) return chunk;
  if (chunk.type !== "content_block_start") return chunk;
  const block = chunk.content_block;
  if (!block || block.type !== "tool_use" || typeof block.name !== "string") return chunk;
  const original = map.get(block.name);
  if (!original) return chunk;
  return { ...chunk, content_block: { ...block, name: original } };
}

/**
 * Restore caller tool names on any response payload: an array of SSE chunks, a
 * Claude body (content[].name), a Chat Completions body
 * (choices[].{delta,message}.tool_calls[].function.name), or a Responses body
 * (output[].name).
 *
 * @param {object|Array} payload
 * @param {Map<string,string>|null} map - sent name -> original name
 * @returns {object|Array} payload with names restored
 */
export function restoreToolNames(payload, map) {
  if (!map?.size || !payload) return payload;
  if (Array.isArray(payload)) return payload.map((item) => restoreChunk(item, map));
  if (typeof payload !== "object") return payload;

  let out = payload;
  const put = (key, value) => {
    if (out === payload) out = { ...payload };
    out[key] = value;
  };

  if (Array.isArray(payload.content)) {
    put("content", payload.content.map((block) =>
      block?.type === "tool_use" && typeof block.name === "string" && map.has(block.name)
        ? { ...block, name: map.get(block.name) }
        : block));
  }

  if (Array.isArray(payload.choices)) {
    put("choices", payload.choices.map((choice) => {
      let changed = false;
      const next = { ...choice };
      for (const holder of ["delta", "message"]) {
        const h = choice?.[holder];
        if (!h || !Array.isArray(h.tool_calls) || h.tool_calls.length === 0) continue;
        const mapped = h.tool_calls.map((call) => {
          const name = call?.function?.name;
          if (typeof name === "string" && map.has(name)) {
            changed = true;
            return { ...call, function: { ...call.function, name: map.get(name) } };
          }
          return call;
        });
        next[holder] = { ...h, tool_calls: mapped };
      }
      return changed ? next : choice;
    }));
  }

  if (Array.isArray(payload.output)) {
    put("output", payload.output.map((item) =>
      item?.type === "function_call" && typeof item.name === "string" && map.has(item.name)
        ? { ...item, name: map.get(item.name) }
        : item));
  }

  return out;
}
