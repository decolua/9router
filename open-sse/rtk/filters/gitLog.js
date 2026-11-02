// JS-native git-log filter
// Compresses `git log` output: keeps commit headers, subjects, Author/Date;
// drops body padding, decoration, embedded diff lines.
import { GIT_LOG_MAX_LINES } from "../constants.js";

export function gitLog(text, maxLines = GIT_LOG_MAX_LINES) {
  if (!text) return "";

  const input = String(text);
  const lines = input.split("\n");
  const out = [];
  let skipped = 0;
  let inCommit = false;
  let subjectSeen = false;

  function pushLine(l) {
    if (out.length < maxLines) {
      out.push(l);
      return true;
    }
    skipped++;
    return false;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // commit <sha> header — starts new commit entry
    // Also matched with leading graph decoration (`*   commit abc1234...` — --graph without --oneline)
    if (/^commit [0-9a-f]{7,40}$/i.test(trimmed) || /^[*|/\\ ]+commit [0-9a-f]{7,40}/i.test(trimmed)) {
      inCommit = true;
      subjectSeen = false;
      pushLine(line);
      continue;
    }

    if (inCommit) {
      // Author / Date — keep as-is (already column 0 in raw, or graph-prefix stripped by commit-header match)
      if (/^[*|/\\ ]*(Author|Date):/i.test(trimmed)) {
        pushLine(trimmed);
        continue;
      }
      // blank — skip
      if (trimmed === "") continue;
      // indented subject (4 spaces, optionally preceded by graph decoration) — first one is subject
      if (!subjectSeen && /^[*|/\\ ]*    \S/.test(line)) {
        pushLine("  Subject: " + trimmed);
        subjectSeen = true;
        continue;
      }
      // stat summary: "N file(s) changed, N insertions(+), N deletions(-)"
      if (/^\d+ file\w* changed/.test(trimmed)) {
        pushLine("  " + trimmed);
        continue;
      }
      // embedded diff header — one-line marker
      if (/^diff --git /.test(trimmed)) {
        pushLine("  ... diff body omitted");
        continue;
      }
      // everything else in commit body — drop
      continue;
    }

    // Not in a commit block (--oneline / --graph modes):

    // Graph decoration + sha + subject: "*|/\\ <sha7> <subject>"
    const graphMatch = trimmed.match(/^[*|/\\ ]+([0-9a-f]{7,40}\s+.+)/i);
    if (graphMatch) {
      pushLine(graphMatch[1]);
      continue;
    }

    // Plain oneline: "<sha7> <subject>"
    if (/^[0-9a-f]{7,40}\s+/.test(trimmed)) {
      pushLine(trimmed);
      continue;
    }

    // Pure graph decoration (no sha) — drop
    if (/^[*|/\\ ]+$/.test(trimmed) && /[*|/\\]/.test(trimmed)) {
      continue;
    }

    // catch-all pass-through
    pushLine(trimmed);
  }

  if (skipped > 0) out.push(`... (${skipped} more lines)`);

  const result = out.join("\n");
  if (!result && input) return input;
  if (result.length > input.length) return input;
  return result;
}

gitLog.filterName = "git-log";
