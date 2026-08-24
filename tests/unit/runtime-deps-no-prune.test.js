// Regression: the SQLite and tray runtime installers must persist their package
// to ~/.9router/runtime/package.json instead of using `--no-save`. Both write to
// the same runtime dir, so a `--no-save` install marks the other's package as
// "extraneous" and npm prunes it — leaving "No SQLite driver available" after the
// tray install removes the just-installed better-sqlite3. Saving keeps both.
//
// Instead of mocking child_process, we put a fake `npm` on PATH that records its
// arguments. This exercises the real spawnSync code path with zero network use.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

let tempDir;
let binDir;
let logFile;
const original = { DATA_DIR: process.env.DATA_DIR, PATH: process.env.PATH };

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-runtime-deps-"));
  binDir = path.join(tempDir, "bin");
  logFile = path.join(tempDir, "npm-calls.log");
  fs.mkdirSync(binDir);
  // Fake npm: append its args to the log and succeed without doing anything.
  const npmStub = path.join(binDir, "npm");
  fs.writeFileSync(npmStub, `#!/bin/sh\necho "$@" >> "${logFile}"\nexit 0\n`);
  fs.chmodSync(npmStub, 0o755);

  process.env.DATA_DIR = tempDir;
  process.env.PATH = `${binDir}${path.delimiter}${original.PATH}`;
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const installLineFor = (pkgPrefix) => {
  if (!fs.existsSync(logFile)) return undefined;
  return fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .find((line) => line.includes("install") && line.includes(pkgPrefix));
};

describe("runtime dep installs are saved, not pruned", () => {
  it.skipIf(process.platform === "win32")(
    "ensureSqliteRuntime saves better-sqlite3 (never --no-save)",
    async () => {
      const { ensureSqliteRuntime } = await import("../../cli/hooks/sqliteRuntime.js");
      ensureSqliteRuntime({ silent: true });

      const line = installLineFor("better-sqlite3");
      expect(line, "expected an npm install for better-sqlite3").toBeTruthy();
      expect(line).not.toContain("--no-save");
      expect(line).toContain("--save-exact");
    }
  );

  it.skipIf(process.platform === "win32")(
    "ensureTrayRuntime saves systray2 (never --no-save)",
    async () => {
      const { ensureTrayRuntime } = await import("../../cli/hooks/trayRuntime.js");
      ensureTrayRuntime({ silent: true });

      const line = installLineFor("systray2");
      expect(line, "expected an npm install for systray2").toBeTruthy();
      expect(line).not.toContain("--no-save");
      expect(line).toContain("--save-exact");
    }
  );
});
