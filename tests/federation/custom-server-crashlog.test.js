// DF-9ROUTER-3 — crash/boot/shutdown JSONL logging in custom-server.js.
//
// An OOM kill (SIGKILL, exit 137) leaves no catchable signal, so the wrapper
// appends one JSONL record per lifecycle event to <DATA_DIR>/logs/crash.log:
// `boot` at startup, `shutdown` on SIGINT/SIGTERM, `uncaughtException` /
// `unhandledRejection` on crashes. A `boot` record with no following record
// = abnormal death (OOM/SIGKILL) — that boot-vs-shutdown gap is the
// diagnostic this task adds.
//
// Spawned-child pattern (custom-server-boot.test.js): importing
// custom-server.js into the vitest module context would leak its top-level
// http.createServer monkeypatch into the test runner, so every path is
// exercised by spawning `node custom-server.js` from a temp dir with a stub
// server.js (Docker-layout equivalence) and DATA_DIR pointed at a temp dir.
// The TEST-ONLY NINEROUTER_CRASH_TEST env hook (throw/reject/sigterm)
// triggers each crash path synchronously after boot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CUSTOM_SERVER = path.join(REPO_ROOT, "custom-server.js");

let tempDir;
let dataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-crashlog-"));
  dataDir = path.join(tempDir, "data");
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function crashLogPath() {
  return path.join(dataDir, "logs", "crash.log");
}

function readCrashLog() {
  const logPath = crashLogPath();
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

// Boot the wrapper in Docker-layout equivalence (stub server.js next to
// custom-server.js, per custom-server-boot.test.js) with DATA_DIR pointed at
// the temp dir. crashTest maps to the NINEROUTER_CRASH_TEST test-only hook.
function bootChild(crashTest) {
  fs.copyFileSync(CUSTOM_SERVER, path.join(tempDir, "custom-server.js"));
  const marker = path.join(tempDir, "required.marker");
  fs.writeFileSync(
    path.join(tempDir, "server.js"),
    `require("fs").writeFileSync(process.env.MARKER_PATH, "required");\n` +
      // Keep the event loop briefly alive (a real Next server listens, so
      // its loop never drains): Node DROPS a self-sent signal when the loop
      // is empty at delivery, which would make the sigterm crash-test child
      // exit 0 without the shutdown record. 300ms then lets the child exit.
      `setTimeout(() => {}, 300);\n`
  );
  const env = { ...process.env, DATA_DIR: dataDir, MARKER_PATH: marker };
  if (crashTest) env.NINEROUTER_CRASH_TEST = crashTest;
  const res = spawnSync(process.execPath, ["custom-server.js"], {
    cwd: tempDir,
    env,
    encoding: "utf8",
    timeout: 15000,
  });
  return { res, marker };
}

describe("custom-server.js crash log — boot record", () => {
  it("appends a `boot` JSONL record to <DATA_DIR>/logs/crash.log at startup", () => {
    const { res, marker } = bootChild();
    expect(res.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(true); // server.js required (booted)

    const records = readCrashLog();
    expect(records).toHaveLength(1);
    const boot = records[0];
    expect(boot.event).toBe("boot");
    expect(typeof boot.pid).toBe("number");
    expect(boot.argv).toBe("custom-server.js");
    expect(boot.dataDir).toBe(dataDir);
    expect(Number.isNaN(Date.parse(boot.ts))).toBe(false); // ISO timestamp
  });

  it("creates the logs/ dir lazily under a fresh DATA_DIR", () => {
    expect(fs.existsSync(path.join(dataDir, "logs"))).toBe(false);
    const { res } = bootChild();
    expect(res.status).toBe(0);
    expect(fs.existsSync(crashLogPath())).toBe(true);
  });
});

describe("custom-server.js crash log — crash paths (NINEROUTER_CRASH_TEST hook)", () => {
  it("throw: exits non-zero and logs an uncaughtException record with the thrown message", () => {
    const { res } = bootChild("throw");
    expect(res.status).not.toBe(0);
    expect(res.status).toBe(1);
    expect(res.signal).toBeNull(); // died by exit(1), not by signal

    const records = readCrashLog();
    expect(records.map((r) => r.event)).toEqual(["boot", "uncaughtException"]);
    const crash = records[1];
    expect(crash.message).toContain("NINEROUTER_CRASH_TEST throw");
    expect(crash.name).toBe("Error");
    expect(crash.stack).toContain("NINEROUTER_CRASH_TEST throw");
    expect(typeof crash.pid).toBe("number");
    expect(Number.isNaN(Date.parse(crash.ts))).toBe(false);
  });

  it("reject: exits non-zero and logs an unhandledRejection record with the rejection reason", () => {
    const { res } = bootChild("reject");
    expect(res.status).not.toBe(0);
    expect(res.status).toBe(1);

    const records = readCrashLog();
    expect(records.map((r) => r.event)).toEqual(["boot", "unhandledRejection"]);
    const crash = records[1];
    expect(crash.message).toContain("NINEROUTER_CRASH_TEST reject");
    expect(crash.stack).toContain("NINEROUTER_CRASH_TEST reject");
  });
});

describe("custom-server.js crash log — shutdown records", () => {
  it("SIGTERM: exits 0 and logs a shutdown record (boot→shutdown = clean stop)", () => {
    const { res, marker } = bootChild("sigterm");
    expect(fs.existsSync(marker)).toBe(true); // booted before the signal
    expect(res.status).toBe(0);
    expect(res.signal).toBeNull(); // handled the signal, clean exit(0)

    const records = readCrashLog();
    expect(records.map((r) => r.event)).toEqual(["boot", "shutdown"]);
    expect(records[1].signal).toBe("SIGTERM");
    expect(typeof records[1].pid).toBe("number");
  });
});

describe("custom-server.js crash log — fail-open guarantee", () => {
  it("an unwritable DATA_DIR (a file, not a dir) must not block or crash the boot", () => {
    // Point DATA_DIR at a regular FILE: mkdirSync(<file>/logs) throws
    // ENOTDIR. The crash logger swallows it (fail-open) and the boot
    // proceeds normally.
    fs.writeFileSync(dataDir, "not a directory");
    const { res, marker } = bootChild("throw");
    expect(res.status).toBe(1); // crash-test exit, NOT a crashlog failure
    expect(fs.existsSync(marker)).toBe(true); // server.js still required
    expect(res.stderr).toMatch(/\[crashlog\] write failed:/);
    // No log file could be written — and nothing else broke.
    expect(fs.existsSync(crashLogPath())).toBe(false);
  });
});
