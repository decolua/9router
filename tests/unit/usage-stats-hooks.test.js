import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  fileURLToPath(new URL("../../src/shared/components/UsageStats.js", import.meta.url)),
  "utf8",
);

describe("UsageStats hook ordering", () => {
  it("does not call a hook after its failed-load early return", () => {
    const earlyReturn = source.indexOf("if (!stats && !loading) return");
    const providersCalculation = source.indexOf("const providersWithModels = buildProvidersWithModels(providers, stats)");

    expect(source).toContain("function buildProvidersWithModels(providers, stats)");
    expect(source).not.toContain("const providersWithModels = useMemo(");
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(providersCalculation).toBeGreaterThan(earlyReturn);
  });
});
