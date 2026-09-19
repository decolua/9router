/**
 * Seam: tray menu item labels/order for Token Saver toggles (pure buildMenuItems).
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildMenuItems,
  MENU_INDEX,
  rtkMenuTitle,
  headroomMenuTitle,
  cavemanMenuTitle,
  ponytailMenuTitle
} = require("../../cli/src/cli/tray/tray.js");

describe("tray menu Token Saver", () => {
  it("title helpers show check when enabled", () => {
    expect(rtkMenuTitle(true)).toBe("✓ RTK Enabled");
    expect(rtkMenuTitle(false)).toBe("Enable RTK");
    expect(headroomMenuTitle(true)).toBe("✓ Headroom Enabled");
    expect(cavemanMenuTitle(false)).toBe("Enable Caveman");
    expect(ponytailMenuTitle(true)).toBe("✓ Ponytail Enabled");
  });

  it("buildMenuItems places Token Saver group between Auto-start and Quit", () => {
    const items = buildMenuItems(20128, true, {
      rtk: true,
      headroom: false,
      caveman: true,
      ponytail: false
    });
    expect(items[MENU_INDEX.STATUS].title).toContain("20128");
    expect(items[MENU_INDEX.AUTOSTART].title).toBe("✓ Auto-start Enabled");
    expect(items[MENU_INDEX.RTK].title).toBe("✓ RTK Enabled");
    expect(items[MENU_INDEX.HEADROOM].title).toBe("Enable Headroom");
    expect(items[MENU_INDEX.CAVEMAN].title).toBe("✓ Caveman Enabled");
    expect(items[MENU_INDEX.PONYTAIL].title).toBe("Enable Ponytail");
    expect(items[MENU_INDEX.QUIT].title).toBe("Quit");
    expect(items).toHaveLength(8);
  });

  it("legacy boolean third arg still sets RTK only", () => {
    const items = buildMenuItems(20128, false, false);
    expect(items[MENU_INDEX.RTK].title).toBe("Enable RTK");
    expect(items[MENU_INDEX.HEADROOM].title).toBe("Enable Headroom");
    expect(items[MENU_INDEX.AUTOSTART].title).toBe("Enable Auto-start");
  });
});
