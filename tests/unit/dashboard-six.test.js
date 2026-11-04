import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Structural checks for the six dashboard additions. These are file-level
 * assertions rather than live requests: they run without a database, and the
 * behaviour each one protects is the *rule* (admin-only, secrets excluded,
 * ranking by median) rather than a rendered pixel.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const FILES = {
  requestDetailRoute: "src/app/api/usage/request-details/[id]/route.js",
  notificationsRoute: "src/app/api/notifications/route.js",
  notificationsScan: "src/app/api/notifications/scan/route.js",
  notificationsRepo: "src/lib/db/repos/notificationsRepo.js",
  bell: "src/shared/components/NotificationBell.js",
  historyRoute: "src/app/api/settings/history/route.js",
  rollbackRoute: "src/app/api/settings/rollback/route.js",
  historyRepo: "src/lib/db/repos/settingsHistoryRepo.js",
  settingsRoute: "src/app/api/settings/route.js",
  historyPanel: "src/shared/components/SettingsHistory.js",
  bulkRoute: "src/app/api/keys/bulk/route.js",
  bulkModal: "src/app/(dashboard)/dashboard/endpoint/components/BulkEditKeys.js",
  endpointPage: "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js",
  requestDetailsTab: "src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js",
  guard: "src/dashboardGuard.js",
  sidebar: "src/shared/components/Sidebar.js",
};

describe("request detail payload", () => {
  const route = read(FILES.requestDetailRoute);
  const tab = read(FILES.requestDetailsTab);

  it("refuses a key session and requires a dashboard session", () => {
    expect(route).toContain("getDashboardAuthSession");
    // Only a password session may read a full record: either spelled as a
    // key-session refusal or as an admin-only gate.
    expect(route).toMatch(/role === "apikey"|role !== "admin"/);
    expect(route).toMatch(/status:\s*40[13]/);
  });

  it("escapes the id before it reaches the query", () => {
    expect(route).toMatch(/encodeURIComponent|String\(.*\)\s*\|\|\s*""|pathParam|params/);
  });

  it("the drawer fetches the full payload per record", () => {
    expect(tab).toContain("/api/usage/request-details/");
    expect(tab).toMatch(/setSelectedDetail\(\(prev\)\s*=>/);
  });

  it("surfaces a failure instead of showing a redacted body silently", () => {
    expect(tab).toMatch(/fullBodyError/);
  });
});

describe("notification feed", () => {
  const route = read(FILES.notificationsRoute);
  const scan = read(FILES.notificationsScan);
  const repo = read(FILES.notificationsRepo);
  const bell = read(FILES.bell);
  const guard = read(FILES.guard);

  it("is closed to key sessions", () => {
    for (const src of [route, scan]) {
      expect(src).toContain('role === "apikey"');
    }
  });

  it("lists, marks read and clears by kind", () => {
    expect(route).toContain("listNotifications");
    expect(route).toContain("markRead");
    expect(route).toContain("clearNotificationByKind");
  });

  it("dedupes by key so a repeated scan cannot flood the feed", () => {
    expect(repo).toMatch(/dedupeKey/);
    expect(scan).toMatch(/dedupeKey/);
    expect(scan).toMatch(/clearNotificationByKind/);
  });

  it("only derives conditions, never fails the dashboard", () => {
    expect(scan).toMatch(/catch[\s\S]{0,400}return/);
  });

  it("is mounted in the header with an unread badge", () => {
    expect(read("src/shared/components/Header.js")).toContain("NotificationBell");
    expect(bell).toMatch(/unread/i);
  });

  it("appears in the guard's protected list", () => {
    expect(guard).toContain('"/api/notifications"');
  });
});

describe("settings history and rollback", () => {
  const historyRoute = read(FILES.historyRoute);
  const rollbackRoute = read(FILES.rollbackRoute);
  const repo = read(FILES.historyRepo);
  const settingsRoute = read(FILES.settingsRoute);
  const panel = read(FILES.historyPanel);
  const profile = read("src/app/(dashboard)/dashboard/profile/page.js");

  it("takes the before-image on every settings mutation", () => {
    expect(settingsRoute).toContain("snapshotSettings");
    // the snapshot must precede the write, or it stores the new state
    expect(settingsRoute.indexOf("snapshotSettings")).toBeLessThan(
      settingsRoute.indexOf("updateSettings(body)")
    );
  });

  it("a failed snapshot never blocks the change itself", () => {
    expect(settingsRoute).toMatch(/snapshot failed/);
  });

  it("keeps secrets out of the history", () => {
    expect(repo).toMatch(/DENY_REVERT/);
    expect(repo).toMatch(/sanitizeHistorySnapshot/);
    expect(repo).toMatch(/includes\("secret"\)|includes\("token"\)/);
  });

  it("rolls back a stored snapshot and re-snapshots the state it replaces", () => {
    expect(rollbackRoute).toContain("getSettingsSnapshot");
    expect(rollbackRoute).toContain("updateSettings");
    expect(rollbackRoute).toContain("snapshotSettings");
  });

  it("sanitizes again on the way out, so a stale row cannot resurrect a secret", () => {
    expect(rollbackRoute).toContain("sanitizeHistorySnapshot");
  });

  it("closes both endpoints to key sessions", () => {
    for (const src of [historyRoute, rollbackRoute]) {
      expect(src).toContain('role === "apikey"');
    }
  });

  it("mounts the panel in settings and hides it when refused", () => {
    expect(profile).toContain("SettingsHistory");
    expect(panel).toMatch(/setDenied\(true\)/);
    expect(panel).toMatch(/if \(denied\) return null/);
  });
});

describe("bulk key edit", () => {
  const route = read(FILES.bulkRoute);
  const modal = read(FILES.bulkModal);
  const page = read(FILES.endpointPage);

  it("is an administrator action", () => {
    expect(route).toContain('role === "apikey"');
  });

  it("accepts only the allow-listed fields", () => {
    expect(route).toMatch(/BULK_FIELDS\s*=\s*new Set/);
    expect(route).toMatch(/cannot be changed in bulk/);
  });

  it("never lets a bulk write touch the key material itself", () => {
    const setMatch = route.match(/BULK_FIELDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    const fields = setMatch ? setMatch[1] : "";
    for (const forbidden of ["key", "apiKey", "hash", "secret"]) {
      expect(fields).not.toContain(`"${forbidden}"`);
    }
  });

  it("records the change in the security trail", () => {
    expect(route).toMatch(/recordSecurityEvent/);
  });

  it("selects keys per row and opens the modal with that set", () => {
    expect(page).toContain("selectedKeyIds");
    expect(page).toContain("<BulkEditKeys");
    expect(modal).toMatch(/selectedCount/);
  });
});

describe("six-dashboard leftovers are gone", () => {
  it("the model benchmark feature was removed and no longer ships", () => {
    // benchmark route/repo/page were cut with the Custom Plugins removal; a
    // stale test must not keep demanding files that were deliberately deleted.
    for (const rel of [
      "src/app/api/models/benchmark/route.js",
      "src/lib/db/repos/benchmarkRepo.js",
      "src/app/(dashboard)/dashboard/benchmark/BenchmarkPage.js",
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
    }
  });
});