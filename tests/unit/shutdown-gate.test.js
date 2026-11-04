import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const shutdownRoute = read("src/app/api/version/shutdown/route.js");
const updateRoute = read("src/app/api/version/update/route.js");
const headerMenu = read("src/shared/components/HeaderMenu.js");
const profile = read("src/app/(dashboard)/dashboard/profile/page.js");

describe("shutdown and update are administrator actions", () => {
  it("the shutdown route verifies the session before touching the process", () => {
    expect(shutdownRoute).toContain("getDashboardAuthSession");
    expect(shutdownRoute).toMatch(/role === "apikey"/);
    // the refusal must come before the kill, or the check is decorative
    const gate = shutdownRoute.indexOf('role === "apikey"');
    const kill = shutdownRoute.indexOf("killAppProcesses()");
    expect(gate).toBeGreaterThan(-1);
    expect(kill).toBeGreaterThan(gate);
    expect(shutdownRoute).toMatch(/status:\s*403/);
  });

  it("a session that cannot be read is refused, not assumed", () => {
    expect(shutdownRoute).toMatch(/catch\s*\{[\s\S]{0,200}status:\s*403/);
  });

  it("the update route is gated the same way", () => {
    expect(updateRoute).toContain("getDashboardAuthSession");
    expect(updateRoute).toMatch(/role === "apikey"/);
    const gate = updateRoute.indexOf('role === "apikey"');
    const spawn = updateRoute.indexOf("spawnUpdaterAndExit()");
    expect(gate).toBeGreaterThan(-1);
    expect(spawn).toBeGreaterThan(gate);
  });

  it("the header menu hides shutdown from a key session", () => {
    expect(headerMenu).toMatch(/const canShutdown = role !== "apikey"/);
    expect(headerMenu).toMatch(/\{canShutdown && \(\s*<MenuItem/);
    // The shutdown row is the only admin-gated row now the theme switcher is
    // gone (glass-only theme), so no sibling must reference a removed rule.
    expect(headerMenu).not.toContain("canChangeTheme");
  });

  it("the profile page gates the red button on the role, not the route", () => {
    expect(profile).toContain("useSessionStore");
    expect(profile).toMatch(/sessionRole !== "apikey" && \(\s*<Button/);
  });
});