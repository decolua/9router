import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareVersions, evaluateCutover, resolveInstalledRoot } from "../../scripts/cutover-guard.mjs";

describe("cutover guard", () => {
  describe("compareVersions", () => {
    it("orders by numeric segment, not lexically", () => {
      // The regression this guard exists for: lexical compare says "0.5.9" > "0.5.10"
      // and would wave a downgrade through.
      expect(compareVersions("0.5.9", "0.5.10")).toBe(-1);
      expect(compareVersions("0.5.10", "0.5.9")).toBe(1);
    });

    it("treats equal, padded and prerelease-suffixed versions as equal", () => {
      expect(compareVersions("0.5.75", "0.5.75")).toBe(0);
      expect(compareVersions("0.5.75.0", "0.5.75")).toBe(0);
      expect(compareVersions("0.5.76-rc.1", "0.5.76")).toBe(0);
    });
  });

  describe("evaluateCutover", () => {
    it("allows an upgrade and a same-version hot cut", () => {
      expect(
        evaluateCutover({ candidateVersion: "0.5.79", installedVersion: "0.5.75" }).ok,
      ).toBe(true);
      expect(
        evaluateCutover({ candidateVersion: "0.5.75", installedVersion: "0.5.75" }).ok,
      ).toBe(true);
    });

    it("blocks a downgrade of the installed package", () => {
      const verdict = evaluateCutover({ candidateVersion: "0.5.69", installedVersion: "0.5.75" });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toContain("DOWNGRADE");
    });

    it("allows a downgrade only when explicitly overridden", () => {
      expect(
        evaluateCutover({
          candidateVersion: "0.5.69",
          installedVersion: "0.5.75",
          allowDowngrade: true,
        }).ok,
      ).toBe(true);
    });

    it("closes when the install cannot be located, and on a versionless tree", () => {
      // F20 (T1.6 H3): this used to assert `ok === true`. "Nothing installed"
      // and "nothing found" are not the same statement, and treating them as
      // one let the guard wave a downgrade through on any machine whose global
      // prefix was not the personal fallback hardcoded in the old resolver.
      const verdict = evaluateCutover({ candidateVersion: "0.5.69", installedVersion: null });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toMatch(/cannot locate/i);
      // A versionless tree was already closed and stays closed.
      expect(evaluateCutover({ candidateVersion: null, installedVersion: "0.5.75" }).ok).toBe(false);
    });

    it("opens for a declared-clean machine and for an explicit downgrade", () => {
      // The two escape hatches, both of them deliberate operator input.
      expect(
        evaluateCutover({
          candidateVersion: "0.5.69",
          installedVersion: null,
          confirmedAbsent: true,
        }).ok,
      ).toBe(true);
      expect(
        evaluateCutover({
          candidateVersion: "0.5.69",
          installedVersion: null,
          allowDowngrade: true,
        }).ok,
      ).toBe(true);
    });
  });

  describe("resolveInstalledRoot", () => {
    it("prefers the launcher env over every other hint", () => {
      const home = "/home/nobody";
      expect(
        resolveInstalledRoot(
          { NINE_ROUTER_PACKAGE_ROOT: "/srv/9router", HOME: home },
          { home, globalRoots: [], git: () => "" },
        ),
      ).toBe("/srv/9router");
    });

    it("returns null instead of guessing a prefix that holds no install", () => {
      // F20: the old fallback was `~/.hermes/node/lib/node_modules/9router` —
      // a personal path, presented as "the standard global prefix".
      expect(resolveInstalledRoot({ HOME: "/nonexistent-home" }, { home: "/nonexistent-home", globalRoots: [] })).toBeNull();
    });

    it("resolves the real `npm root -g` when the prefix is not the personal path", () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "9router-guard-root-"));
      try {
        const npmRoot = path.join(home, ".local", "lib", "node_modules");
        const installed = path.join(npmRoot, "9router");
        fs.mkdirSync(installed, { recursive: true });
        fs.writeFileSync(
          path.join(installed, "package.json"),
          JSON.stringify({ name: "9router", version: "0.5.75" }),
        );
        expect(resolveInstalledRoot({ HOME: home }, { home, globalRoots: [npmRoot] })).toBe(installed);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });
});
