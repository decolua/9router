// Port of compact_ls (rtk/src/cmds/system/ls.rs)
// Input: `ls -la` style output. Output: compact "dir/" then "name  size", capped
// at CAP_INVENTORY entries. Upstream dropped the extension "Summary:" line, so
// this port no longer emits one.
import { LS_INVENTORY_MAX, LS_NOISE_DIRS } from "../constants.js";

// Rust LS_DATE_RE: month + day + (year|HH:MM)
const LS_DATE_RE = /\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4}|\d{2}:\d{2})\s+/;

function humanSize(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}

function parseLsLine(line) {
  const m = LS_DATE_RE.exec(line);
  if (!m) return null;
  const name = line.slice(m.index + m[0].length);
  const beforeDate = line.slice(0, m.index);
  const beforeParts = beforeDate.split(/\s+/).filter(Boolean);
  if (beforeParts.length < 4) return null;

  const perms = beforeParts[0];
  const fileType = perms.charAt(0);

  // size = rightmost parseable number before the date
  let size = 0;
  for (let i = beforeParts.length - 1; i >= 0; i--) {
    const n = Number(beforeParts[i]);
    if (Number.isInteger(n) && String(n) === beforeParts[i]) { size = n; break; }
  }
  return { fileType, size, name };
}

export function ls(input) {
  const dirs = [];
  const files = [];      // [name, sizeStr]

  for (const line of input.split("\n")) {
    if (line.startsWith("total ") || line.length === 0) continue;
    const parsed = parseLsLine(line);
    if (!parsed) continue;
    if (parsed.name === "." || parsed.name === "..") continue;

    // Rust ls.rs: show_all flag respected — for LLM context always skip noise
    if (LS_NOISE_DIRS.includes(parsed.name)) continue;

    if (parsed.fileType === "d") {
      dirs.push(parsed.name);
    } else if (parsed.fileType === "-" || parsed.fileType === "l") {
      files.push([parsed.name, humanSize(parsed.size)]);
    }
  }

  if (dirs.length === 0 && files.length === 0) return input;

  const lines = [
    ...dirs.map(d => `${d}/`),
    ...files.map(([name, size]) => `${name}  ${size}`)
  ];

  // Cap the displayed listing (Rust CAP_INVENTORY); the tail stays recoverable
  // by re-running ls on the directory.
  if (lines.length > LS_INVENTORY_MAX) {
    const hidden = lines.length - LS_INVENTORY_MAX;
    lines.length = LS_INVENTORY_MAX;
    lines.push(`... +${hidden} more entries`);
  }

  return lines.join("\n");
}

ls.filterName = "ls";
