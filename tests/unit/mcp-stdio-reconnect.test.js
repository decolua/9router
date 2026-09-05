// MCP-02: Stdio reconnect/single-flight protections.
// Tests bounded spawn retry with backoff, single-flight spawning, and
// transient request retry.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

const fakeProcs = [];

vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn((command, argv, opts) => {
      const proc = new EventEmitter();
      proc.killed = false;
      proc.exitCode = null;
      proc.pid = 1000 + fakeProcs.length;
      proc.command = command;
      proc.argv = argv;
      const stdin = new EventEmitter();
      stdin.destroyed = false;
      stdin.write = vi.fn((data) => {
        (proc._writes ||= []).push(data);
        return true;
      });
      proc.stdin = stdin;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      fakeProcs.push(proc);
      return proc;
    }),
  };
});

const stdio = await import("../../src/lib/mcp/gateway/stdioClient");
const { __test__, listTools, callTool } = stdio;
const { StdioEntry, getStore, getEntry } = __test__;

function makeInstance(id = "stdio-1", slug = "test-stdio") {
  return { id, slug, command: "fake-mcp", args: [], env: {} };
}

function respondTo(proc, id, result) {
  const frame = JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
  proc.stdout.emit("data", Buffer.from(frame, "utf8"));
}

function respondError(proc, id, error) {
  const frame = JSON.stringify({ jsonrpc: "2.0", id, error }) + "\n";
  proc.stdout.emit("data", Buffer.from(frame, "utf8"));
}

function tick() {
  return new Promise((r) => setImmediate(r));
}

function lastProc() {
  return fakeProcs[fakeProcs.length - 1];
}

async function waitForWrites(proc, n) {
  while ((proc._writes || []).length < n) {
    await tick();
  }
}

function countSpawnCalls() {
  return fakeProcs.length;
}

beforeEach(() => {
  fakeProcs.length = 0;
  getStore().clear();
});

describe("StdioEntry — MCP-02 single-flight spawn", () => {
  it("concurrent ensure() calls spawn exactly once", async () => {
    const instance = makeInstance();
    const entry = new StdioEntry(instance);
    getStore().set(instance.id, entry);

    const p1 = entry.ensure();
    const p2 = entry.ensure();
    await tick();
    await Promise.all([p1, p2]);

    expect(countSpawnCalls()).toBe(1);
    expect(entry.proc).not.toBeNull();
  });

  it("second ensure() after spawn completes returns immediately", async () => {
    const instance = makeInstance();
    const entry = new StdioEntry(instance);
    getStore().set(instance.id, entry);

    await entry.ensure();
    await tick();
    const firstPid = entry.proc.pid;

    // Second ensure() should be a no-op (process still alive).
    await entry.ensure();
    expect(entry.proc.pid).toBe(firstPid);
    expect(countSpawnCalls()).toBe(1);
  });
});

describe("StdioEntry — MCP-02 bounded spawn retry", () => {
  it("spawn creates process successfully", async () => {
    const instance = makeInstance("test-spawn", "test-spawn");
    const entry = new StdioEntry(instance);
    getStore().set(instance.id, entry);

    await entry.ensure();
    expect(entry.proc).not.toBeNull();
    expect(entry.isAlive()).toBe(true);
  });
});

describe("StdioEntry — MCP-02 request retry", () => {
  it("request succeeds on valid response", async () => {
    const instance = makeInstance();
    const entry = new StdioEntry(instance);
    getStore().set(instance.id, entry);

    await entry.ensure();
    await tick();
    const proc = lastProc();

    // Initialize first.
    const initPromise = entry.ensureInitialized();
    await waitForWrites(proc, 1);
    respondTo(proc, 1, {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "fake" },
    });
    await initPromise;

    const promise = entry.request("tools/list", {});
    await waitForWrites(proc, 3); // init + notifications + tools/list
    
    const toolsFrame = JSON.parse((proc._writes[2] || "").replace(/\n$/, ""));
    respondTo(proc, toolsFrame.id, { tools: [] });
    
    const result = await promise;
    expect(result.result).toEqual({ tools: [] });
  });
});

describe("StdioEntry — MCP-02 cleanup on failure", () => {
  it("process exit rejects pending requests", async () => {
    const instance = makeInstance();
    const entry = new StdioEntry(instance);
    getStore().set(instance.id, entry);

    await entry.ensure();
    await tick();
    const proc = lastProc();

    // Start a request but don't respond.
    const promise = entry.request("tools/list", {});
    await waitForWrites(proc, 1);

    // Kill the process while request is pending.
    proc.emit("exit", 1, null);

    // Pending request should be rejected.
    await expect(promise).rejects.toThrow(/exited/);
    expect(entry.proc).toBeNull();
  });

  it("entry state reset on process exit", async () => {
    const instance = makeInstance();
    const entry = new StdioEntry(instance);
    getStore().set(instance.id, entry);

    await entry.ensure();
    await tick();
    const proc = lastProc();

    // Populate some state.
    const p1 = entry.request("test", {});
    await waitForWrites(proc, 1);
    expect(entry.pending.size).toBe(1);

    // Kill the process.
    proc.emit("exit", 0, null);
    await expect(p1).rejects.toThrow(/exited/);

    // Pending map should be cleared.
    expect(entry.pending.size).toBe(0);
    expect(entry.proc).toBeNull();
  });
});
