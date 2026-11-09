// lazyRuntime's runtime-dir fallback must keep named exports for CJS
// packages whose exports map points import→.mjs / require→.js (playwright-core
// shape). createRequire.resolve returns the CJS entry; importing it via file
// URL bypasses the exports map and cjs-module-lexer cannot detect named
// exports through `module.exports = require(...).x.y` chains — consumers then
// crash with "Cannot read properties of undefined (reading
// 'launchPersistentContext')" in published builds (dev works because the bare
// import hits the .mjs entry). See open-sse/services/lazyRuntime.js.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Unique name so step 1 (bare import from the app install) cannot resolve it.
const PKG = "9r-lazy-fixture-pw";
let dataDir;

// vitest rewrites every import in transformed modules with its own CJS interop,
// which synthesizes named exports and masks exactly the bug under test. Run the
// loader in a plain child Node process — the same way production loads it.
function loadFixtureInChildProcess() {
  const sourceUrl = pathToFileURL(path.resolve(__dirname, "../../open-sse/services/lazyRuntime.js")).href;
  const script = [
    `import(${JSON.stringify(sourceUrl)}).then(async ({ loadRuntimeDep }) => {`,
    `  const mod = await loadRuntimeDep(${JSON.stringify(PKG)});`,
    `  console.log(JSON.stringify({ chromium: mod.chromium ?? null, defaultChromium: mod.default?.chromium ?? null }));`,
    `}).catch((error) => { console.error(String(error?.stack || error)); process.exit(1); });`,
  ].join("\n");
  return spawnSync(process.execPath, ["-e", script], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: "utf8",
    timeout: 60000,
  });
}

beforeAll(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "9r-lazyrt-"));
  const runtimeDir = path.join(dataDir, "runtime");
  const pkgDir = path.join(runtimeDir, "node_modules", PKG);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(path.join(runtimeDir, "package.json"), JSON.stringify({ name: "9router-runtime", private: true }));
  // Same shape as playwright-core: import condition listed before require.
  writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: PKG,
      version: "1.0.0",
      exports: { ".": { import: "./index.mjs", require: "./index.js", default: "./index.js" } },
    })
  );
  writeFileSync(path.join(pkgDir, "bootstrap.js"), "module.exports = 0;\n");
  writeFileSync(path.join(pkgDir, "coreBundle.js"), "exports.inprocess = { playwright: { chromium: { kind: 'chromium' } } };\n");
  // Chained re-export that cjs-module-lexer cannot statically analyze.
  writeFileSync(path.join(pkgDir, "index.js"), "require('./bootstrap');\nmodule.exports = require('./coreBundle').inprocess.playwright;\n");
  writeFileSync(
    path.join(pkgDir, "index.mjs"),
    "import pw from './index.js';\nexport const chromium = pw.chromium;\nexport default pw;\n"
  );
  // Must be set before lazyRuntime's first getWritableDataDir() call — cached.
  process.env.DATA_DIR = dataDir;
});

afterAll(() => {
  delete process.env.DATA_DIR;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("lazyRuntime runtime-dir fallback keeps named exports", () => {
  it("exposes a named export from a CJS package installed in the runtime dir", () => {
    const result = loadFixtureInChildProcess();
    expect(result.status).toBe(0);
    const { chromium, defaultChromium } = JSON.parse(result.stdout.trim());
    expect(chromium).toEqual({ kind: "chromium" });
    expect(defaultChromium).toEqual({ kind: "chromium" });
  });
});
