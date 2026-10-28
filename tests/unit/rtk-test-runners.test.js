import { describe, it, expect } from "vitest";
import { tsc } from "../../open-sse/rtk/filters/tsc.js";
import { vitest } from "../../open-sse/rtk/filters/vitest.js";
import { phpunit } from "../../open-sse/rtk/filters/phpunit.js";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";

describe("tsc filter", () => {
  it("groups diagnostics by file with counts and top codes", () => {
    const input = [
      "src/server/api/auth.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/server/api/auth.ts(15,10): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
      "src/components/Button.tsx(8,3): error TS2339: Property 'onClick' does not exist on type 'ButtonProps'.",
      "src/components/Button.tsx(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "",
      "Found 4 errors in 2 files."
    ].join("\n");

    const out = tsc(input);
    expect(out).toContain("TypeScript: 4 errors in 2 files");
    expect(out).toContain("Top codes: TS2322 (2x)");
    expect(out).toContain("src/server/api/auth.ts (2 errors)");
    expect(out).toContain("src/components/Button.tsx (2 errors)");
    expect(out).toMatch(/ {2}L12: TS2322 Type 'string' is not assignable/);
    // tsc's own trailer is replaced, not repeated
    expect(out).not.toContain("Found 4 errors");
  });

  it("parses --pretty ANSI diagnostics and keeps indented context", () => {
    const input = [
      "\x1b[96msrc/index.ts\x1b[0m:\x1b[93m3\x1b[0m:\x1b[93m1\x1b[0m - \x1b[91merror\x1b[0m\x1b[90m TS2304: \x1b[0mCannot find name 'foo'.",
      "  const x = foo();",
      "            ~~~"
    ].join("\n");

    const out = tsc(input);
    expect(out).toContain("TypeScript: 1 errors in 1 files");
    expect(out).toContain("src/index.ts (1 errors)");
    expect(out).toContain("L3: TS2304 Cannot find name 'foo'.");
    expect(out).toContain("    const x = foo();");
    expect(out).not.toContain("\x1b[");
  });

  it("reports file-less diagnostics in a global bucket", () => {
    const out = tsc("error TS5023: Unknown compiler option 'foo'.");
    expect(out).toContain("TypeScript: 1 errors");
    expect(out).toContain("global (1 errors)");
    expect(out).toContain("TS5023 Unknown compiler option 'foo'.");
  });

  it("reports a clean run", () => {
    expect(tsc("Found 0 errors.\n")).toBe("TypeScript: No errors found");
  });
});

describe("vitest filter", () => {
  it("parses JSON output, including prefixed package-manager noise", () => {
    const json = {
      numTotalTests: 3,
      numPassedTests: 2,
      numFailedTests: 1,
      numPendingTests: 1,
      testResults: [
        {
          name: "src/a.test.js",
          assertionResults: [
            { fullName: "adds numbers", status: "failed", failureMessages: ["expected 3 to be 4"] },
            { fullName: "works", status: "passed", failureMessages: [] }
          ]
        }
      ]
    };
    const input = `Scope: all 6 workspace projects\n${JSON.stringify(json)}\n`;

    const out = vitest(input);
    expect(out).toContain("PASS (2) FAIL (1) skipped (1)");
    expect(out).toContain("1. adds numbers");
    expect(out).toContain("   expected 3 to be 4");
    expect(out).not.toContain("Scope:");
    expect(out).not.toContain("numTotalTests");
  });

  it("falls back to the text summary and duration", () => {
    const input = [
      " Test Files  1 failed | 2 passed (3)",
      "      Tests  1 failed | 12 passed (13)",
      "   Duration  450ms",
      " FAIL  src/a.test.js > adds numbers",
      "  AssertionError: expected 3 to be 4"
    ].join("\n");

    const out = vitest(input);
    expect(out).toContain("PASS (12) FAIL (1)");
    expect(out).toContain("Time: 450ms");
    expect(out).toContain("AssertionError: expected 3 to be 4");
  });

  it("caps surfaced failures and counts the rest", () => {
    const json = {
      numTotalTests: 8,
      numPassedTests: 0,
      numFailedTests: 8,
      testResults: [
        {
          name: "src/a.test.js",
          assertionResults: Array.from({ length: 8 }, (_, i) => ({
            fullName: `fails ${i}`,
            status: "failed",
            failureMessages: ["boom"]
          }))
        }
      ]
    };

    const out = vitest(JSON.stringify(json));
    expect(out).toContain("5. fails 4");
    expect(out).not.toContain("6. fails 5");
    expect(out).toContain("+3 more failures");
  });

  it("passes unparsable output through untouched instead of truncating it", () => {
    const input = '{"numTotalTests": not-json}';
    expect(vitest(input)).toBe(input);
  });
});

describe("phpunit filter", () => {
  it("compacts a passing run", () => {
    const input = [
      "PHPUnit 10.5.0 by Sebastian Bergmann and contributors.",
      "",
      "...                                                                 3 / 3 (100%)",
      "",
      "Time: 00:00.012, Memory: 6.00 MB",
      "",
      "OK (3 tests, 5 assertions)"
    ].join("\n");

    expect(phpunit(input)).toBe("PHPUnit: OK (3 tests, 5 assertions)");
  });

  it("keeps counts and two detail lines per failure", () => {
    const input = [
      "PHPUnit 10.5.0 by Sebastian Bergmann and contributors.",
      "",
      ".F                                                                  2 / 2 (100%)",
      "",
      "There was 1 failure:",
      "",
      "1) Tests\\MathTest::testAdd",
      "Expected 4 but got 5.",
      "Failed asserting that 5 is identical to 4.",
      "",
      "/app/tests/MathTest.php:15",
      "",
      "FAILURES!",
      "Tests: 2, Assertions: 2, Failures: 1."
    ].join("\n");

    const out = phpunit(input);
    expect(out).toContain("PHPUnit: 2 tests, 2 assertions, 1 failures");
    expect(out).toContain("1) Tests\\MathTest::testAdd");
    expect(out).toContain("  Expected 4 but got 5.");
    expect(out).toContain("  Failed asserting that 5 is identical to 4.");
    expect(out).not.toContain("/app/tests/MathTest.php:15");
    expect(out).not.toContain("contributors");
  });

  it("strips ANSI colors from the result line", () => {
    const input = "PHPUnit 10.5.0 by Sebastian Bergmann and contributors.\n\x1b[30;42mOK (1 test, 1 assertion)\x1b[0m\n";
    expect(phpunit(input)).toBe("PHPUnit: OK (1 test, 1 assertion)");
  });

  it("reports failures and errors separately", () => {
    const input = [
      "There was 1 error:",
      "",
      "1) Tests\\BoomTest::testBoom",
      "RuntimeException: boom",
      "",
      "ERRORS!",
      "Tests: 4, Assertions: 6, Failures: 1, Errors: 1."
    ].join("\n");

    const out = phpunit(input);
    expect(out).toContain("PHPUnit: 4 tests, 6 assertions, 1 failures, 1 errors");
  });
});

describe("autoDetectFilter detects test-runner output", () => {
  it("detects tsc diagnostics (default and pretty layouts)", () => {
    expect(autoDetectFilter("src/a.ts(1,2): error TS2322: nope").filterName).toBe("tsc");
    expect(autoDetectFilter("src/a.ts:1:2 - error TS2322: nope").filterName).toBe("tsc");
  });

  it("detects vitest JSON and text summaries", () => {
    expect(autoDetectFilter('{"numTotalTests": 1}').filterName).toBe("vitest");
    expect(autoDetectFilter("  Test Files  1 passed (1)\n      Tests  3 passed (3)").filterName).toBe("vitest");
  });

  it("detects PHPUnit by banner and by counts", () => {
    expect(autoDetectFilter("PHPUnit 10.5.0 by Sebastian Bergmann and contributors.").filterName).toBe("phpunit");
    expect(autoDetectFilter("Tests: 2, Assertions: 4, Failures: 1.").filterName).toBe("phpunit");
  });

  it("prefers the test runner over build-output when both signatures appear", () => {
    const input = [
      "      Tests  1 failed | 2 passed (3)",
      "ERROR: something inside the failure detail"
    ].join("\n");
    expect(autoDetectFilter(input).filterName).toBe("vitest");
  });
});
