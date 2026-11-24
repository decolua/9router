import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("redacts console arguments and substituted credentials before terminal and dashboard output", async () => {
  const { initConsoleLogCapture, getConsoleLogs } = await import("@/lib/consoleLogBuffer");
  const methods = ["log","info","warn","error","debug"];
  const originals = Object.fromEntries(methods.map(k => [k, console[k]]));
  const terminal = vi.fn();
  const dir = mkdtempSync(join(tmpdir(), "backup-log-"));
  try {
    vi.stubEnv("DATA_DIR", dir);
    const { makeBackupDir } = await import("@/lib/db/backup.js");
    const backupDir = makeBackupDir("schema-5-to-10");
    const backupLine = `[DB][migrate] pre-schema backup 5 → 10: ${backupDir}`;
    console.log = terminal;
    console.warn = terminal;
    initConsoleLogCapture();
    console.log(backupLine);
    console.log("%s/sk-example/eyJhbGciOiJub25lIn0.e30.signature", backupDir);
    console.warn("HTTP Bearer %s", "opaque-fixture");
    console.warn("request", { nested: [{ password: "private-fixture" }] });
    console.warn(new Error("unable to authenticate with sk-token-fixture"));
    for (const text of [JSON.stringify(terminal.mock.calls), JSON.stringify(getConsoleLogs())]) {
      expect(text).toContain(backupLine);
      expect(text).toContain(backupDir + "/[REDACTED]/[REDACTED]");
      expect(text).toContain("[REDACTED]");
      expect(text).not.toMatch(/opaque-fixture|private-fixture|sk-token-fixture/);
    }
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    Object.assign(console, originals);
    delete global._consoleLogBufferState;
  }
});
