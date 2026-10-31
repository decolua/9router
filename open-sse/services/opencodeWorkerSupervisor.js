// Supervisor: HTTP bridge that performs opencode free-tier fetches in FRESH
// child processes. Runs OUTSIDE the router bundle (plain node, systemd-managed)
// because the bundled parent's spawns die silently (2026-10-30) while the same
// spawn protocol from a plain node parent passes 100% (5/5 live).
//
// Endpoint: POST http://127.0.0.1:20137/fetch
//   body: JSON { url, method, headers, body, proxyUrl, timeoutMs }
//   response: upstream status/headers, body streamed verbatim.
// Each request spawns ONE fresh child (opencodeWorkerChild.js) — the proven
// passing configuration. Concurrency bounded; excess queues. Client abort
// kills the child.
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHILD_PATH = path.join(__dirname, "opencodeWorkerChild.js");
const PORT = parseInt(process.env.OC_WORKER_PORT || "20137", 10);
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.OC_WORKER_MAX || "8", 10) || 8);
const CHILD_TIMEOUT_MS = 180000;

let inFlight = 0;
const waiters = [];

function acquire() {
  if (inFlight < MAX_CONCURRENT) { inFlight++; return; }
  waiters.push(() => { inFlight++; });
}
function release() {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

function doFetch(reqBody, res, clientAbort) {
  acquire();
  const child = spawn(process.execPath, [CHILD_PATH], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
  let settled = false;
  const kill = () => { try { child.kill("SIGKILL"); } catch { } };
  const onAbort = () => kill();
  if (clientAbort) {
    if (clientAbort.aborted) kill();
    else clientAbort.addEventListener("abort", onAbort, { once: true });
  }
  const watchdog = setTimeout(kill, CHILD_TIMEOUT_MS);
  const fail = (code, msg) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    if (clientAbort) clientAbort.removeEventListener("abort", onAbort);
    kill();
    release();
    if (!res.headersSent) res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
  };

  let stderrTail = "";
  child.stderr.on("data", (c) => { stderrTail = (stderrTail + String(c)).slice(-300); });

  const rl = readline.createInterface({ input: child.stdio[3], terminal: false });
  const timer = setTimeout(() => fail(504, `worker header timeout stderr=${stderrTail}`), 60000);
  rl.once("line", (line) => {
    clearTimeout(timer);
    let msg;
    try { msg = JSON.parse(line); } catch { fail(502, `bad header line: ${line.slice(0, 80)}`); return; }
    if (!msg.ok) { fail(502, `worker: ${String(msg.error || "failed").slice(0, 160)}`); return; }

    const headers = { ...msg.headers };
    delete headers["content-length"]; // body is re-chunked over the bridge
    delete headers["transfer-encoding"];
    res.writeHead(msg.status, headers);
    settled = true;
    child.stdout.pipe(res);
    child.stdout.on("end", () => {
      clearTimeout(watchdog);
      if (clientAbort) clientAbort.removeEventListener("abort", onAbort);
      kill();
      release();
      res.end();
    });
    child.stdout.on("error", () => { try { res.end(); } catch { } });
    res.on("close", () => kill());
  });
  rl.once("close", () => { if (!settled || !res.writableEnded) { /* header never came */ } });
  child.on("error", (e) => fail(502, `spawn error: ${e.message}`));

  child.stdin.write(JSON.stringify(reqBody) + "\n");
  child.stdin.end();
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/fetch")) {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { res.writeHead(400).end(); return; }
    try {
      const h = parsed.headers || {};
      const md5 = crypto.createHash("md5").update(String(parsed.body || "")).digest("hex").slice(0, 10);
      console.log(`[oc-worker] req url=${parsed.url} proxySid=${(String(parsed.proxyUrl || "").match(/session-([a-z0-9]+)/) || [])[1]} bodyLen=${(parsed.body || "").length} md5=${md5} hdrJson=${JSON.stringify(h).length} ua=${String(h["User-Agent"] || h["user-agent"] || "?").slice(0, 50)} ses=${String(h["x-opencode-session"] || "?").slice(0, 20)} req=${String(h["x-opencode-request"] || "?").slice(0, 20)} timeoutMs=${parsed.timeoutMs}`);
    } catch { }
    doFetch(parsed, res, req.aborted ? req : undefined);
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[oc-worker] supervisor on 127.0.0.1:${PORT} child=${CHILD_PATH}`));
