import fs from "node:fs";
import path from "node:path";
import { makeBackupDir, pruneOldBackups } from "./backup.js";
import { exportDb } from "./index.js";

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let started = false;

async function runAutoBackup() {
  try {
    const data = await exportDb();
    const dir = makeBackupDir("auto");
    fs.writeFileSync(
      path.join(dir, "db.json"),
      JSON.stringify(data, null, 2),
    );
    console.log("[AutoBackup] Backup saved to", dir);
    pruneOldBackups();
  } catch (err) {
    console.error("[AutoBackup] Failed:", err.message);
  }
}

export function initAutoBackup() {
  if (typeof window !== "undefined") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (started) return;
  started = true;

  // Run first backup after a short delay so the server can finish startup
  setTimeout(() => runAutoBackup(), 30_000);

  const handle = setInterval(runAutoBackup, AUTO_BACKUP_INTERVAL_MS);
  if (handle.unref) handle.unref();
}
