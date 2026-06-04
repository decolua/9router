// Port of filter_tree_output (rtk/src/cmds/system/tree.rs:65-94)
// Removes summary line (e.g. "5 directories, 23 files") and trailing blanks.
import { TREE_MAX_LINES } from "../constants.js";

export function tree(input) {
  const lines = input.split("\n");
  if (lines.length === 0) return input;

  const filtered = [];
  for (const line of lines) {
    // Drop "X directories, Y files" summary
    if (line.includes("director") && line.includes("file")) continue;
    // Drop leading blanks
    if (line.trim() === "" && filtered.length === 0) continue;
    filtered.push(line);
  }

  // Drop trailing blanks
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
    filtered.pop();
  }

  // Cap overly long trees (JS-only safeguard; Rust has no cap)
  if (filtered.length > TREE_MAX_LINES) {
    const cut = filtered.length - TREE_MAX_LINES;
    return filtered.slice(0, TREE_MAX_LINES).join("\n") + `\n... +${cut} more lines`;
  }

  return filtered.join("\n");
}

tree.filterName = "tree";
