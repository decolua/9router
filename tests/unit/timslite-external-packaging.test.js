import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

import { copyStandaloneAssets } from "../../scripts/copy-standalone-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempDirs = [];

function createTempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readServerExternalPackages() {
  const config = readFileSync(path.join(repoRoot, "next.config.mjs"), "utf8");
  const match = config.match(/serverExternalPackages:\s*\[([^\]]*)\]/);
  if (!match) throw new Error("serverExternalPackages not found in next.config.mjs");
  return match[1].split(",").map((entry) => entry.trim().replace(/^["']|["']$/g, ""));
}

describe("timslite standalone packaging", () => {
  it("is kept external so webpack preserves the __dirname-relative native binding load", () => {
    // timslite/index.js does require(join(__dirname, "timslite.<target>.node")).
    // Bundling rewrites __dirname to the chunk directory and drops the .node files,
    // which is exactly the "Cannot find timslite native binding" failure seen in
    // deployed standalone builds. Externalizing keeps the real package on disk.
    expect(readServerExternalPackages()).toContain("timslite");
  });

  it("stays an optional dependency so unsupported platforms keep the inline fallback", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    expect(pkg.optionalDependencies?.timslite).toBeTruthy();
    expect(pkg.dependencies?.timslite).toBeFalsy();
  });

  it("copies the timslite package and native binding into the standalone output", () => {
    const projectRoot = createTempDir("9router-timslite-standalone-");
    const buildRoot = path.join(projectRoot, ".next");
    const moduleRoot = path.join(projectRoot, "node_modules", "timslite");
    mkdirSync(path.join(buildRoot, "standalone"), { recursive: true });
    mkdirSync(path.join(buildRoot, "static"), { recursive: true });
    mkdirSync(moduleRoot, { recursive: true });
    writeFileSync(path.join(moduleRoot, "package.json"), JSON.stringify({ name: "timslite", main: "index.js" }));
    writeFileSync(path.join(moduleRoot, "index.js"), "module.exports = { Store: {} };");
    writeFileSync(path.join(moduleRoot, "timslite.linux-x64-gnu.node"), "native binding");

    copyStandaloneAssets({ projectRoot, distDir: ".next" });

    const copied = path.join(buildRoot, "standalone", "node_modules", "timslite");
    expect(existsSync(path.join(copied, "package.json"))).toBe(true);
    expect(existsSync(path.join(copied, "index.js"))).toBe(true);
    expect(existsSync(path.join(copied, "timslite.linux-x64-gnu.node"))).toBe(true);
  });

  it("does not fail when the optional timslite package was never installed", () => {
    const projectRoot = createTempDir("9router-timslite-missing-");
    const buildRoot = path.join(projectRoot, ".next");
    mkdirSync(path.join(buildRoot, "standalone"), { recursive: true });
    mkdirSync(path.join(buildRoot, "static"), { recursive: true });

    expect(() => copyStandaloneAssets({ projectRoot, distDir: ".next" })).not.toThrow();
    expect(existsSync(path.join(buildRoot, "standalone", "node_modules", "timslite"))).toBe(false);
  });
});

// Post-build availability: only meaningful once a standalone build exists. The
// assertions inspect the real artifact rather than source strings, because a
// source-only guard cannot catch the bundling regression that shipped broken.
const standaloneRoot = path.join(repoRoot, ".next", "standalone");
const hasStandaloneBuild = existsSync(path.join(standaloneRoot, "server.js"));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe.skipIf(!hasStandaloneBuild)("built standalone timslite availability", () => {
  it("ships the timslite package with a loadable native binding", () => {
    const packageDir = path.join(standaloneRoot, "node_modules", "timslite");
    expect(existsSync(path.join(packageDir, "package.json")), "timslite package missing from .next/standalone").toBe(true);

    const requireFromStandalone = createRequire(path.join(packageDir, "index.js"));
    const binding = requireFromStandalone(path.join(packageDir, "index.js"));
    expect(binding).toBeTruthy();
    expect(typeof binding.Store?.open).toBe("function");
  });

  it("keeps the timslite loader out of the server chunk graph", () => {
    const serverDir = path.join(standaloneRoot, ".next", "server");
    if (!existsSync(serverDir)) return;
    const offending = walk(serverDir).filter(
      (file) => file.endsWith(".js") && readFileSync(file, "utf8").includes("Cannot find timslite native binding"),
    );
    expect(offending).toEqual([]);
  });
});
