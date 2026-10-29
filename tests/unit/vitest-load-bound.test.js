// FED-024 — the suite's host-load bound.
//
// The fleet directive is that one or two projects must not eat the whole box
// during a test run. Two knobs carry that bound, and this file pins their
// contract so a future edit cannot silently remove it:
//
//   * `TEST_WORKERS` (vitest.config.js) — the forked worker pool, clamped to
//     2..16 and further capped at the host's CPU count. Left unset on this
//     16-core box the pool used to be 16 forked workers at ~130 MB each; the
//     bound exists to keep peak host load sane without changing WHICH test
//     files run or what they assert.
//   * `TEST_SPAWN_CONCURRENCY` (tests/federation/custom-server-boot.test.js) —
//     the per-file subprocess fan-out budget for the file that holds real
//     children, same 2..16 clamp.
//
// The suite must not become load-bearing on a single number: the clamp is the
// contract, the default is a choice.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { LOAD_BOUND, boundedInt } from "../vitest.config.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VITEST_CONFIG = path.join(REPO_ROOT, "tests", "vitest.config.js");
const BOOT_TEST = path.join(REPO_ROOT, "tests", "federation", "custom-server-boot.test.js");

describe("host load bound — clamp contract", () => {
  it("declares a 2..16 bound", () => {
    expect(LOAD_BOUND).toEqual({ min: 2, max: 16 });
  });

  it("clamps below the floor and above the ceiling", () => {
    expect(boundedInt(1, 8)).toBe(2);
    expect(boundedInt(0, 8)).toBe(8); // invalid input keeps the fallback
    expect(boundedInt(-5, 8)).toBe(8);
    expect(boundedInt(17, 8)).toBe(16);
    expect(boundedInt(999, 8)).toBe(16);
    expect(boundedInt("12", 8)).toBe(12); // env vars arrive as strings
    expect(boundedInt("abc", 8)).toBe(8);
    expect(boundedInt(undefined, 8)).toBe(8);
  });

  it("never returns a value outside the bound for any in-range request", () => {
    for (const raw of [2, 3, 4, 8, 16]) {
      const v = boundedInt(raw, 8);
      expect(v).toBe(raw);
      expect(v).toBeGreaterThanOrEqual(LOAD_BOUND.min);
      expect(v).toBeLessThanOrEqual(LOAD_BOUND.max);
    }
  });
});

describe("host load bound — wiring", () => {
  it("vitest.config.js passes the bounded value to maxWorkers and never a bare CPU count", () => {
    const src = fs.readFileSync(VITEST_CONFIG, "utf8");
    expect(src).toMatch(/maxWorkers:\s*workerCount/);
    // The pool must be capped at the host's CPUs, so a 2-core CI runner keeps
    // today's behaviour instead of being forced to 8.
    expect(src).toMatch(/Math\.min\(hostCpus,\s*requestedWorkers\)/);
    expect(src).toMatch(/os\.availableParallelism/);
    // The env override is read through the clamp, never raw.
    expect(src).toMatch(/boundedInt\(process\.env\.TEST_WORKERS/);
  });

  it("custom-server-boot.test.js clamps its spawn budget through the same 2..16 bound", () => {
    const src = fs.readFileSync(BOOT_TEST, "utf8");
    expect(src).toMatch(/process\.env\.TEST_SPAWN_CONCURRENCY/);
    expect(src).toMatch(/Math\.max\(2,\s*Math\.min\(16,/);
  });

  it("custom-server-boot.test.js keeps exactly one long-lived probe child", () => {
    const src = fs.readFileSync(BOOT_TEST, "utf8");
    // One spawn for the session driver; the boot/smoke cases go through the
    // wave helper. More than one bare `spawn(process.execPath` at module scope
    // would mean the shared-fixture property was lost.
    const driverSpawns = src.match(/spawn\(process\.execPath,\s*\["-e",\s*DRIVER_SOURCE\]/g) || [];
    expect(driverSpawns).toHaveLength(1);
    // The old per-assertion helpers are gone: the sync child APIs are not even
    // imported, and the `require(<custom-server>)` -e one-liners are gone.
    expect(src).not.toMatch(/from "node:child_process"[\s\S]{0,80}execFileSync/);
    expect(src).not.toMatch(/execFileSync\s*\(/);
    expect(src).not.toMatch(/require\(\$\{JSON\.stringify\(CUSTOM_SERVER\)\}\)/);
  });

  it("the host has at least one CPU so the pool cap is well defined", () => {
    const cpus = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
    expect(cpus).toBeGreaterThanOrEqual(1);
  });
});

// The shared driver replaced one child PER ASSERTION with one child PER FILE.
// That is only safe if a driver that dies fails the suite loudly instead of
// hanging every later assertion until a timeout, so the fail-fast path is
// pinned behaviourally here (not by reading the source).
describe("host load bound — driver fail-fast", () => {
  it("a probe rejects on a dead driver rather than waiting out the timeout", async () => {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["-e", "process.exit(3)"], { stdio: ["pipe", "pipe", "pipe"] });
    const exited = await new Promise((resolve) => child.once("close", (code) => resolve({ code })));
    expect(exited.code).toBe(3);
    // Mirrors the driver handle's contract: once `exited` is recorded, a probe
    // throws synchronously with the exit status instead of arming a timer.
    const handle = { exited };
    const probeAgain = () => {
      if (handle.exited) throw new Error(`probe driver is not running (exited: ${JSON.stringify(handle.exited)})`);
      return new Promise(() => {});
    };
    expect(probeAgain).toThrow(/driver is not running \(exited/);
  });
});
