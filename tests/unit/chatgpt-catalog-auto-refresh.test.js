import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { enableConfig, refreshNativeCatalog, serveIntegration } from "../../public/9router-codex.mjs";

const oldModel = { slug: "gpt-6-sol", visibility: "list" };
const newModel = { slug: "gpt-6.1-sol", visibility: "list", supported_reasoning_levels: [{ effort: "max" }] };
const routerModel = { slug: "9router/external", visibility: "list", context_window: 200000, custom: "preserve" };
const directories = [], servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "9router-native-refresh-"));
  directories.push(codexHome);
  const directory = path.join(codexHome, "9router-chatgpt");
  await fs.mkdir(directory);
  const catalogPath = path.join(directory, "catalog.json");
  const config = enableConfig('model = "gpt-6-sol"\n', "http://127.0.0.1:20130/token/v1", catalogPath, [oldModel]);
  const state = { active: true, token: "token", codexHome, directory, applied: config.applied, routerUrl: "https://unreachable.invalid/api/chatgpt/v1" };
  await fs.writeFile(path.join(directory, "state.json"), JSON.stringify(state));
  await fs.writeFile(catalogPath, JSON.stringify({ models: [routerModel, oldModel] }));
  await fs.writeFile(path.join(codexHome, "config.toml"), config.text);
  await fs.writeFile(path.join(codexHome, "auth.json"), "account-credentials-must-not-change");
  return { state, catalogPath, config: config.text };
}

describe("automatic native catalog writes", () => {
  it("adds new native models without a router request or any changes to router entries, config or credentials", async () => {
    const { state, catalogPath, config } = await fixture();
    const discover = vi.fn(async () => [newModel, oldModel]);
    expect(await refreshNativeCatalog(state, { discover })).toEqual({ changed: true, nativeModelCount: 2 });
    expect(JSON.parse(await fs.readFile(catalogPath, "utf8")).models).toEqual([routerModel, newModel, oldModel]);
    expect(await fs.readFile(path.join(state.codexHome, "auth.json"), "utf8")).toBe("account-credentials-must-not-change");
    expect(await fs.readFile(path.join(state.codexHome, "config.toml"), "utf8")).toBe(config);
    expect((await fs.stat(catalogPath)).mode & 0o777).toBe(0o600);
    const before = await fs.stat(catalogPath);
    expect(await refreshNativeCatalog(state, { discover })).toEqual({ changed: false, nativeModelCount: 2 });
    expect((await fs.stat(catalogPath)).mtimeMs).toBe(before.mtimeMs);
  });

  it("preserves the entire catalog after a failed refresh and releases the setup lock", async () => {
    const { state, catalogPath } = await fixture();
    const before = await fs.readFile(catalogPath, "utf8");
    await expect(refreshNativeCatalog(state, { discover: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
    expect(await fs.readFile(catalogPath, "utf8")).toBe(before);
    await expect(fs.stat(path.join(state.directory, "operation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips refresh while enable, sync or disable holds the lock", async () => {
    const { state } = await fixture();
    await fs.writeFile(path.join(state.directory, "operation.lock"), "");
    const discover = vi.fn();
    expect(await refreshNativeCatalog(state, { discover })).toBeUndefined();
    expect(discover).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(state.directory, "operation.lock"), "utf8")).toBe("");
  });

  it("recovers a lock left by an interrupted helper but never takes a live process's lock", async () => {
    const { state } = await fixture();
    const lockPath = path.join(state.directory, "operation.lock");
    const discover = vi.fn(async () => [newModel]);
    await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid }));
    await refreshNativeCatalog(state, { discover });
    expect(discover).not.toHaveBeenCalled();
    const stopped = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(stopped, "exit");
    await fs.writeFile(lockPath, JSON.stringify({ pid: stopped.pid }));
    expect(await refreshNativeCatalog(state, { discover })).toEqual({ changed: true, nativeModelCount: 1 });
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips a disabled integration and respects settings changed during a fetch", async () => {
    const { state, catalogPath, config } = await fixture();
    const discover = vi.fn();
    await fs.writeFile(path.join(state.directory, "state.json"), JSON.stringify({ ...state, active: false }));
    await refreshNativeCatalog(state, { discover });
    expect(discover).not.toHaveBeenCalled();
    await fs.writeFile(path.join(state.directory, "state.json"), JSON.stringify(state));
    await expect(refreshNativeCatalog(state, { discover: async () => {
      await fs.writeFile(path.join(state.codexHome, "config.toml"), config.replace('model_provider = "openai"', 'model_provider = "other"'));
      return [newModel];
    } })).rejects.toThrow("model_provider was changed by another app");
    expect(JSON.parse(await fs.readFile(catalogPath, "utf8")).models).toEqual([routerModel, oldModel]);
  });
});

describe("running bridge catalog lifecycle", () => {
  async function start(refresh, options = {}) {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const server = serveIntegration({ port: 0, token: "fixture-token" }, { refresh, warn: vi.fn(), log: vi.fn(), ...options });
    servers.push(server);
    await once(server, "listening");
    return server;
  }

  it("refreshes at startup without blocking traffic, coalesces overlapping attempts and stops its timer on close", async () => {
    let finish;
    const refresh = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const server = await start(refresh);
    expect(refresh).toHaveBeenCalledOnce();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/fixture-token/v1/_health`);
    expect((await response.json()).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledOnce();
    finish({ changed: false });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    finish({ changed: false });
    await new Promise(resolve => server.close(resolve));
    servers.pop();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("retries failed startup discovery automatically without leaking error details", async () => {
    const warn = vi.fn();
    const refresh = vi.fn().mockRejectedValueOnce(new Error("native-secret")).mockResolvedValue({ changed: false });
    await start(refresh, { warn });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls.flat().join()).not.toContain("native-secret");
  });
});
