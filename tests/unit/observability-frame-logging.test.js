//
// Covers:
//   1. the shared observability resolver (settings authoritative, env only an initial
//      default, master switch gates frame logging, defaults),
//   2. the frame-log retention janitor (deletes only expired sessions, only inside its own
//      marked directory),
//   3. that open-sse/utils/requestLogger.js actually honours the runtime gate.

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// dataDir.js resolves DATA_DIR at import time — pin it (and the frame-log dir) to a temp
// area before anything under test is loaded, so no test can touch a real location.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "9r-frame-logs-"));
process.env.DATA_DIR = path.join(TMP_ROOT, "data");
process.env.OBSERVABILITY_FRAME_LOG_DIR = path.join(TMP_ROOT, "data", "logs", "frames");

const {
  resolveObservabilityConfig,
  OBSERVABILITY_DEFAULTS,
  MAX_RETENTION_HOURS,
  MAX_LOG_SIZE_MB,
} = await import("@/lib/observability/config.js");

const {
  pruneFrameLogs,
  ensureFrameLogDir,
  getFrameLogDir,
  sessionTimestampFromName,
  reserveFrameBytes,
  frameDiskHasRoom,
  scheduleFrameLogPrune,
  __frameLogPruneSettled,
  configureFrameLogBudget,
  getFrameLogBudgetState,
  FRAME_LOG_MARKER_FILE,
  __resetFrameLogPruneState,
} = await import("@/lib/observability/frameLogs.js");

afterAll(() => {
  __resetFrameLogPruneState();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Resolver
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveObservabilityConfig", () => {
  it("defaults to observability off, frame logging off, 12h retention", () => {
    const c = resolveObservabilityConfig();
    expect(c.enabled).toBe(false);
    expect(c.frameLogging).toBe(false);
    expect(c.retentionHours).toBe(12);
    expect(OBSERVABILITY_DEFAULTS.observabilityFrameLogging).toBe(false);
    expect(OBSERVABILITY_DEFAULTS.observabilityRetentionHours).toBe(12);
  });

  it("flips BOTH gates from the single settings source", () => {
    const raw = { enableObservability: true, observabilityFrameLogging: true };
    const on = resolveObservabilityConfig({ raw });
    expect(on).toMatchObject({ enabled: true, frameLogging: true });

    const off = resolveObservabilityConfig({ raw: { ...raw, enableObservability: false } });
    expect(off).toMatchObject({ enabled: false, frameLogging: false });
  });

  it("keeps frame logging subordinate to the master switch", () => {
    // Master off, frames explicitly on → frames stay off.
    expect(resolveObservabilityConfig({
      raw: { enableObservability: false, observabilityFrameLogging: true },
    }).frameLogging).toBe(false);

    // Master on, frames not chosen → frames still off (default false).
    expect(resolveObservabilityConfig({
      raw: { enableObservability: true },
    }).frameLogging).toBe(false);
  });

  // Regression: ENABLE_REQUEST_LOGS used to short-circuit before settings were read, so any
  // value of it (including "false") made the runtime toggle inert.
  it("never lets the env var render the runtime toggle inert", () => {
    const env = { ENABLE_REQUEST_LOGS: "false" };
    expect(resolveObservabilityConfig({
      raw: { enableObservability: true, observabilityFrameLogging: true }, env,
    })).toMatchObject({ enabled: true, frameLogging: true });

    expect(resolveObservabilityConfig({
      raw: { enableObservability: false }, env: { ENABLE_REQUEST_LOGS: "true" },
    })).toMatchObject({ enabled: false, frameLogging: false });
  });

  it("uses the env var only as an initial default, while the setting is absent", () => {
    expect(resolveObservabilityConfig({ env: { ENABLE_REQUEST_LOGS: "true" } }))
      .toMatchObject({ enabled: true, frameLogging: true });
    expect(resolveObservabilityConfig({ env: { ENABLE_REQUEST_LOGS: "false" } }))
      .toMatchObject({ enabled: false, frameLogging: false });
    expect(resolveObservabilityConfig({ env: { OBSERVABILITY_FRAME_LOGGING: "true" } }).frameLogging)
      .toBe(false); // master still off
    expect(resolveObservabilityConfig({
      env: { OBSERVABILITY_ENABLED: "true", OBSERVABILITY_FRAME_LOGGING: "true" },
    })).toMatchObject({ enabled: true, frameLogging: true });
  });

  // Regression: the OBSERVABILITY_ENABLED branch was unreachable because the merged settings
  // snapshot always carried a boolean. Presence is now tested on the RAW row, so it runs.
  it("reaches the OBSERVABILITY_ENABLED fallback (was dead code)", () => {
    const merged = { enableObservability: false }; // what mergeWithDefaults always produces
    const c = resolveObservabilityConfig({
      raw: {}, settings: merged, env: { OBSERVABILITY_ENABLED: "true" },
    });
    expect(c.enabled).toBe(true);
  });

  it("ignores a non-boolean stored value and falls through to the env default", () => {
    const c = resolveObservabilityConfig({
      raw: { enableObservability: "yes" }, env: { OBSERVABILITY_ENABLED: "true" },
    });
    expect(c.enabled).toBe(true);
  });

  it("resolves and clamps the retention window", () => {
    expect(resolveObservabilityConfig({ raw: { observabilityRetentionHours: 48 } }).retentionHours).toBe(48);
    expect(resolveObservabilityConfig({ env: { OBSERVABILITY_RETENTION_HOURS: "6" } }).retentionHours).toBe(6);
    expect(resolveObservabilityConfig({ raw: { observabilityRetentionHours: 0 } }).retentionHours).toBe(12);
    expect(resolveObservabilityConfig({ raw: { observabilityRetentionHours: "nope" } }).retentionHours).toBe(12);
    expect(resolveObservabilityConfig({ raw: { observabilityRetentionHours: 99999 } }).retentionHours)
      .toBe(MAX_RETENTION_HOURS);
    expect(resolveObservabilityConfig({ settings: { observabilityRetentionHours: 24 } }).retentionHours).toBe(24);
  });

  it("resolves and clamps the frame-log size budget", () => {
    expect(resolveObservabilityConfig().maxLogSizeMb).toBe(512);
    expect(resolveObservabilityConfig().maxLogSizeBytes).toBe(512 * 1024 * 1024);
    expect(resolveObservabilityConfig({ raw: { observabilityMaxLogSizeMb: 64 } }).maxLogSizeMb).toBe(64);
    expect(resolveObservabilityConfig({ env: { OBSERVABILITY_MAX_LOG_SIZE_MB: "128" } }).maxLogSizeMb).toBe(128);
    expect(resolveObservabilityConfig({ raw: { observabilityMaxLogSizeMb: 0 } }).maxLogSizeMb).toBe(512);
    expect(resolveObservabilityConfig({ raw: { observabilityMaxLogSizeMb: 1e9 } }).maxLogSizeMb)
      .toBe(MAX_LOG_SIZE_MB);
  });

  it("keeps the upstream SQLite tuning semantics", () => {
    const c = resolveObservabilityConfig({
      settings: { observabilityMaxRecords: 1000, observabilityBatchSize: 20, observabilityFlushIntervalMs: 5000, observabilityMaxJsonSize: 5 },
    });
    expect(c).toMatchObject({ maxRecords: 1000, batchSize: 20, flushIntervalMs: 5000, maxJsonSize: 5 * 1024 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Retention janitor
// ─────────────────────────────────────────────────────────────────────────────
const HOUR = 60 * 60 * 1000;

function stampFor(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${p(d.getMilliseconds(), 3)}`;
}

function makeSession(dir, ageHours, now, bytes = 32) {
  const name = `claude_gemini_gemini-2.5-pro_${stampFor(now - ageHours * HOUR)}`;
  const p = path.join(dir, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "5_res_provider.txt"), "x".repeat(bytes));
  return name;
}

describe("pruneFrameLogs", () => {
  let sandbox;
  let logDir;
  const NOW = new Date("2026-09-10T12:00:00").getTime();

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(TMP_ROOT, "case-"));
    logDir = path.join(sandbox, "data", "logs", "frames");
    ensureFrameLogDir(logDir);
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("deletes only the expired sessions and nothing else in the directory", async () => {
    const expiredA = makeSession(logDir, 13, NOW);
    const expiredB = makeSession(logDir, 72, NOW);
    const fresh = makeSession(logDir, 2, NOW);

    // Things that must survive: a non-session directory, a loose file, the marker.
    fs.mkdirSync(path.join(logDir, "not-a-session"), { recursive: true });
    fs.writeFileSync(path.join(logDir, "provider-2026-09-10.log"), "keep me");

    // ...and a sibling tree outside the frame-log directory (e.g. $DATA_DIR/logs/mitm).
    const sibling = path.join(sandbox, "data", "logs", "mitm");
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "dump.txt"), "untouchable");

    const report = await pruneFrameLogs({ dir: logDir, retentionHours: 12, now: NOW });

    expect(report.skipped).toBeUndefined();
    expect(report.scanned).toBe(3);
    expect(report.removed.sort()).toEqual([expiredA, expiredB].sort());
    expect(report.errors).toBe(0);

    expect(fs.existsSync(path.join(logDir, expiredA))).toBe(false);
    expect(fs.existsSync(path.join(logDir, expiredB))).toBe(false);
    expect(fs.existsSync(path.join(logDir, fresh))).toBe(true);
    expect(fs.existsSync(path.join(logDir, "not-a-session"))).toBe(true);
    expect(fs.existsSync(path.join(logDir, "provider-2026-09-10.log"))).toBe(true);
    expect(fs.existsSync(path.join(logDir, FRAME_LOG_MARKER_FILE))).toBe(true);
    expect(fs.readFileSync(path.join(sibling, "dump.txt"), "utf8")).toBe("untouchable");
  });

  it("refuses to prune a directory without the marker file", async () => {
    const foreign = path.join(sandbox, "someone-elses", "logs");
    fs.mkdirSync(foreign, { recursive: true });
    const victim = makeSession(foreign, 999, NOW);

    const report = await pruneFrameLogs({ dir: foreign, retentionHours: 1, now: NOW });

    expect(report.skipped).toBe("no-marker");
    expect(report.removed).toEqual([]);
    expect(fs.existsSync(path.join(foreign, victim))).toBe(true);
  });

  it("refuses obviously unsafe or missing targets", async () => {
    expect((await pruneFrameLogs({ dir: path.parse(process.cwd()).root })).skipped).toBe("unsafe-path");
    expect((await pruneFrameLogs({ dir: os.homedir() })).skipped).toBe("unsafe-path");
    expect((await pruneFrameLogs({ dir: "" })).skipped).toBe("no-dir");
    expect((await pruneFrameLogs({ dir: path.join(sandbox, "nope") })).skipped).toBe("missing");
  });

  it("does not follow a symlink that points outside the directory", async () => {
    const outside = path.join(sandbox, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "precious.txt"), "keep");

    const linkName = `claude_openai_gpt_${stampFor(NOW - 99 * HOUR)}`;
    try {
      fs.symlinkSync(outside, path.join(logDir, linkName), "dir");
    } catch {
      return; // no symlink permission (e.g. Windows without dev mode) — nothing to assert
    }

    const report = await pruneFrameLogs({ dir: logDir, retentionHours: 1, now: NOW });
    expect(report.removed).toEqual([]);
    expect(fs.existsSync(path.join(outside, "precious.txt"))).toBe(true);
    expect(fs.existsSync(path.join(logDir, linkName))).toBe(true);
  });

  it("enforces the byte budget oldest-first once the age cap is satisfied", async () => {
    const oldest = makeSession(logDir, 5, NOW, 4096);
    const middle = makeSession(logDir, 3, NOW, 4096);
    const newest = makeSession(logDir, 1, NOW, 4096);

    const report = await pruneFrameLogs({
      dir: logDir, retentionHours: 12, maxTotalBytes: 5000, now: NOW,
    });

    expect(report.removed).toEqual([oldest, middle]);
    expect(fs.existsSync(path.join(logDir, newest))).toBe(true);
    expect(report.keptBytes).toBeLessThanOrEqual(5000);
  });

  it("parses (and only accepts) frame session folder names", () => {
    expect(sessionTimestampFromName("claude_gemini_x_20260910_120000_000")).toBe(
      new Date(2026, 8, 10, 12, 0, 0, 0).getTime(),
    );
    expect(sessionTimestampFromName("not-a-session")).toBeNull();
    expect(sessionTimestampFromName("mitm")).toBeNull();
    expect(sessionTimestampFromName("translator")).toBeNull();
  });

  it("points at $DATA_DIR/logs/frames (never the ephemeral cwd) by default", () => {
    const saved = process.env.OBSERVABILITY_FRAME_LOG_DIR;
    delete process.env.OBSERVABILITY_FRAME_LOG_DIR;
    try {
      const dir = getFrameLogDir();
      expect(dir.endsWith(path.join("logs", "frames"))).toBe(true);
      expect(dir.startsWith(path.resolve(process.env.DATA_DIR))).toBe(true);
      expect(dir.startsWith(path.resolve(process.cwd()))).toBe(false);
    } finally {
      process.env.OBSERVABILITY_FRAME_LOG_DIR = saved;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2b. Size budget enforced on write (not only on the timer)
// ─────────────────────────────────────────────────────────────────────────────
describe("frame-log size budget", () => {
  let sandbox;
  let logDir;
  const NOW = new Date("2026-09-10T12:00:00").getTime();

  beforeEach(() => {
    __resetFrameLogPruneState();
    sandbox = fs.mkdtempSync(path.join(TMP_ROOT, "budget-"));
    logDir = path.join(sandbox, "data", "logs", "frames");
    ensureFrameLogDir(logDir);
  });

  afterEach(() => {
    __resetFrameLogPruneState();
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("charges writes against a running total and stops writing at the budget", () => {
    configureFrameLogBudget({ maxLogSizeBytes: 1000 });

    expect(reserveFrameBytes(400, { dir: logDir })).toBe(true);
    expect(getFrameLogBudgetState().usedBytes).toBe(400);
    expect(reserveFrameBytes(400, { dir: logDir })).toBe(true);   // 800 — over high water
    expect(reserveFrameBytes(400, { dir: logDir })).toBe(false);  // 1200 — over budget
    expect(getFrameLogBudgetState().suppressed).toBe(true);

    // Further writes are refused rather than throwing; traffic is unaffected.
    expect(reserveFrameBytes(1, { dir: logDir })).toBe(false);
  });

  it("resumes writing once the SIZE trim has brought usage back under budget", async () => {
    // Three 4096-byte sessions, all minutes old — the AGE cap can never fire here, so this
    // exercises the size path only. Budget 12000 B: the janitor must drop the oldest
    // session (12288 → 8192) and that is below the 80% resume mark (9600).
    const realNow = Date.now();
    const oldest = makeSession(logDir, 0.5, realNow, 4096);
    makeSession(logDir, 0.3, realNow, 4096);
    const newest = makeSession(logDir, 0.1, realNow, 4096);

    configureFrameLogBudget({ maxLogSizeBytes: 12000 });
    expect(reserveFrameBytes(12000, { dir: logDir })).toBe(false);
    expect(getFrameLogBudgetState().suppressed).toBe(true);

    // reserveFrameBytes already kicked a forced sweep; wait for it to land.
    await __frameLogPruneSettled();

    const state = getFrameLogBudgetState();
    expect(state.suppressed).toBe(false);
    expect(state.usedBytes).toBe(8192);
    expect(fs.existsSync(path.join(logDir, oldest))).toBe(false);
    expect(fs.existsSync(path.join(logDir, newest))).toBe(true);
    expect(reserveFrameBytes(10, { dir: logDir })).toBe(true);
  });

  it("stops writing when free disk is below the floor, and says so once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // A floor larger than any real filesystem forces the guard to trip.
      process.env.OBSERVABILITY_FRAME_LOG_MIN_FREE_MB = String(1024 * 1024 * 64); // 64 PiB
      expect(frameDiskHasRoom(logDir)).toBe(false);
      expect(getFrameLogBudgetState().suppressed).toBe(true);
      expect(frameDiskHasRoom(logDir)).toBe(false);
      expect(frameDiskHasRoom(logDir)).toBe(false);
      // Logged on the transition only — not once per call.
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.OBSERVABILITY_FRAME_LOG_MIN_FREE_MB;
      warn.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. requestLogger honours the runtime gate
// ─────────────────────────────────────────────────────────────────────────────
const gate = vi.hoisted(() => ({
  value: { enabled: false, frameLogging: false, retentionHours: 12 },
}));

vi.mock("@/lib/observability/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getObservabilityConfig: async () => gate.value };
});

describe("createRequestLogger runtime gate", () => {
  it("returns a no-op logger while frame logging is off, and captures once it is on", async () => {
    const { createRequestLogger } = await import("open-sse/utils/requestLogger.js");
    const frameDir = process.env.OBSERVABILITY_FRAME_LOG_DIR;

    gate.value = { enabled: true, frameLogging: false, retentionHours: 12 };
    const off = await createRequestLogger("claude", "gemini", "gemini-2.5-pro");
    off.appendProviderChunk("data: nope\n");
    expect(off.sessionPath).toBeNull();

    // No redeploy, no re-import: the same module now captures because the setting changed.
    gate.value = { enabled: true, frameLogging: true, retentionHours: 12 };
    const on = await createRequestLogger("claude", "gemini", "gemini-2.5-pro");
    expect(on.sessionPath).toBeTruthy();
    expect(on.sessionPath.startsWith(frameDir)).toBe(true);
    on.appendProviderChunk("data: {\"finishReason\":\"SAFETY\"}\n");
    expect(fs.readFileSync(path.join(on.sessionPath, "5_res_provider.txt"), "utf8"))
      .toContain("SAFETY");

    // Master switch off ⇒ frames off again.
    gate.value = { enabled: false, frameLogging: false, retentionHours: 12 };
    const offAgain = await createRequestLogger("claude", "gemini", "gemini-2.5-pro");
    expect(offAgain.sessionPath).toBeNull();

    __resetFrameLogPruneState();
  });

  it("stops writing frames when the size budget is exhausted, without breaking the request", async () => {
    const { createRequestLogger } = await import("open-sse/utils/requestLogger.js");
    __resetFrameLogPruneState();

    gate.value = { enabled: true, frameLogging: true, retentionHours: 12, maxLogSizeBytes: 4096 };
    const logger = await createRequestLogger("claude", "gemini", "gemini-2.5-pro");
    expect(logger.sessionPath).toBeTruthy();
    await __frameLogPruneSettled(); // let the startup sweep anchor the running total

    const file = path.join(logger.sessionPath, "5_res_provider.txt");

    logger.appendProviderChunk("a".repeat(1000));      // fits
    expect(fs.statSync(file).size).toBe(1000);

    logger.appendProviderChunk("b".repeat(8000));      // would blow the 4096 B budget
    expect(fs.statSync(file).size).toBe(1000);         // refused, nothing written
    expect(getFrameLogBudgetState().suppressed).toBe(true);

    // Still refused, and the logger keeps behaving like a logger — a request that streams
    // through a suppressed logger must not throw.
    expect(() => logger.appendProviderChunk("c")).not.toThrow();
    expect(() => logger.logProviderResponse(200, "OK", {}, { body: "x" })).not.toThrow();
    expect(fs.statSync(file).size).toBe(1000);

    __resetFrameLogPruneState();
  });
  it("never writes a usable credential to disk (request headers, response headers, URL key)", async () => {
    const { createRequestLogger } = await import("open-sse/utils/requestLogger.js");
    __resetFrameLogPruneState();
    gate.value = { enabled: true, frameLogging: true, retentionHours: 12 };
    const logger = await createRequestLogger("openai", "gemini", "gemini-2.5-pro");
    expect(logger.sessionPath).toBeTruthy();
    await __frameLogPruneSettled();

    const KEY = "AQ.Ab8-e2e-fake-credential-value-000000000XyZ9";
    logger.logClientRawRequest("/v1/chat/completions", { model: "m" }, { authorization: `Bearer ${KEY}` });
    logger.logRawRequest({ model: "m" }, { "x-api-key": KEY });
    logger.logTargetRequest(
      `https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse&key=${KEY}`,
      { "x-goog-api-key": KEY, "content-type": "application/json" },
      { contents: [] },
    );
    logger.logProviderResponse(401, "Unauthorized", new Headers({ "set-cookie": `session=${KEY}` }), { error: "x" });

    // Every file the session wrote, as one string: the key must not appear anywhere.
    const dump = fs.readdirSync(logger.sessionPath)
      .map((f) => fs.readFileSync(path.join(logger.sessionPath, f), "utf8"))
      .join("\n");
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain(KEY.slice(0, 16));
    expect(dump).toContain("***XyZ9");  // still tells an operator WHICH credential was used
    expect(dump).toContain("alt=sse");  // non-secret query params are kept
    expect(dump).toContain("application/json");

    __resetFrameLogPruneState();
  });
});
