// Port of grep_wrapper (rtk/src/cmds/system/pipe_cmd.rs:50-86)
// Input format: "file:lineno:content" — splitn(3, ':') in Rust
import { GREP_PER_FILE_MAX } from "../constants.js";

// A grep hit's first field must look like a file path: no whitespace and a
// separator or an extension. This is what keeps a timestamped log line
// ("2026-11-10 12:30:45 INFO ...") from parsing as "file:line:content" — the
// first field there is "2026-11-10 12".
function isPathField(field) {
  if (!field || /\s/.test(field)) return false;
  return field.includes("/") || field.includes("\\") || field.includes(".");
}

// Parse one "file:lineno:content" line; null when it is not grep-shaped.
export function parseGrepLine(line) {
  // splitn(3, ':') — only split on first 2 colons
  const first = line.indexOf(":");
  if (first === -1) return null;
  const second = line.indexOf(":", first + 1);
  if (second === -1) return null;
  const file = line.slice(0, first);
  const lineNumStr = line.slice(first + 1, second);
  // Rust: parts[1].parse::<usize>().is_ok()
  if (!/^\d+$/.test(lineNumStr)) return null;
  if (!isPathField(file)) return null;
  return { file, lineNumStr, content: line.slice(second + 1) };
}

export function grep(input) {
  const hits = [];
  for (const line of input.split("\n")) {
    if (line.trim() === "") continue;
    const hit = parseGrepLine(line);
    // Fail-open: one non-grep line means this is not grep output. Return the
    // input untouched instead of silently dropping the unmatched lines (a
    // timestamped log used to lose every line that was not "x:NN:y").
    if (!hit) return input;
    hits.push(hit);
  }

  if (hits.length === 0) return input;

  const byFile = new Map();
  for (const { file, lineNumStr, content } of hits) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push([lineNumStr, content]);
  }

  const total = hits.length;

  // Rust: files.sort_by_key(|(f, _)| *f)
  const files = Array.from(byFile.keys()).sort();
  let out = `${total} matches in ${files.length}F:\n\n`;

  for (const file of files) {
    const matches = byFile.get(file);
    out += `[file] ${file} (${matches.length}):\n`;
    const show = matches.slice(0, GREP_PER_FILE_MAX);
    for (const [lineNum, content] of show) {
      // Rust: format!("  {:>4}: {}", line_num, content.trim())
      out += `  ${lineNum.padStart(4)}: ${content.trim()}\n`;
    }
    if (matches.length > GREP_PER_FILE_MAX) {
      out += `  +${matches.length - GREP_PER_FILE_MAX}\n`;
    }
    out += "\n";
  }

  return out;
}

grep.filterName = "grep";
