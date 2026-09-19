// F20 — CLI packaging integrity (T1.6 C1, H2 pack side, M3 build side).
//
// The published tarball shipped the build machine's runtime state
// (cli/.build-home/.9router/{jwt-secret,machine-id,db/data.sqlite*}), because
// EXCLUDE_PATTERNS never listed the HOME redirect and every copy error was
// swallowed. These tests pin the two layers of the fix: exclusion at copy time
// and a hard audit of the staged tree before it can become a tarball.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const pack = require("../../cli/scripts/build-cli.js");

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function mkTmp(prefix = "9router-f20-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function touch(root, rel, contents = rel) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

describe("pack secret audit (C1)", () => {
  it("exports the audit surface", () => {
    for (const name of [
      "EXCLUDE_PATTERNS",
      "shouldExclude",
      "PACK_SECRET_PATTERNS",
      "matchPackSecretPath",
      "findPackSecretPaths",
      "assertNoPackSecrets",
      "syncBundleModuleFiles",
      "SQLJS_BUNDLE_FILES",
      "stageCliVersion",
    ]) {
      expect(pack, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  describe("matchPackSecretPath", () => {
    // Every one of these is a path that really appeared in 9router-0.5.75-enhanced.1.tgz.
    const LEAKED = [
      "cli/.build-home/.9router/jwt-secret",
      "cli/.build-home/.9router/machine-id",
      "cli/.build-home/.9router/db/data.sqlite",
      "cli/.build-home/.9router/db/data.sqlite-shm",
      "cli/.build-home/.9router/db/data.sqlite-wal",
      "cli/.build-home/.9router/db/backups/schema-1-to-2-0.5.75-enhanced.1-20260917-161418/data.sqlite",
      ".build-home/.9router/jwt-secret",
      ".9router/machine-id",
    ];
    for (const rel of LEAKED) {
      it(`flags ${rel}`, () => expect(pack.matchPackSecretPath(rel)).toBeTruthy());
    }

    // Paths the bundle legitimately needs. A false positive here would make
    // `cli:pack` unrunnable, so the audit must stay precise.
    const LEGIT = [
      "server.js",
      "package.json",
      "node_modules/node-machine-id/dist/index.js",
      "node_modules/node-machine-id/package.json",
      "node_modules/caniuse-lite/data/features/dataset.js",
      "node_modules/caniuse-lite/data/features/datauri.js",
      "node_modules/sql.js/dist/sql-wasm.js",
      "node_modules/sql.js/dist/sql-wasm.wasm",
      ".next-cli-build/server/app/api/settings/database/route.js",
      "src/lib/db/driver.js",
      "public/logo.svg",
      "custom-server.js",
    ];
    for (const rel of LEGIT) {
      it(`keeps ${rel}`, () => expect(pack.matchPackSecretPath(rel)).toBeNull());
    }

    it("flags .env and credential dotfiles anywhere in the tree", () => {
      expect(pack.matchPackSecretPath(".env.production")).toBeTruthy();
      expect(pack.matchPackSecretPath("app/.env")).toBeTruthy();
      expect(pack.matchPackSecretPath("home/scursel/.npmrc")).toBeTruthy();
      expect(pack.matchPackSecretPath("db/dump.bak")).toBeTruthy();
    });

    it("accepts an allow list so a documented false positive does not block releases", () => {
      expect(pack.matchPackSecretPath("weird-pkg/backups/index.js", { allow: ["weird-pkg/"] })).toBeNull();
      expect(pack.matchPackSecretPath("vendor/backups/index.js", { allow: ["weird-pkg/"] })).toBeTruthy();
    });
  });

  describe("EXCLUDE_PATTERNS", () => {
    it("lists the build-home redirect and the state dir", () => {
      expect(pack.shouldExclude(".build-home")).toBe(true);
      expect(pack.shouldExclude(".9router")).toBe(true);
      expect(pack.shouldExclude("jwt-secret")).toBe(true);
      expect(pack.shouldExclude("machine-id")).toBe(true);
      expect(pack.shouldExclude("data.sqlite")).toBe(true);
      expect(pack.shouldExclude("data.sqlite-wal")).toBe(true);
      expect(pack.shouldExclude("9router-package-root")).toBe(true);
    });

    it("still keeps every name the bundle needs", () => {
      for (const name of [
        "node-machine-id",
        "caniuse-lite",
        "data",
        "dataset.js",
        "sql-wasm.wasm",
        "database",
        "backups.json",
      ]) {
        expect(pack.shouldExclude(name), `shouldExclude(${name})`).toBe(false);
      }
    });
  });

  describe("findPackSecretPaths / assertNoPackSecrets", () => {
    it("walks a staged tree and reports leaked paths relative to it", () => {
      const stage = mkTmp();
      touch(stage, "server.js");
      touch(stage, "node_modules/node-machine-id/dist/index.js");
      touch(stage, "cli/.build-home/.9router/jwt-secret", "a".repeat(64));
      touch(stage, "cli/.build-home/.9router/db/data.sqlite-wal");
      touch(
        stage,
        "cli/.build-home/.9router/db/backups/schema-1-to-2-0.5.75-enhanced.1-20260917-161418/data.sqlite",
      );

      const found = pack.findPackSecretPaths(stage);
      // The offending parent dir is reported once, without descending into it.
      expect(found.map((f) => f.rel)).toEqual(["cli/.build-home"]);
      expect(found[0].why).toMatch(/HOME redirect/i);

      expect(() => pack.assertNoPackSecrets(stage)).toThrow(/jwt-secret|\.build-home/i);
      try {
        pack.assertNoPackSecrets(stage);
      } catch (error) {
        expect(error.message).toMatch(/ABORT/i);
        expect(error.message).toMatch(/cli\/\.build-home/);
      }
    });

    it("passes a clean staged tree", () => {
      const stage = mkTmp();
      touch(stage, "server.js");
      touch(stage, "package.json", "{}");
      touch(stage, "node_modules/caniuse-lite/data/features/dataset.js");
      touch(stage, "node_modules/node-machine-id/dist/index.js");
      touch(stage, ".next-cli-build/server/app/api/settings/database/route.js");
      expect(() => pack.assertNoPackSecrets(stage)).not.toThrow();
      expect(pack.findPackSecretPaths(stage)).toEqual([]);
    });

    it("honours an allow list", () => {
      const stage = mkTmp();
      touch(stage, "third-party/backups/fixture.json");
      expect(pack.findPackSecretPaths(stage).length).toBe(1);
      expect(pack.findPackSecretPaths(stage, { allow: ["third-party/"] })).toEqual([]);
    });
  });

  describe("copy-time exclusion", () => {
    it("does not stage .build-home out of a standalone tree", () => {
      const root = mkTmp();
      const appDir = path.join(root, "9router-enhanced");
      const buildDistDir = path.join(appDir, ".next-cli-build");
      const standalone = path.join(buildDistDir, "standalone", "9router-enhanced");
      const cliAppDir = path.join(root, "cli-app");

      touch(standalone, "server.js", "standalone server");
      touch(standalone, "cli/.build-home/.9router/jwt-secret", "secret");
      touch(standalone, "cli/.build-home/.9router/db/data.sqlite", "db");
      touch(standalone, "cli/cli.js", "launcher");
      touch(standalone, "node_modules/caniuse-lite/data/features/dataset.js", "legit");
      touch(standalone, ".next-cli-build/server/app/api/v1/chat/completions/route.js", "chat");
      touch(standalone, ".next-cli-build/server/app/api/v1/messages/route.js", "messages");

      pack.copyStandaloneBuild(appDir, buildDistDir, cliAppDir);

      expect(fs.existsSync(path.join(cliAppDir, "server.js"))).toBe(true);
      expect(fs.existsSync(path.join(cliAppDir, "cli", "cli.js"))).toBe(true);
      expect(fs.existsSync(path.join(cliAppDir, "node_modules", "caniuse-lite", "data", "features", "dataset.js"))).toBe(true);
      expect(fs.existsSync(path.join(cliAppDir, "cli", ".build-home"))).toBe(false);
      expect(() => pack.assertNoPackSecrets(cliAppDir)).not.toThrow();
    });

    it("collects copy failures instead of swallowing them", () => {
      // The old code wrapped every fs.copyFileSync in `catch {}`, so a broken
      // exclusion or an unreadable file produced a quietly incomplete bundle.
      const root = mkTmp();
      const src = path.join(root, "src");
      const dest = path.join(root, "dest");
      touch(src, "payload.txt", "x");
      touch(src, "ok.txt", "y");
      touch(dest, "payload.txt/inner.txt", "blocker"); // dest/payload.txt is a directory

      const problems = [];
      pack.copyRecursive(src, dest, { problems });

      expect(problems.length).toBe(1);
      expect(problems[0].path).toContain("payload.txt");
      expect(fs.existsSync(path.join(dest, "ok.txt"))).toBe(true);
    });
  });
});

describe("staged version, not the root's (H2)", () => {
  it("writes the CLI version into the staged package.json only", () => {
    const stage = mkTmp();
    const staged = touch(stage, "cli-app/package.json", JSON.stringify({ name: "9router-app", version: "0.5.76" }, null, 2));
    const result = pack.stageCliVersion({ cliAppDir: path.join(stage, "cli-app"), version: "0.5.75-enhanced.2" });

    expect(result).toMatchObject({ changed: true, before: "0.5.76", after: "0.5.75-enhanced.2" });
    const written = JSON.parse(fs.readFileSync(staged, "utf8"));
    expect(written.version).toBe("0.5.75-enhanced.2");
    // Only the version is rewritten: the rest of the artifact metadata survives.
    expect(written.name).toBe("9router-app");
  });

  it("reports when the staged package.json is missing instead of touching the tree", () => {
    const stage = mkTmp();
    const result = pack.stageCliVersion({ cliAppDir: path.join(stage, "cli-app"), version: "1.2.3" });
    expect(result.changed).toBe(false);
    expect(result.missing).toBe(true);
    expect(fs.existsSync(path.join(stage, "cli-app", "package.json"))).toBe(false);
  });

  it("buildCliPackage no longer rewrites the app package.json", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../cli/scripts/build-cli.js"), "utf8");
    // The old step 0 wrote appPkg back to disk mid-pack; regression guard.
    expect(source).not.toMatch(/fs\.writeFileSync\(appPkgPath/);
    expect(source).toMatch(/stageCliVersion/);
  });
});

describe("sql.js binaries travel together (M3)", () => {
  it("copies the wasm + asm fallback into an already-bundled sql.js", () => {
    const root = mkTmp();
    const appDir = path.join(root, "9router-enhanced");
    const cliAppDir = path.join(root, "cli-app");
    // The tracing output that defeated the old directory-exists check.
    touch(cliAppDir, "node_modules/sql.js/package.json", '{"name":"sql.js"}');
    touch(cliAppDir, "node_modules/sql.js/dist/sql-wasm.js", "// loader");
    // The real module in the app tree has everything.
    touch(appDir, "node_modules/sql.js/package.json", '{"name":"sql.js"}');
    touch(appDir, "node_modules/sql.js/dist/sql-wasm.js", "// loader");
    touch(appDir, "node_modules/sql.js/dist/sql-wasm.wasm", "wasm-bytes");
    touch(appDir, "node_modules/sql.js/dist/sql-asm.js", "// asm fallback");

    const result = pack.syncBundleModuleFiles({
      cliAppDir,
      candidates: [path.join(appDir, "node_modules")],
      pkg: "sql.js",
      files: pack.SQLJS_BUNDLE_FILES,
    });

    expect(result.missing).toEqual([]);
    expect(result.copied).toEqual(expect.arrayContaining(["dist/sql-wasm.wasm", "dist/sql-asm.js"]));
    expect(fs.readFileSync(path.join(cliAppDir, "node_modules/sql.js/dist/sql-wasm.wasm"), "utf8")).toBe("wasm-bytes");
  });

  it("still copies when the module directory is absent (no early return on a traced dir)", () => {
    const root = mkTmp();
    const cliAppDir = path.join(root, "cli-app");
    const appDir = path.join(root, "9router-enhanced");
    touch(appDir, "node_modules/sql.js/package.json", '{"name":"sql.js"}');
    for (const rel of pack.SQLJS_BUNDLE_FILES) touch(appDir, `node_modules/sql.js/${rel}`, rel);

    const result = pack.syncBundleModuleFiles({
      cliAppDir,
      candidates: [path.join(appDir, "node_modules")],
      pkg: "sql.js",
      files: pack.SQLJS_BUNDLE_FILES,
    });
    expect(result.missing).toEqual([]);
    for (const rel of pack.SQLJS_BUNDLE_FILES) {
      expect(fs.existsSync(path.join(cliAppDir, "node_modules", "sql.js", rel))).toBe(true);
    }
  });

  it("reports the file it could not source instead of shipping a half module", () => {
    const root = mkTmp();
    const cliAppDir = path.join(root, "cli-app");
    const appDir = path.join(root, "9router-enhanced");
    touch(cliAppDir, "node_modules/sql.js/package.json", '{"name":"sql.js"}');
    touch(cliAppDir, "node_modules/sql.js/dist/sql-wasm.js", "// loader");
    // Source tree has the JS loader but not the wasm (the broken state).
    touch(appDir, "node_modules/sql.js/package.json", '{"name":"sql.js"}');
    touch(appDir, "node_modules/sql.js/dist/sql-wasm.js", "// loader");

    const result = pack.syncBundleModuleFiles({
      cliAppDir,
      candidates: [path.join(appDir, "node_modules")],
      pkg: "sql.js",
      files: pack.SQLJS_BUNDLE_FILES,
    });
    expect(result.missing).toContain("dist/sql-wasm.wasm");
  });

  it("SQLJS_BUNDLE_FILES covers the wasm and the asm fallback", () => {
    expect(pack.SQLJS_BUNDLE_FILES).toEqual(
      expect.arrayContaining(["dist/sql-wasm.js", "dist/sql-wasm.wasm", "dist/sql-asm.js"]),
    );
  });
});
