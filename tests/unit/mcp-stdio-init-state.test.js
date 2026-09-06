// MCP-01: stdio gateway must run the MCP `initialize` handshake against the
// live child process and re-run it on every respawn. Init-state lives on the
// StdioEntry (process-scoped, keyed in the global store), NOT on the
// per-request `instance` object (which is reconstructed every gateway
// request — see handler.js -> rowToInstance -> { ...row }).
//
// These tests use the `__test__` test seam in stdioClient.js and a fake
// child process injected via `vi.mock("node:child_process", ...)`. No real
// processes are spawned. Newline-delimited JSON-RPC frames are driven into
// the fake proc's stdout, and writes to stdin are captured for assertions.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// Captures every fake proc returned by the mocked spawn(), in order.
const fakeProcs = [];

vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter();
      proc.killed = false;
      proc.exitCode = null;
      proc.pid = 1000 + fakeProcs.length;
      const stdin = new EventEmitter();
      stdin.destroyed = false;
      stdin.write = vi.fn((data) => {
        // Capture every newline-delimited frame for later assertions.
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

// Import after vi.mock so the module picks up the mocked child_process.
const stdio = await import("../../src/lib/mcp/gateway/stdioClient");
const { StdioEntry, getStore, getEntry } = stdio.__test__;
const { listTools } = stdio;

function makeInstance(id = "inst-1", slug = "test-mcp") {
  return { id, slug, command: "fake-mcp", args: [], env: {} };
}

// Drive a JSON-RPC response frame into the proc's stdout buffer. Matches
// the entry's `onData` parser (newline-delimited JSON, id-keyed dispatch).
function respondTo(proc, id, result) {
  const frame = JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
  proc.stdout.emit("data", Buffer.from(frame, "utf8"));
}

function respondError(proc, id, error) {
  const frame = JSON.stringify({ jsonrpc: "2.0", id, error }) + "\n";
  proc.stdout.emit("data", Buffer.from(frame, "utf8"));
}

// Wait one event-loop tick so the `setImmediate` inside `spawn()` resolves
// `entry.initializing` (the proc is "writable" after the next tick).
function tick() {
  return new Promise((r) => setImmediate(r));
}

// Returns the most recently spawned fake proc.
function lastProc() {
  return fakeProcs[fakeProcs.length - 1];
}

// Count `initialize` frames written to the proc's stdin so far.
function initWrites(proc) {
  return (proc._writes || []).filter((w) => {
    try {
      const obj = JSON.parse(w.replace(/\n$/, ""));
      return obj && obj.method === "initialize";
    } catch {
      return false;
    }
  });
}

// Wait until at least `n` frames have been written to the proc's stdin.
// Used to synchronize responses with asynchronous request issuance.
async function waitForWrites(proc, n) {
  while ((proc._writes || []).length < n) {
    await tick();
  }
}

beforeEach(() => {
  fakeProcs.length = 0;
  getStore().clear();
});

describe("StdioEntry — MCP-01 process-scoped init state", () => {
  it("re-initializes after respawn: new spawn() resets state and a fresh initialize frame is sent", async () => {
    const instance = makeInstance();
    getStore().set(instance.id, new StdioEntry(instance));
    const entry = getEntry(instance);

    // First spawn + initialize.
    await entry.ensure();
    await tick();
    const procA = lastProc();
    expect(initWrites(procA)).toHaveLength(0); // not yet initialized

    // Wait for the initialize frame to be written before responding.
    const p1 = entry.ensureInitialized();
    await waitForWrites(procA, 1);
    respondTo(procA, 1, {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "fake" },
    });
    await p1;
    expect(entry.initialized).toBe(true);
    expect(initWrites(procA)).toHaveLength(1);

    // Simulate child death — exit handler nulls out the proc, but does NOT
    // touch init-state (spawn() owns that reset).
    procA.emit("exit", 1, null);
    expect(entry.proc).toBeNull();

    // Re-spawn via ensure(). Right after spawn() returns and `initializing`
    // resolves, the entry MUST be back to fresh: this is the core MCP-01
    // decoupling fix — a fresh child has never seen `initialize`.
    const ensureP = entry.ensure();
    await tick();
    expect(entry.initialized).toBe(false);
    expect(entry.initPromise).toBeNull();
    expect(entry.initInfo).toBeNull();
    await ensureP;

    const procB = lastProc();
    expect(procB).not.toBe(procA);

    // Run the full listTools flow on the new proc to prove a new initialize
    // frame is sent on the new process (the named MCP-01 bug regression test).
    // Note: the entry's `nextId` is not reset on spawn() (intentional — id
    // allocation is per-entry, not per-process), so the initialize frame on
    // procB uses the next id after procA's handshake. The test only cares
    // that ONE initialize frame lands on procB, not the literal id value.
    const toolsPromise = listTools(instance);
    await waitForWrites(procB, 1); // initialize frame
    // Capture the request id that procB's initialize used, so the response
    // matches the pending entry even if it isn't 1.
    const initFrame = JSON.parse((procB._writes[0] || "").replace(/\n$/, ""));
    const initId = initFrame.id;
    respondTo(procB, initId, {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "fake" },
    });
    // After the initialize response, the entry writes notifications/initialized
    // (no id) and listTools writes tools/list (next id). Wait for the third
    // frame and respond to the tools/list id.
    await waitForWrites(procB, 3);
    const toolsFrame = JSON.parse((procB._writes[2] || "").replace(/\n$/, ""));
    respondTo(procB, toolsFrame.id, { tools: [{ name: "echo" }] });
    const tools = await toolsPromise;
    expect(tools).toEqual([{ name: "echo" }]);
    // Exactly one new initialize frame was sent on the new proc — the
    // critical MCP-01 regression assertion.
    expect(initWrites(procB)).toHaveLength(1);
  });

  it("single-flight: two concurrent ensureInitialized() send exactly one initialize frame", async () => {
    const instance = makeInstance();
    getStore().set(instance.id, new StdioEntry(instance));
    const entry = getEntry(instance);
    await entry.ensure();
    await tick();
    const proc = lastProc();

    // Two concurrent calls — only one frame should be written.
    const p1 = entry.ensureInitialized();
    const p2 = entry.ensureInitialized();
    expect(initWrites(proc)).toHaveLength(1);
    // p2 is already settled (resolved with the same value as p1) by sharing initPromise.
    respondTo(proc, 1, {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "fake" },
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(entry.initialized).toBe(true);
    expect(initWrites(proc)).toHaveLength(1);
  });

  it("init-state is not stored on the per-request instance object", async () => {
    const instance = makeInstance();
    getStore().set(instance.id, new StdioEntry(instance));
    const entry = getEntry(instance);
    await entry.ensure();
    await tick();
    const proc = lastProc();
    const p = entry.ensureInitialized();
    respondTo(proc, 1, {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "fake" },
    });
    await p;

    // Decoupling: init lives on the entry, not the request-scoped instance.
    expect(instance.__mcpInit).toBeUndefined();
    expect(entry.initInfo).toEqual({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "fake" },
    });
  });

  it("spawn() resets initialized, initPromise, initInfo, buffer, and pending", async () => {
    const instance = makeInstance();
    const entry = new StdioEntry(instance);

    // Pre-pollute state as if a previous process had been initialized with
    // pending in-flight work and a half-read buffer.
    entry.initialized = true;
    entry.initPromise = Promise.resolve({ leaked: true });
    entry.initInfo = {
      protocolVersion: "leaked",
      serverInfo: { leaked: true },
    };
    entry.buffer = "garbage line\npartial";
    entry.pending.set(99, {
      resolve() {},
      reject() {},
      timer: setTimeout(() => {}, 1),
    });

    entry.spawn();
    await tick();

    expect(entry.initialized).toBe(false);
    expect(entry.initPromise).toBeNull();
    expect(entry.initInfo).toBeNull();
    expect(entry.buffer).toBe("");
    expect(entry.pending.size).toBe(0);
  });

  it("failed initialize rejects, evicts the store entry, and leaves initialized=false", async () => {
    const instance = makeInstance("inst-fail", "fail-mcp");
    getStore().set(instance.id, new StdioEntry(instance));
    const entry = getEntry(instance);
    await entry.ensure();
    await tick();
    const proc = lastProc();

    const p = entry.ensureInitialized();
    respondError(proc, 1, { code: -32602, message: "unsupported protocol" });
    await expect(p).rejects.toThrow(/initialize failed/);

    // Evicted so the next request gets a fresh spawn.
    expect(getStore().has(instance.id)).toBe(false);
    // initPromise cleared so a later call can retry; initialized still false.
    expect(entry.initialized).toBe(false);
    expect(entry.initPromise).toBeNull();
  });
});
