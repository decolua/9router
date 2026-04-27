import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(process.cwd(), "..");
const read = (p) => fs.readFileSync(path.resolve(ROOT_DIR, p), "utf8");

describe("quota aggregate contract", () => {
  it("recognizes session, weekly, and primary quota groups in aggregate logic", () => {
    const providerLimits = read("src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx");

    expect(providerLimits).toContain('startsWith("primary")');
    expect(providerLimits).toContain('startsWith("session")');
    expect(providerLimits).toContain('startsWith("weekly")');
  });

  it("renders a Primary summary row when primary quota exists", () => {
    const summary = read("src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaAggregateSummary.tsx");

    expect(summary).toContain('label="Primary"');
    expect(summary).toContain('aggregate.primary');
  });
});
