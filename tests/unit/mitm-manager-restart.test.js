import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { __test__ } = require("../../src/mitm/manager.js");

describe("MITM manager restart recovery", () => {
  it("treats an already-running MITM process as a recovered restart", () => {
    const error = new Error("MITM server is already running");
    const status = { running: true, pid: 1234 };

    expect(__test__.isAlreadyRunningRestartRecovery(error, status)).toBe(true);
  });

  it("does not hide unrelated restart failures", () => {
    expect(__test__.isAlreadyRunningRestartRecovery(new Error("port busy"), { running: true })).toBe(false);
    expect(__test__.isAlreadyRunningRestartRecovery(new Error("MITM server is already running"), { running: false })).toBe(false);
  });
});
