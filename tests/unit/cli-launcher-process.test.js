import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";

const require = createRequire(import.meta.url);
const lp = require("../../cli/src/cli/utils/launcherProcess.js");

const EXE = path.basename(process.execPath);

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("launcher PID record", () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-pid-"));
    file = lp.getPidFilePath(path.join(dir, "nested"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("places the record under the data dir", () => {
    expect(file).toBe(path.join(dir, "nested", "launcher.pid"));
  });

  it("round-trips a record and creates the data dir", () => {
    const record = { cliPid: 111, serverPid: 222, port: 20128, exe: EXE };
    lp.writePidRecord(file, record);
    expect(lp.readPidRecord(file)).toEqual(record);
  });

  it("returns null when the record is missing", () => {
    expect(lp.readPidRecord(file)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    expect(lp.readPidRecord(file)).toBeNull();
  });

  it("returns null when PIDs are not positive integers", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ cliPid: "1; rm -rf /", serverPid: -4, exe: EXE }));
    expect(lp.readPidRecord(file)).toBeNull();
  });

  it("drops an invalid serverPid but keeps a valid cliPid", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ cliPid: 5, serverPid: "x", port: 1, exe: EXE }));
    expect(lp.readPidRecord(file)).toEqual({ cliPid: 5, serverPid: null, port: 1, exe: EXE });
  });

  it("removes the record only for its owner", () => {
    lp.writePidRecord(file, { cliPid: 111, serverPid: 222, port: 1, exe: EXE });
    lp.removePidRecordIfOwner(file, 999);
    expect(fs.existsSync(file)).toBe(true);
    lp.removePidRecordIfOwner(file, 111);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("isPidAlive", () => {
  it("is true for the current process", () => {
    expect(lp.isPidAlive(process.pid)).toBe(true);
  });

  it("is false when the signal probe reports ESRCH", () => {
    const kill = () => { const e = new Error("no such process"); e.code = "ESRCH"; throw e; };
    expect(lp.isPidAlive(1234, { kill })).toBe(false);
  });

  it("is true when the probe reports EPERM (alive, owned by another user)", () => {
    const kill = () => { const e = new Error("not permitted"); e.code = "EPERM"; throw e; };
    expect(lp.isPidAlive(1234, { kill })).toBe(true);
  });

  it("is false for invalid PIDs without probing", () => {
    const kill = () => { throw new Error("should not be called"); };
    expect(lp.isPidAlive(0, { kill })).toBe(false);
    expect(lp.isPidAlive(null, { kill })).toBe(false);
  });
});

describe("stopRecordedInstance", () => {
  const deps = (overrides = {}) => {
    const killed = [];
    return {
      killed,
      opts: {
        selfPid: 1,
        isAlive: () => true,
        matchesExe: () => true,
        killPid: (pid) => killed.push(pid),
        ...overrides,
      },
    };
  };

  it("kills the recorded server and CLI", () => {
    const { killed, opts } = deps();
    const result = lp.stopRecordedInstance({ cliPid: 10, serverPid: 20, exe: EXE }, opts);
    expect(killed).toEqual([20, 10]);
    expect(result).toEqual([20, 10]);
  });

  it("never kills itself", () => {
    const { killed, opts } = deps({ selfPid: 10 });
    lp.stopRecordedInstance({ cliPid: 10, serverPid: 20, exe: EXE }, opts);
    expect(killed).toEqual([20]);
  });

  it("skips PIDs that are no longer alive", () => {
    const { killed, opts } = deps({ isAlive: (pid) => pid === 20 });
    lp.stopRecordedInstance({ cliPid: 10, serverPid: 20, exe: EXE }, opts);
    expect(killed).toEqual([20]);
  });

  it("skips a reused PID that now belongs to a different program", () => {
    const { killed, opts } = deps({ matchesExe: (pid) => pid !== 10 });
    lp.stopRecordedInstance({ cliPid: 10, serverPid: 20, exe: EXE }, opts);
    expect(killed).toEqual([20]);
  });

  it("does nothing for a null record", () => {
    const { killed, opts } = deps();
    expect(lp.stopRecordedInstance(null, opts)).toEqual([]);
    expect(killed).toEqual([]);
  });

  it("keeps going when one kill throws", () => {
    const { opts } = deps({ killPid: (pid) => { if (pid === 20) throw new Error("denied"); } });
    expect(lp.stopRecordedInstance({ cliPid: 10, serverPid: 20, exe: EXE }, opts)).toEqual([10]);
  });
});

describe("processMatchesExe", () => {
  it("recognises the current process by its executable name", () => {
    expect(lp.processMatchesExe(process.pid, EXE)).toBe(true);
  });

  it("rejects the current process for a different executable name", () => {
    expect(lp.processMatchesExe(process.pid, "definitely-not-this.exe")).toBe(false);
  });

  it("rejects a missing executable name", () => {
    expect(lp.processMatchesExe(process.pid, "")).toBe(false);
  });
});

describe("port helpers", () => {
  it("isPortInUse is true for a listening port and false once closed", async () => {
    const server = await listen();
    const { port } = server.address();
    expect(await lp.isPortInUse(port)).toBe(true);
    await new Promise((r) => server.close(r));
    expect(await lp.isPortInUse(port)).toBe(false);
  });

  it("waitForPortFree resolves immediately when the port is already free", async () => {
    const server = await listen();
    const { port } = server.address();
    await new Promise((r) => server.close(r));
    const start = Date.now();
    expect(await lp.waitForPortFree(port, { timeoutMs: 2000 })).toBe(true);
    expect(Date.now() - start).toBeLessThan(400);
  });

  it("waitForPortFree resolves as soon as the port is released", async () => {
    const server = await listen();
    const { port } = server.address();
    setTimeout(() => server.close(), 200);
    const start = Date.now();
    expect(await lp.waitForPortFree(port, { timeoutMs: 3000, intervalMs: 50 })).toBe(true);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(1500);
  });

  it("waitForPortFree gives up after the timeout", async () => {
    const server = await listen();
    const { port } = server.address();
    try {
      expect(await lp.waitForPortFree(port, { timeoutMs: 300, intervalMs: 50 })).toBe(false);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("waitForPidsExit", () => {
  it("resolves immediately when nothing is alive", async () => {
    const start = Date.now();
    expect(await lp.waitForPidsExit([1, 2], { isAlive: () => false })).toBe(true);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("resolves once all PIDs exit", async () => {
    let alive = true;
    setTimeout(() => { alive = false; }, 150);
    expect(await lp.waitForPidsExit([1], { isAlive: () => alive, intervalMs: 25, timeoutMs: 2000 })).toBe(true);
  });

  it("gives up after the timeout", async () => {
    expect(await lp.waitForPidsExit([1], { isAlive: () => true, intervalMs: 25, timeoutMs: 150 })).toBe(false);
  });
});
