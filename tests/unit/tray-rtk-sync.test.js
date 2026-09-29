/**
 * Regression: tray RTK label must be built from live settings, not hardcoded ON.
 * Locks the bug: dashboard OFF + tray showing "✓ RTK Enabled".
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const path = require("node:path");
const api = require("../../cli/src/cli/api/client.js");
const {
  buildMenuItems,
  MENU_INDEX,
  rtkMenuTitle,
  getRtkEnabled
} = require("../../cli/src/cli/tray/tray.js");

const SERVER = process.env.NINEROUTER_URL || "http://127.0.0.1:20128";

describe("tray RTK sync with settings", () => {
  beforeAll(() => {
    api.configure({ host: "127.0.0.1", port: 20128 });
  });

  it("initial menu label matches settings when RTK is OFF", async () => {
    const ping = await api.getSettings();
    if (!ping.success) {
      // No live server — skip (unit suite still covers pure labels)
      return;
    }

    const patch = await api.updateSettings({ rtkEnabled: false });
    expect(patch.success).toBe(true);

    // Fixed init path: await settings THEN build (no hardcoded true)
    const rtkEnabled = await getRtkEnabled();
    const items = buildMenuItems(20128, true, { rtk: rtkEnabled });

    expect(rtkEnabled).toBe(false);
    expect(items[MENU_INDEX.RTK].title).toBe("Enable RTK");
    expect(items[MENU_INDEX.RTK].title).not.toBe("✓ RTK Enabled");
  });

  it("toggle OFF→ON→OFF keeps label in sync with API", async () => {
    const ping = await api.getSettings();
    if (!ping.success) return;

    for (const want of [false, true, false]) {
      const patch = await api.updateSettings({ rtkEnabled: want });
      expect(patch.success).toBe(true);
      const enabled = await getRtkEnabled();
      expect(enabled).toBe(want);
      expect(rtkMenuTitle(enabled)).toBe(want ? "✓ RTK Enabled" : "Enable RTK");
    }
  });
});
