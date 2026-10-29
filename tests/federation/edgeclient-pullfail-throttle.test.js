// R3-03 — edge pull-failure log throttle.
//
// A long central outage must produce bounded log volume: the first pull
// failure logs at warn, repeats are logged only every 12th consecutive
// failure, and any success resets the counter. Also pins the branch order
// that made the "pull blocked" (schema-version) warn unreachable before
// R3-03: blocked results carry ok:false, so the blocked flag must be
// checked BEFORE the !ok branch.
//
// Determinism: the poll timer keeps running while vi.waitFor polls, so
// exact fetch-call-count assertions are racy — assertions use MILESTONE
// waits (>= N calls, then act) with a 100ms interval, keeping every
// assertion inside its throttle window (12 × 100ms of headroom).
// Pattern mirrors tests/federation/custom-server-loops.test.js: env scrub,
// real temp sqlite via DATA_DIR, vi.resetModules.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const FED_ENV_KEYS = [
  "FEDERATION_MODE",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_SYNC_INTERVAL_MS",
  "FEDERATION_TOKEN",
];

let tempDir;
let savedEnv = {};
let savedDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pullfail-"));
  for (const k of FED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  process.env.FEDERATION_MODE = "edge";
  process.env.FEDERATION_CENTRAL_URL = "http://central.invalid";
  process.env.FEDERATION_EDGE_ID = "edge-test";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  for (const k of FED_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
});

// A delta payload the real apply path accepts (empty batch, valid watermark).
// Built fresh per call — the response object carries a `json` function, which
// structuredClone() cannot copy (DataCloneError would silently turn every
// "successful" mock fetch into a failure).
function okDeltaResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ maxVersion: 1, rows: [], tombstones: [] }),
  };
}

function failedWarns(warnSpy) {
  return warnSpy.mock.calls.filter((a) => String(a[0]).includes("pull failed"));
}

describe("edgeClient.start — pull failure log throttle (R3-03)", () => {
  it("logs failure #1, then only every 12th consecutive failure, and resets on success", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { start } = await import("@/lib/federation/edgeClient.js");

    let mode = "fail";
    const fetchImpl = vi.fn(async () => {
      if (mode === "fail") throw new Error("fetch failed");
      return okDeltaResponse();
    });
    const timer = start({ fetchImpl, intervalMs: 100 });
    expect(timer).not.toBeNull();

    // Reach the first throttle checkpoint (>= 12 consecutive failures):
    // warn logged at #1 and #12 — exactly 2 while failures 12..23 have run.
    await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(12), { timeout: 4000 });
    expect(failedWarns(warnSpy)).toHaveLength(2);
    expect(String(failedWarns(warnSpy)[0][0])).toMatch(/pull failed: fetch failed$/);
    expect(String(failedWarns(warnSpy)[1][0])).toMatch(/consecutive failure #12/);

    // Central recovers: a success tick applies on the real temp sqlite and
    // resets the counter. No new failure lines appear.
    const callsAtRecovery = fetchImpl.mock.calls.length;
    mode = "ok";
    await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThan(callsAtRecovery));
    expect(failedWarns(warnSpy)).toHaveLength(2);

    // First failure after recovery counts from 1 again → logged without the
    // consecutive tag (and only once — the next log would need 12 more).
    mode = "fail";
    await vi.waitFor(() => expect(failedWarns(warnSpy)).toHaveLength(3));
    expect(String(failedWarns(warnSpy)[2][0])).toMatch(/pull failed: fetch failed$/);
    expect(failedWarns(warnSpy)).toHaveLength(3);

    clearInterval(timer);
  });

  it("still warns on schema-blocked pulls (blocked checked before !ok)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { start } = await import("@/lib/federation/edgeClient.js");

    // schemaVersion above the local migration version → SchemaBlockedError
    // → pullOnce returns { ok:false, blocked:true }.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ schemaVersion: 9999, maxVersion: 1, rows: [], tombstones: [] }),
    }));
    const timer = start({ fetchImpl, intervalMs: 100 });
    expect(timer).not.toBeNull();

    await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2));
    const blockedLines = warnSpy.mock.calls.filter((a) => String(a[0]).includes("pull blocked"));
    expect(blockedLines.length).toBeGreaterThanOrEqual(2); // unthrottled, and reachable
    expect(failedWarns(warnSpy)).toHaveLength(0); // blocked pulls do not count as failures

    clearInterval(timer);
  });
});
