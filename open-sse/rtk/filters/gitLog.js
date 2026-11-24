// JS-native git-log filter, rules aligned with upstream filter_log_output
// (rtk/src/cmds/git/git_cmd.rs): per-commit header/meta/subject, up to
// GIT_LOG_BODY_LINES body lines, trailers dropped, omitted lines counted, and a
// hard cap of GIT_LOG_MAX_COMMITS commits.
import { GIT_LOG_MAX_COMMITS, GIT_LOG_BODY_LINES } from "../constants.js";

const RE_COMMIT_HEADER = /^commit [0-9a-f]{7,40}$/i;
const RE_COMMIT_HEADER_GRAPH = /^[*|/\\ ]+commit [0-9a-f]{7,40}/i;
const RE_TRAILER = /^(Signed-off-by|Co-authored-by):/i;
const RE_MERGE_LINE = /^Merge: /;
const RE_GRAPH_ONLY = /^[*|/\\ ]+$/;

export function gitLog(text, maxCommits = GIT_LOG_MAX_COMMITS) {
  if (!text) return "";

  const input = String(text);
  const out = [];
  let commits = 0;
  let dropped = 0;

  // Pending commit block
  let inCommit = false;
  let header = null;
  const meta = [];
  let subject = null;
  const body = [];
  let bodyOmitted = 0;
  const stats = [];
  let diffOmitted = false;

  const reset = () => {
    inCommit = false;
    header = null;
    meta.length = 0;
    subject = null;
    body.length = 0;
    bodyOmitted = 0;
    stats.length = 0;
    diffOmitted = false;
  };

  const flush = () => {
    if (!inCommit) return;
    if (commits < maxCommits) {
      out.push(header);
      out.push(...meta);
      if (subject) out.push(`  Subject: ${subject}`);
      for (const b of body) out.push(`  ${b}`);
      if (bodyOmitted > 0) out.push(`  [+${bodyOmitted} lines omitted]`);
      for (const s of stats) out.push(`  ${s}`);
      if (diffOmitted) out.push("  ... diff body omitted");
      commits += 1;
    } else {
      dropped += 1;
    }
    reset();
  };

  const pushCommitLine = (line) => {
    if (commits < maxCommits) {
      out.push(line);
      commits += 1;
    } else {
      dropped += 1;
    }
  };

  for (const raw of input.split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // commit <sha> header — starts a new commit block. Also matched with leading
    // graph decoration (`*   commit abc1234…` — --graph without --oneline).
    if (RE_COMMIT_HEADER.test(trimmed) || RE_COMMIT_HEADER_GRAPH.test(trimmed)) {
      flush();
      inCommit = true;
      header = line;
      continue;
    }

    if (inCommit) {
      // Author / Date (and other header meta) — keep as-is
      if (/^[*|/\\ ]*(Author|Date):/i.test(trimmed)) {
        meta.push(trimmed);
        continue;
      }
      if (trimmed === "") continue;
      // merge parents line — no value to a reader
      if (RE_MERGE_LINE.test(trimmed)) continue;

      // indented subject (4 spaces, optionally preceded by graph decoration)
      if (!subject && /^[*|/\\ ]*    \S/.test(line)) {
        subject = trimmed;
        continue;
      }

      // stat summary: "N file(s) changed, N insertions(+), N deletions(-)"
      if (/^\d+ file\w* changed/.test(trimmed)) {
        stats.push(trimmed);
        continue;
      }

      // embedded diff header — one-line marker
      if (/^diff --git /.test(trimmed)) {
        diffOmitted = true;
        continue;
      }

      // graph decoration inside a commit block
      if (RE_GRAPH_ONLY.test(trimmed) && /[*|/\\]/.test(trimmed)) continue;

      // commit body: keep the first few lines (upstream keeps 3), drop trailers,
      // count the rest
      if (RE_TRAILER.test(trimmed)) continue;
      if (body.length < GIT_LOG_BODY_LINES) body.push(trimmed);
      else bodyOmitted += 1;
      continue;
    }

    // Not in a commit block (--oneline / --graph modes):

    // Graph decoration + sha + subject: "*|/\ <sha7> <subject>"
    const graphMatch = trimmed.match(/^[*|/\\ ]+([0-9a-f]{7,40}\s+.+)/i);
    if (graphMatch) {
      pushCommitLine(graphMatch[1]);
      continue;
    }

    // Plain oneline: "<sha7> <subject>"
    if (/^[0-9a-f]{7,40}\s+/.test(trimmed)) {
      pushCommitLine(trimmed);
      continue;
    }

    // Pure graph decoration (no sha) — drop
    if (RE_GRAPH_ONLY.test(trimmed) && /[*|/\\]/.test(trimmed)) continue;

    // catch-all pass-through
    out.push(trimmed);
  }

  flush();

  if (dropped > 0) out.push(`... (${dropped} more commits)`);

  const result = out.join("\n");
  if (!result && input) return input;
  if (result.length > input.length) return input;
  return result;
}

gitLog.filterName = "git-log";
