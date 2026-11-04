import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolve } from "node:path";

/**
 * A notification whose link 404s is worse than no link: the bell promises
 * "this leads somewhere" and drops the operator on Next's not-found page.
 * Every link emitted by the scan must resolve to a page that exists.
 */

const ROOT = resolve(__dirname, "../..");
const scan = fs.readFileSync(
  path.join(ROOT, "src/app/api/notifications/scan/route.js"),
  "utf8"
);

const links = [...scan.matchAll(/link:\s*"([^"]+)"/g)].map((m) => m[1]);

function pageExists(link) {
  const rel = link.replace(/^\/dashboard\//, "").replace(/^\//, "");
  const candidates = [
    path.join(ROOT, "src/app/(dashboard)/dashboard", rel, "page.js"),
    path.join(ROOT, "src/app/(dashboard)", rel, "page.js"),
    path.join(ROOT, "src/app", rel, "page.js"),
    path.join(ROOT, "src/app/(dashboard)/dashboard/page.js"),
  ];
  return candidates.some((p) => fs.existsSync(p));
}

describe("notification links", () => {
  it("the scan emits at least one link", () => {
    expect(links.length).toBeGreaterThan(0);
  });

  it("every emitted link resolves to an existing page", () => {
    const dead = links.filter((l) => !pageExists(l));
    expect(dead, `dead links: ${dead.join(", ")}`).toEqual([]);
  });

  it("the settings surface is the profile page (no /dashboard/settings)", () => {
    expect(links).not.toContain("/dashboard/settings");
    expect(links).toContain("/dashboard/profile");
  });
});