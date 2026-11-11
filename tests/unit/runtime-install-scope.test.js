import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("../../cli/hooks/sqliteRuntime.js", import.meta.url));
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir())) throw new Error("Unexpected temporary directory");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("runtime install scope (#5443)", () => {
  it.each(["true", "false", undefined])("installs locally with inherited npm global=%s", (global) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-install-scope-"));
    roots.push(root);
    const runtime = path.join(root, "runtime");
    const fixture = path.join(root, "fixture");
    const prefix = path.join(root, "prefix");
    for (const dir of [runtime, fixture, prefix]) fs.mkdirSync(dir);
    fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({ name: "test-runtime", private: true }));
    fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
      name: "runtime-scope-fixture", version: "1.0.0", main: "index.js",
    }));
    fs.writeFileSync(path.join(fixture, "index.js"), 'module.exports = "runtime ready";');
    const config = path.join(root, "npmrc");
    fs.writeFileSync(config, "");
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
    Object.assign(env, {
      npm_config_prefix: prefix,
      npm_config_cache: path.join(root, "cache"),
      npm_config_userconfig: config,
      npm_config_globalconfig: path.join(root, "global-npmrc"),
    });
    if (global !== undefined) env.npm_config_global = global;

    // Exercise the actual helper/npm boundary without registry access or native builds.
    const output = execFileSync(process.execPath, ["-e", `
      const { runNpmInstall } = require(process.argv[1]);
      const result = runNpmInstall({ cwd: process.argv[2], pkgs: [process.argv[3]],
        extraArgs: ["--offline", "--ignore-scripts", "--no-save", "--package-lock=false"], timeout: 20000 });
      process.stdout.write(JSON.stringify(result));
    `, installer, runtime, "file:../fixture"], { env, encoding: "utf8", timeout: 25000 });
    const result = JSON.parse(output);
    expect(result.ok, result.stderr).toBe(true);
    const installed = path.join(runtime, "node_modules", "runtime-scope-fixture", "index.js");
    expect(fs.existsSync(installed), "fixture must be installed in the runtime project").toBe(true);
    expect(execFileSync(process.execPath, ["-e", "process.stdout.write(require(process.argv[1]))", installed],
      { encoding: "utf8" })).toBe("runtime ready");
    expect(fs.existsSync(path.join(prefix, "node_modules", "runtime-scope-fixture"))).toBe(false);
    expect(fs.existsSync(path.join(prefix, "lib", "node_modules", "runtime-scope-fixture"))).toBe(false);
  }, 30000);
});
