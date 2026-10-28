// Port of filter_phpunit_output (rtk/src/cmds/php/phpunit_cmd.rs).
//
// Emits the aggregate `Tests:/Assertions:/Failures:` counts plus at most
// PHPUNIT_MAX_FAILURES failures, each with its first two detail lines. Dot
// progress and headers are dropped. ANSI and control bytes are stripped first
// because `--colors=always` otherwise defeats every anchor.
import { PHPUNIT_MAX_DETAIL_LINES, PHPUNIT_MAX_FAILURES } from "../constants.js";
import { stripAnsiAndControls } from "../stripAnsi.js";

// PHPUnit prints failure headings as "N) Class::method". Anchor to that shape so
// detail lines starting with a digit and ')' do not split a block.
const RE_FAILURE_HEADING = /^\d+\) \S/;

function parseCounts(output) {
  const counts = { tests: 0, assertions: 0, failures: 0, errors: 0, skipped: 0 };

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("Tests:")) continue;

    for (const part of trimmed.split(",")) {
      const [key = "", rawValue = ""] = part.trim().split(/\s+/);
      const value = Number.parseInt(rawValue.replace(/\.$/, ""), 10);
      const count = Number.isNaN(value) ? 0 : value;

      if (key === "Tests:") counts.tests = count;
      else if (key === "Assertions:") counts.assertions = count;
      else if (key.startsWith("Failures")) counts.failures += count;
      else if (key.startsWith("Errors")) counts.errors += count;
      else if (key.startsWith("Skipped")) counts.skipped = count;
    }
  }

  return counts;
}

function buildSuccessWithSkipped(output) {
  const counts = parseCounts(output);
  return counts.skipped > 0
    ? `PHPUnit: ${counts.tests} tests, ${counts.assertions} assertions, ${counts.skipped} skipped`
    : `PHPUnit: ${counts.tests} tests, ${counts.assertions} assertions`;
}

function buildSummary(output, failures) {
  const counts = parseCounts(output);

  let result = `PHPUnit: ${counts.tests} tests, ${counts.assertions} assertions, ${counts.failures} failures`;
  if (counts.errors > 0) result += `, ${counts.errors} errors`;
  result += "\n";

  for (const failureLines of failures.slice(0, PHPUNIT_MAX_FAILURES)) {
    if (failureLines.length > 0) result += `\n${failureLines[0]}\n`;
    for (const detail of failureLines.slice(1, 1 + PHPUNIT_MAX_DETAIL_LINES)) {
      result += `  ${detail}\n`;
    }
  }

  if (failures.length > PHPUNIT_MAX_FAILURES) {
    result += `\n... +${failures.length - PHPUNIT_MAX_FAILURES} more failures\n`;
  }

  return result.trim();
}

export function phpunit(input) {
  const output = stripAnsiAndControls(input || "");
  const failures = [];
  let current = [];
  let inFailures = false;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("OK (")) return `PHPUnit: ${trimmed}`;

    if (trimmed.startsWith("OK, but")) return buildSuccessWithSkipped(output);

    if (
      (trimmed.startsWith("There was") || trimmed.startsWith("There were")) &&
      (trimmed.includes("failure") || trimmed.includes("error"))
    ) {
      inFailures = true;
      continue;
    }

    if (trimmed === "FAILURES!" || trimmed === "ERRORS!") {
      if (current.length > 0) failures.push(current);
      current = [];
      inFailures = false;
      continue;
    }

    if (!inFailures) continue;

    if (RE_FAILURE_HEADING.test(trimmed)) {
      if (current.length > 0) failures.push(current);
      current = [trimmed];
    } else if (trimmed.length > 0) {
      current.push(trimmed);
    }
  }

  if (current.length > 0) failures.push(current);

  if (failures.length === 0) {
    const counts = parseCounts(output);
    if (counts.tests > 0) {
      return `PHPUnit: ${counts.tests} tests, ${counts.assertions} assertions`;
    }
    return "PHPUnit: ok";
  }

  return buildSummary(output, failures);
}

phpunit.filterName = "phpunit";
