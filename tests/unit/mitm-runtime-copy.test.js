import { afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Integration test for ensureRuntimeServer's self-heal wiring. Redirect DATA_DIR to a
// temp dir BEFORE manager.js is imported (paths.js reads process.env.DATA_DIR at load),
// so the runtime copy lands in the sandbox and never touches the real AppData runtime.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-data-"));
process.env.DATA_DIR = dataDir;

afterAll(() => {
  delete process.env.DATA_DIR;
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

describe("ensureRuntimeServer self-heal wiring", () => {
  // Reproduces the original bug class: an older runtime had a same-size server.js but was
  // missing runtime/shared/constants/mitmToolHosts.js, so dnsConfig crashed with
  // MODULE_NOT_FOUND. The size-skip path must still heal the shared contract.
  it("recreates a missing shared host file even when server.js is unchanged (size-skip path)", async () => {
    const { __test__ } = await import("../../src/mitm/manager.js");
    const serverPath = path.join(process.cwd(), "src", "mitm", "server.js");
    const runtimeServer = path.join(dataDir, "runtime", "mitm", "server.js");
    const runtimeShared = path.join(dataDir, "runtime", "shared", "constants", "mitmToolHosts.js");

    // Full copy on first run populates both the mitm tree and the shared contract.
    __test__.ensureRuntimeServer(serverPath);
    expect(fs.existsSync(runtimeServer)).toBe(true);
    expect(fs.existsSync(runtimeShared)).toBe(true);

    // Simulate the broken older runtime: shared file gone, server.js left untouched so the
    // size-skip short-circuit fires (no full recopy).
    fs.rmSync(runtimeShared, { force: true });
    expect(fs.existsSync(runtimeShared)).toBe(false);

    const before = fs.statSync(runtimeServer).mtimeMs;
    const result = __test__.ensureRuntimeServer(serverPath);

    // Shared file healed, and the untouched server.js was NOT recopied (size-skip held).
    expect(result).toBe(runtimeServer);
    expect(fs.existsSync(runtimeShared)).toBe(true);
    expect(fs.readFileSync(runtimeShared, "utf8")).toContain("TOOL_HOSTS");
    expect(fs.statSync(runtimeServer).mtimeMs).toBe(before);
  });

  it("refreshes the shared host file on a full recopy (server.js size changed)", async () => {
    const { __test__ } = await import("../../src/mitm/manager.js");
    const serverPath = path.join(process.cwd(), "src", "mitm", "server.js");
    const runtimeServer = path.join(dataDir, "runtime", "mitm", "server.js");
    const runtimeShared = path.join(dataDir, "runtime", "shared", "constants", "mitmToolHosts.js");

    __test__.ensureRuntimeServer(serverPath);

    // Make the runtime server.js a different size to force the full-copy branch, and write
    // a stale shared file that must be overwritten from source.
    fs.appendFileSync(runtimeServer, "\n// drift\n");
    fs.writeFileSync(runtimeShared, "module.exports = { STALE: true };");

    __test__.ensureRuntimeServer(serverPath);

    // Full recopy restores server.js to the source size and refreshes the shared contract.
    expect(fs.statSync(runtimeServer).size).toBe(fs.statSync(serverPath).size);
    expect(fs.readFileSync(runtimeShared, "utf8")).toContain("TOOL_HOSTS");
    expect(fs.readFileSync(runtimeShared, "utf8")).not.toContain("STALE");
  });
});
