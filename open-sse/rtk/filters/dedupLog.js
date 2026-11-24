// Port of the upstream `dedup` method (rtk/engine/src/methods/dedup.rs).
//
// Adjacent-only, non-blank lines only, run >= 3: the line is kept once followed
// by an explicit `[xN]` count. Shorter runs pass through untouched, blank-line
// runs are exempt (the marker would cost more than it saves), and ordering is
// preserved. The hard line cap is a 9router safeguard on top of the upstream
// rules so a pathological blob cannot defeat the compressor.
import { DEDUP_LINE_MAX, DEDUP_MIN_RUN } from "../constants.js";

export function dedupLog(input) {
  const lines = input.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run += 1;

    if (run >= DEDUP_MIN_RUN && line.trim() !== "") {
      out.push(line);
      out.push(`[x${run}]`);
    } else {
      for (let k = 0; k < run; k++) out.push(line);
    }
    i += run;

    if (out.length >= DEDUP_LINE_MAX) {
      out.push(`... (truncated at ${DEDUP_LINE_MAX} lines)`);
      return out.join("\n");
    }
  }

  return out.join("\n");
}

dedupLog.filterName = "dedup-log";
