import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("PXPIPE npm invocation", () => {
  it("uses a cached, shell-free Node/npm invocation on Windows", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "..", "src", "lib", "pxpipe", "install.js"), "utf8");

    expect(source).toContain("NPM_PROBE_TTL_MS");
    expect(source).toContain('execFileSync("where.exe", ["node.exe"]');
    expect(source).toContain('"node_modules", "npm", "bin", "npm-cli.js"');
    expect(source).not.toContain("execSync(");
    expect(source).not.toContain('"npm.cmd"');
  });
});
