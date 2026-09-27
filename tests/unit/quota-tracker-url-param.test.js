/**
 * Tests for #4217 — Quota Tracker URL ?provider= parameter support.
 *
 * Before this fix, visiting /dashboard/quota?provider=codex ignored the query
 * parameter and always defaulted to "All providers". The dropdown selection
 * updated only local state and did not update the URL.
 *
 * Fix: ProviderLimits initializes providerFilter from useSearchParams and
 * wraps setProviderFilter to call router.replace when the filter changes.
 *
 * Because ProviderLimits is a JSX file we cannot import it in Vitest without
 * a full Next.js setup. We verify the source text instead.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(
  path.resolve("../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js"),
  "utf-8"
);

describe("ProviderLimits — URL ?provider= sync (#4217)", () => {
  it("imports useSearchParams from next/navigation", () => {
    expect(src).toContain("useSearchParams");
    expect(src).toContain("next/navigation");
  });

  it("imports useRouter from next/navigation", () => {
    expect(src).toContain("useRouter");
  });

  it("imports usePathname from next/navigation", () => {
    expect(src).toContain("usePathname");
  });

  it("initializes providerFilter from searchParams.get('provider')", () => {
    expect(src).toMatch(/searchParams.*get.*provider/);
  });

  it("calls router.replace when provider filter changes", () => {
    expect(src).toContain("router.replace");
  });

  it("removes ?provider from URL when 'all' is selected", () => {
    expect(src).toContain("params.delete");
  });

  it("sets ?provider in URL when a specific provider is selected", () => {
    expect(src).toContain('params.set("provider"');
  });
});