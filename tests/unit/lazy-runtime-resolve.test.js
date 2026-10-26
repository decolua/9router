import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../open-sse/services/lazyRuntime.js");

describe("lazyRuntime", () => {
  let dataDir;
  const prevDataDir = process.env.DATA_DIR;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lazy-runtime-"));
    const pkgDir = path.join(dataDir, "runtime", "node_modules", "fake-lazy-pkg");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "fake-lazy-pkg", version: "1.0.0", main: "index.js" }));
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = { marker: 'from-runtime-dir' };\n");
    process.env.DATA_DIR = dataDir;
  });

  afterAll(() => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("resolves a package already installed in <DATA_DIR>/runtime without npm", async () => {
    vi.resetModules();
    const { loadRuntimeDep } = await import("../../open-sse/services/lazyRuntime.js");
    const mod = await loadRuntimeDep("fake-lazy-pkg");
    expect((mod.default || mod).marker).toBe("from-runtime-dir");
  });

  // Callers destructure named exports (`const { chromium } = ...`), but a CJS
  // package imported by file path only exposes them on `default` under real
  // Node ESM. vitest papers over that, so run the loader in a plain node.
  it("exposes a CJS package's exports by name under real Node ESM", () => {
    const script = `
      import { loadRuntimeDep } from ${JSON.stringify(SRC)};
      const { marker } = await loadRuntimeDep("fake-lazy-pkg");
      console.log(marker);
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(out.trim()).toBe("from-runtime-dir");
  });

  // webpack rewrites `createRequire(...).resolve(x)` into `(void 0).resolve(x)`
  // when createRequire is imported statically — the standalone build then dies
  // with "Cannot read properties of undefined (reading 'resolve')".
  it("does not statically import createRequire (webpack would break it in the packed build)", () => {
    const source = fs.readFileSync(SRC, "utf8");
    expect(source).not.toMatch(/import\s*\{[^}]*createRequire[^}]*\}\s*from\s*["'](node:)?module["']/);
  });

  // An un-annotated import(<expr>) compiles to webpack's empty context module,
  // which always rejects with MODULE_NOT_FOUND in the packed build.
  it("marks every dynamic import() webpackIgnore so the packed build keeps it native", () => {
    const source = fs.readFileSync(SRC, "utf8");
    const calls = source.split("\n").filter((line) => /\bimport\(/.test(line) && !/^\s*\/\//.test(line));
    expect(calls.length).toBeGreaterThan(0);
    for (const line of calls) expect(line).toContain("webpackIgnore: true");
  });
});
