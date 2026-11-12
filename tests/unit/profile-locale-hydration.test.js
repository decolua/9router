import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The server cannot read the locale cookie while rendering the settings page, so
// it renders "en". Reading the cookie in a useState initializer makes the
// client's first render differ for every non-English user, and React reports a
// hydration mismatch. The cookie must be read through useSyncExternalStore,
// whose server snapshot keeps the first client render equal to the server's.
const PAGE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/app/(dashboard)/dashboard/profile/page.js",
);

describe("profile page locale hydration", () => {
  const src = fs.readFileSync(PAGE, "utf8");

  it("does not read the locale cookie in a useState initializer", () => {
    expect(src).not.toMatch(/useState\(\s*\(\)\s*=>\s*getLocaleFromCookie\(\)\s*\)/);
    expect(src).not.toMatch(/useState\(\s*getLocaleFromCookie\b/);
  });

  it("reads it through useSyncExternalStore with an 'en' server snapshot", () => {
    expect(src).toMatch(/useSyncExternalStore\([^)]*getLocaleFromCookie\s*,\s*\(\)\s*=>\s*"en"\s*\)/);
  });
});
