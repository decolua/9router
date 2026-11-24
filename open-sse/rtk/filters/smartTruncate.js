// Port of text::smart_truncate (rtk/text/src/lib.rs).
//
// Structure-aware, head-biased window: keep import lines, function/type
// signatures, `pub`/`export` lines and lone braces wherever they appear, plus
// the first `max_lines / 2` lines, then stop at `max_lines - 1` and append an
// exact `[N more lines]` trailer. No synthetic annotations on the kept lines.
import { SMART_TRUNCATE_MAX_LINES } from "../constants.js";

// Rust IMPORT_PATTERN
const RE_IMPORT = /^(use |import |from |require\(|#include)/;
// Rust FUNC_SIGNATURE
const RE_FUNC_SIGNATURE =
  /^(pub\s+)?(async\s+)?(fn|def|function|func|class|struct|enum|trait|interface|type)\s+\w+/;

function isImportantLine(trimmed) {
  return (
    RE_FUNC_SIGNATURE.test(trimmed) ||
    RE_IMPORT.test(trimmed) ||
    trimmed.startsWith("pub ") ||
    trimmed.startsWith("export ") ||
    trimmed === "}" ||
    trimmed === "{"
  );
}

export function smartTruncate(input, maxLines = SMART_TRUNCATE_MAX_LINES) {
  if (maxLines === 0) return "";

  const lines = input.split("\n");
  if (lines.length <= maxLines) return input;

  const result = [];
  let keptLines = 0;
  const softHead = Math.floor(maxLines / 2);

  for (const line of lines) {
    if (isImportantLine(line.trim()) || keptLines < softHead) {
      result.push(line);
      keptLines += 1;
    }

    if (keptLines >= maxLines - 1) break;
  }

  result.push(`[${lines.length - keptLines} more lines]`);
  return result.join("\n");
}

smartTruncate.filterName = "smart-truncate";
