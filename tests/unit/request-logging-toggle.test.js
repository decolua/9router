import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalEnv = {
  dataDir: process.env.DATA_DIR,
  requestLogs: process.env.ENABLE_REQUEST_LOGS,
};

let tempDir;
let db;

function setEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function loadDb(requestLogs) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-request-logging-"));
  process.env.DATA_DIR = tempDir;
  setEnv("ENABLE_REQUEST_LOGS", requestLogs);
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({
    enableObservability: true,
    observabilityBatchSize: 1,
    observabilityFlushIntervalMs: 1,
  });
}

async function closeDb() {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  db = undefined;
}

afterEach(async () => {
  await closeDb();
  setEnv("DATA_DIR", originalEnv.dataDir);
  setEnv("ENABLE_REQUEST_LOGS", originalEnv.requestLogs);
  vi.restoreAllMocks();
});

describe.sequential("ENABLE_REQUEST_LOGS", () => {
  it("gates all captured console levels while allowing them when enabled", async () => {
    const levels = ["log", "info", "warn", "error", "debug"];
    const originals = Object.fromEntries(levels.map((level) => [level, console[level]]));
    const forwarded = [];
    for (const level of levels) console[level] = (...args) => forwarded.push([level, args]);

    try {
      setEnv("ENABLE_REQUEST_LOGS", "false");
      delete global._consoleLogBufferState;
      vi.resetModules();
      const capture = await import("@/lib/consoleLogBuffer.js");
      capture.initConsoleLogCapture();
      for (const level of levels) console[level]("hidden");
      expect(forwarded).toHaveLength(0);
      expect(capture.getConsoleLogs()).toEqual([]);

      setEnv("ENABLE_REQUEST_LOGS", " TRUE ");
      console.log("visible");
      expect(forwarded).toHaveLength(1);
      expect(capture.getConsoleLogs()).toContain("visible");
    } finally {
      const state = global._consoleLogBufferState;
      if (state?.flushTimer) clearTimeout(state.flushTimer);
      for (const level of levels) console[level] = originals[level];
      delete global._consoleLogBufferState;
    }
  });

  it("gates request logger helpers without changing the existing log-level API", async () => {
    setEnv("ENABLE_REQUEST_LOGS", "false");
    vi.resetModules();
    const logger = await import("../../src/sse/utils/logger.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.line("tag", "→", "line");
    logger.request("GET", "/v1/models");
    logger.response(200, 4);
    logger.stream("done");
    logger.errorLine("tag", "✗", "error");
    logger.warn("tag", "warning");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    setEnv("ENABLE_REQUEST_LOGS", "true");
    logger.line("tag", "→", "line");
    logger.request("GET", "/v1/models");
    logger.response(200, 4);
    logger.stream("done");
    expect(logSpy).toHaveBeenCalledTimes(4);
  });

  it("does not persist request details or usage when explicitly disabled", async () => {    await loadDb("false");
    const timestamp = new Date().toISOString();
    await db.saveRequestDetail({
      id: "disabled-detail",
      timestamp,
      provider: "openai",
      model: "gpt-test",
      status: "success",
      request: { messages: [{ role: "user", content: "secret" }] },
    });
    await db.saveRequestUsage({
      timestamp,
      provider: "openai",
      model: "gpt-test",
      tokens: { prompt_tokens: 3, completion_tokens: 2 },
      status: "success",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await db.getRequestDetailById("disabled-detail")).toBeNull();
    expect(await db.getUsageHistory({ model: "gpt-test" })).toEqual([]);
  });

  it("persists request details and usage when explicitly enabled", async () => {
    await loadDb(" TrUe ");
    const timestamp = new Date().toISOString();
    await db.saveRequestDetail({
      id: "enabled-detail",
      timestamp,
      provider: "openai",
      model: "gpt-test",
      status: "success",
      request: { headers: { authorization: "secret", accept: "application/json" } },
    });
    await db.saveRequestUsage({
      timestamp,
      provider: "openai",
      model: "gpt-test",
      tokens: { prompt_tokens: 3, completion_tokens: 2 },
      status: "success",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    const detail = await db.getRequestDetailById("enabled-detail");
    expect(detail?.provider).toBe("openai");
    expect(detail?.request?.headers).toEqual({ accept: "application/json" });
    expect(await db.getUsageHistory({ model: "gpt-test" })).toHaveLength(1);
  });

  it("keeps existing settings fallback when the environment variable is unset", async () => {
    await loadDb(undefined);
    await db.updateSettings({ enableObservability: false });
    await db.saveRequestDetail({
      id: "unset-detail",
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-test",
      status: "success",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await db.getRequestDetailById("unset-detail")).toBeNull();
  });

  it("stops tracking live activity when explicitly disabled", async () => {
    await loadDb("false");
    // usageRepo binds its pending state to this global object at import;
    // replace the contents so no other test can leak into this assertion.
    if (global._pendingRequests) {
      global._pendingRequests.byModel = {};
      global._pendingRequests.byAccount = {};
    }
    let pendingFired = 0;
    const onPending = () => { pendingFired++; };
    db.statsEmitter.on("pending", onPending);
    try {
      db.trackPendingRequest("gpt-test", "openai", "conn-1", true);
      expect((await db.getActiveRequests()).activeRequests).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(pendingFired).toBe(0);
    } finally {
      db.statsEmitter.off("pending", onPending);
    }
  });

  it("tracks live activity when explicitly enabled", async () => {
    await loadDb("true");
    if (global._pendingRequests) {
      global._pendingRequests.byModel = {};
      global._pendingRequests.byAccount = {};
    }
    const onPending = () => {};
    db.statsEmitter.on("pending", onPending);
    try {
      db.trackPendingRequest("gpt-test", "openai", "conn-1", true);
      const active = (await db.getActiveRequests()).activeRequests;
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ model: "gpt-test", provider: "openai", count: 1 });
      db.trackPendingRequest("gpt-test", "openai", "conn-1", false);
      expect((await db.getActiveRequests()).activeRequests).toEqual([]);
    } finally {
      db.statsEmitter.off("pending", onPending);
    }
  });
});
