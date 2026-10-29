/**
 * Helpers for the OpenCode free-tier client fingerprint.
 *
 * Two body-side gates are mirrored here (live probes 2026-10-26, /inference/v1):
 *
 * - Tools: free-tier requests must declare OpenCode's own `read` and `shell`
 *   tools with their exact descriptions and parameter schemas; stubbed
 *   descriptions, renamed schemas or tool_choice "none" are answered with 403
 *   FreeTierError. Caller tools are sent untouched. A tool that already uses an
 *   exact fingerprint name with a different definition adopts OpenCode's
 *   definition in place whenever its arguments can carry them; only a genuinely
 *   different schema travels under an alias, and the response side restores
 *   that caller's original name.
 * - System prompt: the CLI's `<env>` marker must be present. A request missing
 *   either half (marker or tools) answers 429 FreeUsageLimitError regardless of
 *   headers, UA or session shape; both halves together pass.
 *
 * Transport is a third gate and lives in services/opencodeTlsClient.js.
 */
import os from "node:os";
import path from "node:path";

/** Names required by the upstream free-tier gate. */
export const OPENCODE_FINGERPRINT_TOOLS = ["read", "shell"];

// Verbatim from the OpenCode v2.0.26 CLI. Upstream compares description and
// parameters, so do not reword or reformat these.
const FINGERPRINT_TOOL_DEFINITIONS = {
  read: {
    description: "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory to read" },
        offset: { type: "integer", minimum: 0, description: "The line or directory entry to start reading from (1-based)" },
        limit: { type: "integer", minimum: 0, description: "The maximum number of lines or directory entries to read (defaults to and capped at 2000)" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  shell: {
    description: "Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command string to execute" },
        workdir: { type: "string", description: "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead." },
        timeout: { type: "integer", minimum: 0, description: "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default." },
        background: { type: "boolean", description: "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
};

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

/** The fingerprint name when `name` is exactly one; "" otherwise. */
export function fingerprintToolKey(name) {
  const trimmed = String(name ?? "").trim();
  return OPENCODE_FINGERPRINT_TOOLS.includes(trimmed) ? trimmed : "";
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

function chatFunctionOf(tool) {
  const fn = tool?.function;
  return fn && typeof fn === "object" && !Array.isArray(fn) ? fn : null;
}

/** True when `tool` already carries OpenCode's exact definition for `key`. */
function isFingerprintDefinition(tool, key) {
  const def = tool && (chatFunctionOf(tool) || tool);
  const want = FINGERPRINT_TOOL_DEFINITIONS[key];
  return !!def && def.description === want.description
    && JSON.stringify(def.parameters) === JSON.stringify(want.parameters);
}

function withToolName(tool, name) {
  const fn = chatFunctionOf(tool);
  return fn ? { ...tool, function: { ...fn, name } } : { ...tool, name };
}

/**
 * True when `tool` already speaks OpenCode's parameter names for `key`, so the
 * fingerprint definition can replace its own without hiding or adding an
 * argument the caller's handler expects.
 *
 * This is the common case, not an edge: OpenCode composes `shell`'s description
 * from `process.platform`, so the very same tool run on Windows reports
 * "Commands run on Windows using pwsh." while the captured definition says
 * "Commands run on Linux using bash." — a two-word difference that an exact
 * string compare rejects.
 */
function canNormalizeInPlace(tool, key) {
  const def = tool && (chatFunctionOf(tool) || tool);
  const props = def?.parameters?.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return false;

  const wanted = Object.keys(FINGERPRINT_TOOL_DEFINITIONS[key].parameters.properties || {});
  const declared = Object.keys(props);
  if (declared.some((name) => !wanted.includes(name))) return false;
  return FINGERPRINT_TOOL_DEFINITIONS[key].parameters.required.every((name) => declared.includes(name));
}

/**
 * Replace `tool`'s definition with OpenCode's while keeping its name, so the
 * wire carries a single, gate-satisfying tool instead of a caller tool plus a
 * placeholder of the same purpose.
 */
function withFingerprintDefinition(tool, key) {
  const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[key];
  const fn = chatFunctionOf(tool);
  return fn
    ? { ...tool, function: { ...fn, description, parameters } }
    : { ...tool, description, parameters };
}

/**
 * Keep caller tools on the fingerprint names whenever their arguments can carry
 * OpenCode's, and move the remaining ones off them so the exact definitions can
 * be appended without a duplicate name. Everything else, including case
 * variants such as `Read`, is preserved verbatim; upstream accepts them
 * alongside `read`.
 *
 * @param {Array} tools
 * @returns {{ tools: Array, map: Map<string,string> }} map: sent name -> original name
 */
export function concealFingerprintToolNames(tools) {
  const map = new Map();
  if (!Array.isArray(tools) || tools.length === 0) return { tools, map };

  const taken = new Set(tools.map(toolNameOf));
  const seen = new Set();
  const out = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      out.push(tool);
      continue;
    }

    const key = fingerprintToolKey(toolNameOf(tool));
    if (!key) {
      out.push(tool);
      continue;
    }

    // Duplicate declarations of one name are rejected upstream; keep the first.
    if (seen.has(key)) continue;
    seen.add(key);

    if (isFingerprintDefinition(tool, key)) {
      out.push(tool);
      continue;
    }

    // Same tool, different wording. Adopt OpenCode's definition in place: the
    // caller keeps its own name, so there is no alias to restore, no alias name
    // for the model to collide with, and no placeholder to explain away.
    if (canNormalizeInPlace(tool, key)) {
      out.push(withFingerprintDefinition(tool, key));
      continue;
    }

    let alias = `${key}_client`;
    for (let i = 2; taken.has(alias); i++) alias = `${key}_client${i}`;
    taken.add(alias);
    map.set(alias, key);
    out.push(withToolName(tool, alias));
  }
  return { tools: out, map };
}

/**
 * Append OpenCode's definition for each fingerprint tool not already declared.
 *
 * @returns {string[]} names that were appended
 */
export function appendMissingFingerprintTools(tools, flat, injectedNames = null) {
  const appended = [];
  if (!Array.isArray(tools)) return appended;
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (tools.some((tool) => fingerprintToolKey(toolNameOf(tool)) === name)) continue;
    const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[name];
    tools.push(flat
      ? { type: "function", name, description, parameters, strict: false }
      : { type: "function", function: { name, description, parameters } });
    appended.push(name);
    injectedNames?.add(name);
  }
  return appended;
}

/** Invert a sent -> original rename map. */
function aliasesByOriginal(map) {
  return new Map([...map].map(([alias, original]) => [original, alias]));
}

/** Point an explicit tool_choice at the alias of a concealed caller tool. */
export function retargetToolChoice(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  const choice = body.tool_choice;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return;
  const aliases = aliasesByOriginal(map);

  if (typeof choice.name === "string") {
    const alias = aliases.get(choice.name.trim());
    if (alias) body.tool_choice = { ...choice, name: alias };
    return;
  }

  const fn = choice.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string") {
    const alias = aliases.get(fn.name.trim());
    if (alias) body.tool_choice = { ...choice, function: { ...fn, name: alias } };
  }
}

/**
 * Rename prior-turn calls to concealed caller tools as well; otherwise the model
 * reads its own earlier calls as calls to OpenCode's tool of the same name.
 */
export function aliasHistoryToolCalls(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  const aliases = aliasesByOriginal(map);

  if (Array.isArray(body.input)) {
    body.input = body.input.map((item) =>
      item?.type === "function_call" && aliases.has(item.name)
        ? { ...item, name: aliases.get(item.name) }
        : item);
  }

  if (Array.isArray(body.messages)) {
    body.messages = body.messages.map((msg) => {
      if (!Array.isArray(msg?.tool_calls)) return msg;
      return {
        ...msg,
        tool_calls: msg.tool_calls.map((call) =>
          aliases.has(call?.function?.name)
            ? { ...call, function: { ...call.function, name: aliases.get(call.function.name) } }
            : call),
      };
    });
  }
}

// Without the old "must not be used" descriptions the model does call the
// appended tools (live probe: `read` on "what files are in /etc?"), so tell it
// in the system prompt instead. Upstream does not gate on the prompt text.
// Wording matters: "not available" made the model also refuse the caller's own
// Read/Bash; "placeholders ... use the other tools" kept those working.
function noteUnavailableTools(body, flat, names, claude = false) {
  const list = names.map((name) => `\`${name}\``).join(" or ");
  const note = names.length > 1
    ? `Do not call the ${list} tools; they are placeholders that do nothing. Use the other tools you have been given instead.`
    : `Do not call the ${list} tool; it is a placeholder that does nothing. Use the other tools you have been given instead.`;
  if (flat) {
    body.instructions = typeof body.instructions === "string" && body.instructions.trim()
      ? `${body.instructions}\n\n${note}`
      : note;
    return;
  }
  // Claude-shaped bodies carry `system` instead; /messages rejects role:"system".
  if (claude || body.system !== undefined) {
    body.system = appendSystemText(body.system, note);
    return;
  }
  if (!Array.isArray(body.messages)) return;
  const first = body.messages[0];
  if (first?.role === "system" && typeof first.content === "string") {
    body.messages = [{ ...first, content: `${first.content}\n\n${note}` }, ...body.messages.slice(1)];
  } else {
    body.messages = [{ role: "system", content: note }, ...body.messages];
  }
}

// The marker gate reads text only: a foreign system prompt plus this exact block
// passes, so the marker is appended to the caller's own prompt rather than
// replacing it. Values mirror a real CLI instance on this host.
const ENV_TAG = "<env>";
const ENV_HEADING = "Here is some useful information about the environment you are running in:";
const ENV_TMP_DIR = path.join(os.tmpdir(), "opencode");
const ENV_WORKING_DIR = process.cwd();
const ENV_FINGERPRINT_PROMPT = [
  ENV_HEADING,
  ENV_TAG,
  `  Working directory: ${ENV_WORKING_DIR}`,
  `  Workspace root folder: ${ENV_WORKING_DIR}`,
  "  Is directory a git repo: no",
  `  Platform: ${process.platform}`,
  `  Prefer ${ENV_TMP_DIR} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
  "</env>",
].join("\n");

/** True when the marker is already present; a genuine opencode client is passthrough. */
function systemCarriesEnv(system) {
  if (typeof system === "string") return system.includes(ENV_TAG);
  if (Array.isArray(system)) {
    return system.some((block) => typeof block?.text === "string" && block.text.includes(ENV_TAG));
  }
  return false;
}

/** Append `text` to a system prompt held as a string, text blocks, or unset. */
function appendSystemText(system, text) {
  if (typeof system === "string") {
    return system.trim() ? `${system}\n\n${text}` : text;
  }
  const blocks = Array.isArray(system) ? [...system] : [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (typeof block?.text === "string") {
      const existing = block.text.trim();
      blocks[i] = { ...block, text: existing ? `${block.text}\n\n${text}` : text };
      return blocks;
    }
  }
  return [...blocks, { type: "text", text }];
}

/**
 * Append the CLI's environment marker without replacing the caller's content,
 * covering all three request shapes: Responses (`instructions`), chat
 * (`messages[]` system) and claude-top-level (`system`). Fail-open — the marker
 * is an enhancement, so a surprising body is left untouched.
 *
 * @param {object} body
 * @param {boolean} flat - true for Responses instructions, false for chat/claude
 * @param {object} [options]
 * @param {boolean} [options.claude] - body posts to /messages (claude shape)
 * @returns {boolean} true when the marker was added
 */
export function applyEnvFingerprint(body, flat, { claude = false } = {}) {
  try {
    if (!body || typeof body !== "object") return false;

    if (flat) {
      if (body.instructions !== undefined && typeof body.instructions !== "string") return false;
      if (systemCarriesEnv(body.instructions)) return false;
      body.instructions = (typeof body.instructions === "string" && body.instructions.trim())
        ? `${body.instructions}\n\n${ENV_FINGERPRINT_PROMPT}`
        : ENV_FINGERPRINT_PROMPT;
      return true;
    }

    if (claude || body.system !== undefined) {
      if (systemCarriesEnv(body.system)) return false;
      body.system = appendSystemText(body.system, ENV_FINGERPRINT_PROMPT);
      return true;
    }

    if (!Array.isArray(body.messages)) return false;
    const idx = body.messages.findIndex((msg) => msg?.role === "system");
    if (idx >= 0) {
      const target = body.messages[idx];
      if (systemCarriesEnv(target.content)) return false;
      const content = appendSystemText(target.content, ENV_FINGERPRINT_PROMPT);
      body.messages = body.messages.map((msg, i) => (i === idx ? { ...msg, content } : msg));
      return true;
    }
    body.messages = [{ role: "system", content: ENV_FINGERPRINT_PROMPT }, ...body.messages];
    return true;
  } catch {
    return false;
  }
}

/**
 * Full request-side pass: normalize caller tools that collide with a
 * fingerprint name, append OpenCode's definitions for any that are missing, and
 * tell the model the appended ones are off-limits.
 *
 * @param {object} body
 * @param {boolean} flat - true for Responses tools ({name}), false for chat tools
 * @returns {Map<string,string>} map: sent name -> original name
 */
export function applyFingerprintTools(body, flat, { claude = false } = {}) {
  if (!body || typeof body !== "object") return new Map();
  const existing = takeFingerprintMetadata(body);
  if (existing) return existing.renameMap;

  const { tools, map } = concealFingerprintToolNames(body.tools);
  const injectedNames = new Set();
  body.tools = Array.isArray(tools) ? tools : [];
  const appended = appendMissingFingerprintTools(body.tools, flat, injectedNames);
  retargetToolChoice(body, map);
  aliasHistoryToolCalls(body, map);
  if (appended.length) noteUnavailableTools(body, flat, appended, claude);

  // The `<env>` marker is required on every free-lane request, with or without tools.
  applyEnvFingerprint(body, flat, { claude });

  // Responses keeps its explicit auto default. Never default to "none": upstream
  // answers tool_choice "none" with 403 FreeTierError.
  if (!body.tool_choice && flat) body.tool_choice = "auto";

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
  const map = takeFingerprintMetadata(body)?.renameMap;
  return map?.size ? map : null;
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
