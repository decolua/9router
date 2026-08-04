import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const traySource = fs.readFileSync(
  fileURLToPath(new URL("../../cli/src/cli/tray/trayWin.js", import.meta.url)),
  "utf8",
);
const clipboardSource = fs.readFileSync(
  fileURLToPath(new URL("../../cli/src/cli/utils/clipboard.js", import.meta.url)),
  "utf8",
);

describe("Windows tray and clipboard lifecycle", () => {
  it("ties delayed tray cleanup to its captured child instead of a mutable global", () => {
    expect(traySource).toContain("let activeTray = null");
    expect(traySource).toContain("const controller = {");
    expect(traySource).toContain("if (psProcess.exitCode === null");
    expect(traySource).not.toContain("let psProcess = null");
    expect(traySource).toContain("psProcess.on(\"error\", clearProcess)");
  });

  it("copies through direct executables without a shell", () => {
    expect(clipboardSource).toContain('runClipboardCommand("clip.exe", [], text)');
    expect(clipboardSource).toContain("spawnSync(command, args");
    expect(clipboardSource).toContain("shell: false");
    expect(clipboardSource).not.toContain("execSync(");
  });
});
