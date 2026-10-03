// #3628 — autostart could not be turned off on any platform.
//
// cli.js called enableAutoStart() every time the user switched to tray mode,
// so the tray's "Disable" was undone by the next hide, and deleting the
// startup entry by hand was undone too. The automatic path now runs once and
// then leaves the user's choice alone.
//
// Exercised through the Linux branch against a temporary HOME: the Windows
// branch writes into the real Start Menu Startup folder, which a test must
// never touch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AUTOSTART = "../../cli/src/cli/tray/autostart.js";

const saved = {};
let home;
let dataDir;
let cliPath;

function desktopEntry() {
  return path.join(home, ".config", "autostart", "9router.desktop");
}

function decidedMarker() {
  return path.join(dataDir, "autostart-decided");
}

function load() {
  delete require.cache[require.resolve(AUTOSTART)];
  return require(AUTOSTART);
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-autostart-3628-"));
  home = path.join(root, "home");
  dataDir = path.join(root, "data");
  fs.mkdirSync(path.join(home, ".config", "autostart"), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  cliPath = path.join(root, "cli.js");
  fs.writeFileSync(cliPath, "// stub\n");

  for (const key of ["HOME", "USERPROFILE", "DATA_DIR", "DISPLAY"]) saved[key] = process.env[key];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.DATA_DIR = dataDir;
  process.env.DISPLAY = ":0";

  saved.platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, "platform", saved.platform);
  for (const key of ["HOME", "USERPROFILE", "DATA_DIR", "DISPLAY"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("autostart respects the user's choice (#3628)", () => {
  it("enables on the first automatic run", () => {
    const { ensureAutoStart } = load();
    expect(ensureAutoStart(cliPath)).toBe(true);
    expect(fs.existsSync(desktopEntry())).toBe(true);
    expect(fs.existsSync(decidedMarker())).toBe(true);
  });

  it("does not re-enable after the user disables it", () => {
    const { ensureAutoStart, disableAutoStart, isAutoStartEnabled } = load();
    ensureAutoStart(cliPath);
    disableAutoStart();
    expect(fs.existsSync(desktopEntry())).toBe(false);

    // The next switch to tray mode. This is the loop the issue reports.
    expect(ensureAutoStart(cliPath)).toBe(false);
    expect(fs.existsSync(desktopEntry())).toBe(false);
    expect(isAutoStartEnabled()).toBe(false);
  });

  it("does not re-create an entry the user deleted by hand", () => {
    const { ensureAutoStart } = load();
    ensureAutoStart(cliPath);
    fs.unlinkSync(desktopEntry());

    expect(ensureAutoStart(cliPath)).toBe(false);
    expect(fs.existsSync(desktopEntry())).toBe(false);
  });

  it("still turns back on when the user asks explicitly", () => {
    const { ensureAutoStart, disableAutoStart, enableAutoStart, isAutoStartEnabled } = load();
    ensureAutoStart(cliPath);
    disableAutoStart();

    expect(enableAutoStart(cliPath)).toBe(true);
    expect(fs.existsSync(desktopEntry())).toBe(true);
    expect(isAutoStartEnabled()).toBe(true);
    // ...and stays on across a later hide.
    expect(ensureAutoStart(cliPath)).toBe(false);
    expect(fs.existsSync(desktopEntry())).toBe(true);
  });

  it("records the choice even when removing the entry fails", () => {
    const { disableAutoStart, ensureAutoStart } = load();
    // Nothing to remove: disable must still be remembered, or the next launch
    // would treat this as a fresh install and enable autostart again.
    expect(fs.existsSync(desktopEntry())).toBe(false);
    disableAutoStart();
    expect(ensureAutoStart(cliPath)).toBe(false);
    expect(fs.existsSync(desktopEntry())).toBe(false);
  });
});
