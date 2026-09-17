// F-07 — in-flight usage persistence must survive an orderly shutdown.
//
// The SQLite driver being synchronous does NOT make saveRequestUsage synchronous:
// it awaits the adapter (init/migrations on the first call, DB I/O afterwards) and
// the cost lookup before its transaction. A shutdown that exits on the signal
// therefore loses writes that were already admitted. These tests spawn a CHILD
// process (never signal the test runner) and inspect the child's SQLite file
// afterwards.
//
// Non-tautology control: with the same workload, a child that exits without
// draining persists ZERO rows, so the assertions below can actually observe loss.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");
const originalDataDir = process.env.DATA_DIR;
const originalHome = process.env.HOME;

let tempDir;
let db;

function resetDbState() {
  const adapter = global._dbAdapter?.instance;
  if (adapter && typeof adapter.close === "function") {
    try { adapter.close(); } catch {}
  }
  delete global._dbAdapter;
  delete global._pendingRequests;
  delete global._recentRing;
  if (global.__shutdownCoordinator) {
    delete global.__shutdownCoordinator;
  }
  vi.resetModules();
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-drain-test-"));
  process.env.DATA_DIR = tempDir;
  process.env.HOME = tempDir;
  resetDbState();
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
});

afterEach(async () => {
  if (db && typeof db.closeAdapter === "function") {
    try { await db.closeAdapter(); } catch {}
  }
  resetDbState();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

// Plain `node` cannot resolve the app's "@/…"/"open-sse/…" specifiers (webpack does),
// so the child gets a resolve hook instead of a rewritten import graph.
const RESOLVER = `
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.REPO_ROOT;

function toFile(base) {
  for (const cand of [base, base + ".js", base + ".mjs", base + ".json", path.join(base, "index.js")]) {
    try { if (fs.statSync(cand).isFile()) return cand; } catch { /* try next */ }
  }
  return base;
}

export async function resolve(specifier, context, nextResolve) {
  // Timeout scenario: stall getPricingForModel (async) instead of the sync cost
  // math, so the drain deadline can actually fire while a REAL write is parked
  // mid-flight. A busy-wait would block the loop and the timer with it.
  if (process.env.MODE === "slow_write_timeout" && specifier.endsWith("pricingRepo.js")) {
    return {
      url: pathToFileURL(toFile(path.join(ROOT, "src", "lib", "db", "repos", "pricingRepo.js"))).href + "?slow_pricing_delay=1",
      shortCircuit: true,
    };
  }

  if (process.env.MODE === "slow_write_signal" && (specifier === "open-sse/providers/pricing.js" || specifier.endsWith("pricing.js"))) {
    const realPath = specifier.startsWith("open-sse/")
      ? path.join(ROOT, specifier)
      : path.join(ROOT, "src", "lib", "db", "repos", "pricingRepo.js");
    return {
      url: pathToFileURL(toFile(realPath)).href + "?slow_cost_delay=1",
      shortCircuit: true,
    };
  }

  if (specifier.startsWith("@/")) {
    return nextResolve(pathToFileURL(toFile(path.join(ROOT, "src", specifier.slice(2)))).href, context);
  }
  if (specifier === "open-sse" || specifier.startsWith("open-sse/")) {
    return nextResolve(pathToFileURL(toFile(path.join(ROOT, specifier))).href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.includes("slow_pricing_delay=1")) {
    const loaded = await nextLoad(url, { ...context, format: "module" });
    const source = typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source);
    if (!source.includes("export async function getPricingForModel(provider, model) {")) {
      throw new Error("[TEST LOADER] getPricingForModel export not found in " + url);
    }
    const patched = source.replace(
      "export async function getPricingForModel(provider, model) {",
      'export async function getPricingForModel(provider, model) {\\n  console.log("ENTERING_BLOCKED_PRICING_PATH:1");\\n  await new Promise((r) => setTimeout(r, 3000));\\n'
    );
    return { format: "module", shortCircuit: true, source: patched };
  }

  if (url.includes("slow_cost_delay=1")) {
    const loaded = await nextLoad(url, { ...context, format: "module" });
    const source = typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source);
    if (!source.includes("export function calculateCostFromTokens(")) {
      throw new Error("[TEST LOADER] calculateCostFromTokens export not found in " + url);
    }
    const patched = source.replace(
      "export function calculateCostFromTokens(tokens, pricing) {",
      'export function calculateCostFromTokens(tokens, pricing) {\\n  console.log("ENTERING_BLOCKED_COST_PATH:1");\\n  const t0 = Date.now(); while (Date.now() - t0 < 150) {}\\n'
    );
    return {
      format: "module",
      shortCircuit: true,
      source: patched,
    };
  }
  return nextLoad(url, context);
}
`;

const RESOLVER_HOOK = `
import { register } from "node:module";
register("./resolve.mjs", import.meta.url);
`;

const CHILD_SCRIPT = `
const _path = await import("node:path");
const mode = process.env.MODE;
const N = Number(process.env.N || "50");
const db = await import("@/lib/db/index.js");

function fireUsage() {
  for (let i = 0; i < N; i++) {
    db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      timestamp: "2026-09-16T12:00:00.000Z",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });
  }
}

if (mode === "control") {
  // The adapter used to call process.exit(0) on SIGTERM, i.e. the process left
  // while these writes were still awaiting the adapter. Same workload, no drain.
  fireUsage();
  process.exit(0);
}

if (process.env.DETAILS === "1") {
  // Buffered request details need an initialized adapter + observability on.
  await db.initDb();
  await db.updateSettings({
    enableObservability: true,
    observabilityBatchSize: 100000,
    observabilityFlushIntervalMs: 600000,
  });
  for (let i = 0; i < 5; i++) {
    db.saveRequestDetail({ id: "det-" + i, provider: "openai", model: "gpt-4o", status: "ok", request: { i }, response: { ok: true } });
  }
}

const { installShutdownCoordinator } = await import("@/shared/services/shutdownCoordinator.js");

if (mode === "repeat") {
  const stuck = new Promise(() => {});
  stuck.catch(() => {});
  global._pendingUsagePersists.inflight.add(stuck);
}

if (mode === "http_server_smoke") {
  const { pathToFileURL } = await import("node:url");
  await import(pathToFileURL(_path.join(process.env.REPO_ROOT, "custom-server.js")).href);
  const http = await import("node:http");
  const { installShutdownCoordinator } = await import("@/shared/services/shutdownCoordinator.js");
  let clientFinished = false;
  let secondClientDone = false;
  installShutdownCoordinator({
    drainTimeoutMs: 5000,
    // Hold the exit until both clients have been answered, so the assertions
    // below observe the real outcome instead of a race with process.exit().
    cleanup: async () => {
      for (let i = 0; i < 100 && !(clientFinished && secondClientDone); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/admitted") {
      db.saveRequestUsage({
        provider: "openai",
        model: "gpt-4o",
        timestamp: "2026-09-16T12:00:00.000Z",
        tokens: { prompt_tokens: 10, completion_tokens: 5 },
      });
      // Signal from INSIDE the handler: the request is now provably admitted and
      // in flight. A fixed delay from listen() races the client on a loaded box
      // and turns this into a flaky test.
      process.kill(process.pid, "SIGTERM");
      // Second client, issued while the shutdown is running and REQ1 is still
      // unanswered. stopAdmission() also closes the listening socket, so a new
      // connection may be refused before it reaches the wrapper — the 503 path
      // itself is proven deterministically by the http_503 mode.
      setTimeout(() => {
        const req2 = http.get("http://127.0.0.1:" + server.address().port + "/new", (res2) => {
          console.log("REQ2_STATUS:" + res2.statusCode);
          res2.resume();
          res2.on("end", () => { secondClientDone = true; });
        });
        req2.on("error", (err) => {
          console.log("REQ2_ERROR:" + err.code);
          secondClientDone = true;
        });
      }, 20);
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }, 100);
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    const req1 = http.get("http://127.0.0.1:" + port + "/admitted", (res1) => {
      let data = "";
      res1.on("data", (c) => { data += c; });
      res1.on("end", () => {
        console.log("REQ1_STATUS:" + res1.statusCode);
        clientFinished = true;
      });
    });

  });
} else if (mode === "http_503") {
  // Deterministic proof of the 503 admission path. stopAdmission() also closes
  // the listening socket, so a brand-new connection can be refused at the TCP
  // level before it ever reaches the wrapper — that is why the SIGTERM smoke
  // test above accepts ECONNREFUSED. Here the flag is flipped WITHOUT closing
  // the listener, so the request really does reach custom-server.js's wrapper.
  const { pathToFileURL } = await import("node:url");
  await import(pathToFileURL(_path.join(process.env.REPO_ROOT, "custom-server.js")).href);
  const http = await import("node:http");

  let handlerRan = false;
  const server = http.createServer((req, res) => {
    handlerRan = true;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    global.__shutdownCoordinator.shuttingDown = true;
    const req = http.get("http://127.0.0.1:" + port + "/v1/models", (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        console.log("STATUS:" + res.statusCode);
        console.log("BODY:" + data);
        console.log("HANDLER_RAN:" + handlerRan);
        server.close();
        process.exit(0);
      });
    });
    req.on("error", (err) => { console.log("ERROR:" + err.code); process.exit(2); });
  });
} else if (mode === "duplicate_signal") {
  // Production topology: systemd signals the whole cgroup AND the launcher
  // signals the server's process group. Two SIGTERMs, microseconds apart.
  installShutdownCoordinator({ drainTimeoutMs: 5000 });
  fireUsage();
  process.kill(process.pid, "SIGTERM");
  process.kill(process.pid, "SIGTERM");
} else if (mode === "additive_cleanup") {
  // instrumentation.js installs the coordinator at boot; initializeApp adds its
  // tunnel/DNS teardown later. The second install must NOT drop the first one's
  // cleanup, nor register a second set of signal handlers.
  installShutdownCoordinator({ drainTimeoutMs: 5000, cleanup: () => console.log("CLEANUP_A") });
  const second = installShutdownCoordinator({ drainTimeoutMs: 5000, cleanup: () => console.log("CLEANUP_B") });
  console.log("SECOND_INSTALL:" + second);
  console.log("SIGTERM_LISTENERS:" + process.listenerCount("SIGTERM"));
  fireUsage();
  process.kill(process.pid, "SIGTERM");
} else if (mode === "slow_write_signal") {
  installShutdownCoordinator({ drainTimeoutMs: 5000 });
  fireUsage();
} else if (mode === "slow_write_timeout") {
  // Short budget + a real write parked in async pricing → the drain deadline
  // fires with the write still in flight. Proves the bound AND that the hard
  // watchdog does not preempt cleanup/closeAdapter.
  installShutdownCoordinator({ drainTimeoutMs: 300 });
  fireUsage();
} else {
  installShutdownCoordinator({ drainTimeoutMs: 5000 });
  fireUsage();
  process.kill(process.pid, "SIGTERM");

  if (mode === "repeat") {
    // Beyond REPEAT_SIGNAL_GRACE_MS: this is a user asking again, not the
    // process tree delivering the same shutdown twice.
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 1500);
  }
}
`;

function writeChildFiles() {
  fs.writeFileSync(path.join(tempDir, "resolve.mjs"), RESOLVER);
  fs.writeFileSync(path.join(tempDir, "hook.mjs"), RESOLVER_HOOK);
  fs.writeFileSync(path.join(tempDir, "child.mjs"), CHILD_SCRIPT);
}

const nodeBin = process.env.NODE || "node";

function runChild({ mode, n = 50, details = false, timeoutMs = 20000 }) {
  writeChildFiles();
  const child = spawn(nodeBin, ["--import", path.join(tempDir, "hook.mjs"), path.join(tempDir, "child.mjs")], {
    cwd: tempDir,
    env: {
      ...process.env,
      REPO_ROOT,
      DATA_DIR: tempDir,
      HOME: tempDir,
      MODE: mode,
      N: String(n),
      DETAILS: details ? "1" : "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let signalSent = false;
  child.stdout.on("data", (c) => {
    const str = c.toString();
    stdout += str;
    const marker = mode === "slow_write_timeout" ? "ENTERING_BLOCKED_PRICING_PATH:1" : "ENTERING_BLOCKED_COST_PATH:1";
    if ((mode === "slow_write_signal" || mode === "slow_write_timeout") && stdout.includes(marker) && !signalSent) {
      // Signal only once the child is provably parked inside the blocked path,
      // and only ever at the CHILD pid.
      signalSent = true;
      process.kill(child.pid, "SIGTERM");
    }
  });
  child.stderr.on("data", (c) => {
    stderr += c.toString();
  });

  const started = Date.now();
  const exited = new Promise((resolve) => {
    // "close", not "exit": exit fires as soon as the process is gone, while the
    // last chunks of its stdout may still be queued. Asserting on stdout after
    // "exit" is a race that silently drops the very lines under test.
    child.on("close", (code, signal) => resolve({ code, signal }));
    setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs).unref?.();
  });
  return exited.then((res) => ({ ...res, elapsed: Date.now() - started, stdout, stderr }));
}

function countRows(table) {
  const raw = new DatabaseSync(path.join(tempDir, "db", "data.sqlite"));
  try {
    return Number(raw.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
  } finally {
    raw.close();
  }
}

describe("F-07 — usage persistence drain on shutdown", () => {
  it("control: exiting without draining loses the admitted writes", async () => {
    const res = await runChild({ mode: "control", n: 50 });
    expect(res.code, `control code: ${res.code}, stderr: ${res.stderr.slice(0, 2000)}`).toBe(0);
    expect(countRows("usageHistory")).toBeLessThan(50);
  });

  it("drain: every write admitted before SIGTERM is persisted", async () => {
    const res = await runChild({ mode: "drain", n: 50 });
    expect(res.code, `drain exit code: ${res.code}, stderr: ${res.stderr.slice(0, 2000)}`).toBe(0);
    expect(res.stderr).not.toMatch(/UnhandledPromiseRejection|ERR_MODULE_NOT_FOUND/);
    expect(countRows("usageHistory")).toBe(50);
  }, 25000);

  it("drain also flushes buffered request details", async () => {
    const res = await runChild({ mode: "drain", n: 20, details: true });
    expect(res.code, `drain details exit code: ${res.code}, stderr: ${res.stderr.slice(0, 2000)}`).toBe(0);
    expect(countRows("usageHistory")).toBe(20);
    expect(countRows("requestDetails")).toBe(5);
  }, 25000);

  it("persist failures are counted and never hang the drain", async () => {
    const badTokens = { get prompt_tokens() { throw new Error("boom"); } };
    await db.saveRequestUsage({ provider: "openai", model: "gpt-4o", tokens: badTokens });
    const summary = await db.drainPendingUsage({ timeoutMs: 1000 });
    expect(summary.failedTotal).toBeGreaterThanOrEqual(1);
    expect(summary.pending).toBe(0);
    expect(summary.timedOut).toBe(false);
  });

  it("drain is bounded (synthetic never-settling promise): yields timedOut instead of hanging", async () => {
    const stuck = new Promise(() => {});
    stuck.catch(() => {});
    global._pendingUsagePersists.inflight.add(stuck);
    try {
      const t0 = Date.now();
      const summary = await db.drainPendingUsage({ timeoutMs: 200 });
      expect(summary.timedOut).toBe(true);
      expect(summary.pending).toBe(1);
      expect(Date.now() - t0).toBeLessThan(1500);
    } finally {
      global._pendingUsagePersists.inflight.delete(stuck);
    }
  });

  it("coordinator drains real delayed saveRequestUsage admitted before SIGTERM and verifies DB after child exit", async () => {
    const res = await runChild({ mode: "slow_write_signal", n: 10, timeoutMs: 15000 });
    expect(res.code, `slow_write code: ${res.code}, stderr: ${res.stderr.slice(0, 2000)}`).toBe(0);
    expect(countRows("usageHistory")).toBe(10);
  }, 20000);

  it("duplicate delivery of one shutdown (systemd cgroup + launcher) does not abort the drain", async () => {
    const res = await runChild({ mode: "duplicate_signal", n: 30, timeoutMs: 15000 });
    expect(res.code, `code: ${res.code}, stderr: ${res.stderr.slice(0, 2000)}`).toBe(0);
    expect(res.stdout + res.stderr, "the second delivery must not force an exit")
      .not.toMatch(/repeated SIGTERM/);
    expect(countRows("usageHistory")).toBe(30);
  }, 20000);

  it("repeated signal forces an immediate exit instead of draining again", async () => {
    const res = await runChild({ mode: "repeat", n: 5, timeoutMs: 15000 });
    expect(res.code, `repeat code: ${res.code}, stderr: ${res.stderr.slice(0, 2000)}`).toBe(1);
    expect(res.elapsed).toBeLessThan(3000);
  }, 20000);

  it("real wedged write: drain times out, exits non-zero, and cleanup still runs before the hard watchdog", async () => {
    const res = await runChild({ mode: "slow_write_timeout", n: 10, timeoutMs: 20000 });
    const all = res.stdout + res.stderr;

    expect(all, "the child must actually reach the stalled pricing path").toMatch(/ENTERING_BLOCKED_PRICING_PATH:1/);
    // Bounded: the drain gave up instead of waiting out the 3s stall.
    // Either bound may win the race (drainPendingUsage's own deadline or the
    // whole-drain deadline); both must report the loss rather than zeros.
    expect(all).toMatch(/timed out after \d+ms, \d+ write\(s\) still in flight|whole drain timed out/);
    expect(all, "the parked writes must be reported as still pending").toMatch(/pending=10/);
    // Bound is reported as a failure, not swallowed.
    expect(res.code, `exit code: ${res.code}, stderr: ${res.stderr.slice(0, 2000)}`).toBe(1);
    // The margin between the drain deadline and the hard watchdog is what lets
    // cleanup + closeAdapter run; if it regresses to zero, this fires.
    expect(all, "hard watchdog must not preempt the orderly exit").not.toMatch(/HARD TIMEOUT/);
    // And the abandoned writes really are lost — the assertion above is not vacuous.
    expect(countRows("usageHistory")).toBeLessThan(10);
  }, 25000);

  it("additive install: a second installShutdownCoordinator keeps both cleanups and one handler set", async () => {
    const res = await runChild({ mode: "additive_cleanup", n: 5, timeoutMs: 15000 });
    expect(res.code, `code: ${res.code}, stderr: ${res.stderr.slice(0, 2000)}`).toBe(0);
    expect(res.stdout).toMatch(/SECOND_INSTALL:false/);
    expect(res.stdout, "handlers installed once, not per call").toMatch(/SIGTERM_LISTENERS:1/);
    expect(res.stdout, "cleanup from the first install must survive").toMatch(/CLEANUP_A/);
    expect(res.stdout, "cleanup from the second install must be added").toMatch(/CLEANUP_B/);
    expect(countRows("usageHistory")).toBe(5);
  }, 20000);

  it("custom-server wrapper answers 503 without running the handler once admission stopped", async () => {
    const res = await runChild({ mode: "http_503", timeoutMs: 15000 });
    expect(res.code, `code: ${res.code}, stderr: ${res.stderr.slice(0, 2000)}`).toBe(0);
    expect(res.stdout).toMatch(/STATUS:503/);
    expect(res.stdout).toMatch(/Server is shutting down/);
    expect(res.stdout, "a rejected request must not reach the app handler").toMatch(/HANDLER_RAN:false/);
  }, 20000);

  it("the coordinator is installed at server boot, not only from the dashboard layout", () => {
    // Regression guard: initializeApp() runs from src/app/layout.js, so a
    // gateway-only process (only /v1/* is ever hit) would never install it —
    // and the SQLite adapters no longer handle signals themselves.
    const instrumentation = fs.readFileSync(path.join(REPO_ROOT, "src/instrumentation.js"), "utf8");
    expect(instrumentation).toContain("shutdownCoordinator.js");
    expect(instrumentation).toMatch(/installShutdownCoordinator\(/);

    const adapters = ["betterSqliteAdapter.js", "bunSqliteAdapter.js", "nodeSqliteAdapter.js"];
    for (const name of adapters) {
      const src = fs.readFileSync(path.join(REPO_ROOT, "src/lib/db/adapters", name), "utf8");
      expect(src, `${name} must not race the coordinator on signals`).not.toMatch(/process\.once\(\s*["']SIG(INT|TERM)["']/);
    }

    const detailsRepo = fs.readFileSync(path.join(REPO_ROOT, "src/lib/db/repos/requestDetailsRepo.js"), "utf8");
    expect(detailsRepo, "request details must be flushed by the coordinator, not a parallel handler")
      .not.toMatch(/process\.on\(\s*["']SIG(INT|TERM)["']/);
  });

  it("child HTTP server: admits inflight request, rejects new requests with 503 during SIGTERM, drains usage to DB", async () => {
    const res = await runChild({ mode: "http_server_smoke", timeoutMs: 15000 });
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/REQ1_STATUS:200/);
    expect(res.stdout).toMatch(/(REQ2_STATUS:503|REQ2_ERROR:(ECONNREFUSED|ECONNRESET))/);
    expect(countRows("usageHistory")).toBe(1);
  }, 20000);
});
