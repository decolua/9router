// Per-attempt worker bridge for the opencode free tier.
//
// Spawns ONE fresh node process per upstream attempt (see
// opencodeWorkerChild.js for why). Mirrors opencodeTlsFetch()'s signature so
// the executor swaps it in transparently. Streaming is preserved: the child's
// stdout IS the response body stream. Abort propagates by killing the child.
//
// Protocol: request JSON on child stdin; header JSON on child fd 3; raw body
// bytes on child stdout. This keeps the header line off the body stream so no
// byte can be lost or reordered between them.
//
// Concurrency is bounded by OPENCODE_WORKER_MAX (default 8); excess attempts
// queue. Spawn latency ~100-200ms per attempt — negligible against 1-3s
// upstream round-trips.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The webpack bundle flattens this module into a chunk dir that does NOT
// contain the child file, so resolve through candidates: explicit env ->
// next to this module -> the deployed source tree. Also import fs lazily so
// bundlers keep the existsSync call real.
import fs from "node:fs";
const CHILD_CANDIDATES = [
  process.env.OPENCODE_WORKER_CHILD,
  path.join(__dirname, "opencodeWorkerChild.js"),
].filter(Boolean);
const CHILD_PATH = CHILD_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } })
  || CHILD_CANDIDATES[CHILD_CANDIDATES.length - 1];
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.OPENCODE_WORKER_MAX || "8", 10) || 8);

let inFlight = 0;
const waiters = [];

function acquireSlot() {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot() {
  inFlight--;
  const next = waiters.shift();
  if (next) {
    inFlight++;
    next();
  }
}

export class OpencodeWorkerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpencodeWorkerUnavailableError";
  }
}

/**
 * Fetch via a fresh worker process. Returns a native Response whose body
 * streams from the child's stdout. Throws OpencodeWorkerUnavailableError on
 * spawn/protocol failures so the caller can fail open.
 */
export function opencodeWorkerFetch(url, init = {}, { signal, timeoutMs = 20000, proxyUrl } = {}) {
  return schedule(() => attempt(url, init, { signal, timeoutMs, proxyUrl }));
}

async function schedule(task) {
  await acquireSlot();
  try {
    return await task();
  } finally {
    releaseSlot();
  }
}

async function attempt(url, init, { signal, timeoutMs, proxyUrl }) {
  const id = Math.random().toString(36).slice(2, 10);
  let child;
  try {
    child = spawn(process.execPath, [CHILD_PATH], {
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
  } catch (e) {
    throw new OpencodeWorkerUnavailableError(`spawn failed: ${e.message}`);
  }

  const killChild = () => {
    try { child.kill("SIGKILL"); } catch { }
  };

  let onAbort = null;
  if (signal) {
    if (signal.aborted) killChild();
    else {
      onAbort = () => killChild();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }
  // Watchdog: header deadline + generous body window. A silent child must
  // never hold a client request.
  const watchdog = setTimeout(() => killChild(), (timeoutMs || 20000) + 150000);

  const cleanup = () => {
    clearTimeout(watchdog);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  };

  let stderrTail = "";
  let exitInfo = "";
  child.stderr?.on?.("data", (c) => {
    stderrTail = (stderrTail + String(c)).slice(-400);
  });
  const headerLine = await new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdio[3], terminal: false });
    const timer = setTimeout(() => {
      killChild();
      reject(new OpencodeWorkerUnavailableError(`worker: header timeout${stderrTail ? " stderr=" + stderrTail : ""}`));
    }, (timeoutMs || 20000) + 5000);
    rl.once("line", (l) => {
      clearTimeout(timer);
      rl.close();
      resolve(l);
    });
    child.once("exit", (code, sig) => {
      exitInfo = `exit=${code}${sig ? " sig=" + sig : ""}`;
    });
    rl.once("close", () => {
      clearTimeout(timer);
      reject(new OpencodeWorkerUnavailableError(`worker exited before headers ${exitInfo || ""}${stderrTail ? " stderr=" + stderrTail : ""}`));
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(new OpencodeWorkerUnavailableError(`worker spawn error: ${e.message}`));
    });
  }).catch((e) => {
    cleanup();
    try { child.kill("SIGKILL"); } catch { }
    throw e;
  });

  let msg;
  try {
    msg = JSON.parse(headerLine);
  } catch {
    cleanup();
    killChild();
    throw new OpencodeWorkerUnavailableError(`worker: bad header line: ${String(headerLine).slice(0, 80)}`);
  }

  if (!msg.ok) {
    cleanup();
    killChild();
    throw new OpencodeWorkerUnavailableError(`worker: ${String(msg.error || "failed").slice(0, 160)}`);
  }

  const headers = new Map(Object.entries(msg.headers || {}));
  const bodyStream = child.stdout;

  const response = new Response(bodyStream, {
    status: msg.status,
    statusText: msg.statusText || "",
    headers,
  });

  // Free resources when the body is fully consumed or abandoned.
  const done = () => {
    cleanup();
    killChild();
  };
  if (bodyStream && typeof bodyStream.once === "function") {
    bodyStream.once("end", done);
    bodyStream.once("error", done);
    bodyStream.once("close", done);
  }

  return response;
}
