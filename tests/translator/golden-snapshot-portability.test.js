/**
 * The GOLDEN url/header snapshot is committed, so anything machine-specific that
 * leaks into it is committed too — and then the file only matches on the machine
 * that produced it.
 *
 * Cline and Kimi both stamp the host into their headers:
 *   open-sse/shared/clineAuth.js:23  "X-PLATFORM": process.platform
 *   open-sse/shared/clineAuth.js:24  "X-PLATFORM-VERSION": process.version
 *   open-sse/config/appConstants.js:214  deviceName = hostname()
 * and four headers carry the app version (User-Agent, X-CLIENT-VERSION,
 * X-CORE-VERSION, X-Msh-Version), which changes on every release.
 *
 * This guard is what keeps a future `vitest -u` from baking those back in.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SNAP = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__snapshots__",
  "golden-url-header.test.js.snap"
);

const snapshot = fs.readFileSync(SNAP, "utf-8");

describe("golden-url-header snapshot portability", () => {
  it("does not embed the recording machine's hostname", () => {
    const host = os.hostname();
    expect(host.length).toBeGreaterThan(0);
    expect(snapshot).not.toContain(`"X-Msh-Device-Name": "${host}"`);
    expect(snapshot).toContain(`"X-Msh-Device-Name": "<HOST>"`);
  });

  it("does not embed the recording machine's platform or Node version", () => {
    expect(snapshot).not.toContain(`"X-PLATFORM": "${process.platform}"`);
    expect(snapshot).not.toContain(`"X-PLATFORM-VERSION": "${process.version}"`);
    expect(snapshot).toContain(`"X-PLATFORM": "<PLATFORM>"`);
    expect(snapshot).toContain(`"X-PLATFORM-VERSION": "<NODE>"`);
  });

  it("does not embed the app version, which every release bumps", () => {
    const version = createRequire(import.meta.url)("../../package.json").version;
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(snapshot).not.toContain(version);
  });

  it("keeps the app-version headers on the placeholder, not on a release number", () => {
    // Hardcoded third-party client versions (CodeBuddy 2.108.1, claude-cli 2.1.92,
    // grok-shell 0.2.99, kimchi 0.1.50) are part of the contract and stay pinned —
    // they come from source, not from the machine. Only 9router's own version rots.
    for (const header of ["X-CLIENT-VERSION", "X-CORE-VERSION", "X-Msh-Version"]) {
      const values = [...snapshot.matchAll(new RegExp(`"${header}": "([^"]*)"`, "g"))].map((m) => m[1]);
      expect(values.length).toBeGreaterThan(0);
      expect([...new Set(values)]).toEqual(["<VERSION>"]);
    }
    expect(snapshot).toContain(`"User-Agent": "9Router/<VERSION>"`);
  });
});
