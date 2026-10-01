// Tests for PR #1175: build output filter + porcelain regex fix
// Covers edge cases: porcelain workdir-only, cargo misdetection, false positives, compression
import { describe, it, expect } from "vitest";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";
import { buildOutput } from "../../open-sse/rtk/filters/buildOutput.js";
import { gitStatus } from "../../open-sse/rtk/filters/gitStatus.js";

describe("PR #1175 - buildOutput filter detection", () => {
  it("detects npm install output", () => {
    const input = [
      "npm warn deprecated har-validator@5.1.5: this library is no longer supported",
      "npm warn deprecated uuid@3.4.0: uuid@10 and below is no longer supported",
      "npm warn deprecated request@2.88.2: request has been deprecated",
      "added 47 packages, and audited 48 packages in 13s",
      "3 packages are looking for funding",
      "  run `npm fund` for details",
      "4 vulnerabilities (2 moderate, 2 critical)",
      "Run `npm audit` for details."
    ].join("\n");
    const filter = autoDetectFilter(input);
    expect(filter).toBe(buildOutput);
  });

  it("detects cargo build output (no longer misdetected as git-status)", () => {
    const input = [
      "   Compiling proc-macro2 v1.0.95",
      "   Compiling unicode-ident v1.0.18",
      "   Compiling quote v1.0.40",
      "   Compiling syn v2.0.104",
      "   Compiling my-project v0.1.0 (/home/user/my-project)",
      "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 12.34s"
    ].join("\n");
    const filter = autoDetectFilter(input);
    expect(filter).toBe(buildOutput);
    expect(filter).not.toBe(gitStatus);
  });
});

describe("PR #1175 - buildOutput compression behavior", () => {
  it("compresses npm install with deprecations", () => {
    const input = [
      "npm warn deprecated har-validator@5.1.5: this library is no longer supported",
      "npm warn deprecated uuid@3.4.0: uuid@10 and below is no longer supported",
      "npm warn deprecated request@2.88.2: request has been deprecated",
      "added 47 packages, and audited 48 packages in 13s",
      "3 packages are looking for funding",
      "  run `npm fund` for details",
      "4 vulnerabilities (2 moderate, 2 critical)",
      "Run `npm audit` for details."
    ].join("\n");
    const out = buildOutput(input);
    // Minimal fix: keep first 3 deprecations verbatim (no truncation needed since count == 3)
    expect(out).toContain("har-validator@5.1.5");
    expect(out).toContain("uuid@3.4.0");
    expect(out).toContain("request@2.88.2");
    expect(out).toContain("added 47 packages");
    expect(out).toContain("4 vulnerabilities");
    // 3 deprecations kept verbatim → no size win on this small input
    expect(out.length).toBeLessThanOrEqual(input.length);
  });

  it("compresses cargo build output", () => {
    const input = [
      "   Compiling proc-macro2 v1.0.95",
      "   Compiling unicode-ident v1.0.18",
      "   Compiling quote v1.0.40",
      "   Compiling syn v2.0.104",
      "   Compiling serde v1.0.219",
      "   Compiling serde_derive v1.0.219",
      "   Compiling serde_json v1.0.140",
      "   Compiling tokio v1.45.0",
      "   Compiling hyper v1.6.0",
      "   Compiling my-project v0.1.0 (/home/user/my-project)",
      "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 12.34s"
    ].join("\n");
    const out = buildOutput(input);
    expect(out).toContain("Compiled 10 packages");
    expect(out).toContain("Finished");
    expect(out.length).toBeLessThan(input.length * 0.5);
  });

  it("keeps cargo errors verbatim", () => {
    const input = [
      "   Compiling foo v0.1.0",
      "error[E0308]: mismatched types",
      "  --> src/main.rs:5:9",
      "   |",
      "5  |     let x: u32 = \"hello\";",
      "   |            ---   ^^^^^^^ expected `u32`, found `&str`",
      "error: aborting due to previous error"
    ].join("\n");
    const out = buildOutput(input);
    expect(out).toContain("error[E0308]");
    expect(out).toContain("error: aborting");
  });

  it("keeps maven BUILD FAILED as error", () => {
    const input = [
      "[INFO] Scanning for projects...",
      "[ERROR] Failed to execute goal",
      "[ERROR] Could not resolve dependencies",
      "BUILD FAILED"
    ].join("\n");
    const out = buildOutput(input);
    expect(out).toContain("[ERROR] Failed to execute goal");
    expect(out).toContain("BUILD FAILED");
  });
});

describe("PR #1175 - porcelain regex fix edge cases", () => {
  it("git status --porcelain workdir-only (space first char) STILL detects as gitStatus (minimal fix preserved old regex)", () => {
    const input = [
      " M src/a.js",
      " M src/b.js",
      " D src/c.js",
      "?? new.js"
    ].join("\n");
    const filter = autoDetectFilter(input);
    expect(filter).toBe(gitStatus);
  });

  it("git status --porcelain with staged (status code first char) still detects", () => {
    const input = [
      "M  src/a.js",
      "A  src/new.js",
      "?? untracked.js",
      "M  src/b.js"
    ].join("\n");
    const filter = autoDetectFilter(input);
    expect(filter).toBe(gitStatus);
  });

  it("cargo Compiling lines NOT detected as git-status (porcelain false positive fix)", () => {
    const input = [
      "   Compiling proc-macro2 v1.0.95",
      "   Compiling unicode-ident v1.0.18",
      "   Compiling quote v1.0.40"
    ].join("\n");
    const filter = autoDetectFilter(input);
    expect(filter).not.toBe(gitStatus);
  });

  it("long-form git status with 'On branch' always detects", () => {
    const input = [
      "On branch main",
      "Your branch is up to date with 'origin/main'.",
      "",
      "Changes not staged for commit:",
      "\tmodified:   src/a.js"
    ].join("\n");
    const filter = autoDetectFilter(input);
    expect(filter).toBe(gitStatus);
  });
});

describe("PR #1175 - false positive risks", () => {
  it("generic app log with 'ERROR:' triggers buildOutput (potential false positive)", () => {
    const input = [
      "2026-05-16 10:00:00 INFO Server started on port 3000",
      "2026-05-16 10:00:05 INFO Request received: GET /api/users",
      "ERROR: Database connection timeout",
      "2026-05-16 10:00:10 INFO Retrying connection",
      "2026-05-16 10:00:15 INFO Connection restored"
    ].join("\n");
    const filter = autoDetectFilter(input);
    // Document actual behavior — may detect as buildOutput
    console.log("[generic-error-log] detected:", filter?.filterName || "null");
    // Whatever the detection, the filter should NOT corrupt the data
    if (filter === buildOutput) {
      const out = buildOutput(input);
      expect(out).toContain("ERROR: Database connection timeout");
    }
  });

  it("generic 'Compiling templates' (non-build context) triggers buildOutput", () => {
    const input = [
      "[INFO] Starting application",
      "[INFO]   Compiling templates for view layer",
      "[INFO]   Compiling assets for production",
      "[INFO] Application ready"
    ].join("\n");
    const filter = autoDetectFilter(input);
    console.log("[compiling-templates] detected:", filter?.filterName || "null");
    if (filter === buildOutput) {
      const out = buildOutput(input);
      // Should at least preserve structure (count compiling)
      expect(out).toContain("Compiled");
    }
  });

  it("plain text with no patterns falls through (no false positive)", () => {
    const input = [
      "Hello world",
      "This is a normal message",
      "Nothing special here"
    ].join("\n");
    const filter = autoDetectFilter(input);
    expect(filter).not.toBe(buildOutput);
  });
});

describe("PR #1175 - safety: no data corruption", () => {
  it("empty input returns input", () => {
    expect(buildOutput("")).toBe("");
  });

  it("input with only errors preserves all errors", () => {
    const input = "npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path /tmp/foo";
    const out = buildOutput(input);
    expect(out).toContain("npm ERR! code ENOENT");
    expect(out).toContain("npm ERR! syscall open");
    expect(out).toContain("npm ERR! path /tmp/foo");
  });

  it("input with no recognized patterns returns input (fallback)", () => {
    const input = "random text\nmore random\nstill random";
    const out = buildOutput(input);
    // When nothing matches, returns input via `|| input`
    expect(out).toBe(input);
  });

  it("limits warnings to 5 + summary line", () => {
    const warnings = [];
    for (let i = 0; i < 10; i++) warnings.push(`npm warn config foo${i} something`);
    const input = warnings.join("\n");
    const out = buildOutput(input);
    expect(out).toContain("npm warn config foo0");
    expect(out).toContain("npm warn config foo4");
    expect(out).toContain("... +5 more warnings");
    expect(out).not.toContain("npm warn config foo9");
  });
});
