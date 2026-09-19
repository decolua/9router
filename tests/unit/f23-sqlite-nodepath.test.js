/**
 * F23 (T1.6 M3-runtime) — buildEnvWithRuntime must not export a shadowed NODE_PATH.
 *
 * The published artifact ships app/node_modules/sql.js WITHOUT dist/sql-wasm.wasm
 * (npm strips it from nested node_modules). Node consults NODE_PATH only AFTER
 * walking the requiring module's own node_modules chain — so the broken bundle
 * copy shadows the self-healed runtime copy, and exporting the broken root
 * advertises a fix that can never load. Rule under test: a NODE_PATH root is
 * only exported when the module it carries is VALIDATED; when the bundle ships
 * an unvalidated sql.js and the runtime has nothing validated either, export
 * no NODE_PATH at all — let the server's driver fallback chain (better-sqlite3
 * → node:sqlite → sql.js, each guarded) run against what is actually resolvable
 * (src/lib/db/driver.js).
 *
 * Pure decision + fake fs — no installs, no real ~/.9router, no network.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildEnvWithRuntime, planRuntimeNodePath } = require("../../cli/hooks/sqliteRuntime.js");

const RT = "/home/u/.9router/runtime/node_modules";
const BD = "/opt/9router/cli/app/node_modules";

function fakeFs(existingPaths) {
  const set = new Set(existingPaths);
  return { existsSync: (p) => set.has(p) };
}

function facts(over = {}) {
  return {
    runtimeNm: RT,
    bundledNm: BD,
    existing: "",
    bundleHasSqlJs: true,
    bundleSqlJsWasm: true,
    runtimeSqlJsWasm: false,
    runtimeBetterSqliteValid: false,
    ...over,
  };
}

describe("planRuntimeNodePath — the shadowing rule", () => {
  it("bundle ships a BROKEN sql.js and the runtime has nothing validated → NO NODE_PATH export", () => {
    expect(planRuntimeNodePath(facts({ bundleSqlJsWasm: false }))).toBe(null);
  });

  it("bundle ships a broken sql.js but the runtime WAS self-healed → runtime root only, broken bundle root dropped", () => {
    const p = planRuntimeNodePath(facts({ bundleSqlJsWasm: false, runtimeSqlJsWasm: true }));
    expect(p).toBe(RT);
    expect(p).not.toContain(BD);
  });

  it("…same when the validated runtime module is better-sqlite3 instead of sql.js", () => {
    const p = planRuntimeNodePath(facts({ bundleSqlJsWasm: false, runtimeBetterSqliteValid: true }));
    expect(p).toBe(RT);
  });

  it("bundle validated (wasm present) → behaviour unchanged (both roots, runtime first)", () => {
    const p = planRuntimeNodePath(facts({ runtimeSqlJsWasm: true }));
    expect(p.split(path.delimiter)).toEqual([RT, BD]);
  });

  it("bundle carries NO sql.js at all (nothing to shadow) → runtime root stays (it is the only resolver)", () => {
    const p = planRuntimeNodePath(facts({ bundleHasSqlJs: false }));
    expect(p).toContain(RT);
  });

  it("a pre-existing NODE_PATH is preserved in every exported branch", () => {
    expect(planRuntimeNodePath(facts({ existing: "/opt/extra" }))).toBe(`${RT}${path.delimiter}${BD}${path.delimiter}/opt/extra`);
    expect(planRuntimeNodePath(facts({ bundleSqlJsWasm: false, runtimeSqlJsWasm: true, existing: "/opt/extra" }))).toBe(`${RT}${path.delimiter}/opt/extra`);
    expect(planRuntimeNodePath(facts({ bundleSqlJsWasm: false, runtimeSqlJsWasm: true }))).not.toContain(path.delimiter);
  });
});

describe("buildEnvWithRuntime — end-to-end env shape (fake filesystems)", () => {
  const SQLJS_BROKEN = `${BD}/sql.js`;
  const RUNTIME_WASM = `${RT}/sql.js/dist/sql-wasm.wasm`;

  it("broken bundle + empty runtime: the server child env gets NO NODE_PATH (self-heal shadowing disabled)", () => {
    const env = buildEnvWithRuntime(
      { PATH: "/usr/bin" },
      { fsImpl: fakeFs([SQLJS_BROKEN]), runtimeNm: RT, bundledNm: BD, runtimeBetterSqliteValid: false }
    );
    expect("NODE_PATH" in env).toBe(false);
    expect(env.PATH).toBe("/usr/bin");
  });

  it("broken bundle + validated runtime sql.js: NODE_PATH keeps only the runtime root", () => {
    const env = buildEnvWithRuntime(
      { PATH: "/usr/bin" },
      { fsImpl: fakeFs([SQLJS_BROKEN, RUNTIME_WASM]), runtimeNm: RT, bundledNm: BD, runtimeBetterSqliteValid: false }
    );
    expect(env.NODE_PATH).toBe(RT);
  });

  it("validated bundle: unchanged legacy export (runtime + bundle)", () => {
    const env = buildEnvWithRuntime(
      { PATH: "/usr/bin" },
      { fsImpl: fakeFs([`${BD}/sql.js`, `${BD}/sql.js/dist/sql-wasm.wasm`]), runtimeNm: RT, bundledNm: BD, runtimeBetterSqliteValid: false }
    );
    expect(env.NODE_PATH.split(path.delimiter)).toEqual([RT, BD]);
  });
});
