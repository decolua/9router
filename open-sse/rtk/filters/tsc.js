// Port of filter_tsc_output (rtk/src/cmds/js/tsc_cmd.rs).
//
// Groups TypeScript diagnostics by file: a one-line aggregate, a `Top codes:`
// ranking, then every error per file by line number. tsc's own `Found N errors`
// trailer and unparsed noise are dropped; ANSI `--pretty` output is normalized
// first so both layouts parse.
import { TSC_MESSAGE_MAX_CHARS } from "../constants.js";
import { stripAnsi } from "../stripAnsi.js";

const RE_TSC_ERROR = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;
// `--pretty` layout: `file:line:col - error TSxxxx: message`
const RE_TSC_PRETTY = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.+)$/;
// File-less diagnostics ("error TS5023: Unknown compiler option ...")
const RE_TSC_GLOBAL = /^(error|warning)\s+(TS\d+):\s+(.+)$/;

function parseDiagnostic(line) {
  let match = RE_TSC_ERROR.exec(line);
  if (match) return { file: match[1], line: match[2], code: match[5], message: match[6] };

  match = RE_TSC_PRETTY.exec(line);
  if (match) return { file: match[1], line: match[2], code: match[5], message: match[6] };

  match = RE_TSC_GLOBAL.exec(line);
  if (match) return { file: null, line: null, code: match[2], message: match[3] };

  return null;
}

// Rust core::utils::truncate — characters, not bytes.
function truncate(text, max) {
  if (text.length <= max) return text;
  if (max < 3) return "...";
  return `${text.slice(0, max - 3)}...`;
}

export function tsc(input) {
  const clean = stripAnsi(input || "");
  const lines = clean.split("\n");
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const diagnostic = parseDiagnostic(lines[i]);
    if (!diagnostic) continue;

    const error = {
      file: diagnostic.file,
      line: diagnostic.line === null ? null : Number(diagnostic.line),
      code: diagnostic.code,
      message: diagnostic.message,
      contextLines: [],
    };

    // Indented follow-up lines belong to this diagnostic.
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const indented = next.startsWith("  ") || next.startsWith("\t");
      if (next.length > 0 && indented && !parseDiagnostic(next)) {
        error.contextLines.push(next.trim());
        i += 1;
      } else {
        break;
      }
    }
    // The outer loop's own increment must not skip this line.
    i -= 1;

    errors.push(error);
  }

  if (errors.length === 0) {
    return clean.includes("Found 0 errors")
      ? "TypeScript: No errors found"
      : "TypeScript compilation completed";
  }

  const globalErrors = errors.filter(err => err.file === null);

  const byFile = new Map();
  for (const err of errors) {
    if (err.file === null) continue;
    if (!byFile.has(err.file)) byFile.set(err.file, []);
    byFile.get(err.file).push(err);
  }

  const byCode = new Map();
  for (const err of errors) {
    byCode.set(err.code, (byCode.get(err.code) || 0) + 1);
  }

  let result = byFile.size === 0
    ? `TypeScript: ${errors.length} errors`
    : `TypeScript: ${errors.length} errors in ${byFile.size} files`;

  // Top error codes, most frequent first.
  const codeCounts = Array.from(byCode.entries()).sort((a, b) => b[1] - a[1]);
  if (codeCounts.length > 1) {
    const codesStr = codeCounts
      .slice(0, 5)
      .map(([code, count]) => `${code} (${count}x)`)
      .join(", ");
    result += `\nTop codes: ${codesStr}\n`;
  }

  if (globalErrors.length > 0) {
    result += `\nglobal (${globalErrors.length} errors)\n`;
    for (const err of globalErrors) {
      result += `  ${err.code} ${truncate(err.message, TSC_MESSAGE_MAX_CHARS)}\n`;
      for (const ctx of err.contextLines) {
        result += `    ${truncate(ctx, TSC_MESSAGE_MAX_CHARS)}\n`;
      }
    }
    result += "\n";
  }

  // Files with the most errors first (stable for equal counts).
  const filesSorted = Array.from(byFile.entries()).sort((a, b) => b[1].length - a[1].length);
  for (const [file, fileErrors] of filesSorted) {
    result += `${file} (${fileErrors.length} errors)\n`;
    for (const err of fileErrors) {
      result += `  L${err.line ?? 0}: ${err.code} ${truncate(err.message, TSC_MESSAGE_MAX_CHARS)}\n`;
      for (const ctx of err.contextLines) {
        result += `    ${truncate(ctx, TSC_MESSAGE_MAX_CHARS)}\n`;
      }
    }
    result += "\n";
  }

  return result.trim();
}

tsc.filterName = "tsc";
