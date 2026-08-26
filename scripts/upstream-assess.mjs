#!/usr/bin/env node
/**
 * Assess upstream commits against this fork before any of them are merged.
 *
 * The operator's merge policy, stated 2026-08-23, in their words:
 *
 *   1. not deliberately merging commit without assessing it
 *   2. if our fix in our usecase should persist then it wins
 *   3. if there are official features that already handled our improvement or
 *      fix, choose the official. if it still needs adjustments or fixes, still
 *      choose the official. and start fixing from the official feature.
 *
 * (2) and (3) do not contradict: (2) applies only where no official equivalent
 * exists. So the whole job of this script is to work out, for each incoming
 * commit, whether an official equivalent exists — and it deliberately does NOT
 * decide that itself. Deciding whether upstream's change "already handles" ours
 * is a judgement about intent, and a file-overlap heuristic that pretended
 * otherwise would silently discard our work under the banner of rule 3.
 *
 * What it does instead is make the judgement cheap and evidenced: for every
 * upstream commit it reports which files it touches, whether WE have touched
 * those same files, and exactly which of our commits did — so the reviewer
 * reads two subjects side by side rather than re-deriving the fork's history.
 *
 * Commits touching nothing we own are marked CLEAN. Those are the ones rule 1
 * costs nothing on, and the workflow merges them without ceremony.
 *
 * Output: JSON on stdout, and a Markdown report on stderr-free stdout when
 * --markdown is passed. Exit 0 always; "nothing to do" is not a failure.
 */

import { execFileSync } from "node:child_process";

const MARKDOWN = process.argv.includes("--markdown");
const BASE = process.env.FORK_BRANCH || "inyund";
const UPSTREAM = process.env.UPSTREAM_REF || "upstream/master";

// Paths that are ours by definition and can never be "handled upstream" — they
// do not exist there. Overlap on these is not a signal, so reporting it would
// mark almost every commit as contended and train the reviewer to skim.
const FORK_ONLY = [
  /^tuner\//,
  /^\.scratch\//,
  /^\.omo\//,
  /^docs\/adr\//,
  /^CONTEXT\.md$/,
  /^CLAUDE\.md$/,
  /^src\/middleware\.js$/,
  /^scripts\/upstream-assess\.mjs$/,
  /^\.github\/workflows\/upstream-sync\.yml$/,
];

// Files every release touches. Overlap here is guaranteed and means nothing
// about whether a change collides in substance.
const NOISE = [/^CHANGELOG\.md$/, /^package(-lock)?\.json$/, /^README/];

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const lines = (s) => (s ? s.split("\n").filter(Boolean) : []);
const matches = (path, res) => res.some((re) => re.test(path));

function main() {
  const incoming = lines(git("rev-list", "--reverse", `${BASE}..${UPSTREAM}`));
  if (incoming.length === 0) {
    emit({ upstream: UPSTREAM, base: BASE, incoming: 0, clean: [], contended: [] });
    return;
  }

  // Every file this fork has changed relative to the merge base, mapped to the
  // commits that changed it. Built once — it is the same answer for every
  // incoming commit, and `git log` per file per commit is what made the first
  // version of this take minutes.
  const mergeBase = git("merge-base", BASE, UPSTREAM);
  const ourFiles = new Map();
  for (const sha of lines(git("rev-list", `${mergeBase}..${BASE}`))) {
    const subject = git("log", "-1", "--format=%h %s", sha);
    for (const f of lines(git("show", "--pretty=", "--name-only", sha))) {
      if (!ourFiles.has(f)) ourFiles.set(f, []);
      const list = ourFiles.get(f);
      if (list.length < 5) list.push(subject); // most recent five is plenty to judge by
    }
  }

  const clean = [];
  const contended = [];
  for (const sha of incoming) {
    const subject = git("log", "-1", "--format=%s", sha);
    const author = git("log", "-1", "--format=%an", sha);
    const date = git("log", "-1", "--format=%ad", "--date=short", sha);
    const files = lines(git("show", "--pretty=", "--name-only", sha));

    const overlaps = files
      .filter((f) => ourFiles.has(f))
      .filter((f) => !matches(f, FORK_ONLY))
      .filter((f) => !matches(f, NOISE))
      .map((f) => ({ file: f, ourCommits: ourFiles.get(f) }));

    const entry = { sha: sha.slice(0, 8), subject, author, date, files: files.length };
    if (overlaps.length === 0) clean.push(entry);
    else contended.push({ ...entry, overlaps });
  }

  emit({ upstream: UPSTREAM, base: BASE, incoming: incoming.length, clean, contended });
}

function emit(result) {
  if (!MARKDOWN) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  const out = [];
  out.push(`## Upstream sync — ${result.incoming} new commit(s) on \`${result.upstream}\``);
  out.push("");
  if (result.incoming === 0) {
    out.push("Nothing to merge.");
    process.stdout.write(out.join("\n") + "\n");
    return;
  }

  out.push(`**${result.clean.length} clean** — touch no file this fork has modified. Rule 1 is satisfied by`);
  out.push("inspection: there is no fork change for them to override, so nothing has to be decided.");
  out.push("");
  for (const c of result.clean) out.push(`- \`${c.sha}\` ${c.subject} — ${c.author}, ${c.date}`);
  out.push("");

  if (result.contended.length === 0) {
    out.push("**0 contended.** Merge is mechanical.");
  } else {
    out.push(`**${result.contended.length} contended** — these touch files this fork has changed. Each one needs`);
    out.push("the operator's rule applied, and the script does not apply it for you:");
    out.push("");
    out.push("- If upstream's change **already handles** what our commit was for → take upstream, even if it");
    out.push("  needs further work. Fix forward from theirs, do not reinstate ours. *(rule 3)*");
    out.push("- If it does **not** → keep ours. *(rule 2)*");
    out.push("");
    out.push("Read the two subjects side by side before deciding; file overlap alone does not mean either.");
    out.push("");
    for (const c of result.contended) {
      out.push(`### \`${c.sha}\` ${c.subject}`);
      out.push(`${c.author}, ${c.date} · ${c.files} file(s) changed`);
      out.push("");
      for (const o of c.overlaps) {
        out.push(`- \`${o.file}\` — ours: ${o.ourCommits.map((x) => `\`${x}\``).join(", ")}`);
      }
      out.push("");
    }
  }
  process.stdout.write(out.join("\n") + "\n");
}

main();
