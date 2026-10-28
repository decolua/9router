// Handles Cursor/Codex read_file output: "  1|content\n  2|content".
// No upstream counterpart (rtk numbers its own read output), so this port keeps
// its own head+tail window: a whole-file read is useful from both ends.
import { READ_NUMBERED_HEAD, READ_NUMBERED_TAIL, READ_NUMBERED_MIN_LINES } from "../constants.js";

const LINE_RE = /^\s*\d+\|/;

export function readNumbered(input) {
  const lines = input.split("\n");
  if (lines.length < READ_NUMBERED_MIN_LINES) return input;

  // Count how many lines match "N|content" to verify shape (hit ratio check
  // already done by autodetect; here we just truncate).
  const head = lines.slice(0, READ_NUMBERED_HEAD);
  const tail = lines.slice(lines.length - READ_NUMBERED_TAIL);
  const cut = lines.length - head.length - tail.length;

  return [
    ...head,
    `... +${cut} lines truncated (file continues)`,
    ...tail
  ].join("\n");
}

readNumbered.filterName = "read-numbered";

// Exposed for autodetect
export const READ_NUMBERED_LINE_RE = LINE_RE;
