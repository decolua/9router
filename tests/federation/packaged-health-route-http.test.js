// FED-GAP-05 — the PACKAGED server's GET /api/health, proven over real HTTP.
//
// The board row: a test must BOOT the packaged/standalone server and assert
// that GET /api/health answers 200 {"ok":true} — i.e. the route must be
// exercised over HTTP as the app ships it. Neither of the pre-existing
// coverages does that:
//   * tests/federation/health-route-and-free-tier.test.js imports
//     src/app/api/health/route.js into the vitest process and calls GET()
//     directly — no server, no HTTP, no packaged artifact;
//   * tests/federation/custom-server-boot.test.js spawns the wrapper against a
//     MARKER server.js stub — the stub is a test double, so the real route is
//     never reached;
//   * the e2e harness (tests/federation/e2e.mjs) runs its own loader-aliased
//     child, not the packaged build.
//
// Three arms, all against the packaged output (`.next/standalone`, produced by
// `npm run build` + the postbuild asset copy):
//
//   1. STRUCTURAL — the tracked module src/app/api/health/route.js is read at
//      test time and its contract (CORS header names + values, the response
//      body literal) is required inside the PACKED compiled route chunk
//      (.next/server/app/api/health/route.js of the standalone output). A
//      stale or foreign packed copy fails here, and the acceptance criterion
//      (`{"ok":true}`) is pinned once.
//   2. REAL BOOT — an isolated temp copy of the packaged output is started as
//      `node server.js` (its own PID, OS-assigned port, DATA_DIR in the temp
//      tree) and GET /api/health is issued over a real TCP socket: HTTP 200,
//      body EXACTLY {"ok":true}, the module's own CORS headers.
//   3. RED-PROOF — the same packaged bytes are copied again with exactly ONE
//      verified edit to that compiled chunk: the body literal becomes the
//      pre-task harness-only shape ({ok, role, edgeId, state}). The packaged
//      server then serves that shape — so the served body is causally governed
//      by the very file arm 2 asserts against — and the real-route assertion
//      REJECTS it. Status stays 200, which is the point: a status-only check
//      passes a harness-only response, the exact-body assertion does not.
//
// Determinism / isolation:
//   * NETWORK-FREE — the child is handed HTTP(S)_PROXY/ALL_PROXY pointing at a
//     closed loopback port (src/lib/network/outboundProxy.js honours those
//     vars), so any outbound attempt (cloud sync, provider call) dies on
//     loopback instead of leaving the box; the instance binds 127.0.0.1 only.
//     No provider is contacted and no external host is resolved.
//   * The packaged tree is COPIED into a temp dir, so a run cannot write into
//     the repo's build output (DATA_DIR, crash logs, route mutation all land
//     in the copy).
//   * Children are cleaned up by their EXPLICIT PID (SIGTERM → SIGKILL after a
//     grace period) and the test asserts the PID is gone. No pkill/pgrep
//     pattern is used anywhere. Every HTTP request opens and closes its own
//     socket (agent:false → Connection: close), so no keep-alive pool survives
//     the test, plus a bounded per-request timeout and a bounded readiness poll
//     that fails fast when the child dies.
//   * custom-server.js is NEVER imported into this process: it monkeypatches
//     http.createServer at module load (see custom-server-boot.test.js).
//
// A packaged build is a BUILD artifact. When it is absent (fresh clone, CI
// runner that does not build) this file SKIPS with a loud warning naming the
// missing path and how to produce it — a visible skip, never a silent pass.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// The tracked route module whose contract the packaged server must serve.
const HEALTH_ROUTE_SOURCE = path.join(REPO_ROOT, "src", "app", "api", "health", "route.js");

// The packaged standalone output. NINEROUTER_STANDALONE_DIR points the test at
// a packaged tree built elsewhere (e.g. a Docker standalone directory); the
// default is the repo's own `npm run build` output.
const STANDALONE_DIR = process.env.NINEROUTER_STANDALONE_DIR
  ? path.resolve(process.env.NINEROUTER_STANDALONE_DIR)
  : path.join(REPO_ROOT, ".next", "standalone");
const STANDALONE_SERVER = path.join(STANDALONE_DIR, "server.js");
// The compiled route chunk the packaged server loads for /api/health.
const COMPILED_ROUTE_REL = path.join(".next", "server", "app", "api", "health", "route.js");
const COMPILED_ROUTE = path.join(STANDALONE_DIR, COMPILED_ROUTE_REL);

const MISSING_ARTIFACTS = [STANDALONE_SERVER, COMPILED_ROUTE].filter((p) => !fs.existsSync(p));
const PACKAGED_BUILD_PRESENT = MISSING_ARTIFACTS.length === 0;

if (!PACKAGED_BUILD_PRESENT) {
  console.warn(
    "[FED-GAP-05] SKIP: packaged standalone output not found — " +
      MISSING_ARTIFACTS.map((p) => path.relative(REPO_ROOT, p)).join(", ") +
      ". Produce it with `npm run build` (Next standalone + postbuild asset copy) or point " +
      "NINEROUTER_STANDALONE_DIR at an existing packaged tree. This file proves /api/health " +
      "over HTTP against the PACKAGED server only; it never substitutes a harness stub."
  );
}

const UNREACHABLE_PROXY = "http://127.0.0.1:1"; // closed loopback port — outbound dies locally
const READY_TIMEOUT_MS = 60000;
const REQUEST_TIMEOUT_MS = 10000;
// The pre-task harness-only body the route module used to return (the shape
// the e2e harness served). Values are arbitrary — the KEY SET is what a
// harness-only response is caught by.
const HARNESS_EXTRA_SOURCE = ',role:"standalone",edgeId:"local-edge",state:null';

// The tracked module's expected response body, derived in the suite's
// beforeAll from src/app/api/health/route.js (not restated here).
let expectedBodyText = null;
let expectedKeys = null;
// Temp root for the isolated packaged layouts + DATA_DIRs (set in beforeAll).
let tmpRoot = null;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rel = (p) => path.relative(REPO_ROOT, p);

// ─── the tracked module's contract, derived from SOURCE (never hardcoded) ──

// An object literal written as JS (`{ ok: true }`, identifier keys, single
// quotes) normalized into JSON so the expected body text can be DERIVED from
// the tracked route module instead of restated here. Throws for a literal this
// test cannot translate — that must be a loud failure, not a silent hardcode.
function literalToJson(literal) {
  const jsonish = literal
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'([^']*)'/g, '"$1"');
  return JSON.parse(jsonish);
}

function readTrackedRouteContract() {
  const source = fs.readFileSync(HEALTH_ROUTE_SOURCE, "utf8");
  const block = source.match(/CORS_HEADERS\s*=\s*\{([\s\S]*?)\}/);
  if (!block) {
    throw new Error(
      `FED-GAP-05: ${rel(HEALTH_ROUTE_SOURCE)} no longer declares a literal CORS_HEADERS object. ` +
        "This test derives the expected response headers from that module — update the test to the module's new shape."
    );
  }
  const headers = {};
  for (const m of block[1].matchAll(/["']([^"']+)["']\s*:\s*["']([^"']*)["']/g)) headers[m[1]] = m[2];
  if (Object.keys(headers).length < 3) {
    throw new Error(
      `FED-GAP-05: could not read the route module's CORS headers as string literals ` +
        `(got ${JSON.stringify(headers)}) from ${rel(HEALTH_ROUTE_SOURCE)}.`
    );
  }
  const bodyLiteral = source.match(/NextResponse\.json\(\s*(\{[^}]*\})/);
  if (!bodyLiteral) {
    throw new Error(
      `FED-GAP-05: ${rel(HEALTH_ROUTE_SOURCE)} no longer returns NextResponse.json(<object literal>) — ` +
        "this test derives the expected response body from that call."
    );
  }
  return { source, headers, bodyLiteral: bodyLiteral[1] };
}

// ─── the real-route assertion (shared by the green arm and the red-proof) ──
//
// Every clause a harness-only response would violate. Throws instead of using
// expect() so the red-proof can assert the rejection deterministically.
function assertRealHealthRoute(response, expectedHeaders) {
  const detail = `status=${response.status} body=${JSON.stringify(response.text)}`;
  if (response.status !== 200) {
    throw new Error(`FED-GAP-05: packaged /api/health must answer HTTP 200 — ${detail}`);
  }
  const contentType = response.header("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`FED-GAP-05: packaged /api/health must answer application/json — got ${contentType} (${detail})`);
  }
  if (response.text !== expectedBodyText) {
    throw new Error(
      `FED-GAP-05: packaged /api/health must answer the tracked route's body exactly ` +
        `${expectedBodyText} — ${detail}`
    );
  }
  let body;
  try {
    body = JSON.parse(response.text);
  } catch (e) {
    throw new Error(`FED-GAP-05: packaged /api/health body is not JSON (${e.message}) — ${detail}`);
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== expectedKeys[0] || body[expectedKeys[0]] !== true) {
    throw new Error(
      `FED-GAP-05: packaged /api/health must carry exactly ${JSON.stringify(expectedKeys)} — ` +
        `got ${JSON.stringify(keys)} (a harness-only body fails here) — ${detail}`
    );
  }
  for (const [name, value] of Object.entries(expectedHeaders)) {
    const got = response.header(name);
    if (got !== value) {
      throw new Error(
        `FED-GAP-05: packaged /api/health header ${name} must be ${JSON.stringify(value)} — ` +
          `got ${JSON.stringify(got)} (${detail})`
      );
    }
  }
}

// ─── child lifecycle (explicit PIDs, bounded waits, no pkill/pgrep) ────────

const liveChildren = new Set();

function childAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

function pidGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
}

function waitForExit(child, timeoutMs) {
  if (!childAlive(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(!childAlive(child)), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// Last-resort net: a vitest process that dies mid-run must not orphan a server.
process.on("exit", () => {
  for (const child of liveChildren) {
    try {
      if (childAlive(child)) child.kill("SIGKILL");
    } catch {
      /* the process is going away regardless */
    }
  }
});

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// One request per socket (agent:false → Connection: close) with a hard timeout:
// nothing is pooled, so nothing needs draining at teardown.
function requestHealth(baseUrl, timeoutMs = REQUEST_TIMEOUT_MS) {
  const url = new URL(`${baseUrl}/api/health`);
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        agent: false,
        headers: { connection: "close" },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > 64 * 1024) {
            req.destroy(new Error("response body exceeded 64KiB"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            text: Buffer.concat(chunks).toString("utf8"),
            header: (name) => res.headers[String(name).toLowerCase()],
          })
        );
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no response within ${timeoutMs}ms`)));
    req.on("error", reject);
  });
}

function packagedEnv({ port, dataDir, baseUrl }) {
  const env = { ...process.env };
  // Standalone (the packaged default) is what this file proves — never let an
  // inherited federation mode turn the boot into a different code path.
  delete env.FEDERATION_MODE;
  return {
    ...env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    DATA_DIR: dataDir,
    // Network-free: any outbound attempt is pointed at a closed loopback port.
    HTTP_PROXY: UNREACHABLE_PROXY,
    HTTPS_PROXY: UNREACHABLE_PROXY,
    ALL_PROXY: UNREACHABLE_PROXY,
    NO_PROXY: "127.0.0.1,localhost,::1",
    OBSERVABILITY_ENABLED: "false",
    BASE_URL: baseUrl,
    NEXT_PUBLIC_BASE_URL: baseUrl,
    CLOUD_URL: baseUrl,
    NEXT_PUBLIC_CLOUD_URL: baseUrl,
  };
}

async function startPackagedServer({ layoutDir, label }) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = path.join(tmpRoot, `data-${label}`);
  fs.mkdirSync(dataDir, { recursive: true });

  const child = spawn(process.execPath, ["server.js"], {
    cwd: layoutDir, // the packaged tree — never the repo root
    env: packagedEnv({ port, dataDir, baseUrl }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  liveChildren.add(child);

  let output = "";
  child.stdout.on("data", (c) => {
    output += c;
  });
  child.stderr.on("data", (c) => {
    output += c;
  });

  return {
    child,
    pid: child.pid,
    port,
    baseUrl,
    output: () => output.slice(-2000),
  };
}

// Bounded readiness poll: succeeds on the first 200, fails fast and loudly if
// the child died (a dead child can never satisfy the poll).
async function waitForPackagedHealth(entry) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "no attempt made";
  while (Date.now() < deadline) {
    if (!childAlive(entry.child)) {
      throw new Error(
        `FED-GAP-05: the packaged server (pid ${entry.pid}) exited before serving /api/health ` +
          `(code=${entry.child.exitCode}, signal=${entry.child.signalCode}). Output:\n${entry.output()}`
      );
    }
    try {
      const res = await requestHealth(entry.baseUrl, 3000);
      if (res.status === 200) return res;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.message;
    }
    await sleep(200);
  }
  throw new Error(
    `FED-GAP-05: timed out after ${READY_TIMEOUT_MS}ms waiting for ${entry.baseUrl}/api/health ` +
      `(last: ${last}). Output:\n${entry.output()}`
  );
}

async function stopPackagedServer(entry, { termGraceMs = 5000, killWaitMs = 3000 } = {}) {
  const { child } = entry;
  if (childAlive(child)) {
    child.kill("SIGTERM"); // explicit PID — no pkill/pgrep pattern anywhere
    if (!(await waitForExit(child, termGraceMs))) {
      child.kill("SIGKILL"); // same explicit PID
      await waitForExit(child, killWaitMs);
    }
  }
  liveChildren.delete(child);
}

// ─── the suite ────────────────────────────────────────────────────────────

describe.skipIf(!PACKAGED_BUILD_PRESENT)("packaged standalone server — real /api/health over HTTP (FED-GAP-05)", () => {
  let layoutReal = null;
  let tracked = null;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed05-"));
    tracked = readTrackedRouteContract();
    const expectedBody = literalToJson(tracked.bodyLiteral);
    expectedBodyText = JSON.stringify(expectedBody);
    expectedKeys = Object.keys(expectedBody);
    // Isolated copy of the packaged tree: the run never writes into the repo
    // build output (and the red-proof mutates a copy, never the original).
    layoutReal = path.join(tmpRoot, "packaged-real");
    fs.cpSync(STANDALONE_DIR, layoutReal, { recursive: true });
  }, 120000);

  afterAll(async () => {
    for (const entry of [...liveChildren]) await stopPackagedServer(entry);
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  });

  it("the packaged route chunk carries the tracked module's contract (no stale/foreign packed copy)", () => {
    const serverEntry = path.join(layoutReal, "server.js");
    expect(fs.existsSync(serverEntry)).toBe(true);

    const source = fs.readFileSync(HEALTH_ROUTE_SOURCE, "utf8");
    const compiledChunk = fs.readFileSync(path.join(layoutReal, COMPILED_ROUTE_REL), "utf8");

    // The board row's acceptance criterion, pinned exactly once.
    expect(expectedBodyText).toBe('{"ok":true}');
    expect(expectedKeys).toEqual(["ok"]);

    // Every CORS header the tracked module declares, name AND value, must be
    // present in the packed chunk — a stale build (source edited, not rebuilt)
    // or a foreign/substituted copy fails here.
    for (const [name, value] of Object.entries(tracked.headers)) {
      const pair = new RegExp(`"?${escapeRe(name)}"?\\s*:\\s*"${escapeRe(value)}"`);
      expect(compiledChunk, `packed chunk is missing the tracked route's ${name}: ${value}`).toMatch(pair);
    }
    // …and the response body literal (the minifier may emit ok:!0 for ok:true).
    expect(compiledChunk).toMatch(/\{ok:\s*(?:!0|true)\}/);

    console.info(
      `[FED-GAP-05] provenance: source ${rel(HEALTH_ROUTE_SOURCE)} sha256=${sha256(source)} | ` +
        `packed ${rel(COMPILED_ROUTE)} sha256=${sha256(compiledChunk)} (${compiledChunk.length}B)`
    );
  });

  it('boots the packaged server (own PID) and answers GET /api/health with exactly {"ok":true}', async () => {
    const entry = await startPackagedServer({ layoutDir: layoutReal, label: "real" });
    try {
      const res = await waitForPackagedHealth(entry);
      // The child really booted the packaged Next server (not a stub/harness).
      expect(entry.output()).toMatch(/Next\.js/);
      // The full real-route contract: 200 + exact body + the module's CORS
      // headers + the single "ok" key. A harness-only body fails all of it.
      assertRealHealthRoute(res, tracked.headers);
      expect(res.header("content-type")).toContain("application/json");
      expect(Object.keys(JSON.parse(res.text))).toEqual(["ok"]);
      expect(JSON.parse(res.text)).not.toHaveProperty("role");
    } finally {
      await stopPackagedServer(entry);
    }
    // Cleanup is by explicit PID and is verified, not assumed.
    expect(pidGone(entry.pid)).toBe(true);
  }, 180000);

  it("red-proof: the same assertion rejects a harness-only /api/health body served by the packaged server", async () => {
    // Derived from the SAME packaged bytes as the green arm, with exactly one
    // verified edit to the compiled route chunk.
    const layoutMutant = path.join(tmpRoot, "packaged-mutant");
    fs.cpSync(STANDALONE_DIR, layoutMutant, { recursive: true });
    const chunkPath = path.join(layoutMutant, COMPILED_ROUTE_REL);
    const original = fs.readFileSync(chunkPath, "utf8");

    const anchor = original.match(/\{ok:\s*(?:!0|true)\}/);
    expect(
      anchor,
      "the packed route chunk no longer contains a {ok:…} body literal — update this mutation anchor, do not drop the red-proof"
    ).not.toBeNull();
    const mutantLiteral = `{${anchor[0].slice(1, -1)}${HARNESS_EXTRA_SOURCE}}`;
    const mutated = original.replace(anchor[0], mutantLiteral);
    expect(mutated).not.toBe(original);
    // Single deliberate edit: reverting the one literal restores the exact bytes.
    const parts = mutated.split(mutantLiteral);
    expect(parts).toHaveLength(2);
    expect(parts[0] + anchor[0] + parts[1]).toBe(original);
    fs.writeFileSync(chunkPath, mutated);

    const entry = await startPackagedServer({ layoutDir: layoutMutant, label: "mutant" });
    try {
      const res = await waitForPackagedHealth(entry);
      // Causal provenance: the body the packaged server serves is governed by
      // that compiled chunk — the same file the green arm asserts against.
      expect(res.status).toBe(200); // a status-only check would still say "healthy"
      expect(JSON.parse(res.text)).toEqual({
        ok: true,
        role: "standalone",
        edgeId: "local-edge",
        state: null,
      });
      expect(res.text).not.toBe(expectedBodyText);
      // Load-bearing: the real-route assertion rejects the harness-only body.
      expect(() => assertRealHealthRoute(res, tracked.headers)).toThrow(
        /must answer the tracked route's body exactly/
      );
    } finally {
      await stopPackagedServer(entry);
    }
    expect(pidGone(entry.pid)).toBe(true);
  }, 180000);
});
