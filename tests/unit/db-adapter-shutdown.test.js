import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ShutdownPhase,
  runShutdown,
  __test__ as coord,
} from "@/lib/runtime/shutdownCoordinator.js";

describe("SQLite adapters shutdown integration", () => {
  let tempDir;

  beforeEach(() => {
    coord.reset();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-adapter-shutdown-"));
  });

  afterEach(() => {
    coord.reset();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers a CLOSE-phase coordinator step instead of its own signal handlers", async () => {
    const sigintBefore = process.listeners("SIGINT").length;
    const sigtermBefore = process.listeners("SIGTERM").length;

    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    const adapter = await createNodeSqliteAdapter(path.join(tempDir, "shutdown.db"));

    try {
      expect(process.listeners("SIGINT").length).toBe(sigintBefore);
      expect(process.listeners("SIGTERM").length).toBe(sigtermBefore);

      const step = coord.snapshot().find((entry) => entry.name === "db-adapter:node:sqlite");
      expect(step).toBeDefined();
      expect(step.phase).toBe(ShutdownPhase.CLOSE);

      adapter.exec("CREATE TABLE t (id INTEGER)");
      adapter.run("INSERT INTO t (id) VALUES (?)", [1]);

      await runShutdown("test");

      expect(() => adapter.get("SELECT 1 AS v")).toThrow();
    } finally {
      try { adapter.close(); } catch { /* already closed */ }
    }
  });

  it("keeps a direct close() API for non-server use", async () => {
    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    const adapter = await createNodeSqliteAdapter(path.join(tempDir, "direct.db"));

    expect(typeof adapter.close).toBe("function");
    expect(() => adapter.close()).not.toThrow();
  });

  it("does not call process.exit from any adapter shutdown path", async () => {
    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    const adapter = await createNodeSqliteAdapter(path.join(tempDir, "no-exit.db"));

    try {
      const exitSpy = (await import("vitest")).vi.spyOn(process, "exit").mockImplementation(() => {});
      try {
        await runShutdown("SIGTERM");
        expect(exitSpy).not.toHaveBeenCalled();
      } finally {
        exitSpy.mockRestore();
      }
    } finally {
      try { adapter.close(); } catch { /* already closed */ }
    }
  });
});
