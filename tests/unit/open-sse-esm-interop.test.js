import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("open-sse ESM interop", () => {
  it("loads the CommonJS node-machine-id dependency from plain Node ESM", () => {
    const scope = JSON.parse(readFileSync(join(repoRoot, "open-sse", "package.json"), "utf8"));
    expect(scope.type).toBe("module");

    const moduleUrl = pathToFileURL(join(repoRoot, "open-sse", "shared", "machineId.js")).href;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `import(${JSON.stringify(moduleUrl)})`],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("does not use top-level await to load http2", () => {
    const source = readFileSync(join(repoRoot, "open-sse", "executors", "cursor.js"), "utf8");
    expect(source).toContain("createRequire(import.meta.url)");
    expect(source).not.toMatch(/await import\(["']http2["']\)/);
  });
});
