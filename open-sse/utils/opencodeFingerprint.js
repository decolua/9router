/**
 * Helpers for the OpenCode free-tier client fingerprint.
 *
 * Two upstream gates are mirrored here (both measured end-to-end with the
 * official client as control, issue #5128):
 *
 * - Tools: free-tier requests must declare OpenCode's own `read` and `shell`
 *   tools with their exact descriptions and parameter schemas; stubbed
 *   descriptions, renamed schemas or tool_choice "none" are answered with 403
 *   FreeTierError. Caller tools are sent untouched, except one that already
 *   uses an exact fingerprint name with a different definition: it travels
 *   under an alias and the response side restores the caller's original name.
 * - System prompt: the CLI's `<env>` environment marker must be present in the
 *   system content; a foreign prompt without it is answered 429
 *   FreeUsageLimitError regardless of headers, UA or sessions
 *   (applyEnvFingerprint below).
 */
import os from "node:os";
import path from "node:path";

/** Names required by the upstream free-tier gate. */
export const OPENCODE_FINGERPRINT_TOOLS = ["read", "shell"];

// Verbatim sentence chains from the OpenCode v2 CLI tool builders
// (tool/plugin/read.ts, tool/plugin/shell.ts). Upstream compares description and
// parameters, so do not reword or reformat these.
const READ_DESCRIPTION = "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.";

const FINGERPRINT_TOOL_PARAMETERS = {
  read: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or directory to read" },
      offset: { type: "integer", minimum: 0, description: "The line or directory entry to start reading from (1-based)" },
      limit: { type: "integer", minimum: 0, description: "The maximum number of lines or directory entries to read (defaults to and capped at 2000)" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  shell: {
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
};

// OpenCode derives the shell description's OS wording from the tool host
// (tool/plugin/shell.ts: "Commands run on ${OS} using ${shell}.", with dev builds
// sending Windows=powershell, macOS=zsh, Linux=bash). Every real wording is
// accepted: #4971/#5157 — a Windows-worded caller `shell` used to be renamed
// and leak a placeholder note because only the Linux form matched.
const SHELL_DESCRIPTION_HEAD = "Execute a shell command and return its output.";
const SHELL_DESCRIPTION_TAIL = "Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.";
const SHELL_PLATFORM_WORDINGS = {
  linux: "Linux using bash",
  darwin: "macOS using zsh",
  win32: "Windows using powershell",
};

function shellDescription(platform) {
  const wording = SHELL_PLATFORM_WORDINGS[platform] ?? SHELL_PLATFORM_WORDINGS.linux;
  return `${SHELL_DESCRIPTION_HEAD} Commands run on ${wording}. ${SHELL_DESCRIPTION_TAIL}`;
}

const ACCEPTED_FINGERPRINT_DESCRIPTIONS = {
  read: new Set([READ_DESCRIPTION]),
  shell: new Set(Object.keys(SHELL_PLATFORM_WORDINGS).map((platform) => shellDescription(platform))),
};

// Runtime values shared by the shell wording and the `<env>` marker below so a
// request tells one consistent platform story, like a real CLI instance.
const HOST_PLATFORM = process.platform || "linux";

const FINGERPRINT_TOOL_DEFINITIONS = {
  read: { description: READ_DESCRIPTION, parameters: FINGERPRINT_TOOL_PARAMETERS.read },
  shell: { description: shellDescription(HOST_PLATFORM), parameters: FINGERPRINT_TOOL_PARAMETERS.shell },
};

// Request body -> names renamed for that request. transformRequest() mutates the
// same body object that chatCore passed into the executor, so a WeakMap keeps the
// mapping request-local without putting transport metadata on the wire.
const renamedToolNames = new WeakMap();

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

/** True when `tool` already carries an accepted OpenCode definition for `key`. */
function isFingerprintDefinition(tool, key) {
  const def = tool && (chatFunctionOf(tool) || tool);
  const want = FINGERPRINT_TOOL_DEFINITIONS[key];
  return !!def && ACCEPTED_FINGERPRINT_DESCRIPTIONS[key].has(def.description)
    && JSON.stringify(def.parameters) === JSON.stringify(want.parameters);
}

function withToolName(tool, name) {
  const fn = chatFunctionOf(tool);
  return fn ? { ...tool, function: { ...fn, name } } : { ...tool, name };
}

/**
 * Move caller tools off the fingerprint names when their definition differs
 * from OpenCode's, so the exact definitions can be appended without a
 * duplicate name. Everything else, including case variants such as `Read`, is
 * preserved verbatim; upstream accepts them alongside `read`.
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
export function appendMissingFingerprintTools(tools, flat) {
  const appended = [];
  if (!Array.isArray(tools)) return appended;
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (tools.some((tool) => fingerprintToolKey(toolNameOf(tool)) === name)) continue;
    const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[name];
    tools.push(flat
      ? { type: "function", name, description, parameters, strict: false }
      : { type: "function", function: { name, description, parameters } });
    appended.push(name);
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
function noteUnavailableTools(body, flat, names, claude) {
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
  // Claude bodies only carry system at top level; a role:"system" message in
  // their messages array is rejected by /messages.
  if (claude) {
    body.system = appendSystemText(body.system, note);
    return;
  }
  if (body.system !== undefined) return; // claude-shaped without the hint: skip, as before
  // OpenAI chat shape only.
  if (!Array.isArray(body.messages)) return;
  const first = body.messages.find((msg) => msg?.role === "system");
  if (first?.role === "system" && typeof first.content === "string") {
    body.messages = body.messages.map((msg) =>
      msg === first ? { ...msg, content: `${msg.content}\n\n${note}` } : msg);
  } else {
    body.messages = [{ role: "system", content: note }, ...body.messages];
  }
}

// The env marker gate reads text only: a foreign system prompt plus this exact
// block passes, so the marker is appended to the caller's own prompt instead of
// replacing it. Values mirror a real CLI instance on this host; the gate cares
// about the `Working directory:`/`Workspace root folder:` lines and the tags.
const ENV_TAG = "<env>";
const ENV_HEADING = "Here is some useful information about the environment you are running in:";
const ENV_TMP_DIR = path.join(os.tmpdir(), "opencode");
const ENV_WORKING_DIR = process.cwd();
const ENV_FINGERPRINT_PROMPT = [
  ENV_HEADING,
  "<env>",
  `  Working directory: ${ENV_WORKING_DIR}`,
  `  Workspace root folder: ${ENV_WORKING_DIR}`,
  "  Is directory a git repo: no",
  `  Platform: ${HOST_PLATFORM}`,
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

/** Append `text` to a top-level `system` (string, text blocks or unset). */
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

/** Append the marker to a top-level `system` (string, text blocks or unset). */
function appendToSystemField(system) {
  return appendSystemText(system, ENV_FINGERPRINT_PROMPT);
}

/**
 * Append the CLI's environment marker to the effective system prompt without
 * replacing the caller's own content, covering all three request shapes:
 * Responses (`instructions`), chat (`messages[0]` system) and claude-top-level
 * (`system`). Claude bodies without `system` get the optional top-level field
 * created instead of a `role:"system"` message, which /messages rejects.
 * Fail-open: the marker is an enhancement; leave the body untouched on any
 * surprise.
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

    // Claude-shaped bodies carry `system` at top level; same conventions as
    // noteUnavailableTools above.
    if (claude || body.system !== undefined) {
      if (systemCarriesEnv(body.system)) return false;
      body.system = appendToSystemField(body.system);
      return true;
    }

    if (Array.isArray(body.messages)) {
      const idx = body.messages.findIndex((msg) => msg?.role === "system");
      if (idx >= 0) {
        const target = body.messages[idx];
        if (Array.isArray(target.content)) {
          if (systemCarriesEnv(target.content)) return false;
          body.messages = body.messages.map((msg, i) =>
            i === idx ? { ...msg, content: appendToSystemField(target.content) } : msg);
          return true;
        }
        if (systemCarriesEnv(target.content)) return false;
        const content = appendToSystemField(typeof target.content === "string" ? target.content : "");
        body.messages = body.messages.map((msg, i) => (i === idx ? { ...msg, content } : msg));
        return true;
      }
      body.messages = [{ role: "system", content: ENV_FINGERPRINT_PROMPT }, ...body.messages];
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Full request-side pass: alias conflicting caller tools, append OpenCode's
 * fingerprint definitions, tell the model the appended ones are off-limits, and
 * append the environment marker.
 *
 * @param {object} body
 * @param {boolean} flat - true for Responses tools ({name}), false for chat tools
 * @param {object} [options]
 * @param {boolean} [options.claude] - body posts to /messages (claude shape)
 * @returns {Map<string,string>} map: sent name -> original name
 */
export function applyFingerprintTools(body, flat, { claude = false } = {}) {
  if (!body || typeof body !== "object") return new Map();

  const { tools, map } = concealFingerprintToolNames(body.tools);
  body.tools = Array.isArray(tools) ? tools : [];
  const appended = appendMissingFingerprintTools(body.tools, flat);
  retargetToolChoice(body, map);
  aliasHistoryToolCalls(body, map);
  if (appended.length) noteUnavailableTools(body, flat, appended, claude);

  // The `<env>` marker is required on every free-lane request, with or without tools.
  applyEnvFingerprint(body, flat, { claude });

  // Responses keeps its explicit auto default. Never default to "none": upstream
  // answers tool_choice "none" with 403 FreeTierError.
  if (!body.tool_choice && flat) body.tool_choice = "auto";

  recordRenamedToolNames(body, map);
  return map;
}

/** Store the rename map for `body`. */
export function recordRenamedToolNames(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  renamedToolNames.set(body, map);
}

/** Retrieve the rename map for `body`. */
export function takeRenamedToolNames(body) {
  if (!body || typeof body !== "object") return null;
  return renamedToolNames.get(body) || null;
}

// Response side -------------------------------------------------------------

/** Restore caller tool spellings in supported response/event shapes. */
export function restoreToolNames(payload, map) {
  if (!map?.size || !payload) return payload;
  if (Array.isArray(payload)) return payload.map((item) => restoreToolNames(item, map));
  if (typeof payload !== "object") return payload;

  let out = payload;
  const put = (key, value) => {
    if (out === payload) out = { ...payload };
    out[key] = value;
  };

  // Claude streaming content_block_start event.
  if (payload.type === "content_block_start") {
    const block = payload.content_block;
    if (block?.type === "tool_use" && typeof block.name === "string" && map.has(block.name)) {
      put("content_block", { ...block, name: map.get(block.name) });
    }
  }

  // Claude non-streaming message body.
  if (Array.isArray(payload.content)) {
    put("content", payload.content.map((block) =>
      block?.type === "tool_use" && typeof block.name === "string" && map.has(block.name)
        ? { ...block, name: map.get(block.name) }
        : block));
  }

  // OpenAI Chat Completions, both streaming delta and JSON message shapes.
  if (Array.isArray(payload.choices)) {
    put("choices", payload.choices.map((choice) => {
      let changed = false;
      const next = { ...choice };
      for (const holder of ["delta", "message"]) {
        const value = choice?.[holder];
        if (!value || !Array.isArray(value.tool_calls) || value.tool_calls.length === 0) continue;
        const calls = value.tool_calls.map((call) => {
          const name = call?.function?.name;
          if (typeof name === "string" && map.has(name)) {
            changed = true;
            return { ...call, function: { ...call.function, name: map.get(name) } };
          }
          return call;
        });
        next[holder] = { ...value, tool_calls: calls };
      }
      return changed ? next : choice;
    }));
  }

  // OpenAI Responses final JSON body.
  if (Array.isArray(payload.output)) {
    put("output", payload.output.map((item) =>
      item?.type === "function_call" && typeof item.name === "string" && map.has(item.name)
        ? { ...item, name: map.get(item.name) }
        : item));
  }

  // OpenAI Responses SSE events such as response.output_item.added/done.
  const item = payload.item;
  if (item?.type === "function_call" && typeof item.name === "string" && map.has(item.name)) {
    put("item", { ...item, name: map.get(item.name) });
  }

  return out;
}
