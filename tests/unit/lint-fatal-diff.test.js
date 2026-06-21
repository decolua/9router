/**
 * CH-01 QA tests for scripts/lint-fatal-diff.mjs
 *
 * Tests the diff-scoped fatal lint gate behavior:
 * - Path and extension exclusion logic
 * - Unified diff line-number parser
 * - Script exit codes (clean, fatal finding, infra error)
 *
 * Since the script cannot be modified, pure logic functions are
 * reimplemented here to match the script's behavior exactly.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Pure logic reimplementations (mirrors scripts/lint-fatal-diff.mjs)
// ---------------------------------------------------------------------------

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

const EXCLUDED_EXTENSIONS = [
	/\.md$/i,
	/\.markdown$/i,
	/\.txt$/i,
	/\.json$/i,
	/\.ya?ml$/i,
	/\.lock$/i,
	/^\.gitignore$/i,
];

function isExcluded(filePath) {
	if (EXCLUDED_PATH_PATTERNS.some((re) => re.test(filePath))) return true;
	if (EXCLUDED_EXTENSIONS.some((re) => re.test(filePath))) return true;
	return false;
}

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
		if (raw.startsWith("@@")) {
			if (!currentFile) {
				nextLineNo = 0;
				continue;
			}
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
			nextLineNo += 1;
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Tests: isExcluded — path patterns
// ---------------------------------------------------------------------------

describe("isExcluded — path patterns", () => {
	const cases = [
		// Should be excluded
		["node_modules/foo.js", true],
		[".worktrees/main/foo.js", true],
		["packages/.worktrees/nested/file.js", true],
		[".next/server/foo.js", true],
		[".atl/config.yml", true],
		["coverage/lcov.info", true],
		[".vscode/settings.json", true],
		["foo/node_modules/bar/baz.js", true],

		// Should NOT be excluded
		["src/foo.js", false],
		["packages/worktrees/foo.js", false], // "worktrees" not ".worktrees"
		["packages/worktrees/foo.js", false],
		["src/next.js", false], // "next" not ".next"
		["src/atlast.js", false], // "atl" not ".atl"
		["src/worktrees.js", false], // same
		["src/vscode.js", false],
		["lib/utils.js", false],
		["scripts/lint.js", false],
		["open-sse/foo.js", false],
		["cloud/src/handler.js", false],
	];

	it.each(cases)("path %s → excluded: %s", (filePath, expected) => {
		expect(isExcluded(filePath)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Tests: isExcluded — extension patterns
// ---------------------------------------------------------------------------

describe("isExcluded — extension patterns", () => {
	const cases = [
		// Should be excluded
		["README.md", true],
		["CHANGELOG.md", true],
		["docs/readme.markdown", true],
		["notes.txt", true],
		["package.json", true],
		[".eslintrc.json", true],
		["config.yaml", true],
		["config.yml", true],
		["docker-compose.yaml", true],
		["package-lock.json", true],
		["yarn.lock", true],
		[".gitignore", true],
		["src/data.json", true], // .json IS excluded
		["src/config.json", true], // .json IS excluded

		// Should NOT be excluded
		["src/foo.js", false],
		["src/bar.ts", false],
		["src/component.jsx", false],
		["src/styles.css", false],
		["script.ts", false], // Not a standard extension
		["config.js", false],
	];

	it.each(cases)("file %s → excluded: %s", (filePath, expected) => {
		expect(isExcluded(filePath)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Tests: parseDiffLineNumbers
// ---------------------------------------------------------------------------

describe("parseDiffLineNumbers", () => {
	it("parses added lines from a simple hunk", () => {
		const diff = `diff --git a/src/foo.js b/src/foo.js
index 1234567..abcdefg 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
 const z = 3;`;

		const result = parseDiffLineNumbers(diff);
		// The hunk starts at line 1 (+ side), so the + line is at line 2
		expect(result.get("src/foo.js")).toEqual(new Set([2]));
	});

	it("parses multiple added lines in a hunk", () => {
		const diff = `diff --git a/src/foo.js b/src/foo.js
index 1234567..abcdefg 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,5 +1,7 @@
 const x = 1;
+const a = 1;
 const y = 2;
+const b = 2;
 const z = 3;`;

		const result = parseDiffLineNumbers(diff);
		expect(result.get("src/foo.js")).toEqual(new Set([2, 4]));
	});

	it("handles multiple hunks in same file", () => {
		const diff = `diff --git a/src/foo.js b/src/foo.js
index 1234567..abcdefg 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,3 +1,4 @@
 const x = 1;
+const a = 1;
 const y = 2;
@@ -5,3 +6,4 @@
 const z = 3;
 const w = 4;
+const b = 2;`;

		const result = parseDiffLineNumbers(diff);
		// First hunk: +a at line 2
		// Second hunk: header +6, +b is 3rd line in hunk → 6+2=8
		expect(result.get("src/foo.js")).toEqual(new Set([2, 8]));
	});

	it("handles multiple files", () => {
		const diff = `diff --git a/src/foo.js b/src/foo.js
index 1234567..abcdefg 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
diff --git a/src/bar.js b/src/bar.js
index 7654321..gfedcba 100644
--- a/src/bar.js
+++ b/src/bar.js
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;`;

		const result = parseDiffLineNumbers(diff);
		expect(result.get("src/foo.js")).toEqual(new Set([2]));
		expect(result.get("src/bar.js")).toEqual(new Set([2]));
	});

	it("skips removed lines (no post-image line)", () => {
		const diff = `diff --git a/src/foo.js b/src/foo.js
index 1234567..abcdefg 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,4 +1,3 @@
 const x = 1;
-const old = 0;
 const y = 2;
 const z = 3;`;

		const result = parseDiffLineNumbers(diff);
		// Removed lines don't produce post-image line numbers
		expect(result.get("src/foo.js")).toBeUndefined();
	});

	it("handles new files (from /dev/null)", () => {
		const diff = `diff --git a/src/newfile.js b/src/newfile.js
new file mode 100644
index 0000000..abcdefg
--- /dev/null
+++ b/src/newfile.js
@@ -0,0 +1,3 @@
+const x = 1;
+const y = 2;
+const z = 3;`;

		const result = parseDiffLineNumbers(diff);
		expect(result.get("src/newfile.js")).toEqual(new Set([1, 2, 3]));
	});

	it("handles empty diff", () => {
		const result = parseDiffLineNumbers("");
		expect(result.size).toBe(0);
	});

	it("skips binary file markers", () => {
		const diff = `diff --git a/src/binary.png b/src/binary.png
new file mode 100644
index 0000000..abcdefg
Binary files /dev/null and b/src/binary.png differ`;

		const result = parseDiffLineNumbers(diff);
		// Binary files have no line numbers
		expect(result.get("src/binary.png")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Tests: integration — script exit codes via child process
// ---------------------------------------------------------------------------

describe("lint-fatal-diff.mjs — integration", () => {
	// Path from tests/ directory: go up to project root
	const scriptPath = path.resolve(
		__dirname,
		"../../scripts/lint-fatal-diff.mjs",
	);
	// CWD for script execution (project root)
	const projectRoot = path.resolve(__dirname, "../..");

	const forbiddenFixtureRoots = [
		"/home/cortexos/Developer/github.com/bloodf/9router",
		"/home/cortexos/Developer/github.com/bloodf/9router-agent-worktrees",
	];

	/**
	 * Run the script via spawnSync and capture output.
	 * Returns { status, output }
	 */
	function runScript(cwd = projectRoot) {
		const result = spawnSync("node", [scriptPath], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		// The script writes to stderr, so combine both streams
		const output = (result.stdout || "") + (result.stderr || "");
		return { status: result.status, output };
	}

	function expectCommandSuccess(cwd, cmd, args) {
		const result = spawnSync(cmd, args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		expect(
			result.status,
			`${cmd} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		).toBe(0);
	}

	function expectFixtureOutsideRepos(fixtureRoot) {
		const resolved = path.resolve(fixtureRoot);
		expect(resolved.startsWith("/tmp/")).toBe(true);
		for (const forbiddenRoot of forbiddenFixtureRoots) {
			expect(resolved.startsWith(forbiddenRoot)).toBe(false);
		}
	}

	it("exits 1 when a severity-2 lint finding is on an added line", () => {
		let fixtureRoot;
		try {
			fixtureRoot = mkdtempSync("/tmp/ch01-lint-fatal-test.");
			expectFixtureOutsideRepos(fixtureRoot);

			const fixtureNodeModules = path.join(fixtureRoot, "node_modules");
			const projectNodeModules = path.join(projectRoot, "node_modules");
			expect(existsSync(path.join(projectNodeModules, ".bin/eslint"))).toBe(
				true,
			);
			symlinkSync(projectNodeModules, fixtureNodeModules, "dir");

			writeFileSync(
				path.join(fixtureRoot, "eslint.config.mjs"),
				`export default [
	{
		files: ["**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
		},
		rules: {
			"no-undef": "error",
		},
	},
];
`,
			);
			mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });
			writeFileSync(path.join(fixtureRoot, "src/fatal.js"), "const ok = 1;\n");

			// Keep the fixture git repository outside all source repos/worktrees.
			expectFixtureOutsideRepos(fixtureRoot);
			expectCommandSuccess(fixtureRoot, "git", ["init"]);
			expectCommandSuccess(fixtureRoot, "git", [
				"config",
				"user.email",
				"ch01-test@example.invalid",
			]);
			expectCommandSuccess(fixtureRoot, "git", [
				"config",
				"user.name",
				"CH-01 Test",
			]);
			expectCommandSuccess(fixtureRoot, "git", [
				"add",
				"eslint.config.mjs",
				"src/fatal.js",
			]);
			expectCommandSuccess(fixtureRoot, "git", ["commit", "-m", "base"]);

			writeFileSync(
				path.join(fixtureRoot, "src/fatal.js"),
				"const ok = 1;\nconst stillOk = ok;\n",
			);
			expectCommandSuccess(fixtureRoot, "git", ["add", "src/fatal.js"]);
			expectCommandSuccess(fixtureRoot, "git", ["commit", "-m", "second"]);

			writeFileSync(
				path.join(fixtureRoot, "src/fatal.js"),
				"const ok = 1;\nconst stillOk = ok;\nmissingSymbol;\n",
			);

			const { status, output } = runScript(fixtureRoot);
			expect(output).toContain("resolved via HEAD~1");
			expect(output).toContain("no-undef");
			expect(output).toContain("FAILED");
			expect(status).toBe(1);
		} finally {
			if (fixtureRoot) {
				rmSync(fixtureRoot, { recursive: true, force: true });
			}
		}
	});

	it("exits 0 on clean diff (no fatal findings)", () => {
		const { status, output } = runScript();
		expect(status).toBe(0);
		expect(output).toContain("PASS");
	});

	it("reports merge-base in output", () => {
		const { output } = runScript();
		expect(output).toMatch(/merge-base = [a-f0-9]+/);
	});

	it("reports file counts in output", () => {
		const { output } = runScript();
		expect(output).toMatch(/diff has \d+ file\(s\)/);
		expect(output).toMatch(/\d+ in lint scope/);
	});
});

// ---------------------------------------------------------------------------
// Tests: collectChangedFiles (exclusion integration)
// ---------------------------------------------------------------------------

describe("collectChangedFiles — filtering", () => {
	// Simulate what the script does
	function collectChangedFiles(lineMap) {
		const files = [];
		for (const file of lineMap.keys()) {
			if (isExcluded(file)) continue;
			files.push(file);
		}
		files.sort();
		return files;
	}

	it("filters out .worktrees paths", () => {
		const lineMap = new Map([
			["src/foo.js", new Set([1, 2, 3])],
			[".worktrees/main/script.js", new Set([1])],
			["lib/utils.js", new Set([5])],
		]);

		const result = collectChangedFiles(lineMap);
		expect(result).toEqual(["lib/utils.js", "src/foo.js"]);
	});

	it("filters out excluded extensions", () => {
		const lineMap = new Map([
			["src/foo.js", new Set([1])],
			["README.md", new Set([1])],
			["package.json", new Set([1])],
			["src/bar.ts", new Set([2])],
		]);

		const result = collectChangedFiles(lineMap);
		expect(result).toEqual(["src/bar.ts", "src/foo.js"]);
	});

	it("returns empty array when all files excluded", () => {
		const lineMap = new Map([
			[".git/config", new Set([1])],
			["node_modules/lodash/index.js", new Set([1])],
			["README.md", new Set([1])],
		]);

		const result = collectChangedFiles(lineMap);
		expect(result).toEqual([]);
	});
});
