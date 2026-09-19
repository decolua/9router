// F20 — cutover-guard must not wave a pack through because it could not find
// the install (T1.6 H3), and it must judge the artifact that is actually
// packed, `cli/package.json`, not the dashboard's (T1.6 H2).
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const {
  detectInstalls,
  resolveInstalledRoot,
  evaluateCutover,
  planPreflight,
  installedRootCandidates,
  npmGlobalRoots,
} = await import("../../scripts/cutover-guard.mjs");

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function mkTmp(prefix = "9router-f20-guard-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** A fake HOME / fake npm root holding an installed `9router` at `version`. */
function installAt(root, relDir, { version = "0.5.75", name = "9router" } = {}) {
  const dir = path.join(root, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }, null, 2));
  return dir;
}

function fakeRepo({ cliVersion = "0.5.75", rootVersion = "0.5.75" } = {}) {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, "cli"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "9router-app", version: rootVersion }));
  fs.writeFileSync(path.join(root, "cli", "package.json"), JSON.stringify({ name: "9router", version: cliVersion }));
  return root;
}

describe("detectInstalls (H3)", () => {
  it("finds the install behind the real `npm root -g`", () => {
    const home = mkTmp();
    const npmRoot = path.join(home, ".local", "lib", "node_modules");
    const installed = installAt(npmRoot, "9router", { version: "0.5.75-enhanced.1" });

    const result = detectInstalls({ HOME: home }, { home, globalRoots: [npmRoot] });
    expect(result.installs.map((i) => i.root)).toContain(installed);
    expect(result.installs[0].version).toBe("0.5.75-enhanced.1");
    expect(result.installs[0].source).toMatch(/npm/);
  });

  it("covers the common prefixes (nvm, ~/.local, .hermes, /usr/local) by heuristic", () => {
    const home = mkTmp();
    installAt(home, ".nvm/versions/node/v22.1.0/lib/node_modules/9router", { version: "0.5.74" });
    installAt(home, ".nvm/versions/node/v20.19.0/lib/node_modules/9router", { version: "0.5.72" });
    installAt(home, ".local/lib/node_modules/9router", { version: "0.5.75" });
    installAt(home, ".hermes/node/lib/node_modules/9router", { version: "0.5.73" });
    installAt(home, ".volta/lib/node_modules/9router", { version: "0.5.71" });

    const result = detectInstalls({ HOME: home }, { home, globalRoots: [] });
    const versions = result.installs.map((i) => i.version).sort();
    expect(versions).toEqual(["0.5.71", "0.5.72", "0.5.73", "0.5.74", "0.5.75"]);
    // Highest version wins the ordering, so the guard compares against it.
    expect(result.installs[0].version).toBe("0.5.75");
    expect(result.highestInstalledVersion).toBe("0.5.75");
  });

  it("honours NINE_ROUTER_PACKAGE_ROOT and reports a pointer that leads nowhere", () => {
    const home = mkTmp();
    const pointed = installAt(home, "srv/9router", { version: "0.5.70" });
    const explicit = detectInstalls(
      { HOME: home, NINE_ROUTER_PACKAGE_ROOT: pointed },
      { home, globalRoots: [] },
    );
    expect(explicit.installs).toHaveLength(1);
    expect(explicit.installs[0].source).toBe("NINE_ROUTER_PACKAGE_ROOT");

    const dangling = detectInstalls(
      { HOME: home, NINE_ROUTER_PACKAGE_ROOT: "/definitely/not/here" },
      { home, globalRoots: [] },
    );
    expect(dangling.installs).toEqual([]);
    expect(dangling.confirmedAbsent).toBe(false);
    expect(dangling.broken.join("|")).toContain("/definitely/not/here");
  });

  it("`none` is the only declaration that a machine is genuinely clean", () => {
    const home = mkTmp();
    const declared = detectInstalls({ HOME: home, NINE_ROUTER_PACKAGE_ROOT: "none" }, { home, globalRoots: [] });
    expect(declared.installs).toEqual([]);
    expect(declared.confirmedAbsent).toBe(true);

    const undeclared = detectInstalls({ HOME: home }, { home, globalRoots: [] });
    expect(undeclared.installs).toEqual([]);
    expect(undeclared.confirmedAbsent).toBe(false);
  });

  it("reads the launcher state file when it exists and keeps hunting when it is stale", () => {
    const home = mkTmp();
    const real = installAt(home, ".local/lib/node_modules/9router", { version: "0.5.75" });
    fs.mkdirSync(path.join(home, ".9router"), { recursive: true });
    fs.writeFileSync(path.join(home, ".9router", "9router-package-root"), "/gone/away\n");

    const result = detectInstalls({ HOME: home }, { home, globalRoots: [] });
    expect(result.installs.map((i) => i.root)).toContain(real);
    expect(result.stalePointers.join("|")).toContain("/gone/away");
  });

  it("resolveInstalledRoot returns a located root, or null (never a guess)", () => {
    const home = mkTmp();
    const installed = installAt(home, ".local/lib/node_modules/9router", { version: "0.5.75" });
    expect(resolveInstalledRoot({ HOME: home }, { home, globalRoots: [] })).toBe(installed);
    expect(resolveInstalledRoot({ HOME: mkTmp() }, { home: mkTmp(), globalRoots: [] })).toBeNull();
  });

  it("lists candidate shapes without touching the filesystem", () => {
    const candidates = installedRootCandidates({ home: "/h", globalRoots: ["/npmroot"], platform: "linux" });
    const joined = candidates.join("\n");
    expect(joined).toContain("/npmroot/9router");
    expect(joined).toContain("/h/.local/lib/node_modules/9router");
    expect(joined).toContain("/h/.nvm/versions/node");
    expect(joined).toContain("/usr/local/lib/node_modules/9router");
  });
});

describe("npmGlobalRoots (H3)", () => {
  it("asks npm for the root and the prefix without grafting node_modules twice", () => {
    const answers = {
      "root -g": "/home/u/.local/lib/node_modules\n",
      "prefix -g": "/home/u/.local\n",
    };
    const roots = npmGlobalRoots({}, { exec: (args) => answers[args.join(" ")] });
    expect(roots).toContain("/home/u/.local/lib/node_modules");
    expect(roots).toContain("/home/u/.local");
    expect(roots).toContain(path.join("/home/u/.local", "lib", "node_modules"));
    expect(roots).not.toContain(path.join("/home/u/.local/lib/node_modules", "lib", "node_modules"));
  });

  it("degrades to no global roots when npm is unavailable", () => {
    expect(npmGlobalRoots({}, { exec: () => "" })).toEqual([]);
  });
});

describe("evaluateCutover is fail-closed (H3)", () => {
  it("blocks when no installed package could be located", () => {
    const verdict = evaluateCutover({ candidateVersion: "0.5.75", installedVersion: null });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/cannot locate/i);
    expect(verdict.reason).toMatch(/NINE_ROUTER_PACKAGE_ROOT/);
  });

  it("opens only on an explicit declaration or an explicit downgrade", () => {
    expect(
      evaluateCutover({ candidateVersion: "0.5.75", installedVersion: null, confirmedAbsent: true }).ok,
    ).toBe(true);
    expect(
      evaluateCutover({ candidateVersion: "0.5.75", installedVersion: null, allowDowngrade: true }).ok,
    ).toBe(true);
  });

  it("still blocks a downgrade of the located install", () => {
    const verdict = evaluateCutover({ candidateVersion: "0.5.69", installedVersion: "0.5.75" });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("DOWNGRADE");
  });
});

describe("planPreflight judges cli/package.json (H2)", () => {
  it("uses the CLI version as the candidate, not the dashboard's", () => {
    // The exact incident shape: the tree's app version is newer, the packaged
    // CLI is older than what is installed. Root-based compare waved it through.
    const repo = fakeRepo({ cliVersion: "0.5.70", rootVersion: "0.5.99" });
    const home = mkTmp();
    installAt(home, ".local/lib/node_modules/9router", { version: "0.5.75" });

    const plan = planPreflight(
      { rootDir: repo, env: { HOME: home } },
      { home, globalRoots: [], git: () => "" },
    );

    expect(plan.candidateVersion).toBe("0.5.70");
    expect(plan.candidatePackage).toBe("cli/package.json");
    expect(plan.installedVersion).toBe("0.5.75");
    expect(plan.exitCode).toBe(1);
    expect(plan.lines.join("\n")).toMatch(/DOWNGRADE/);
    // The tarball note must name the artifact npm will actually write.
    expect(plan.tarball).toBe("9router-0.5.70.tgz");
  });

  it("fails closed on a machine where no install can be located", () => {
    const repo = fakeRepo({ cliVersion: "0.5.80" });
    const home = mkTmp();
    const plan = planPreflight(
      { rootDir: repo, env: { HOME: home } },
      { home, globalRoots: [], git: () => "" },
    );
    expect(plan.exitCode).toBe(1);
    expect(plan.lines.join("\n")).toMatch(/cannot locate/i);
  });

  it("passes an upgrade and records the root/cli version split as a note", () => {
    const repo = fakeRepo({ cliVersion: "0.5.80", rootVersion: "0.5.75" });
    const home = mkTmp();
    installAt(home, ".local/lib/node_modules/9router", { version: "0.5.75" });

    const plan = planPreflight(
      { rootDir: repo, env: { HOME: home } },
      { home, globalRoots: [], git: () => "" },
    );
    expect(plan.exitCode).toBe(0);
    expect(plan.lines.join("\n")).toMatch(/independent versioning/i);
  });

  it("accepts NINE_ROUTER_NOT_INSTALLED=1 on a clean build machine", () => {
    const repo = fakeRepo({ cliVersion: "0.5.80" });
    const home = mkTmp();
    const plan = planPreflight(
      { rootDir: repo, env: { HOME: home, NINE_ROUTER_NOT_INSTALLED: "1" } },
      { home, globalRoots: [], git: () => "" },
    );
    expect(plan.exitCode).toBe(0);
    expect(plan.lines.join("\n")).toMatch(/clean machine declared/i);
  });
});
