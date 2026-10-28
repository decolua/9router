/**
 * Path containment guard for every agent file operation.
 *
 * The agent runs with the editor's trust, so a model-supplied path must never
 * escape the session workspace: `..`, absolute paths outside the root and
 * symlinks pointing out of it are all rejected before any read or write.
 */

const fs = require("fs");
const path = require("path");

class PathEscapeError extends Error {
  constructor(message) {
    super(message);
    this.name = "PathEscapeError";
  }
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve `input` against `root` and assert it stays inside.
 * Follows symlinks for the deepest existing ancestor so a link out of the
 * workspace cannot be used to read or write outside of it.
 */
function resolveInRoot(root, input) {
  if (typeof input !== "string" || !input.trim()) throw new PathEscapeError("Path is required");
  const absRoot = path.resolve(root);
  const target = path.resolve(absRoot, input);
  if (!isInside(absRoot, target)) throw new PathEscapeError(`Path escapes the workspace: ${input}`);

  // Walk up to the deepest existing ancestor and resolve its real path.
  let probe = target;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  try {
    const real = fs.realpathSync(probe);
    if (!isInside(absRoot, path.resolve(real, path.relative(probe, target)))) {
      throw new PathEscapeError(`Path escapes the workspace via symlink: ${input}`);
    }
  } catch (err) {
    if (err instanceof PathEscapeError) throw err;
    /* realpath failure on odd FS: containment above still holds */
  }
  return target;
}

module.exports = { resolveInRoot, isInside, PathEscapeError };
