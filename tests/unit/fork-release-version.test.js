import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createForkVersion, resolveForkVersion } = require("../../cli/scripts/fork-version.js");

describe("fork npm release version", () => {
  it("derives a valid prerelease without changing the upstream base", () => {
    expect(createForkVersion("0.5.40", "17")).toBe("0.5.40-fork.17");
  });

  it("rejects colliding or malformed explicit versions", () => {
    expect(() => resolveForkVersion("0.5.40", {
      NINEROUTER_FORK_VERSION: "0.5.41-fork.1",
    })).toThrow(/must match/);
    expect(() => createForkVersion("0.5.40", "01")).toThrow(/Invalid fork SemVer/);
  });
});
