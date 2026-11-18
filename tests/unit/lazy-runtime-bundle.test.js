import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("lazy runtime production bundling", () => {
  it("loads createRequire at runtime so webpack cannot stub module resolution", () => {
    const source = readFileSync(new URL("../../open-sse/services/lazyRuntime.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/import\s+.*createRequire.*from/);
    expect(source).toContain('import(/* webpackIgnore: true */ "node:module")');
    expect(source).toContain('pathToFileURL(resolveRuntimeEntry(runtimeRequire, pkg)).href');
    expect(source).toContain('unwrapCjsNamespace(await import(');
    expect(source).toContain('await installIntoRuntime(pkg, installPackages)');
    expect(source).toContain("node_modules");
    expect(source).toContain('cloakbrowser: "0.3.31"');
    expect(source).toContain('"socks-proxy-agent": "10.1.0"');
    expect(source).toContain('cloakbrowser: ["cloakbrowser", "playwright-core", "socks-proxy-agent"]');
  });
});