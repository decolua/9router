/**
 * OpenCode / OpenAI-compatible tool name mapping for Cursor native tools.
 *
 * Cursor expects native tool names (shell, ls, read, write, grep).
 * OpenCode sends OpenAI-style names (bash, list, glob, read, write, grep).
 */

const OPENAI_TO_CURSOR = {
  bash: "shell",
  shell: "shell",
  run_terminal_cmd: "shell",
  execute_command: "shell",
  list: "ls",
  glob: "grep",
  read: "read",
  write: "write",
  grep: "grep",
  edit: "write",
  search: "grep",
};

const CURSOR_TO_OPENAI = {
  shell: "bash",
  run_terminal_cmd: "bash",
  run_terminal_command: "bash",
  run_terminal_command_v2: "bash",
  execute_command: "bash",
  ls: "list",
  list_dir: "list",
  list_dir_v2: "list",
  read: "read",
  read_file: "read",
  read_file_v2: "read",
  write: "write",
  edit_file: "write",
  edit_file_v2: "write",
  grep: "grep",
  ripgrep_search: "grep",
  ripgrep_raw_search: "grep",
  glob_file_search: "glob",
};

function normalizeName(name) {
  return typeof name === "string" ? name.trim() : "";
}

export function toCursorToolName(name) {
  const raw = normalizeName(name);
  if (!raw) return "tool";
  const mapped = OPENAI_TO_CURSOR[raw.toLowerCase()];
  return mapped || raw;
}

export function fromCursorToolName(name) {
  const raw = normalizeName(name);
  if (!raw) return "tool";
  const mapped = CURSOR_TO_OPENAI[raw.toLowerCase()];
  return mapped || raw;
}

export function toCursorToolArgs(toolName, rawArgs) {
  const args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs || {});
  const cursorName = toCursorToolName(toolName).toLowerCase();

  if (cursorName !== "shell") return args;

  try {
    const parsed = JSON.parse(args);
    if (parsed && typeof parsed === "object" && !parsed.command) {
      if (typeof parsed.cmd === "string") {
        parsed.command = parsed.cmd;
      } else if (typeof parsed.script === "string") {
        parsed.command = parsed.script;
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return args;
  }
}

export function fromCursorToolArgs(toolName, rawArgs) {
  const openAiName = fromCursorToolName(toolName).toLowerCase();
  const args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs || {});

  if (openAiName !== "bash") return args;

  try {
    const parsed = JSON.parse(args);
    if (parsed && typeof parsed === "object" && !parsed.command) {
      if (typeof parsed.cmd === "string") {
        parsed.command = parsed.cmd;
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return args;
  }
}

export function isOpenCodeUserAgent(userAgent) {
  return /opencode/i.test(userAgent || "");
}

export function shouldForceAgentMode(userAgent) {
  const ua = userAgent || "";
  return (
    ua.includes("claude-cli") ||
    ua.includes("claude-code") ||
    ua.includes("Claude Code") ||
    isOpenCodeUserAgent(ua)
  );
}

/**
 * Map OpenAI-style tool definitions to Cursor native ClientSideToolV2 enum ids.
 * Enum values verified against cursor-api proto (RUN_TERMINAL_COMMAND_V2=15,
 * EDIT_FILE_V2=38, LIST_DIR_V2=39, READ_FILE_V2=40, RIPGREP_RAW_SEARCH=41,
 * GLOB_FILE_SEARCH=42).
 *
 * Note: arbitrary non-native tools (custom MCP server tools) are a separate,
 * pre-existing limitation of the Cursor route and are not enabled here.
 */
export function getSupportedToolEnumsFromOpenAiTools(tools = []) {
  const defaultSet = [
    15, // RUN_TERMINAL_COMMAND_V2
    40, // READ_FILE_V2
    38, // EDIT_FILE_V2
    39, // LIST_DIR_V2
    41, // RIPGREP_RAW_SEARCH
    42, // GLOB_FILE_SEARCH
  ];

  if (!Array.isArray(tools) || tools.length === 0) {
    return defaultSet;
  }

  const mapping = {
    bash: 15,
    shell: 15,
    run_terminal_cmd: 15,
    execute_command: 15,
    read: 40,
    write: 38,
    edit: 38,
    list: 39,
    ls: 39,
    grep: 41,
    glob: 42,
  };

  const enums = new Set();
  for (const tool of tools) {
    const name = String(tool?.function?.name || tool?.name || "").toLowerCase();
    const enumVal = mapping[name];
    if (enumVal) enums.add(enumVal);
  }

  return enums.size > 0 ? [...enums] : defaultSet;
}

/**
 * Parse Cursor native tool-call text when protobuf frames are missing.
 * Example: <|tool_calls_begin|>...run_terminal_cmd...{"command":"ls"}
 */
export function parseNativeToolCallsFromText(text) {
  if (typeof text !== "string") return [];

  // Only match Cursor's explicit native tool-call text delimiters.
  // A broad `"name"/"arguments"` JSON regex was deliberately removed because it
  // false-positives on ordinary assistant prose that happens to contain JSON.
  const results = [];
  const patterns = [
    /(?:<\|[^|]*tool_call_begin[^|]*\|>\s*)?(run_terminal_cmd|execute_command|shell)\s*(\{[\s\S]*?\})/gi,
    /(?:<\|tool_call_begin\|>\s*)([a-zA-Z0-9_\-]+)\s*([\s\S]*?)(?:<\|tool_call_end\|>)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const cursorName = match[1];
      let rawArgs = (match[2] || "").trim();
      if (!rawArgs.startsWith("{")) {
        const jsonMatch = rawArgs.match(/\{[\s\S]*\}/);
        rawArgs = jsonMatch ? jsonMatch[0] : "{}";
      }

      const openAiName = fromCursorToolName(cursorName);
      const key = `${openAiName}:${rawArgs}`;
      if (results.some((item) => `${item.function.name}:${item.function.arguments}` === key)) continue;

      results.push({
        id: `cursor-native-${results.length + 1}`,
        type: "function",
        function: {
          name: openAiName,
          arguments: fromCursorToolArgs(cursorName, rawArgs || "{}"),
        },
      });
    }
  }

  return results;
}
