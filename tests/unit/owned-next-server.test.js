// The CLI and the app updater used to kill every process titled "next-server", which is every
// Next.js app on the machine. Only a next-server running from this install's app directory is ours.
import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

import * as esm from "../../src/lib/ownedProcess.js";

const require = createRequire(import.meta.url);
const cjs = require("../../cli/src/cli/utils/ownedProcess.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "owned-next-"));
const appDir = path.join(root, "node_modules", "9router", "app");
const otherApp = path.join(root, "other-project");
fs.mkdirSync(path.join(appDir, ".next"), { recursive: true });
fs.mkdirSync(otherApp, { recursive: true });

const children = [];
// A long-lived node process titled like a Next server, started in `cwd`.
function fakeNextServer(cwd) {
  const child = spawn(process.execPath, ["-e", "process.title='next-server (v16.3.4)'; setInterval(()=>{}, 1000)"], { cwd, stdio: "ignore" });
  children.push(child);
  return child;
}
const settle = () => new Promise((r) => setTimeout(r, 300));

afterAll(() => {
  for (const c of children) { try { c.kill("SIGKILL"); } catch {} }
  fs.rmSync(root, { recursive: true, force: true });
});

describe.each([["cli (CommonJS)", cjs], ["app (ESM)", esm]])("processRunsFrom — %s", (_name, mod) => {
  it.skipIf(process.platform === "win32")("claims a next-server running from our app directory", async () => {
    const ours = fakeNextServer(appDir);
    await settle();
    expect(mod.processRunsFrom(ours.pid, appDir)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("claims one running from a subdirectory of the app", async () => {
    const ours = fakeNextServer(path.join(appDir, ".next"));
    await settle();
    expect(mod.processRunsFrom(ours.pid, appDir)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("leaves another project's next-server alone", async () => {
    const theirs = fakeNextServer(otherApp);
    await settle();
    expect(mod.processRunsFrom(theirs.pid, appDir)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("does not mistake a sibling directory with the same prefix", async () => {
    const sibling = `${appDir}-old`;
    fs.mkdirSync(sibling, { recursive: true });
    const theirs = fakeNextServer(sibling);
    await settle();
    expect(mod.processRunsFrom(theirs.pid, appDir)).toBe(false);
  });

  it("says no when the owner cannot be established", () => {
    expect(mod.processRunsFrom(2 ** 22 + 12345, appDir)).toBe(false); // no such pid
    expect(mod.processRunsFrom("", appDir)).toBe(false);
    expect(mod.processRunsFrom(process.pid, "")).toBe(false);
  });

  it("uses the WMI command line on Windows", () => {
    const winApp = "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\9router\\app";
    const ours = `"4242","node C:/Users/me/AppData/Roaming/npm/node_modules/9router/app/server.js"`;
    const theirs = `"4343","node C:\\dev\\shop\\.next\\standalone\\server.js"`;
    expect(mod.processRunsFrom("4242", winApp, { commandLine: ours, platform: "win32" })).toBe(true);
    expect(mod.processRunsFrom("4343", winApp, { commandLine: theirs, platform: "win32" })).toBe(false);
  });

  it("isInside handles equal, nested, sibling and parent paths", () => {
    expect(mod.isInside("/a/app", "/a/app")).toBe(true);
    expect(mod.isInside("/a/app/x", "/a/app")).toBe(true);
    expect(mod.isInside("/a/app-old", "/a/app")).toBe(false);
    expect(mod.isInside("/a", "/a/app")).toBe(false);
  });
});

describe("kill call sites only target our next-server", () => {
  const cli = fs.readFileSync(path.resolve(__dirname, "../../cli/cli.js"), "utf8");
  const updater = fs.readFileSync(path.resolve(__dirname, "../../src/lib/appUpdater.js"), "utf8");

  it("never matches a bare next-server title", () => {
    for (const src of [cli, updater]) {
      expect(src).not.toMatch(/\|\|\s*(cmd|lower|line)\.includes\("next-server"\)\s*[;|)]/);
    }
  });

  it("gates every next-server match on processRunsFrom", () => {
    const gated = /includes\("next-server"\)\s*&&[^\n]*processRunsFrom\(/g;
    expect((cli.match(gated) || []).length).toBe(2);      // Windows + POSIX
    expect((updater.match(gated) || []).length).toBe(2);  // Windows + POSIX
  });
});
