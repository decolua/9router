// Port of the Vitest/Jest parser + compact formatter
// (rtk/src/cmds/js/vitest_cmd.rs + src/parser/formatter.rs).
//
// Tier 1 parses `--reporter=json` output (a JSON object possibly prefixed by
// package-manager noise), tier 2 reads the plain-text summary line, and
// anything else passes through untouched. Failures are capped at
// VITEST_MAX_FAILURES in the compact view.
import { VITEST_MAX_FAILURES } from "../constants.js";
import { stripAnsi } from "../stripAnsi.js";

const RE_TESTS = /Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed/;
const RE_DURATION = /Duration\s+([\d.]+)(ms|s)/;

// Rust extract_json_object: locate the object around the vitest marker so
// pnpm/dotenv prefixes do not break the parse.
function extractJsonObject(input) {
  const marker = input.indexOf('"numTotalTests"');
  let start = -1;

  if (marker !== -1) {
    start = input.lastIndexOf("{", marker);
  } else {
    const lineStart = input.match(/^[ \t]*\{/m);
    if (lineStart) start = lineStart.index + lineStart[0].indexOf("{");
  }
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }

  return null;
}

function parseJson(input) {
  try {
    return JSON.parse(input);
  } catch {
    const extracted = extractJsonObject(input);
    if (!extracted) return null;
    try {
      return JSON.parse(extracted);
    } catch {
      return null;
    }
  }
}

function resultFromJson(json) {
  if (!json || typeof json.numTotalTests !== "number") return null;

  const failures = [];
  for (const file of Array.isArray(json.testResults) ? json.testResults : []) {
    for (const test of Array.isArray(file?.assertionResults) ? file.assertionResults : []) {
      if (test?.status !== "failed") continue;
      failures.push({
        testName: test.fullName || test.title || "",
        filePath: file?.name || "",
        errorMessage: Array.isArray(test.failureMessages) ? test.failureMessages.join("\n") : "",
      });
    }
  }

  return {
    total: json.numTotalTests,
    passed: typeof json.numPassedTests === "number" ? json.numPassedTests : 0,
    failed: typeof json.numFailedTests === "number" ? json.numFailedTests : 0,
    skipped: typeof json.numPendingTests === "number" ? json.numPendingTests : 0,
    durationMs: null,
    failures,
  };
}

function extractFailuresRegex(output) {
  const lines = output.split("\n");
  const failures = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("[x]") && !line.includes("FAIL")) continue;

    const errorLines = [line];
    i += 1;
    while (i < lines.length && lines[i].startsWith("  ")) {
      errorLines.push(lines[i].trim());
      i += 1;
    }
    i -= 1;

    failures.push({
      testName: errorLines[0],
      filePath: "",
      errorMessage: errorLines.slice(1).join("\n"),
    });
  }

  return failures;
}

// Tier 2: plain-text runner summary (jest/vitest with a custom reporter).
function resultFromText(raw) {
  const clean = stripAnsi(raw);

  let passed = 0;
  let failed = 0;
  const tests = RE_TESTS.exec(clean);
  if (tests) {
    failed = tests[1] ? Number.parseInt(tests[1], 10) : 0;
    passed = Number.parseInt(tests[2], 10);
  }
  const total = passed + failed;
  if (total === 0) return null;

  const duration = RE_DURATION.exec(clean);
  const durationMs = duration
    ? (duration[2] === "ms"
      ? Math.trunc(Number.parseFloat(duration[1]))
      : Math.trunc(Number.parseFloat(duration[1]) * 1000))
    : null;

  return {
    total,
    passed,
    failed,
    skipped: 0,
    durationMs,
    failures: extractFailuresRegex(clean),
  };
}

// Rust TokenFormatter::format_compact for TestResult.
function formatCompact(result) {
  let summary = `PASS (${result.passed}) FAIL (${result.failed})`;
  if (result.skipped > 0) summary += ` skipped (${result.skipped})`;

  const lines = [summary];

  if (result.failures.length > 0) {
    lines.push("");
    result.failures.slice(0, VITEST_MAX_FAILURES).forEach((failure, idx) => {
      lines.push(`${idx + 1}. ${failure.testName}`);
      if (failure.errorMessage.length > 0) {
        for (const line of failure.errorMessage.split("\n")) lines.push(`   ${line}`);
      }
    });
    if (result.failures.length > VITEST_MAX_FAILURES) {
      lines.push(`\n... +${result.failures.length - VITEST_MAX_FAILURES} more failures`);
    }
  }

  if (result.durationMs !== null) lines.push(`\nTime: ${result.durationMs}ms`);

  return lines.join("\n");
}

export function vitest(input) {
  const raw = input || "";

  const result = resultFromJson(parseJson(raw)) || resultFromText(raw);

  // Upstream truncates the unparsable tail to the passthrough limit because a
  // tee copy exists. We have no recall file, so hand the text back untouched:
  // the compressor's never-grow guard then leaves the caller's content intact.
  if (!result) return raw;

  return formatCompact(result);
}

vitest.filterName = "vitest";
