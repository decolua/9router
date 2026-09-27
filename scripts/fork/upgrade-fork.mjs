#!/usr/bin/env node
/**
 * Moves the fork onto a newer upstream release.
 *
 *   node scripts/fork/upgrade-fork.mjs                 # onto the newest upstream tag
 *   node scripts/fork/upgrade-fork.mjs --to v0.5.85
 *   node scripts/fork/upgrade-fork.mjs --to upstream/master
 *   node scripts/fork/upgrade-fork.mjs --rebase        # replay linearly instead
 *   node scripts/fork/upgrade-fork.mjs --dry-run       # show what would happen
 *   node scripts/fork/upgrade-fork.mjs --finish        # after resolving conflicts by hand
 *
 * Merging is the default. Rebase would replay the fork's commits on top of the
 * new upstream, which reads more cleanly but DROPS the merge commit that shows
 * the fork arriving as one reviewable change — git flattens merges when it
 * replays them. --rebase opts into that if a linear history is preferred.
 *
 * The replay itself is git's 3-way merge — that is the part that survives
 * upstream moving our surrounding lines. Everything here is the scaffolding
 * around it: refuse to run on a dirty tree, tag a rollback point, regenerate
 * what should be regenerated rather than merged, and verify afterwards.
 */
import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import {
  DERIVED_ASSETS,
  FORK_BRANCH,
  PATCHED_FILES,
  REGENERATED_BASELINES,
  UPSTREAM,
} from "./fork-manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const FINISH_ONLY = argv.includes("--finish");
// Merge by default: rebase flattens the merge commit that records the fork
// arriving as one change. "--merge" stays accepted so older notes keep working.
const USE_MERGE = !argv.includes("--rebase");
const target = (() => {
  const index = argv.indexOf("--to");
  return index >= 0 ? argv[index + 1] : null;
})();

function git(args, { allowFail = false, quiet = true } = {}) {
  const run = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (run.status !== 0 && !allowFail) {
    if (!quiet) console.error(run.stdout || "");
    console.error(`git ${args.join(" ")} failed:\n${run.stderr || run.stdout}`);
    process.exit(1);
  }
  return { ok: run.status === 0, out: (run.stdout || "").trim(), err: (run.stderr || "").trim() };
}

function step(title) {
  console.log(`\n── ${title}`);
}

function die(message, extra = "") {
  console.error(`\n✗ ${message}`);
  if (extra) console.error(extra);
  process.exit(1);
}

// A hand-resolved conflict leaves the replay already done; only the
// regenerate-and-verify half is still owed.
if (FINISH_ONLY) {
  const stillConflicted = git(["diff", "--name-only", "--diff-filter=U"], { allowFail: true }).out;
  if (stillConflicted) {
    die("there are still unresolved conflicts.", stillConflicted);
  }
  // --finish does not know which release was targeted; name the nearest
  // upstream tag under HEAD rather than mislabelling it as the branch.
  const nearest = git(["describe", "--tags", "--abbrev=0", "HEAD"], { allowFail: true });
  finish({ ref: nearest.ok && nearest.out ? nearest.out : "the new upstream base" });
  process.exit(0);
}

// ── preflight ───────────────────────────────────────────────────────────────
step("preflight");

// What matters is that HEAD is a branch carrying fork commits — not what that
// branch is called. An exact name match refused every other layout, including
// the ordinary one where the fork simply lives on `master` and upstream is a
// remote. Whether there is anything to replay is reported further down, from
// the commit range rather than from a name.
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).out;
if (branch === "HEAD") {
  die("HEAD is detached.",
    `  git switch ${FORK_BRANCH}\n\nAn upgrade replays commits onto a branch; a detached HEAD has none to move.`);
}
console.log(
  branch === FORK_BRANCH
    ? `  branch: ${branch}`
    : `  branch: ${branch} (manifest records ${FORK_BRANCH}; continuing on this one)`,
);

const dirty = git(["status", "--porcelain", "--untracked-files=no"]).out;
if (dirty) {
  die("the working tree has uncommitted changes.",
    `${dirty}\n\nCommit or stash them — an upgrade replays commits and would otherwise lose work.`);
}
console.log("  working tree: clean");

if (!git(["rev-parse", "--verify", "--quiet", `refs/remotes/${UPSTREAM.remote}/${UPSTREAM.branch}`], { allowFail: true }).ok) {
  console.log(`  adding missing remote "${UPSTREAM.remote}" → ${UPSTREAM.url}`);
  if (!DRY_RUN) git(["remote", "add", UPSTREAM.remote, UPSTREAM.url], { allowFail: true });
}

// ── fetch + pick the target ─────────────────────────────────────────────────
step("fetching upstream");
if (!DRY_RUN) git(["fetch", UPSTREAM.remote, "--tags"], { allowFail: true });

function newestTag() {
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname"]).out.split("\n").filter(Boolean);
  return tags[0] || `${UPSTREAM.remote}/${UPSTREAM.branch}`;
}

const ref = target || newestTag();
if (!git(["rev-parse", "--verify", "--quiet", ref], { allowFail: true }).ok) {
  die(`unknown ref "${ref}".`, `  git tag --list 'v*' --sort=-v:refname | head`);
}
console.log(`  target: ${ref} (${git(["rev-parse", "--short", ref]).out})`);

const incoming = git(["log", "--oneline", `HEAD..${ref}`]).out;
if (!incoming) {
  console.log(`\n✓ already up to date with ${ref} — nothing to replay.`);
  process.exit(0);
}
const count = incoming.split("\n").length;
console.log(`  ${count} upstream commit(s) to take:`);
for (const line of incoming.split("\n").slice(0, 10)) console.log(`    ${line}`);
if (count > 10) console.log(`    … and ${count - 10} more`);

const ourCommits = git(["log", "--oneline", `${ref}..HEAD`]).out;
console.log(`  ${ourCommits ? ourCommits.split("\n").length : 0} fork commit(s) to replay`);
if (!ourCommits) {
  // Nothing of the fork is on this branch. Replaying would be a no-op that
  // silently leaves the operator on plain upstream, believing they upgraded.
  die("this branch carries no commits of its own — there is no fork here to replay.",
    `  git branch -a        # find the branch holding the fork\n  git switch ${FORK_BRANCH}`);
}

if (DRY_RUN) {
  console.log("\n(--dry-run: stopping before touching anything)");
  process.exit(0);
}

// ── rollback point ──────────────────────────────────────────────────────────
step("rollback point");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const backup = `fork-backup/${stamp}`;
git(["branch", backup, "HEAD"]);
console.log(`  ${backup} → ${git(["rev-parse", "--short", "HEAD"]).out}`);
console.log(`  undo at any point with:  git ${USE_MERGE ? "merge --abort" : "rebase --abort"}  ||  git reset --hard ${backup}`);

// ── replay ──────────────────────────────────────────────────────────────────
step(USE_MERGE ? `merging ${ref}` : `rebasing onto ${ref}`);
const replay = USE_MERGE
  ? git(["merge", "--no-edit", ref], { allowFail: true })
  : git(["rebase", ref], { allowFail: true });

if (!replay.ok) {
  const conflicted = git(["diff", "--name-only", "--diff-filter=U"], { allowFail: true }).out
    .split("\n").filter(Boolean);

  console.error(`\n✗ ${USE_MERGE ? "merge" : "rebase"} stopped on conflicts:\n`);
  for (const file of conflicted) {
    const known = PATCHED_FILES.find((entry) => entry.path === file);
    console.error(`  ${file}`);
    if (known) console.error(`      → ${known.hint}`);
    else console.error("      → not a known fork integration point; take upstream's version unless you know otherwise.");
  }
  console.error(
    "\nResolve, then:\n"
    + `  git add <files> && git ${USE_MERGE ? "commit" : "rebase --continue"}\n`
    + "  node scripts/fork/upgrade-fork.mjs --finish\n"
    + `\nOr abandon: git ${USE_MERGE ? "merge --abort" : "rebase --abort"}\n`
    + "\nPer-file guidance: UPGRADE.md\n",
  );
  process.exit(1);
}
console.log(`  ${USE_MERGE ? "merged" : "rebased"} cleanly`);

finish({ ref, backup });

// ── post-upgrade: regenerate, then verify ───────────────────────────────────
function finish({ ref = "the target", backup = null } = {}) {
  step("regenerating derived files");
  for (const { from, to } of DERIVED_ASSETS) {
    const source = join(ROOT, from);
    const dest = join(ROOT, to);
    if (existsSync(dest)) continue;
    if (!existsSync(source)) {
      console.log(`  skip ${to} (upstream no longer has ${from})`);
      continue;
    }
    copyFileSync(source, dest);
    console.log(`  ${to} ← ${from}`);
  }

  for (const { file, command } of REGENERATED_BASELINES) {
    const run = spawnSync(command[0], command[1], { cwd: ROOT, encoding: "utf8" });
    if (run.status === 0) console.log(`  ${file} regenerated`);
    else console.log(`  ${file} could NOT be regenerated: ${(run.stderr || "").trim().split("\n").pop()}`);
  }
  console.log("  (baselines are snapshots — upstream adds providers too, so they are rebuilt, not merged)");

  step("verifying");
  const verify = spawnSync(process.execPath, [join(ROOT, "scripts/fork/verify-fork.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (verify.status !== 0) {
    console.error(
      "\n✗ upgrade replayed but verification failed — the fork is not fully wired up.\n"
      + `  Inspect, fix, and re-run: node scripts/fork/verify-fork.mjs\n`
      + (backup ? `  Or roll back:             git reset --hard ${backup}\n` : ""),
    );
    process.exit(1);
  }

  console.log(
    `\n✓ upgraded to ${ref} with the fork intact.\n`
    + `  Baselines were regenerated — review and commit them:\n`
    + `    git add tests/__baseline__ public/providers && git commit -m "chore(fork): rebuild baselines for ${ref}"\n`
    + (backup ? `  Rollback branch kept: ${backup}\n` : ""),
  );
}
