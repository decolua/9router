#!/usr/bin/env node
/**
 * CH-01: diff-scoped fatal lint gate.
 *
 * Runs ESLint in JSON report-only mode (never --fix) on the files changed
 * against the merge-base with the integration branch, then exits non-zero
 * ONLY when at least one severity-2 finding lands on a line that was
 * added or replaced by the diff.
 *
 * Pre-existing lint debt on unchanged lines is intentionally tolerated so
 * CI gates on what the PR introduced instead of the 144-error baseline.
 *
 * Usage:
 *   node scripts/lint-fatal-diff.mjs
 *
 * Exit codes:
 *   0 — no fatal findings on changed lines (clean)
 *   1 — fatal findings on changed lines (gate failed)
 *   2 — tool/infrastructure error (config, merge-base, eslint crash)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const REPO_ROOT = process.cwd();
const ESLINT_BIN = resolvePath(REPO_ROOT, "node_modules/.bin/eslint");

// Paths under which we never lint, even if changed by the diff.
// Keep in sync with eslint.config.mjs globalIgnores.
const EXCLUDED_PATH_PATTERNS = [
	/(^|\/)\.worktrees(\/|$)/,
	/(^|\/)\.next(\/|$)/,
	/(^|\/)\.next-cli-build(\/|$)/,
	/(^|\/)\.atl(\/|$)/,
	/(^|\/)node_modules(\/|$)/,
	/(^|\/)\.git(\/|$)/,
	/(^|\/)coverage(\/|$)/,
	/(^|\/)\.vscode(\/|$)/,
];

// Files we never lint as code (extensions ESLint can't meaningfully lint).
const EXCLUDED_EXTENSIONS = [
	/\.md$/i,
	/\.markdown$/i,
	/\.txt$/i,
	/\.json$/i,
	/\.ya?ml$/i,
	/\.lock$/i,
	/^\.gitignore$/i,
];

const MERGE_BASE_CANDIDATES = [
	"origin/dev",
	"origin/main",
	"origin/master",
	"upstream/dev",
	"upstream/main",
	"upstream/master",
];

function run(
	cmd,
	args,
	{ allowFailure = false, maxBuffer = 64 * 1024 * 1024 } = {},
) {
	const result = spawnSync(cmd, args, {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.error) {
		if (allowFailure)
			return { status: -1, stdout: "", stderr: String(result.error) };
		throw result.error;
	}
	if (!allowFailure && result.status !== 0) {
		throw new Error(
			`command failed (exit ${result.status}): ${cmd} ${args.join(" ")}\n` +
				`stderr: ${result.stderr.slice(0, 2000)}`,
		);
	}
	return {
		status: result.status ?? 0,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function log(message) {
	process.stderr.write(`lint-fatal: ${message}\n`);
}

function isExcluded(filePath) {
	if (EXCLUDED_PATH_PATTERNS.some((re) => re.test(filePath))) return true;
	if (EXCLUDED_EXTENSIONS.some((re) => re.test(filePath))) return true;
	return false;
}

function resolveMergeBase() {
	for (const candidate of MERGE_BASE_CANDIDATES) {
		const { status } = run(
			"git",
			["rev-parse", "--verify", "--quiet", candidate],
			{ allowFailure: true },
		);
		if (status !== 0) continue;
		const { status: mbStatus, stdout: mbOut } = run(
			"git",
			["merge-base", "HEAD", candidate],
			{ allowFailure: true },
		);
		if (mbStatus === 0 && mbOut.trim()) {
			return { ref: candidate, sha: mbOut.trim() };
		}
	}
	// Last-resort fallback: parent commit. This keeps the gate usable on
	// throwaway branches with no remote tracking, but logs a warning so the
	// operator notices.
	const { status: headStatus, stdout: headOut } = run(
		"git",
		["rev-parse", "--verify", "--quiet", "HEAD~1"],
		{ allowFailure: true },
	);
	if (headStatus === 0 && headOut.trim()) {
		return { ref: "HEAD~1", sha: headOut.trim() };
	}
	return null;
}

/**
 * Parse a unified diff into a Map<relativePath, Set<postImageLineNumber>>.
 * We use `-U0` so every hunk line is either + or -, no context. Post-image
 * line numbers for added/replaced lines are tracked here. Deleted lines
 * produce no post-image line numbers (they vanish).
 */
function parseDiffLineNumbers(diffText) {
	const result = new Map();
	let currentFile = null;
	let nextLineNo = 0;

	const lines = diffText.split("\n");
	for (const raw of lines) {
		if (raw.startsWith("diff --git ")) {
			const m = raw.match(/^diff --git a\/(.+) b\/(.+)$/);
			if (m && m[2] !== "/dev/null") {
				currentFile = m[2];
			} else {
				currentFile = null;
			}
			nextLineNo = 0;
			continue;
		}
		// We only care about hunk headers and +/- body lines; skip the rest.
		if (raw.startsWith("@@")) {
			if (!currentFile) {
				nextLineNo = 0;
				continue;
			}
			// Match both "@@ -a +b @@" and "@@ -a,b +c,d @@" with no trailing context.
			const m = raw.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/);
			nextLineNo = m ? parseInt(m[1], 10) : 0;
			continue;
		}
		if (!currentFile || nextLineNo === 0) continue;

		if (raw.startsWith("+")) {
			let set = result.get(currentFile);
			if (!set) {
				set = new Set();
				result.set(currentFile, set);
			}
			set.add(nextLineNo);
			nextLineNo += 1;
		} else if (raw.startsWith("-")) {
			// Removed line: do NOT advance the post-image counter.
		} else if (raw.startsWith(" ")) {
			// Should not happen with -U0, but be defensive.
			nextLineNo += 1;
		}
	}
	return result;
}

function collectChangedFiles(lineMap) {
	const files = [];
	for (const file of lineMap.keys()) {
		if (isExcluded(file)) continue;
		files.push(file);
	}
	files.sort();
	return files;
}

function runEslintJson(files) {
	if (!existsSync(ESLINT_BIN)) {
		log(`eslint binary not found at ${ESLINT_BIN}; aborting.`);
		process.exit(2);
	}
	if (files.length === 0) return [];

	const args = [ESLINT_BIN, "--no-warn-ignored", "--format", "json", ...files];

	// ESLint exits non-zero when findings exist; we still want to parse the
	// JSON on stdout, so allowFailure is set.
	const { status, stdout, stderr } = run("node", args, { allowFailure: true });

	if (stderr && stderr.trim()) {
		// Surface eslint warnings (deprecations, config notes) but don't fail.
		process.stderr.write(stderr);
	}

	if (!stdout || !stdout.trim().startsWith("[")) {
		// No JSON emitted — treat as infra error unless we deliberately passed
		// zero files (already filtered above).
		log(`ESLint produced no JSON output (exit ${status}). Aborting.`);
		process.exit(2);
	}

	try {
		const parsed = JSON.parse(stdout);
		return Array.isArray(parsed) ? parsed : [];
	} catch (err) {
		log(`failed to parse ESLint JSON output: ${err.message}`);
		process.exit(2);
	}
}

function toRepoRelative(absoluteOrRelative) {
	// ESLint returns absolute paths when invoked with absolute CLI args;
	// we always pass relative paths, so a simple check is enough.
	if (absoluteOrRelative.startsWith(REPO_ROOT + "/")) {
		return absoluteOrRelative.slice(REPO_ROOT.length + 1);
	}
	return absoluteOrRelative;
}

function main() {
	const mergeBase = resolveMergeBase();
	if (!mergeBase) {
		log(
			"could not determine a merge-base (no origin/dev, origin/main, origin/master, " +
				"upstream/*, or HEAD~1). Refusing to gate on an empty diff.",
		);
		process.exit(2);
	}
	log(`merge-base = ${mergeBase.sha} (resolved via ${mergeBase.ref})`);

	const { stdout: diffText } = run("git", [
		"diff",
		"--no-color",
		"-U0",
		mergeBase.sha,
	]);
	if (!diffText.trim()) {
		log("empty diff against merge-base; nothing to lint — exiting 0.");
		process.exit(0);
	}

	const lineMap = parseDiffLineNumbers(diffText);
	const changedFiles = collectChangedFiles(lineMap);
	log(
		`diff has ${lineMap.size} file(s), ${changedFiles.length} in lint scope ` +
			`(${lineMap.size - changedFiles.length} excluded by path/extension).`,
	);

	if (changedFiles.length === 0) {
		log("no lintable files changed; exiting 0.");
		process.exit(0);
	}

	const results = runEslintJson(changedFiles);

	// Build a quick lookup from relPath -> Set<line>.
	const lookup = new Map();
	for (const [file, lines] of lineMap.entries()) {
		if (isExcluded(file)) continue;
		lookup.set(file, lines);
	}

	const violations = [];
	let totalFindings = 0;
	for (const fileResult of results) {
		const rel = toRepoRelative(fileResult.filePath);
		const lineSet = lookup.get(rel);
		if (!lineSet) continue;
		for (const msg of fileResult.messages || []) {
			totalFindings += 1;
			if (msg.severity !== 2) continue;
			if (!msg.line) continue;
			if (!lineSet.has(msg.line)) continue;
			violations.push({
				file: rel,
				line: msg.line,
				column: msg.column ?? 0,
				ruleId: msg.ruleId ?? "<rule>",
				message: msg.message,
			});
		}
	}

	log(
		`eslint reported ${totalFindings} total finding(s) across ${changedFiles.length} file(s); ` +
			`${violations.length} severity-2 on changed lines.`,
	);

	if (violations.length > 0) {
		process.stderr.write("\n");
		for (const v of violations) {
			process.stderr.write(
				`  ${v.file}:${v.line}:${v.column}  ${v.ruleId}  ${v.message}\n`,
			);
		}
		process.stderr.write(
			`\nlint-fatal: FAILED — ${violations.length} severity-2 finding(s) on lines added/replaced by this diff.\n`,
		);
		process.exit(1);
	}

	log("PASS — no severity-2 findings on changed lines.");
	process.exit(0);
}

main();
