// Compact "Result of search in '...' (total N files):\n- path\n- path" output
// (Cursor Glob tool). Groups by parent dir like find, shows basenames.
import { SEARCH_LIST_PER_DIR_MAX, SEARCH_LIST_TOTAL_DIR_MAX } from "../constants.js";

const HEADER_RE = /^Result of search in '[^']*' \(total (\d+) files?\):/;

export function searchList(input) {
  const lines = input.split("\n");
  if (lines.length === 0) return input;

  // First line must be the header (validated by autodetect too)
  const header = lines[0] || "";
  const rest = lines.slice(1);

  const paths = [];
  for (const raw of rest) {
    const t = raw.trim();
    if (!t.startsWith("- ")) continue;
    paths.push(t.slice(2));
  }
  if (paths.length === 0) return input;

  const byDir = new Map();
  for (const p of paths) {
    const slash = p.lastIndexOf("/");
    const dir = slash === -1 ? "." : (p.slice(0, slash) || "/");
    const name = slash === -1 ? p : p.slice(slash + 1);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(name);
  }

  const dirs = Array.from(byDir.keys()).sort();
  let out = `${header}\n${paths.length} files in ${dirs.length} dirs:\n\n`;

  for (const dir of dirs.slice(0, SEARCH_LIST_TOTAL_DIR_MAX)) {
    const names = byDir.get(dir);
    out += `${dir}/ (${names.length}):\n`;
    for (const n of names.slice(0, SEARCH_LIST_PER_DIR_MAX)) out += `  ${n}\n`;
    if (names.length > SEARCH_LIST_PER_DIR_MAX) {
      out += `  +${names.length - SEARCH_LIST_PER_DIR_MAX}\n`;
    }
    out += "\n";
  }
  if (dirs.length > SEARCH_LIST_TOTAL_DIR_MAX) {
    out += `+${dirs.length - SEARCH_LIST_TOTAL_DIR_MAX} more dirs\n`;
  }

  return out.replace(/\n+$/, "");
}

searchList.filterName = "search-list";
export const SEARCH_LIST_HEADER_RE = HEADER_RE;
