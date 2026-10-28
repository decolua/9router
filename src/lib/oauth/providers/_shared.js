// Shared helpers used across provider entry files (currently trae + windsurf).

export function extractJsonPath(root, paths) {
  for (const path of paths) {
    let cur = root;
    for (const key of path) {
      if (cur == null || typeof cur !== "object") { cur = undefined; break; }
      cur = cur[key];
    }
    if (typeof cur === "string" && cur.trim()) return cur.trim();
    if (typeof cur === "number") return String(cur);
  }
  return null;
}
