// Port of find_wrapper (rtk/src/cmds/system/pipe_cmd.rs:89-128)
// Group by parent dir, show basenames, cap 10/dir and 20 dirs total
import { FIND_PER_DIR_MAX, FIND_TOTAL_DIR_MAX } from "../constants.js";

export function find(input) {
  const lines = input.split("\n").filter(l => l.trim());
  if (lines.length === 0) return input;

  const byDir = new Map();

  for (const path of lines) {
    const lastSlash = path.lastIndexOf("/");
    let dir;
    let basename;
    if (lastSlash === -1) {
      dir = ".";
      basename = path;
    } else {
      // Rust: PathBuf::from(path).parent().display() + file_name().display()
      dir = path.slice(0, lastSlash) || "/";
      basename = path.slice(lastSlash + 1);
    }
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(basename);
  }

  // Rust: dirs.sort_by_key(|(d, _)| d.clone())
  const dirs = Array.from(byDir.keys()).sort();
  let out = `${lines.length} files in ${dirs.length} dirs:\n\n`;

  const showDirs = dirs.slice(0, FIND_TOTAL_DIR_MAX);
  for (const dir of showDirs) {
    const files = byDir.get(dir);
    out += `${dir}/ (${files.length}):\n`;
    const showFiles = files.slice(0, FIND_PER_DIR_MAX);
    for (const f of showFiles) out += `  ${f}\n`;
    if (files.length > FIND_PER_DIR_MAX) {
      out += `  +${files.length - FIND_PER_DIR_MAX}\n`;
    }
    out += "\n";
  }
  if (dirs.length > FIND_TOTAL_DIR_MAX) {
    out += `+${dirs.length - FIND_TOTAL_DIR_MAX} more dirs\n`;
  }

  return out;
}

find.filterName = "find";
