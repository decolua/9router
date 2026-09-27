#!/usr/bin/env node
/**
 * Writes the whole fork out as one git patch against an upstream ref, for the
 * case where there is no fork branch to rebase — a fresh clone of upstream, or
 * a machine that only has the release tarball's git history.
 *
 *   node scripts/fork/export-patch.mjs                 # against the merge-base with upstream
 *   node scripts/fork/export-patch.mjs --base v0.5.81
 *   node scripts/fork/export-patch.mjs --out /tmp/fork.patch
 *
 * Apply it on a fresh checkout with a 3-way merge, which tolerates upstream
 * having moved the surrounding lines:
 *
 *   git apply --3way fork.patch
 *
 * A plain `git apply` is deliberately not suggested: it needs exact context and
 * fails on the first upstream edit near one of our hunks.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { UPSTREAM } from "./fork-manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(args, { allowFail = false } = {}) {
  const run = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (run.status !== 0 && !allowFail) {
    console.error(`git ${args.join(" ")} failed:\n${run.stderr || run.stdout}`);
    process.exit(1);
  }
  return (run.stdout || "").trim();
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const outPath = flag("--out", join(ROOT, "fork.patch"));
let base = flag("--base");

if (!base) {
  const upstreamRef = `${UPSTREAM.remote}/${UPSTREAM.branch}`;
  const hasUpstream = git(["rev-parse", "--verify", "--quiet", upstreamRef], { allowFail: true });
  if (!hasUpstream) {
    console.error(
      `No ${upstreamRef}. Add it first:\n  git remote add ${UPSTREAM.remote} ${UPSTREAM.url}\n  git fetch ${UPSTREAM.remote} --tags`,
    );
    process.exit(1);
  }
  base = git(["merge-base", "HEAD", upstreamRef]);
}

// Untracked files would be silently left out of the patch, which is the one
// failure mode that produces a patch that applies cleanly and still breaks.
const untracked = git(["ls-files", "--others", "--exclude-standard"])
  .split("\n")
  .filter((line) => line && !line.startsWith(".omc/"));
if (untracked.length) {
  console.error("These files are untracked and would be missing from the patch:\n");
  for (const file of untracked) console.error(`  ${file}`);
  console.error("\nCommit them to the fork branch first (see UPGRADE.md).");
  process.exit(1);
}

const patch = git(["diff", "--binary", `${base}...HEAD`]);
if (!patch) {
  console.error(`No difference between ${base} and HEAD — nothing to export.`);
  process.exit(1);
}

writeFileSync(outPath, `${patch}\n`, "utf8");

const stat = git(["diff", "--stat", `${base}...HEAD`]).split("\n").pop();
console.log(`Wrote ${outPath}`);
console.log(`  base:    ${base} (${git(["describe", "--tags", "--always", base], { allowFail: true }) || "no tag"})`);
console.log(`  content: ${stat}`);
console.log("\nApply on a fresh upstream checkout with:\n  git apply --3way fork.patch");
