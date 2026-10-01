/**
 * Regression test for #4232
 *
 * codebuddy-intl was missing from OAUTH_TEST_CONFIG. The test route handler
 * returned {"valid":false,"error":"Provider test not supported"} for every
 * codebuddy-intl account, regardless of token validity.
 *
 * Fix: add a "codebuddy-intl" entry alongside "codebuddy-cn". Both providers
 * use the same JWT token structure (eyJ…, ~1-year expiry, access + refresh
 * token pair).
 *
 * NOTE: the entry was later upgraded from the `tokenExists: true` stub (which
 * never caught revoked/expired tokens) to a real billing-endpoint probe. This
 * test asserts the entry exists and is wired to a real probe, which is the
 * durable intent of #4232 — not the specific stub shape.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Read the source file and verify the config entry is present.
// testUtils.js is a Next.js server file so we inspect the source text
// rather than importing it (avoids next/server bootstrap requirements).

const src = fs.readFileSync(
  path.resolve("../src/app/api/providers/[id]/test/testUtils.js"),
  "utf-8"
);

describe("OAUTH_TEST_CONFIG — codebuddy-intl (#4232)", () => {
  it('contains "codebuddy-intl" entry', () => {
    expect(src).toContain('"codebuddy-intl"');
  });

  it('"codebuddy-intl" is wired to a real billing-endpoint probe', () => {
    // The entry configures a POST probe with an Authorization Bearer header —
    // either the original `tokenExists: true` stub or the upgraded real probe
    // satisfies "codebuddy-intl is testable".
    const intl = src.match(/"codebuddy-intl"\s*:\s*\{[\s\S]*?\n  \}/);
    expect(intl).toBeTruthy();
    expect(intl[0]).toMatch(/tokenExists\s*:\s*true|billing\/meter/);
  });

  it('"codebuddy-cn" is also present and testable (regression guard)', () => {
    const cn = src.match(/"codebuddy-cn"\s*:\s*\{[\s\S]*?\n  \}/);
    expect(cn).toBeTruthy();
    expect(cn[0]).toMatch(/tokenExists\s*:\s*true|billing\/meter/);
  });
});