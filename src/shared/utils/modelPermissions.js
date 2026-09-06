/**
 * API Key model-permission pattern matching.
 *
 * Pure functions (zero dependency, ReDoS-safe) adapted from OmniRoute's
 * modelPermissions.ts. Handles exact match, prefix wildcard, and
 * segment-bounded glob matching.
 */

/**
 * Check if a model pattern matches any of the candidate model IDs.
 *
 * Pattern syntax:
 *   - Exact:     "kr/claude-sonnet-4.5"   → matches only that model
 *   - Prefix:    "openai/*"               → matches "openai/gpt-5", "openai/gpt-4"
 *   - Glob:      "claude-sonnet*"         → matches "claude-sonnet-4.5", "claude-sonnet-4.6"
 *
 * @param {string} pattern
 * @param {string[]} candidates
 * @returns {boolean}
 */
export function modelPatternMatches(pattern, candidates) {
  for (const candidate of candidates) {
    if (pattern === candidate) return true;

    // Prefix wildcard: provider/* → all models under that provider
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      if (candidate.startsWith(prefix + "/") || candidate.startsWith(prefix)) {
        return true;
      }
    }

    // Glob wildcard (segment-bounded, no ReDoS)
    if (pattern.includes("*") && matchesWildcardPattern(pattern, candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * Segment-by-segment wildcard matching (no RegExp, ReDoS-safe).
 *
 * Walks the pattern token-by-token: each `*` matches the longest possible
 * run within the current path segment, then the next literal anchor must
 * appear before the segment boundary. Worst-case complexity is O(n*m).
 *
 * @param {string} pattern
 * @param {string} candidate
 * @returns {boolean}
 */
export function matchesWildcardPattern(pattern, candidate) {
  const pSegs = pattern.split("/");
  const cSegs = candidate.split("/");
  if (pSegs.length !== cSegs.length) return false;

  for (let i = 0; i < pSegs.length; i++) {
    if (!segmentMatchesWildcard(pSegs[i], cSegs[i])) return false;
  }
  return true;
}

function segmentMatchesWildcard(pattern, segment) {
  if (pattern === segment) return true;
  if (!pattern.includes("*")) return false;

  const parts = pattern.split("*");
  let cursor = 0;

  // Anchor first literal to start
  const first = parts[0];
  if (first) {
    if (!segment.startsWith(first)) return false;
    cursor = first.length;
  }

  // Anchor last literal to end
  const last = parts[parts.length - 1];
  const endLimit = segment.length - last.length;
  if (last) {
    if (!segment.endsWith(last)) return false;
  }

  // Each middle literal must appear in order between cursor and endLimit
  for (let i = 1; i < parts.length - 1; i++) {
    const piece = parts[i];
    if (!piece) continue;
    const idx = segment.indexOf(piece, cursor);
    if (idx === -1 || idx + piece.length > endLimit) return false;
    cursor = idx + piece.length;
  }

  return cursor <= endLimit;
}
