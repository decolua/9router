// Port of Rust git::compact_diff (rtk/src/cmds/git/git_cmd.rs)
// Compacts unified + combined diffs: file headers, per-hunk change cap with its
// leading context kept, truncation notes split by sign, diff-wide line budget.
import {
  GIT_DIFF_HUNK_MAX_LINES,
  GIT_DIFF_MAX_LINES,
  GIT_DIFF_CONTEXT_KEEP,
  GIT_DIFF_CONTEXT_BUDGET_DIVISOR,
} from "../constants.js";

export function gitDiff(diff, maxLines = GIT_DIFF_MAX_LINES) {
  const result = [];
  let currentFile = "";
  let added = 0;
  let removed = 0;
  let hunk = null;
  let hunkShown = 0;
  let skippedDel = 0;
  let skippedAdd = 0;
  // Context before a hunk's first change, kept so the body reads as contiguous
  // with the change. Charged to a diff-wide budget and not against maxLines.
  let leadingContext = [];
  let leadingContextTotal = 0;
  const leadingContextCap = Math.floor(maxLines / GIT_DIFF_CONTEXT_BUDGET_DIVISOR);
  let wasTruncated = false;

  const flushLeadingContext = () => {
    const room = Math.max(0, leadingContextCap - leadingContextTotal);
    const keep = Math.min(leadingContext.length, room);
    const skip = leadingContext.length - keep;
    if (keep > 0) result.push(...leadingContext.slice(skip));
    leadingContext = [];
    leadingContextTotal += keep;
  };

  // Emit any pending truncation note; the hunk's dropped change lines are
  // reported split by sign so a reader can tell what it did not see.
  const flushHunkNote = () => {
    const note = hunkTruncationNote(skippedDel, skippedAdd);
    if (!note) return;
    result.push(note);
    wasTruncated = true;
    skippedDel = 0;
    skippedAdd = 0;
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --")) {
      // `diff --git`, and the `diff --cc` / `diff --combined` headers of a
      // combined diff, each open a new file and close any open hunk.
      flushLeadingContext();
      flushHunkNote();
      if (currentFile && (added > 0 || removed > 0)) {
        result.push(`  +${added} -${removed}`);
      }
      currentFile = diffHeaderPath(line);
      result.push(`\n${currentFile}`);
      added = 0;
      removed = 0;
      hunk = null;
      hunkShown = 0;
      continue;
    }

    const parsedHunk = parseHunkHeader(line);
    if (parsedHunk) {
      hunk = parsedHunk;
      flushLeadingContext();
      flushHunkNote();
      hunkShown = 0;
      // Preserve the full hunk header, including trailing function context.
      result.push(line);
    } else if (hunk) {
      if (isExhausted(hunk)) {
        hunk = null;
        continue;
      }
      if (line.startsWith("\\")) {
        // "\ No newline at end of file" annotates the line above; it occupies
        // no line in either file.
        continue;
      }

      // Marker columns are ASCII by construction; body content after them is not.
      const width = Math.min(hunk.prefixWidth, line.length);
      const markers = line.slice(0, width);
      const isAdd = markers.includes("+");
      const isDel = markers.includes("-");
      consumeHunk(hunk, markers);

      if (isAdd || isDel) {
        if (isAdd) added += 1;
        if (isDel) removed += 1;
        if (hunkShown < GIT_DIFF_HUNK_MAX_LINES) {
          flushLeadingContext();
          result.push(line);
          hunkShown += 1;
        } else if (isDel) {
          skippedDel += 1;
        } else {
          skippedAdd += 1;
        }
        leadingContext = [];
      } else if (hunkShown > 0) {
        if (hunkShown < GIT_DIFF_HUNK_MAX_LINES) {
          result.push(line);
          hunkShown += 1;
        }
      } else if (leadingContextTotal < leadingContextCap) {
        // Buffer the last `CONTEXT_KEEP` lines rather than the first: with
        // `-U10` or `--function-context` the first ones sit far above the
        // change and would imply an adjacency the file does not have.
        if (leadingContext.length === GIT_DIFF_CONTEXT_KEEP) leadingContext.shift();
        leadingContext.push(line);
      }

      if (isExhausted(hunk)) {
        hunk = null;
        flushLeadingContext();
      }
    }

    if (result.length - leadingContextTotal >= maxLines) {
      result.push("\n... (more changes truncated)");
      wasTruncated = true;
      break;
    }
  }

  // Flush last hunk
  flushLeadingContext();
  flushHunkNote();

  if (currentFile && (added > 0 || removed > 0)) {
    result.push(`  +${added} -${removed}`);
  }

  if (wasTruncated) {
    result.push("[full diff: rtk git diff --no-compact]");
  }

  return result.join("\n");
}

// ---- hunk header ----

// Line budget a hunk header declares, and how wide its body prefix is.
// `parents` holds one entry per parent in marker-column order (one for `@@`,
// one per parent for a combined `@@@`).
function parseHunkHeader(line) {
  const leading = line.startsWith("@") ? line.match(/^@+/)[0].length : 0;
  if (leading < 2) return null;
  const body = line.slice(leading).split("@")[0];

  const parents = [];
  let newCount = null;
  for (const group of body.split(/\s+/)) {
    if (!group.startsWith("-") && !group.startsWith("+")) continue;
    const rest = group.slice(1);
    const comma = rest.indexOf(",");
    const count = comma === -1 ? 1 : Number(rest.slice(comma + 1));
    // Rust: parts[1].parse::<usize>() — anything unparseable rejects the header.
    if (!Number.isInteger(count) || count < 0) return null;
    if (group.startsWith("-")) parents.push(count);
    else newCount = count;
  }

  // `@@` has one marker column, `@@@` two, and so on. A range count missing
  // from the header gets an unbounded budget so the hunk stays open to the
  // next header rather than dropping its body.
  const prefixWidth = leading - 1;
  if (parents.length !== prefixWidth) {
    if (parents.length > prefixWidth) parents.length = prefixWidth;
    while (parents.length < prefixWidth) parents.push(Number.MAX_SAFE_INTEGER);
  }

  return { parents, new: newCount ?? 0, prefixWidth };
}

// A combined hunk is not done until every parent's budget is spent.
function isExhausted(hunk) {
  return hunk.new === 0 && hunk.parents.every(remaining => remaining === 0);
}

// Charge a body line against the budgets it occupies. Column i is the line's
// marker against parent i+1: `-` there means the line is in that parent and is
// being removed; a space on a non-removal line means it is in that parent
// unchanged. `+` there, or a space on a removal line, means it is not in that
// parent at all.
function consumeHunk(hunk, markers) {
  const isAdd = markers.includes("+");
  const isDel = markers.includes("-");
  hunk.parents = hunk.parents.map((remaining, i) => {
    const column = i < markers.length ? markers[i] : undefined;
    const present = isDel ? column === "-" : column !== "+";
    return present ? Math.max(0, remaining - 1) : remaining;
  });
  if (isAdd || !isDel) hunk.new = Math.max(0, hunk.new - 1);
}

function hunkTruncationNote(deletions, additions) {
  const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  if (deletions === 0 && additions === 0) return null;
  if (additions === 0) return `  ... (${count(deletions, "deletion")} truncated)`;
  if (deletions === 0) return `  ... (${count(additions, "addition")} truncated)`;
  return `  ... (${count(deletions, "deletion")}, ${count(additions, "addition")} truncated)`;
}

// ---- file header path ----

function diffHeaderPath(line) {
  const rest = splitn3Space(line);
  if (rest == null) return "unknown";
  if (!line.startsWith("diff --git ")) return unquotePath(rest);

  const same = samePathTwice(rest);
  if (same) return same;

  // A rename names two different paths, and the destination is the second.
  const quotedIdx = rest.indexOf(' "b/');
  if (quotedIdx !== -1) {
    const dst = rest.slice(quotedIdx + 1);
    if (dst.endsWith('"')) return unescapePath(dst.slice(1, -1));
  }
  const bIdx = rest.indexOf(" b/");
  if (bIdx !== -1) return rest.slice(bIdx + 3);
  return unquotePath(rest);
}

// Third field onwards, i.e. Rust's `line.splitn(3, ' ').nth(2)`.
function splitn3Space(line) {
  const first = line.indexOf(" ");
  if (first === -1) return null;
  const second = line.indexOf(" ", first + 1);
  if (second === -1) return null;
  return line.slice(second + 1);
}

// The path a `diff --git` header names twice, split at the midpoint. A rename
// has halves that differ past their first component, so it falls through to the
// ` b/` split. `--no-prefix` and custom prefixes read alike.
function samePathTwice(rest) {
  if (rest.length % 2 === 0) return null;
  const mid = Math.floor(rest.length / 2);
  if (rest[mid] !== " ") return null;

  const left = unquotePath(rest.slice(0, mid));
  const right = unquotePath(rest.slice(mid + 1));
  if (left === right) return left;

  const leftSlash = left.indexOf("/");
  const rightSlash = right.indexOf("/");
  if (leftSlash === -1 || rightSlash === -1) return null;
  const leftPath = left.slice(leftSlash + 1);
  const rightPath = right.slice(rightSlash + 1);
  return leftPath === rightPath ? rightPath : null;
}

// Undo git's `core.quotepath` quoting: `"a/\303\251.txt"` becomes `a/é.txt`.
function unquotePath(raw) {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return unescapePath(raw.slice(1, -1));
  }
  return raw;
}

// Decode the C escapes inside a quoted path. Octal escapes spell out the path's
// bytes one at a time, so they are collected as bytes and decoded once at the
// end rather than per escape.
function unescapePath(quoted) {
  const bytes = new TextEncoder().encode(quoted);
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x5c || i + 1 === bytes.length) {
      out.push(bytes[i]);
      continue;
    }
    const escape = bytes[i + 1];
    if (escape >= 0x30 && escape <= 0x39) {
      const end = Math.min(i + 4, bytes.length);
      const digits = new TextDecoder().decode(new Uint8Array(bytes.slice(i + 1, end)));
      const octal = /^[0-7]{1,3}$/.test(digits) ? parseInt(digits, 8) : NaN;
      if (!Number.isNaN(octal)) {
        out.push(octal);
        i = end - 1;
        continue;
      }
      // Not an octal escape after all: keep the backslash verbatim.
      out.push(bytes[i]);
      continue;
    }
    const map = { 0x61: 0x07, 0x62: 0x08, 0x74: 0x09, 0x6e: 0x0a, 0x76: 0x0b, 0x66: 0x0c, 0x72: 0x0d };
    out.push(map[escape] ?? escape);
    i += 1;
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(out));
}

gitDiff.filterName = "git-diff";
