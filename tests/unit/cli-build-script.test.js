import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

describe("CLI build script", () => {
  it("supports Next standalone output nested under the workspace directory", () => {
    const script = readFileSync(join(root, "cli/scripts/build-cli.js"), "utf8");

    expect(script).toContain("findStandaloneApp");
    expect(script).toContain("fs.readdirSync(standaloneRootToUse");
    expect(script).toContain('path.join(standaloneRootToUse, entry.name)');
  });
});
