/**
 * Phase 3.4 — minimal Cascade native tool bridge.
 *
 * Translates between OpenAI-shaped client tools (Read/Bash/Glob/Grep/...) and
 * Cascade's built-in IDE step kinds (view_file/run_command/find/grep_search_v2/...).
 *
 * This is a trimmed port of the upstream Windsurf bridge — we only keep the
 * pieces required to:
 *   1. Decide whether the caller's tools[] inventory can be 100% mapped to
 *      Cascade-native tools (canMapAllTools).
 *   2. Build the `tool_allowlist` (CustomToolSpec list, field 32 of
 *      SendUserCascadeMessageRequest) when we go down the native path.
 *   3. Reverse-look-up Cascade kinds back to caller tool names so we can
 *      surface trajectory steps as the OpenAI tool name the caller declared.
 *
 * Phases 3.5+ may grow this file with additional_steps encoding, propose_code
 * fan-out, etc. Right now we only need the partitioning gate and the kind
 * table. Native mode is opt-in via env DEVIN_NATIVE_TOOLS=1.
 */

// ─── argument translators (used by future trajectory-step round-trip) ───
//
// Kept minimal — Phase 3.4 only ships the partitioning gate, but the reverse
// translators are also re-exported via TOOL_MAP[name].reverse so callers
// inspecting cascade trajectory steps can map them back to OpenAI args.

function safeJsonParse(s) {
  if (typeof s !== 'string' || !s) return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
}

function buildFileUri(absolutePath) {
  if (typeof absolutePath !== 'string' || !absolutePath) return '';
  if (/^file:\/\//.test(absolutePath)) return absolutePath;
  if (/^[a-zA-Z]:[\\/]/.test(absolutePath) || absolutePath.startsWith('/')) {
    return `file://${absolutePath.replace(/\\/g, '/')}`;
  }
  return absolutePath;
}

function stripFileUri(uri) {
  if (typeof uri !== 'string') return '';
  return uri.replace(/^file:\/\//, '');
}

// ── Read / view_file ────────────────────────────────────────────
function forwardReadArgs(args) {
  const file_path = args.file_path || args.path || args.absolute_path || '';
  return {
    absolute_path_uri: buildFileUri(file_path),
    offset: Number(args.offset) || 0,
    limit: Number(args.limit) || 0,
  };
}
function reverseReadArgs(cascade) {
  return {
    file_path: stripFileUri(cascade.absolute_path_uri || ''),
    ...(cascade.offset ? { offset: cascade.offset } : {}),
    ...(cascade.limit ? { limit: cascade.limit } : {}),
  };
}

// ── Bash / run_command ──────────────────────────────────────────
function forwardBashArgs(args) {
  return {
    command_line: String(args.command || args.shell_command || ''),
    cwd: typeof args.cwd === 'string' ? args.cwd : '',
    blocking: true,
  };
}
function reverseBashArgs(cascade) {
  return {
    command: cascade.command_line || cascade.proposed_command_line || '',
    ...(cascade.cwd ? { cwd: cascade.cwd } : {}),
  };
}

// ── Glob / find ─────────────────────────────────────────────────
function forwardGlobArgs(args) {
  return {
    pattern: args.pattern || '',
    search_directory: args.path || args.cwd || '',
  };
}
function reverseGlobArgs(cascade) {
  return {
    pattern: cascade.pattern || '',
    ...(cascade.search_directory ? { path: cascade.search_directory } : {}),
  };
}

// ── Grep / grep_search_v2 ───────────────────────────────────────
function forwardGrepArgs(args) {
  return {
    pattern: args.pattern || '',
    path: args.path || '',
    glob: args.glob || '',
    output_mode: args.output_mode || 'files_with_matches',
    case_insensitive: !!args['-i'],
    multiline: !!args.multiline,
    type: args.type || '',
    head_limit: Number(args.head_limit) || 0,
    lines_after: Number(args['-A']) || 0,
    lines_before: Number(args['-B']) || 0,
    lines_both: Number(args['-C'] ?? args.context) || 0,
  };
}
function reverseGrepArgs(cascade) {
  const out = { pattern: cascade.pattern || '' };
  if (cascade.path) out.path = cascade.path;
  if (cascade.glob) out.glob = cascade.glob;
  if (cascade.output_mode) out.output_mode = cascade.output_mode;
  if (cascade.case_insensitive) out['-i'] = true;
  if (cascade.multiline) out.multiline = true;
  if (cascade.type) out.type = cascade.type;
  if (cascade.head_limit) out.head_limit = cascade.head_limit;
  if (cascade.lines_after) out['-A'] = cascade.lines_after;
  if (cascade.lines_before) out['-B'] = cascade.lines_before;
  if (cascade.lines_both) out['-C'] = cascade.lines_both;
  return out;
}

// ── list_dir / list_directory ──────────────────────────────────
function forwardListDirArgs(args) {
  return {
    directory_path_uri: buildFileUri(args.path || args.directory_path || args.cwd || ''),
  };
}
function reverseListDirArgs(cascade) {
  return { path: stripFileUri(cascade.directory_path_uri || '') };
}

// ── identity (caller already speaks cascade vocabulary) ───────
function identityArgs(x) { return { ...x }; }

// run_command pass-through: cascade and Codex both name the param
// "command" / "command_line" — accept either, normalise on the cascade side.
function forwardRunCommandPassThrough(args) {
  return {
    command_line: args.command_line || args.command || '',
    cwd: args.cwd || '',
    blocking: true,
  };
}
function reverseRunCommandPassThrough(cascade) {
  return {
    command_line: cascade.command_line || cascade.proposed_command_line || '',
    ...(cascade.cwd ? { cwd: cascade.cwd } : {}),
  };
}

// ── Codex CLI shell_command ─────────────────────────────────────
function forwardCodexShellArgs(args) {
  return {
    command_line: args.command || args.command_line || '',
    cwd: args.workdir || args.cwd || '',
    blocking: true,
  };
}
function reverseCodexShellArgs(cascade) {
  return {
    command: cascade.command_line || cascade.proposed_command_line || '',
    ...(cascade.cwd ? { workdir: cascade.cwd } : {}),
  };
}

// ─── OpenAI tool name → cascade kind table ──────────────────────────
//
// Keys are the EXACT tool name the caller declares in tools[].function.name.
// Casing matters — Claude Code uses TitleCase; Codex CLI uses snake_case.

export const TOOL_MAP = {
  // Claude Code
  Read:       { kind: 'view_file',      forward: forwardReadArgs, reverse: reverseReadArgs },
  Bash:       { kind: 'run_command',    forward: forwardBashArgs, reverse: reverseBashArgs },
  Glob:       { kind: 'find',           forward: forwardGlobArgs, reverse: reverseGlobArgs },
  Grep:       { kind: 'grep_search_v2', forward: forwardGrepArgs, reverse: reverseGrepArgs },

  // Codex CLI / cascade-native vocabulary
  view_file:       { kind: 'view_file',      forward: identityArgs, reverse: identityArgs },
  run_command:     { kind: 'run_command',    forward: forwardRunCommandPassThrough, reverse: reverseRunCommandPassThrough },
  grep_search:     { kind: 'grep_search_v2', forward: identityArgs, reverse: identityArgs },
  grep_search_v2:  { kind: 'grep_search_v2', forward: identityArgs, reverse: identityArgs },
  find:            { kind: 'find',           forward: identityArgs, reverse: identityArgs },
  list_dir:        { kind: 'list_directory', forward: forwardListDirArgs, reverse: reverseListDirArgs },
  list_directory:  { kind: 'list_directory', forward: forwardListDirArgs, reverse: reverseListDirArgs },

  // Common synonyms
  read_file:       { kind: 'view_file',      forward: forwardReadArgs, reverse: reverseReadArgs },
  shell:           { kind: 'run_command',    forward: forwardBashArgs, reverse: reverseBashArgs },
  shell_command:   { kind: 'run_command',    forward: forwardCodexShellArgs, reverse: reverseCodexShellArgs },
};

// ─── Caller-tools introspection ─────────────────────────────────────

/**
 * canMapAllTools(tools) — returns true when EVERY caller-declared tool is
 * present in TOOL_MAP. Phase 3.4 uses the all-or-nothing gate: if any tool
 * lacks a mapping, fall back to the existing prompt emulation path.
 */
export function canMapAllTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return false;
  for (const t of tools) {
    if (t?.type !== 'function') return false;
    const name = t.function?.name;
    if (!name || !TOOL_MAP[name]) return false;
  }
  return true;
}

/**
 * partitionTools(tools) — split caller tools[] into mapped vs unmapped sets.
 * Returned for callers that want partial-native mode in the future.
 */
export function partitionTools(tools) {
  const mapped = [];
  const unmapped = [];
  if (Array.isArray(tools)) {
    for (const t of tools) {
      if (t?.type !== 'function' || !t.function?.name) continue;
      if (TOOL_MAP[t.function.name]) mapped.push(t);
      else unmapped.push(t);
    }
  }
  return { mapped, unmapped, hasAny: mapped.length > 0 };
}

/**
 * buildReverseLookup(callerTools) — Map<cascade_kind, caller_tool_names[]>.
 * Used to convert Cascade-native trajectory steps back to OpenAI tool calls
 * with the name the caller actually declared.
 */
export function buildReverseLookup(callerTools) {
  const out = new Map();
  if (!Array.isArray(callerTools)) return out;
  for (const t of callerTools) {
    if (t?.type !== 'function' || !t.function?.name) continue;
    const name = t.function.name;
    const entry = TOOL_MAP[name];
    if (!entry) continue;
    if (!out.has(entry.kind)) out.set(entry.kind, []);
    out.get(entry.kind).push(name);
  }
  return out;
}

/**
 * buildNativeAllowlist(tools) — extract the unique cascade kinds for the
 * caller's mapped tools. Pass to buildSendCascadeMessageRequest as
 * options.nativeAllowlist; windsurf.js's buildNativeCascadeToolConfig writes
 * this into CascadeToolConfig.tool_allowlist (field 32, repeated string).
 */
export function buildNativeAllowlist(tools) {
  const seen = new Set();
  if (!Array.isArray(tools)) return [];
  for (const t of tools) {
    if (t?.type !== 'function' || !t.function?.name) continue;
    const entry = TOOL_MAP[t.function.name];
    if (entry) seen.add(entry.kind);
  }
  return Array.from(seen);
}
