/**
 * What claude-cli does under concurrent load.
 *
 *   node scripts/fork/check-claude-cli-concurrency.mjs
 *
 * The report this exists for: "calling this one makes the API feel like it
 * stops". claude-cli is not an HTTP upstream — every routed request spawns a
 * whole Claude Code interpreter (~230 MB resident), so the executor puts a FIFO
 * gate in front of spawning: CLI_CLAUDE_MAX_CONCURRENCY slots (4 by default),
 * and anything past that waits up to CLAUDE_CLI_QUEUE_TIMEOUT_MS (120s).
 *
 * Queueing is invisible from outside — a queued request looks exactly like a
 * slow one — so this measures it instead of guessing: send LIMIT+2 tiny
 * requests at once and report when each one started returning. If the gate is
 * what the user is feeling, the first LIMIT finish together and the extras only
 * start after a slot frees.
 *
 * It spends LIMIT+2 small Claude requests on whatever account this machine is
 * signed into. Skips when Claude Code is missing or not signed in.
 *
 * Needs port 21997 free.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = process.env.ROUTER_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 21997;
const PASSWORD = "claude-cli-concurrency-password";
const DATA_DIR = path.join(os.tmpdir(), `9r-cli-concurrency-${Date.now()}`);
// Read from the same place the executor reads it, so this tracks the default.
const LIMIT = Number(process.env.CLI_CLAUDE_MAX_CONCURRENCY) > 0
  ? Number(process.env.CLI_CLAUDE_MAX_CONCURRENCY)
  : 4;
const BURST = LIMIT + 2;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
};

const call = (opts, body) => new Promise((resolve, reject) => {
  const started = Date.now();
  const r = http.request({ host: "127.0.0.1", port: PORT, timeout: 300000, ...opts }, (res) => {
    let data = "";
    let firstByteAt = null;
    res.on("data", (c) => { firstByteAt ??= Date.now(); data += c; });
    res.on("end", () => {
      let json = null;
      try { json = JSON.parse(data); } catch { /* sse or html */ }
      resolve({
        status: res.statusCode, headers: res.headers, body: data, json,
        startedAt: started, firstByteAt, endedAt: Date.now(),
      });
    });
  });
  r.on("error", reject);
  r.on("timeout", () => r.destroy(new Error("request timeout")));
  if (body) r.write(body);
  r.end();
});

const waitFor = async (fn, ms, label) => {
  const deadline = Date.now() + ms;
  let last = "";
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${label} (${last})`);
};

let server;
let log = "";
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const env = { ...process.env };
  delete env.JWT_SECRET;
  server = spawn(process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "--webpack", "--port", String(PORT)], {
      cwd: ROOT,
      env: {
        ...env,
        DATA_DIR,
        INITIAL_PASSWORD: PASSWORD,
        NODE_OPTIONS: `--require "${path.join(ROOT, "custom-server.js").replace(/\\/g, "/")}"`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });

  await waitFor(async () => (await call({ method: "GET", path: "/api/health" })).status < 500,
    240000, "next dev to answer");

  const login = await call({ method: "POST", path: "/api/auth/login", headers: { "content-type": "application/json" } },
    JSON.stringify({ password: PASSWORD }));
  const m = /auth_token=([^;]+)/.exec([].concat(login.headers["set-cookie"] || []).join("; "));
  if (!m) throw new Error("no session cookie from login");
  const cookie = `auth_token=${m[1]}`;
  const json = { cookie, "content-type": "application/json" };

  const accounts = await call({ method: "GET", path: "/api/cli-tools/claude-cli-accounts", headers: { cookie } });
  if (!accounts.json?.installed || !accounts.json?.host?.signedIn) {
    console.log("  SKIP  concurrency (needs Claude Code installed and signed in on this machine)");
    process.exit(0);
  }
  const adopted = await call({ method: "POST", path: "/api/cli-tools/claude-cli-accounts", headers: json },
    JSON.stringify({ adoptHost: true }));
  if (!adopted.json?.account?.id) throw new Error(`cannot adopt host account: ${adopted.body.slice(0, 200)}`);

  const keyRes = await call({ method: "POST", path: "/api/keys", headers: json },
    JSON.stringify({ name: "claude-cli-concurrency-check" }));
  const apiKey = keyRes.json?.apiKey?.key || keyRes.json?.key || keyRes.json?.apiKey;
  if (!apiKey) throw new Error(`no API key: ${keyRes.body.slice(0, 200)}`);

  const one = (n) => call({
    method: "POST",
    path: "/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  }, JSON.stringify({
    model: "claude-cli/claude-cli-haiku",
    messages: [{ role: "user", content: `Reply with exactly: ${n}` }],
    stream: false,
  })).then((r) => ({ n, ...r }));

  // One request on its own first, to separate "a spawn is slow" from "the gate
  // made it wait" — without this baseline every number below is unreadable.
  const solo = await one(0);
  const soloMs = solo.endedAt - solo.startedAt;
  check("a single request succeeds", solo.status === 200,
    `status=${solo.status} body=${solo.body.slice(0, 200)}`);
  console.log(`        one request alone: ${soloMs}ms`);

  const t0 = Date.now();
  const burst = await Promise.all(Array.from({ length: BURST }, (_, i) => one(i + 1)));
  const rows = burst
    .map((r) => ({ n: r.n, status: r.status, ms: r.endedAt - t0, ok: r.status === 200 }))
    .sort((a, b) => a.ms - b.ms);
  console.log(`        ${BURST} at once (limit ${LIMIT}):`);
  for (const r of rows) console.log(`          #${r.n} ${r.status} after ${r.ms}ms`);

  check("every request in the burst is answered, none dropped",
    burst.every((r) => r.status === 200),
    burst.filter((r) => r.status !== 200).map((r) => `#${r.n} ${r.status} ${r.body.slice(0, 150)}`).join(" | "));

  check("none of them hit the queue timeout",
    !burst.some((r) => /queue_timeout|waiting for a free slot/i.test(r.body)),
    "a request waited out CLAUDE_CLI_QUEUE_TIMEOUT_MS instead of running");

  // The diagnosis. Past the limit, a request cannot start until one finishes,
  // so the slowest of the burst runs at least two spawns deep.
  const slowest = rows[rows.length - 1].ms;
  const queued = BURST > LIMIT && slowest > soloMs * 1.5;
  console.log(`        slowest ${slowest}ms vs ${soloMs}ms alone `
    + `→ ${queued ? "QUEUED behind the gate" : "no queueing observed"}`);

  // The gate is supposed to bound how many interpreters run at once, not to
  // serialize the burst. Waves of LIMIT, so the slowest should land inside a
  // couple of spawns' worth of time — well short of BURST spawns end to end.
  const waves = Math.ceil(BURST / LIMIT);
  const budget = Math.max(soloMs * waves * 2, 30000);
  check("queueing stays bounded — a burst costs waves, not one-at-a-time",
    slowest < budget,
    `slowest ${slowest}ms against a ${budget}ms budget (${waves} waves of ${LIMIT}, ${soloMs}ms alone)`);

  // A slot leak is the failure that would look like a permanent hang, so prove
  // the gate gave every slot back: after the burst, one more request must be
  // as fast as the first was.
  const after = await one(99);
  const afterMs = after.endedAt - after.startedAt;
  check("slots are returned after the burst, so nothing is left wedged",
    after.status === 200 && afterMs < Math.max(soloMs * 3, 30000),
    `status=${after.status} took ${afterMs}ms vs ${soloMs}ms for the first`);
} catch (e) {
  check("harness completed", false, e.message);
} finally {
  if (server) server.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

const pass = results.filter((r) => r.ok).length;
if (pass !== results.length) console.log(`\n--- server log tail ---\n${log.slice(-3000)}`);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
