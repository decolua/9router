import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const sidebar = readFileSync(
  resolve(root, "src/shared/components/Sidebar.js"),
  "utf8"
);

// Every menu group has to be gated on the session being resolved. The bug was
// that `permissions` fell back to a full-admin object while the fetch was in
// flight, so a dashboard-only API key saw every admin link until it landed.
const FILTERS = [
  "filteredNavItems",
  "filteredWorkshopItems",
  "filteredDebugItems",
  "filteredSystemItems",
];

describe("sidebar: menu is deny-by-default until the session resolves", () => {
  it("has no all-true permission fallback", () => {
    // The old fallback was an inline object literal with every key set true.
    const fallback = /authStatus\.permissions\s*\|\|\s*\{[^}]*manageApiKeys:\s*true/;
    expect(sidebar).not.toMatch(fallback);
    expect(sidebar).toContain("const permissions = authStatus.permissions || NO_PERMISSIONS;");
  });

  it("NO_PERMISSIONS grants nothing", () => {
    const block = sidebar.slice(
      sidebar.indexOf("const NO_PERMISSIONS = {"),
      sidebar.indexOf("};", sidebar.indexOf("const NO_PERMISSIONS = {")) + 2
    );
    const entries = [...block.matchAll(/(\w+):\s*(true|false)/g)];
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const [, key, value] of entries) {
      expect(value, `${key} must default to false`).toBe("false");
    }
  });

  it("reads `loaded` from the session store", () => {
    expect(sidebar).toContain(
      'const sessionLoaded = useSessionStore((state) => state.loaded);'
    );
    expect(sidebar).toMatch(/const sessionReady = sessionLoaded === true;/);
  });

  it("gates every menu filter on sessionReady", () => {
    for (const name of FILTERS) {
      const start = sidebar.indexOf(`const ${name} = `);
      expect(start, `${name} must exist`).toBeGreaterThan(-1);
      const body = sidebar.slice(start, start + 700);
      const guardAt = body.indexOf("if (!sessionReady) return false;");
      expect(guardAt, `${name} must deny before the session resolves`).toBeGreaterThan(-1);
      // The guard has to come first, ahead of the admin shortcut.
      const adminAt = body.indexOf("if (!isApiKeyUser) return true;");
      expect(guardAt).toBeLessThan(adminAt);
    }
  });

  it("shows Media Services as a direct category while preserving its permission gate", () => {
    expect(sidebar).toMatch(
      /const canOpenMedia = sessionReady && \(!isApiKeyUser \|\| permissions\.manageMediaProviders\);/
    );
    expect(sidebar).toContain('title="Media Services"');
    expect(sidebar).toContain("items={mediaNavItems}");
    expect(sidebar).toContain("href: `/dashboard/media-providers/${kind.id}`");
    expect(sidebar).toContain("COMBINED_WEB_ITEM.href");
    expect(sidebar).not.toContain("mediaOpen");
    expect(sidebar).not.toContain("keyboard_arrow_down");
    expect(sidebar).toContain("{sessionReady && !isApiKeyUser && (");
    expect(sidebar).toContain("{sessionReady && isApiKeyUser && (");
  });

  it("does not fetch admin settings before the role is known", () => {
    expect(sidebar).toContain(
      "if (!sessionReady || isApiKeyUser) return;"
    );
    expect(sidebar).toContain("}, [sessionReady, isApiKeyUser]);");
  });

  it("still grants a password session the full menu once loaded", () => {
    // The deny-by-default must only apply while `loaded` is false; a resolved
    // non-apikey session keeps the "if (!isApiKeyUser) return true" shortcut.
    const filters = sidebar.slice(sidebar.indexOf("const filteredNavItems = "));
    expect(filters).toContain("if (!sessionReady) return false;");
    expect(filters).toContain("if (!isApiKeyUser) return true;");
  });
});
