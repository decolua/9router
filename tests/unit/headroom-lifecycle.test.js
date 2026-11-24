import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dns from "node:dns";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execSync: vi.fn() }));
vi.mock("child_process", () => ({ ...mocks, execFileSync: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ headroomUrl: "http://localhost:8877" }) }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-lifecycle-"));
vi.stubEnv("DATA_DIR", dir);
const { startHeadroomProxy, stopHeadroomProxy, restartHeadroomProxy, getManagedPid } = await import("@/lib/headroom/process.js");
const { getHeadroomStatus } = await import("@/lib/headroom/detect.js");
const { headroomLookup, fetchHeadroom } = await import("@/lib/headroom/transport.js");
const url = "http://localhost:8877";
let child;
beforeEach(() => {
  child = Object.assign(new EventEmitter(), { pid: 9999, unref: vi.fn(), kill: vi.fn(() => child.emit("exit", 0)) });
  mocks.spawn.mockReset().mockReturnValue(child);
  mocks.execSync.mockReset().mockImplementation(cmd => String(cmd).includes("which headroom") ? Buffer.from("/bin/headroom") : Buffer.alloc(0));
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });

it("recognizes healthy external proxy before CLI discovery; a stale PID gives no ownership", async () => {
  fs.mkdirSync(path.join(dir, "headroom"), { recursive: true });
  fs.writeFileSync(path.join(dir, "headroom/proxy.pid"), String(process.pid));
  expect(await startHeadroomProxy({ url })).toMatchObject({ state: "external", pid: null });
  expect(mocks.execSync).not.toHaveBeenCalled();
  expect(await restartHeadroomProxy({ url })).toMatchObject({ state: "external" });
  expect(await stopHeadroomProxy(url)).toEqual({ stopped: false, reason: "not_managed" });
  expect(await getHeadroomStatus(url, getManagedPid(url))).toMatchObject({ state: "external", canStart: false });
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("start, status and stop routes agree on external ownership and ignore caller URL", async () => {
  const start = await import("@/app/api/headroom/start/route");
  const status = await import("@/app/api/headroom/status/route");
  const stop = await import("@/app/api/headroom/stop/route");
  expect(await (await start.POST(new Request("http://localhost/api/headroom/start?url=http://example.com"))).json())
    .toMatchObject({ state: "external", pid: null });
  expect(await (await status.GET()).json()).toMatchObject({ state: "external", running: true, managedPid: null });
  expect((await stop.POST()).status).toBe(409);
  expect(fetch.mock.calls.every(([href]) => href === url + "/health")).toBe(true);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("starts once after failed health, waits for readiness and signals only its child", async () => {
  fetch.mockRejectedValueOnce(new Error("refused"));
  const [a, b] = await Promise.all([startHeadroomProxy({ url }), startHeadroomProxy({ url })]);
  expect(a).toMatchObject({ state: "running", alreadyRunning: false });
  expect(b).toMatchObject({ state: "running", alreadyRunning: true });
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(mocks.spawn.mock.calls[0][1]).toEqual(["proxy", "--port", "8877"]);
  expect((await stopHeadroomProxy("http://localhost:8888")).stopped).toBe(false);
  expect((await stopHeadroomProxy(url)).stopped).toBe(true);
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(getManagedPid(url)).toBeNull();
});

it("reports early child exit and releases ownership", async () => {
  fetch.mockRejectedValue(new Error("refused"));
  mocks.spawn.mockImplementation(() => { queueMicrotask(() => child.emit("exit", 3)); return child; });
  await expect(startHeadroomProxy({ url })).rejects.toMatchObject({ code: "EARLY_EXIT", message: expect.stringContaining("code=3") });
  expect(getManagedPid(url)).toBeNull();
  expect((await getHeadroomStatus(url)).state).toBe("stopped");
  expect((await getHeadroomStatus("https://external.example")).state).toBe("unreachable");
  await expect(startHeadroomProxy({ url: "https://external.example" })).rejects.toMatchObject({ code: "EXTERNAL_PROXY" });
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it.each(["http://169.254.169.254", "http://10.2.3.4", "http://[fd00::2]", "http://0.0.0.0", "file:///tmp/file"])("refuses unsafe configured address %s before fetch or spawn", async target => {
  expect(() => fetchHeadroom(target)).toThrow();
  await expect(startHeadroomProxy({ url: target })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("checks all DNS answers at connect time and disallows redirects", async () => {
  vi.spyOn(dns, "lookup").mockImplementation((_host, _options, cb) => cb(null, [
    { family: 4, address: "8.8.8.8" }, { family: 4, address: "127.0.0.1" },
  ]));
  const cb = vi.fn();
  headroomLookup("service.example", { all: true }, cb);
  expect(cb).toHaveBeenCalledWith(expect.any(Error));
  await fetchHeadroom(url);
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", dispatcher: expect.anything() });
});
