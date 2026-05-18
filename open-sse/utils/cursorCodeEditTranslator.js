/**
 * Cursor Code-Edit Block Translator
 *
 * Cursor's hosted Claude/GPT models are server-trained to emit file modifications as
 *
 *     ```N:M:path/to/file
 *     <new content>
 *     ```
 *
 * markdown blocks (the IDE's "fast-apply" format). When 9Router proxies these
 * responses to Claude Code (or any other client that expects native tool_use), the
 * blocks render as plain text and never get applied — the user sees a diff but no
 * actual file change.
 *
 * This translator parses code-edit blocks out of an accumulated assistant text
 * response and rewrites them as Edit / Write tool_use calls. It cooperates with
 * the conversation history (already-translated Cursor message format) to recover
 * the original `old_string` from the most recent Read tool result on the same
 * file, so the synthesised Edit is exact.
 *
 * Public surface:
 *   parseCodeEditBlocks(text) -> [{ startLine, endLine, filePath, newContent, raw, span }]
 *   resolveEditFromHistory(messages, edit) -> { tool, args }
 *   stripCodeEditBlocks(text, edits) -> string with blocks removed
 */

const CODE_EDIT_RE = /```(\d+):(\d+):([^\n`]+)\n([\s\S]*?)\n```/g;

export function parseCodeEditBlocks(text) {
  if (typeof text !== "string" || !text.includes("```")) return [];
  CODE_EDIT_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = CODE_EDIT_RE.exec(text)) !== null) {
    out.push({
      startLine: parseInt(m[1], 10),
      endLine: parseInt(m[2], 10),
      filePath: m[3].trim(),
      newContent: m[4],
      raw: m[0],
      span: { start: m.index, end: m.index + m[0].length }
    });
  }
  return out;
}

export function stripCodeEditBlocks(text, edits) {
  if (!edits || edits.length === 0) return text;
  // Remove blocks from end-to-start so spans stay valid
  const sorted = [...edits].sort((a, b) => b.span.start - a.span.start);
  let result = text;
  for (const e of sorted) {
    result = result.slice(0, e.span.start) + result.slice(e.span.end);
  }
  // Collapse runs of blank lines left behind
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Parse `cat -n` output into an array indexed by line number (1-based -> array[0]).
// Tolerates rows that don't match the expected pattern (preserves them as-is).
export function parseCatNContent(catText) {
  const lines = [];
  for (const raw of String(catText || "").split("\n")) {
    const m = raw.match(/^\s*(\d+)\t(.*)$/);
    if (m) {
      const idx = parseInt(m[1], 10) - 1;
      lines[idx] = m[2];
    }
  }
  // Fill any holes
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === undefined) lines[i] = "";
  }
  return lines;
}

// Extract the most recent Read tool result for a given file path from the
// (already cursor-format) message history. Returns the cat -n string, or null.
export function findLatestReadResult(messages, filePath) {
  if (!Array.isArray(messages) || !filePath) return null;

  // First, build a map of toolCallId -> file_path from assistant tool_calls
  const callIdToPath = new Map();
  for (const msg of messages) {
    if (msg?.role !== "assistant") continue;
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    for (const tc of calls) {
      const name = tc?.function?.name || tc?.name;
      if (name !== "Read") continue;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* ignore */ }
      const fp = args?.file_path || args?.path || args?.target_file;
      if (fp && tc?.id) callIdToPath.set(tc.id, fp);
    }
  }

  // Walk messages backward; find user-role <tool_result> with matching path.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user" || typeof msg.content !== "string") continue;
    const blocks = [...msg.content.matchAll(/<tool_result>([\s\S]*?)<\/tool_result>/g)];
    for (let b = blocks.length - 1; b >= 0; b--) {
      const inner = blocks[b][1];
      const idMatch = inner.match(/<tool_call_id>([^<]*)<\/tool_call_id>/);
      const nameMatch = inner.match(/<tool_name>([^<]+)<\/tool_name>/);
      const resultMatch = inner.match(/<result>([\s\S]*?)<\/result>/);
      if (!nameMatch || !resultMatch) continue;
      if (decodeXmlEntities(nameMatch[1].trim()) !== "Read") continue;
      const callId = idMatch ? decodeXmlEntities(idMatch[1].trim()) : "";
      const knownPath = callIdToPath.get(callId);
      if (!knownPath) continue;
      // Match on suffix to tolerate absolute vs relative paths the model emits
      if (knownPath === filePath || knownPath.endsWith(filePath) || filePath.endsWith(knownPath)) {
        return decodeXmlEntities(resultMatch[1]);
      }
    }
  }
  return null;
}

// === DeepSeek-style tool calls embedded in thinking text ===
//
// Cursor's `default` model resolves to a DeepSeek-style reasoner that emits
// tool calls inside the protobuf THINKING field instead of as proper
// ClientSideToolV2Call frames. The wire format uses these special tokens:
//
//   <｜tool▁calls▁begin｜>
//   <｜tool▁call▁begin｜>
//   ToolName
//   <｜tool▁sep｜>paramName
//   paramValue
//   <｜tool▁sep｜>otherParam
//   otherValue
//   <｜tool▁call▁end｜>
//   <｜tool▁calls▁end｜>
//
// We parse them here and re-map to Claude Code tool names so the synthesised
// tool_use call lines up with what the client (Claude Code) knows how to run.

const DEEPSEEK_TOKEN_CALLS_BEGIN = "<｜tool▁calls▁begin｜>";
const DEEPSEEK_TOKEN_CALLS_END = "<｜tool▁calls▁end｜>";
const DEEPSEEK_TOKEN_CALL_BEGIN = "<｜tool▁call▁begin｜>";
const DEEPSEEK_TOKEN_CALL_END = "<｜tool▁call▁end｜>";
const DEEPSEEK_TOKEN_SEP = "<｜tool▁sep｜>";

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (typeof obj?.[k] === "string" && obj[k].length > 0) return obj[k];
  }
  return "";
}

function mapDeepSeekToolToClaudeCode(name, params) {
  const n = (name || "").trim();
  // StrReplace ≡ Edit. DeepSeek uses `path`; Claude Code uses `file_path`.
  if (
    n === "StrReplace" ||
    n === "str_replace" ||
    n === "Edit" ||
    n === "edit" ||
    n === "EditFile" ||
    n === "edit_file" ||
    n === "Replace" ||
    n === "replace"
  ) {
    return {
      tool: "Edit",
      args: {
        file_path: pickFirst(params, ["file_path", "path", "target_file"]),
        old_string: pickFirst(params, [
          "old_string", "old_strings", "old", "old_str", "old_text", "old_content",
          "old_contents", "from", "search"
        ]),
        new_string: pickFirst(params, [
          "new_string", "new_strings", "new", "new_str", "new_text", "new_content",
          "new_contents", "to", "replace", "replacement"
        ])
      }
    };
  }
  if (
    n === "View" ||
    n === "view" ||
    n === "Read" ||
    n === "read" ||
    n === "ReadFile" ||
    n === "read_file" ||
    n === "Cat" ||
    n === "cat" ||
    n === "OpenFile" ||
    n === "open_file"
  ) {
    return {
      tool: "Read",
      args: {
        file_path: pickFirst(params, ["file_path", "path", "target_file"])
      }
    };
  }
  if (
    n === "Create" ||
    n === "create" ||
    n === "Write" ||
    n === "write" ||
    n === "WriteFile" ||
    n === "write_file" ||
    n === "CreateFile" ||
    n === "create_file" ||
    n === "NewFile" ||
    n === "new_file"
  ) {
    return {
      tool: "Write",
      args: {
        file_path: pickFirst(params, ["file_path", "path", "target_file"]),
        content: pickFirst(params, [
          "content", "contents", "file_text", "file_content", "file_contents",
          "text", "body", "source", "data"
        ])
      }
    };
  }
  if (
    n === "Bash" ||
    n === "BashTool" ||
    n === "RunCommand" ||
    n === "run_terminal_command" ||
    n === "run_terminal_cmd" ||
    n === "RunTerminalCmd" ||
    n === "Shell" ||
    n === "shell" ||
    n === "Terminal" ||
    n === "terminal"
  ) {
    const args = {
      command: pickFirst(params, ["command", "cmd", "script"])
    };
    const description = pickFirst(params, ["description", "explanation"]);
    if (description) args.description = description;
    return { tool: "Bash", args };
  }
  if (
    n === "Glob" ||
    n === "glob" ||
    n === "FileSearch" ||
    n === "file_search" ||
    n === "FindFile" ||
    n === "find_file" ||
    n === "FindFiles" ||
    n === "find_files"
  ) {
    const args = {
      pattern: pickFirst(params, ["pattern", "glob_pattern", "query"])
    };
    const dirPath = pickFirst(params, ["path", "target_directory", "directory", "cwd"]);
    if (dirPath) args.path = dirPath;
    return { tool: "Glob", args };
  }
  if (
    n === "LS" ||
    n === "ls" ||
    n === "ListDir" ||
    n === "List_dir" ||
    n === "list_dir" ||
    n === "Listdir" ||
    n === "ListDirectory" ||
    n === "list_directory" ||
    n === "Dir" ||
    n === "dir"
  ) {
    return {
      tool: "LS",
      args: { path: pickFirst(params, ["path", "target_directory", "directory"]) }
    };
  }
  if (
    n === "Grep" ||
    n === "grep" ||
    n === "GrepSearch" ||
    n === "grep_search" ||
    n === "RipgrepSearch" ||
    n === "ripgrep_search" ||
    n === "Ripgrep" ||
    n === "ripgrep" ||
    n === "Rg" ||
    n === "rg" ||
    n === "Search" ||
    n === "search" ||
    n === "TextSearch" ||
    n === "text_search"
  ) {
    const args = {
      pattern: pickFirst(params, ["pattern", "query", "regex"])
    };
    const grepPath = pickFirst(params, ["path", "target_directory", "directory"]);
    if (grepPath) args.path = grepPath;
    const glob = pickFirst(params, ["glob", "include", "include_pattern"]);
    if (glob) args.glob = glob;
    const outputMode = pickFirst(params, ["output_mode"]);
    if (outputMode) args.output_mode = outputMode;
    return { tool: "Grep", args };
  }
  if (n === "WebSearch" || n === "web_search" || n === "WebSearchTool") {
    return {
      tool: "WebSearch",
      args: { query: pickFirst(params, ["query", "search_term", "q", "search", "term"]) }
    };
  }
  if (n === "WebFetch" || n === "WebViewer" || n === "web_viewer") {
    return {
      tool: "WebFetch",
      args: {
        url: pickFirst(params, ["url", "uri", "link"]),
        prompt: pickFirst(params, ["prompt", "question"]) || "Fetch and summarize this page"
      }
    };
  }
  if (n === "MultiEdit" || n === "multi_edit" || n === "BatchEdit" || n === "batch_edit") {
    const filePath = pickFirst(params, ["file_path", "path", "target_file"]);
    let edits = [];
    const editsRaw = pickFirst(params, ["edits", "changes", "patches"]);
    if (editsRaw) {
      try {
        const parsed = JSON.parse(editsRaw);
        if (Array.isArray(parsed)) {
          edits = parsed.map((e) => ({
            old_string: e.old_string ?? e.old ?? e.old_str ?? "",
            new_string: e.new_string ?? e.new ?? e.new_str ?? "",
            ...(e.replace_all ? { replace_all: true } : {})
          }));
        }
      } catch { /* fall through with empty edits */ }
    }
    return { tool: "MultiEdit", args: { file_path: filePath, edits } };
  }
  if (n === "NotebookEdit" || n === "notebook_edit" || n === "EditNotebook") {
    const args = {
      notebook_path: pickFirst(params, ["notebook_path", "file_path", "path"]),
      new_source: pickFirst(params, ["new_source", "source", "content", "new_string"])
    };
    const cellId = pickFirst(params, ["cell_id"]);
    if (cellId) args.cell_id = cellId;
    const cellType = pickFirst(params, ["cell_type"]);
    if (cellType) args.cell_type = cellType;
    const editMode = pickFirst(params, ["edit_mode"]);
    if (editMode) args.edit_mode = editMode;
    return { tool: "NotebookEdit", args };
  }
  if (n === "Task" || n === "Agent" || n === "SpawnAgent" || n === "spawn_agent" || n === "SubAgent") {
    const args = {
      description: pickFirst(params, ["description", "summary", "title"]),
      prompt: pickFirst(params, ["prompt", "task", "instructions", "input"])
    };
    const subagent = pickFirst(params, ["subagent_type", "agent_type", "type"]);
    if (subagent) args.subagent_type = subagent;
    return { tool: "Task", args };
  }
  if (n === "TodoWrite" || n === "todo_write" || n === "WriteTodos" || n === "UpdateTodos") {
    let todos = [];
    const todosRaw = pickFirst(params, ["todos", "items", "tasks"]);
    if (todosRaw) {
      try {
        const parsed = JSON.parse(todosRaw);
        if (Array.isArray(parsed)) todos = parsed;
      } catch { /* leave empty */ }
    }
    return { tool: "TodoWrite", args: { todos } };
  }
  if (n === "ExitPlanMode" || n === "exit_plan_mode" || n === "FinishPlan") {
    return {
      tool: "ExitPlanMode",
      args: { plan: pickFirst(params, ["plan", "summary", "content"]) }
    };
  }
  // Fallback: pass through using whatever the model emitted. Removes empty keys.
  const cleaned = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (typeof v === "string" && v.length > 0) cleaned[k] = v;
  }
  return { tool: n || "tool", args: cleaned };
}

function parseDeepSeekCallBody(body) {
  // body is the text BETWEEN <｜tool▁call▁begin｜> and <｜tool▁call▁end｜>.
  // Split on <｜tool▁sep｜>: first segment is "ToolName" (possibly with a
  // leading "function" prefix); subsequent segments are "paramName\nvalue".
  const segs = body.split(DEEPSEEK_TOKEN_SEP).map((s) => s.replace(/^[\s\n]+|[\s\n]+$/g, ""));
  if (segs.length === 0) return null;

  // First segment may include "function" prefix and tool name on next line.
  const firstSeg = segs[0];
  const firstLines = firstSeg.split("\n").map((l) => l.trim()).filter(Boolean);
  const toolName =
    firstLines.length > 1 && /^function$/i.test(firstLines[0])
      ? firstLines.slice(1).join(" ")
      : firstLines.join(" ");

  const params = {};
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    const idx = seg.indexOf("\n");
    if (idx === -1) {
      // Whole segment is the param name with empty value
      params[seg.trim()] = "";
      continue;
    }
    const key = seg.slice(0, idx).trim();
    const value = seg.slice(idx + 1);
    if (key) params[key] = value;
  }
  return { name: toolName, params };
}

export function parseDeepSeekToolCalls(text) {
  if (typeof text !== "string" || !text.includes(DEEPSEEK_TOKEN_CALL_BEGIN)) return [];
  const calls = [];
  // Calls may be wrapped in <｜tool▁calls▁begin｜>...<｜tool▁calls▁end｜> or appear bare.
  let cursor = 0;
  while (cursor < text.length) {
    const begin = text.indexOf(DEEPSEEK_TOKEN_CALL_BEGIN, cursor);
    if (begin < 0) break;
    const end = text.indexOf(DEEPSEEK_TOKEN_CALL_END, begin);
    if (end < 0) break;
    const body = text.slice(begin + DEEPSEEK_TOKEN_CALL_BEGIN.length, end);
    const parsed = parseDeepSeekCallBody(body);
    if (parsed) calls.push(parsed);
    cursor = end + DEEPSEEK_TOKEN_CALL_END.length;
  }
  return calls;
}

// Extract chain-of-thought, preamble assistant text, and tool calls from a
// DeepSeek-style thinking blob. Splits on:
//   - `</think>` boundary (everything before = chain-of-thought)
//   - `<｜tool▁calls▁begin｜>` / `<｜tool▁call▁begin｜>` (tool-call region)
// Returns { cotText, assistantText, toolCalls }.
export function extractDeepSeekResponse(thinkingText) {
  if (typeof thinkingText !== "string" || thinkingText.length === 0) {
    return { cotText: "", assistantText: "", toolCalls: [] };
  }

  const thinkEnd = thinkingText.lastIndexOf("</think>");
  const cotText = thinkEnd >= 0 ? thinkingText.slice(0, thinkEnd) : "";
  const afterThink =
    thinkEnd >= 0 ? thinkingText.slice(thinkEnd + "</think>".length) : thinkingText;

  const callsStart = afterThink.indexOf(DEEPSEEK_TOKEN_CALLS_BEGIN);
  const fallbackStart = afterThink.indexOf(DEEPSEEK_TOKEN_CALL_BEGIN);
  const cutoff =
    callsStart >= 0
      ? callsStart
      : fallbackStart >= 0
      ? fallbackStart
      : -1;

  const assistantText = (cutoff >= 0 ? afterThink.slice(0, cutoff) : afterThink).trim();

  const callsRegion =
    cutoff >= 0
      ? (() => {
          const endIdx = afterThink.indexOf(DEEPSEEK_TOKEN_CALLS_END, cutoff);
          return endIdx >= 0
            ? afterThink.slice(cutoff, endIdx)
            : afterThink.slice(cutoff);
        })()
      : "";

  const rawCalls = parseDeepSeekToolCalls(callsRegion);
  const toolCalls = rawCalls.map((c) => mapDeepSeekToolToClaudeCode(c.name, c.params));
  return { cotText, assistantText, toolCalls };
}

// Build a tool call that semantically applies the given code-edit block.
// Prefers Edit (exact old_string/new_string) when we can recover the original
// lines from a prior Read; otherwise falls back to Write (full overwrite).
export function resolveEditFromHistory(messages, edit) {
  const catText = findLatestReadResult(messages, edit.filePath);
  if (catText) {
    const lines = parseCatNContent(catText);
    const startIdx = Math.max(0, edit.startLine - 1);
    const endIdx = Math.max(startIdx, edit.endLine - 1);
    if (startIdx < lines.length) {
      const oldSlice = lines.slice(startIdx, endIdx + 1).join("\n");
      return {
        tool: "Edit",
        args: {
          file_path: edit.filePath,
          old_string: oldSlice,
          new_string: edit.newContent
        }
      };
    }
  }
  // Fallback: Write the new content as the entire file. Lossy if the file had
  // content outside the edited range, but better than emitting nothing.
  return {
    tool: "Write",
    args: {
      file_path: edit.filePath,
      content: edit.newContent
    }
  };
}
