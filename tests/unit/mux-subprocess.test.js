import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempDir;
let previousNpmCli;
let previousNpmPrefix;
let previousCallLog;
let previousDataDir;

beforeEach(() => {
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mux-process-"));
  previousNpmCli = process.env.NINEROUTER_NPM_CLI;
  previousNpmPrefix = process.env.MUX_TEST_NPM_PREFIX;
  previousCallLog = process.env.MUX_TEST_NPM_CALL_LOG;
  previousDataDir = process.env.DATA_DIR;

  const prefix = path.join(tempDir, "prefix");
  const entry = path.join(prefix, "node_modules", "mux", "dist", "cli", "index.js");
  const npmCli = path.join(tempDir, "fake-npm-cli.cjs");
  const callLog = path.join(tempDir, "calls.log");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "// fake mux entry\n", "utf8");
  fs.writeFileSync(npmCli, [
    "const fs = require('fs');",
    "fs.appendFileSync(process.env.MUX_TEST_NPM_CALL_LOG, process.argv.slice(2).join(' ') + '\\n');",
    "process.stdout.write(process.env.MUX_TEST_NPM_PREFIX + '\\n');",
  ].join("\n"), "utf8");

  process.env.NINEROUTER_NPM_CLI = npmCli;
  process.env.MUX_TEST_NPM_PREFIX = prefix;
  process.env.MUX_TEST_NPM_CALL_LOG = callLog;
  process.env.DATA_DIR = path.join(tempDir, "data");
});

afterEach(() => {
  if (previousNpmCli === undefined) delete process.env.NINEROUTER_NPM_CLI;
  else process.env.NINEROUTER_NPM_CLI = previousNpmCli;
  if (previousNpmPrefix === undefined) delete process.env.MUX_TEST_NPM_PREFIX;
  else process.env.MUX_TEST_NPM_PREFIX = previousNpmPrefix;
  if (previousCallLog === undefined) delete process.env.MUX_TEST_NPM_CALL_LOG;
  else process.env.MUX_TEST_NPM_CALL_LOG = previousCallLog;
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Mux subprocess handling", () => {
  it("uses npm's Node entry directly and caches repeated global-entry probes", async () => {
    const { getMuxGlobalEntry, deleteMux } = await import("@/lib/muxManager.js");

    const first = getMuxGlobalEntry();
    const second = getMuxGlobalEntry();
    expect(second).toEqual(first);
    expect(first.fullPath).toBe(path.join(process.env.MUX_TEST_NPM_PREFIX, "node_modules", "mux", "dist", "cli", "index.js"));
    expect(fs.readFileSync(process.env.MUX_TEST_NPM_CALL_LOG, "utf8").trim().split("\n")).toEqual(["prefix -g"]);

    // Uninstall invalidates the cache.  The fake CLI is a plain JS file, so
    // this also proves it was invoked through process.execPath rather than a
    // Windows npm.cmd shell wrapper.
    deleteMux();
    getMuxGlobalEntry();
    expect(fs.readFileSync(process.env.MUX_TEST_NPM_CALL_LOG, "utf8").trim().split("\n")).toEqual([
      "prefix -g",
      "uninstall -g mux --ignore-scripts",
      "prefix -g",
    ]);
  });
});
