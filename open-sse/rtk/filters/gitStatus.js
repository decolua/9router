// Port of upstream git-status output rules (rtk/src/cmds/git/git_cmd.rs):
//
// - `format_status_output` (porcelain): the `## branch` header becomes
//   `* branch`, every other porcelain line passes through unchanged, and a
//   branch-only status gains a `clean — nothing to commit` marker. Upstream no
//   longer groups entries into Staged/Modified/Untracked buckets.
// - `filter_status_with_args` (plain `git status`): drop empty lines and git's
//   own hint lines (`(use "git ...`), collapse a clean tree to its clean line,
//   and answer `ok` when nothing is left.

// Rust: strip lines that only tell the reader which git command to run next.
const RE_GIT_HINT = /^\(use "git|^\(create\/copy files/;
const RE_GIT_HINT_INLINE = /\(use "git (add|restore)"/;

function formatStatusOutput(input) {
  // Rust: .lines().filter(|line| !line.trim().is_empty())
  const lines = input.split("\n").filter(line => line.trim().length > 0);
  if (lines.length === 0) return "Clean working tree";

  const out = [];
  const first = lines[0];
  if (first.startsWith("##")) {
    // Rust: trim_start_matches("## ")
    out.push(`* ${first.replace(/^(## )+/, "")}`);
  } else {
    out.push(first);
  }
  for (let i = 1; i < lines.length; i++) out.push(lines[i]);

  if (lines.length === 1 && first.startsWith("##")) {
    out.push("clean — nothing to commit");
  }

  return out.join("\n");
}

function filterStatusWithArgs(input) {
  const result = [];

  for (const line of input.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.length === 0) continue;
    if (RE_GIT_HINT.test(trimmed) || RE_GIT_HINT_INLINE.test(trimmed)) continue;

    // Special case: clean working tree
    if (trimmed.includes("nothing to commit") && trimmed.includes("working tree clean")) {
      result.push(trimmed);
      break;
    }

    result.push(line);
  }

  return result.length === 0 ? "ok" : result.join("\n");
}

export function gitStatus(input) {
  if (!input || !input.trim()) return "Clean working tree";

  // Porcelain (`git status --porcelain -b`) starts with the `## branch` header;
  // plain `git status` starts with `On branch …` / state text.
  const firstLine = input.split("\n").find(line => line.trim().length > 0) || "";
  return firstLine.startsWith("##")
    ? formatStatusOutput(input)
    : filterStatusWithArgs(input);
}

gitStatus.filterName = "git-status";
