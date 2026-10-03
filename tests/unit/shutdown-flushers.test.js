import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

let directory;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = null;
});

describe("shutdown flushers", () => {
  it("waits for priority groups and isolates failed flushers", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "9router-shutdown-"));
    const marker = path.join(directory, "flushed");
    const shutdownUrl = pathToFileURL(path.resolve("src/lib/shutdown.js")).href;
    const program = `
      import { appendFile, writeFile } from "node:fs/promises";
      import { registerShutdownFlusher } from ${JSON.stringify(shutdownUrl)};
      registerShutdownFlusher(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        await writeFile(process.argv[1], "network");
      }, -100);
      registerShutdownFlusher(async () => appendFile(process.argv[1], "-buffer"));
      registerShutdownFlusher(async () => { throw new Error("expected"); });
      registerShutdownFlusher(async () => appendFile(process.argv[1], "-db"), 100);
      if (process.listenerCount("SIGTERM") !== 1) throw new Error("multiple SIGTERM owners");
      process.kill(process.pid, "SIGTERM");
      setTimeout(() => {}, 1_000);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program, marker], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 5_000,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("[Shutdown] flusher failed: expected");
    expect(await readFile(marker, "utf8")).toBe("network-buffer-db");
  });

  it("runs application flushers before the SQLite adapter closes", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "9router-shutdown-sqlite-"));
    const databaseFile = path.join(directory, "data.sqlite");
    const adapterUrl = pathToFileURL(path.resolve("src/lib/db/adapters/nodeSqliteAdapter.js")).href;
    const shutdownUrl = pathToFileURL(path.resolve("src/lib/shutdown.js")).href;
    const program = `
      const { createNodeSqliteAdapter } = await import(${JSON.stringify(adapterUrl)});
      const { registerShutdownFlusher } = await import(${JSON.stringify(shutdownUrl)});
      const adapter = await createNodeSqliteAdapter(process.argv[1]);
      adapter.exec("CREATE TABLE proof (id INTEGER PRIMARY KEY)");
      registerShutdownFlusher(() => adapter.run("INSERT INTO proof DEFAULT VALUES"));
      process.kill(process.pid, "SIGTERM");
      setTimeout(() => {}, 1_000);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program, databaseFile], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 5_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const database = new DatabaseSync(databaseFile, { readOnly: true });
    expect(database.prepare("SELECT COUNT(*) AS count FROM proof").get().count).toBe(1);
    expect(database.prepare("PRAGMA integrity_check").get().integrity_check).toBe("ok");
    database.close();
  });

  it("flushes before an application-requested exit", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "9router-shutdown-direct-"));
    const marker = path.join(directory, "flushed");
    const shutdownUrl = pathToFileURL(path.resolve("src/lib/shutdown.js")).href;
    const program = `
      import { writeFile } from "node:fs/promises";
      import { registerShutdownFlusher, shutdownProcess } from ${JSON.stringify(shutdownUrl)};
      registerShutdownFlusher(() => writeFile(process.argv[1], "flushed"));
      shutdownProcess(7);
      setTimeout(() => {}, 1_000);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program, marker], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 5_000,
    });

    expect(result.status, result.stderr).toBe(7);
    expect(await readFile(marker, "utf8")).toBe("flushed");
  });
});
