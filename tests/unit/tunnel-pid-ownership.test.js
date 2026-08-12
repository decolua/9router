import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cloudflared PID ownership", () => {
  let dataDir;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-tunnel-pid-"));
    process.env.DATA_DIR = dataDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("does not let an old child clear its successor PID", async () => {
    const { clearPid, loadPid, savePid } = await import("../../src/lib/tunnel/cloudflare/pid.js");

    savePid(100);
    savePid(200);
    clearPid(100);

    expect(loadPid()).toBe(200);

    clearPid(200);
    expect(loadPid()).toBeNull();
  });

  it("releases PID and process ownership for the exiting child only", () => {
    const source = fs.readFileSync(new URL("../../src/lib/tunnel/cloudflare/cloudflared.js", import.meta.url), "utf8");

    expect(source.match(/clearPid\(child\.pid\)/g)).toHaveLength(2);
    expect(source.match(/cloudflaredProcess === child/g)).toHaveLength(2);
  });
});
