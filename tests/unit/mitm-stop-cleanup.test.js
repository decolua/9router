import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const manager = require("../../src/mitm/manager.js");

describe("MITM stop cleanup targets", () => {
  it("includes a unix server-path fallback so orphan node children are killed", () => {
    expect(manager.resolveMitmStopTargets).toBeTypeOf("function");
    expect(
      manager.resolveMitmStopTargets({
        isWin: false,
        processPid: 100,
        pidFilePid: 100,
        serverPath: "/home/ubuntu/.9router/runtime/mitm/server.js",
      }),
    ).toEqual({
      pids: [100],
      serverPathPattern: "/home/ubuntu/.9router/runtime/mitm/server.js",
    });
  });

  it("deduplicates process and pid-file targets", () => {
    expect(
      manager.resolveMitmStopTargets({
        isWin: false,
        processPid: 10,
        pidFilePid: 20,
        serverPath: "/tmp/server.js",
      }),
    ).toEqual({
      pids: [10, 20],
      serverPathPattern: "/tmp/server.js",
    });
  });

  it("disables path fallback on Windows", () => {
    expect(
      manager.resolveMitmStopTargets({
        isWin: true,
        processPid: 10,
        pidFilePid: null,
        serverPath: "C:\\server.js",
      }),
    ).toEqual({
      pids: [10],
      serverPathPattern: null,
    });
  });
});
