// Generic fallback: collapse consecutive duplicate lines + blank-line dedupe + hard line cap
import { DEDUP_LINE_MAX } from "../constants.js";

export function dedupLog(input) {
  const lines = input.split("\n");
  const out = [];
  let prev = null;
  let runCount = 0;
  let blankStreak = 0;

  const flushRun = () => {
    if (prev !== null && runCount > 1) {
      out.push(`  ... (${runCount - 1} duplicate lines)`);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      if (blankStreak < 1) out.push(line);
      blankStreak += 1;
      flushRun();
      prev = null;
      runCount = 0;
      continue;
    }
    blankStreak = 0;
    if (line === prev) {
      runCount += 1;
      continue;
    }
    flushRun();
    out.push(line);
    prev = line;
    runCount = 1;
    if (out.length >= DEDUP_LINE_MAX) {
      // The cap is deliberate (token saving), but the marker must say how much
      // was dropped — the old "truncated at 2000 lines" hid the omitted tail.
      // A trailing newline yields one empty split element; it is not a line.
      const tailBlank = lines[lines.length - 1] === "" ? 1 : 0;
      const omitted = Math.max(0, lines.length - (i + 1) - tailBlank);
      out.push(`... (truncated at ${DEDUP_LINE_MAX} lines: ${omitted} more lines omitted)`);
      return out.join("\n");
    }
  }
  flushRun();
  return out.join("\n");
}

dedupLog.filterName = "dedup-log";
