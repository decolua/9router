/**
 * Regression: Windows tray stdin must accept update-item (Peek()-based IPC was broken).
 * Requires Windows + powershell. Skips elsewhere.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoTray = path.resolve(__dirname, "../../cli/src/cli/tray");

describe.skipIf(process.platform !== "win32")("windows tray stdin IPC", () => {
  it("update-item changes menu text (dump)", async () => {
    const scriptPath = path.join(repoTray, "tray.ps1");
    const iconPath = path.join(repoTray, "icon.ico");
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(fs.existsSync(iconPath)).toBe(true);

    const ps = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
      "-InputFormat", "Text", "-OutputFormat", "Text",
      "-File", scriptPath, "-IconPath", iconPath, "-Tooltip", "test"
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    const send = (cmd) => ps.stdin.write(`${JSON.stringify(cmd)}\n`, "utf8");
    const events = [];
    readline.createInterface({ input: ps.stdout }).on("line", (line) => {
      try { events.push(JSON.parse(line)); } catch { /* ignore */ }
    });

    await new Promise((r) => setTimeout(r, 600));
    for (const [index, title, enabled] of [
      [0, "A", false],
      [1, "B", true],
      [2, "C", true],
      [3, "RTK ON", true],
      [4, "Q", true]
    ]) {
      send({ action: "add-item", index, title, enabled });
    }
    await new Promise((r) => setTimeout(r, 400));
    send({ action: "update-item", index: 3, title: "Enable RTK", enabled: true });
    send({ action: "dump-items" });
    await new Promise((r) => setTimeout(r, 500));
    send({ action: "kill" });
    await new Promise((r) => setTimeout(r, 400));
    try { ps.kill(); } catch { /* ignore */ }

    const dump = events.find((e) => e.type === "dump");
    expect(dump, `events=${JSON.stringify(events)}`).toBeTruthy();
    expect(dump.items[3]).toBe("Enable RTK");
  }, 15000);
});
