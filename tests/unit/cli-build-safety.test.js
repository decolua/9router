import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const buildScript = fs.readFileSync(path.join(root, "cli/scripts/build-cli.js"), "utf8");

describe("CLI build safety", () => {
  it("cleans prior output and excludes transient build HOME state", () => {
    expect.soft(buildScript).toMatch(/EXCLUDE_PATTERNS\s*=\s*\[[\s\S]*?"\.build-home"/);
    expect.soft(buildScript).toMatch(/buildCliPackage\(\)[\s\S]*?rmSync\(buildDistDir,[\s\S]*?npm run build/);
  });
});
