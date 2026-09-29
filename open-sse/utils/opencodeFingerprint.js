/**
 * Helpers for the OpenCode Zen free-tier client fingerprint.
 *
 * Live upstream probes show that free-tier requests must include the lowercase
 * file-search quartet (bash/glob/grep/read). Agent clients such as Claude Code
 * may declare the same tools with different casing, so those case variants must
 * be renamed instead of duplicated. The response side restores the caller's
 * original spelling so downstream clients still recognise their own tool calls.
 */

/** Canonical names required by the upstream free-tier gate. */
export const OPENCODE_FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"];

// Request body -> names renamed for that request. transformRequest() mutates the
// same body object that chatCore passed into the executor, so a WeakMap keeps the
// mapping request-local without putting transport metadata on the wire.
const fingerprintMetadata = new WeakMap();

export const OPENCODE_GUARD_LIMITS = Object.freeze({
  MAX_TRACKED_CALLS: 64,
  MAX_NAME_BYTES: 256,
  MAX_BUFFERED_SUFFIX_BYTES: 1024 * 1024,
});

export class OpenCodeUndeclaredToolError extends Error {
  constructor(message = "Upstream selected an undeclared tool") {
    super(message);
    this.name = "OpenCodeUndeclaredToolError";
    this.code = "upstream_undeclared_tool";
    this.status = 502;
    this.streamOrigin = "processing";
  }
}

/** Canonical lowercase name when `name` is a quartet member; "" otherwise. */
export function fingerprintToolKey(name) {
  const lower = String(name ?? "").trim().toLowerCase();
  return OPENCODE_FINGERPRINT_TOOLS.includes(lower) ? lower : "";
}

/** Read a tool name from either flat ({name}) or chat ({function:{name}}) shape. */
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
 * Canonicalise only the fingerprint quartet and remove duplicate quartet
 * variants. Non-fingerprint tools are preserved verbatim, including tools whose
 * names differ only by case; they are outside OpenCode's fingerprint contract.
 *
 * @param {Array} tools
 * @returns {{ tools: Array, map: Map<string,string> }} map: sent name -> original name
 */
export function concealFingerprintToolNames(tools) {
  const map = new Map();
  if (!Array.isArray(tools) || tools.length === 0) return { tools, map };

  const seenQuartet = new Set();
  const out = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      out.push(tool);
      continue;
    }

    const current = toolNameOf(tool);
    const key = fingerprintToolKey(current);
    if (!key) {
      out.push(tool);
      continue;
    }

    // `Bash` + `bash` is rejected upstream as a duplicate. Keep exactly one
    // declaration for each quartet member.
    if (seenQuartet.has(key)) continue;
    seenQuartet.add(key);

    if (current !== key) {
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

/** Append only genuinely missing quartet declarations. */
export function appendMissingFingerprintTools(tools, flat, injectedNames = null) {
  const list = Array.isArray(tools) ? tools : [];
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (list.some((tool) => fingerprintToolKey(toolNameOf(tool)) === name)) continue;
    injectedNames?.add(name);
    list.push(flat ? {
      type: "function",
      name,
      description: "This tool is currently unavailable and must not be used.",
      parameters: { type: "object", properties: {} },
    } : {
      type: "function",
      function: {
        name,
        description: "This tool is currently unavailable and must not be used.",
        parameters: { type: "object", properties: {} },
      },
    });
  }
  return list;
}

/** Point an explicit tool_choice at a quartet member after canonicalisation. */
export function retargetToolChoice(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  const choice = body.tool_choice;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return;

  if (typeof choice.name === "string") {
    const key = fingerprintToolKey(choice.name);
    if (key && map.has(key)) body.tool_choice = { ...choice, name: key };
    return;
  }

  const fn = choice.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string") {
    const key = fingerprintToolKey(fn.name);
    if (key && map.has(key)) {
      body.tool_choice = { ...choice, function: { ...fn, name: key } };
    }
  }
}

/**
 * Full request-side pass: canonicalise quartet case variants, remove duplicate
 * quartet declarations, append missing members and preserve the legacy
 * tool_choice defaults used by the OpenCode executor.
 *
 * @param {object} body
 * @param {boolean} flat - true for Responses tools ({name}), false for chat tools
 * @returns {Map<string,string>} map: sent name -> original name
 */
export function applyFingerprintTools(body, flat) {
  if (!body || typeof body !== "object") return new Map();
  const existing = takeFingerprintMetadata(body);
  if (existing) return existing.renameMap;

  const hadClientTools = Array.isArray(body.tools) && body.tools.length > 0;
  const { tools, map } = concealFingerprintToolNames(body.tools);
  const injectedNames = new Set();
  body.tools = appendMissingFingerprintTools(tools, flat, injectedNames);
  retargetToolChoice(body, map);

  // Preserve the existing executor semantics. Responses uses auto when the
  // fingerprint helper supplies tools; chat requests with no caller tools use
  // none so the injected decoys cannot be selected.
  if (!body.tool_choice) {
    if (flat) body.tool_choice = "auto";
    else if (!hadClientTools) body.tool_choice = "none";
  }

  recordFingerprintMetadata(body, { renameMap: map, injectedNames });
  return map;
}

/** Store request-local fingerprint metadata without putting it on the wire. */
export function recordFingerprintMetadata(body, metadata) {
  if (!body || typeof body !== "object") return;
  const existing = fingerprintMetadata.get(body);
  if (existing) return;
  fingerprintMetadata.set(body, {
    renameMap: metadata?.renameMap instanceof Map ? metadata.renameMap : new Map(),
    injectedNames: metadata?.injectedNames instanceof Set ? metadata.injectedNames : new Set(),
  });
}

/** Retrieve fingerprint metadata without removing it so retrying the same body is stable. */
export function takeFingerprintMetadata(body) {
  if (!body || typeof body !== "object") return null;
  return fingerprintMetadata.get(body) || null;
}

/** Compatibility accessor for response rename mappings. */
export function takeRenamedToolNames(body) {
  return takeFingerprintMetadata(body)?.renameMap || null;
}

/** Verify a completed tool name belongs to a caller declaration, not an injected decoy. */
export function assertDeclaredFingerprintTool(name, metadata) {
  if (!metadata?.injectedNames?.has(name)) return;
  if (metadata.renameMap?.has(name)) return;
  throw new OpenCodeUndeclaredToolError();
}

// Response side -------------------------------------------------------------

/** Restore caller tool spellings in supported response/event shapes. */
export function restoreToolNames(payload, mapOrMetadata) {
  const metadata = mapOrMetadata?.renameMap instanceof Map
    ? mapOrMetadata
    : (mapOrMetadata?.injectedNames instanceof Set ? { renameMap: mapOrMetadata, injectedNames: mapOrMetadata.injectedNames } : null);
  const map = metadata?.renameMap || mapOrMetadata;
  if (!payload) return payload;
  if (Array.isArray(payload)) return payload.map((item) => restoreToolNames(item, mapOrMetadata));
  if (typeof payload !== "object") return payload;
  const assertName = (name) => {
    if (metadata) assertDeclaredFingerprintTool(name, metadata);
  };

  let out = payload;
  const put = (key, value) => {
    if (out === payload) out = { ...payload };
    out[key] = value;
  };

  // Claude streaming content_block_start event.
  if (payload.type === "content_block_start") {
    const block = payload.content_block;
    if (block?.type === "tool_use" && typeof block.name === "string") {
      assertName(block.name);
      if (map?.has(block.name)) put("content_block", { ...block, name: map.get(block.name) });
    }
  }

  // Claude non-streaming message body.
  if (Array.isArray(payload.content)) {
    let changed = false;
    const content = payload.content.map((block) => {
      if (block?.type === "tool_use" && typeof block.name === "string") {
        assertName(block.name);
        if (map?.has(block.name)) {
          changed = true;
          return { ...block, name: map.get(block.name) };
        }
      }
      return block;
    });
    if (changed) put("content", content);
  }

  // OpenAI Chat Completions, both streaming delta and JSON message shapes.
  if (Array.isArray(payload.choices)) {
    let changed = false;
    const choices = payload.choices.map((choice) => {
      let choiceChanged = false;
      const next = { ...choice };
      for (const holder of ["delta", "message"]) {
        const value = choice?.[holder];
        if (!value || !Array.isArray(value.tool_calls) || value.tool_calls.length === 0) continue;
        const calls = value.tool_calls.map((call) => {
          const name = call?.function?.name;
          if (typeof name === "string") {
            assertName(name);
            if (map?.has(name)) {
              choiceChanged = true;
              return { ...call, function: { ...call.function, name: map.get(name) } };
            }
          }
          return call;
        });
        if (choiceChanged) next[holder] = { ...value, tool_calls: calls };
      }
      if (choiceChanged) changed = true;
      return choiceChanged ? next : choice;
    });
    if (changed) put("choices", choices);
  }

  // OpenAI Responses final JSON body.
  if (Array.isArray(payload.output)) {
    let changed = false;
    const output = payload.output.map((item) => {
      if (item?.type === "function_call" && typeof item.name === "string") {
        assertName(item.name);
        if (map?.has(item.name)) {
          changed = true;
          return { ...item, name: map.get(item.name) };
        }
      }
      return item;
    });
    if (changed) put("output", output);
  }

  // OpenAI Responses SSE events such as response.output_item.added/done.
  const item = payload.item;
  if (item?.type === "function_call" && typeof item.name === "string") {
    assertName(item.name);
    if (map?.has(item.name)) put("item", { ...item, name: map.get(item.name) });
  }

  return out;
}
