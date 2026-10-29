// FED-006 — federation end-to-end lifecycle proof (spec §5 FED-006).
//
// Spawns THREE real instances (central + 2 edges) as child processes, each
// with its own temp DATA_DIR and port, running the REAL federation modules
// (server.js handlers, proxy.js, queue.js, failover.js, edgeClient.js) via
// the e2e-loader alias hook. Proves the full lifecycle:
//
//   standalone boot (all three boot clean with FEDERATION_MODE unset)
//   → central starts, edges LINKED (heartbeat + replication sync)
//   → /v1 completions (JSON and streamed SSE) proxied up to central
//   → kill central → edges flip DEGRADED after the outage threshold
//   → edges still serve /v1 from the local replica, JSON and streamed
//     (X-Federation-State: degraded + replicaRevision)
//   → degraded writes are queued locally (202 + X-Federation-Queued-Write-Id)
//   → restart central → edges RECOVERING → replay drain + delta catch-up
//     → LINKED → writes reconcile (central sees the queued write)
//
// FED-GAP-04 adds the two REAL application-route boundaries the dogfood run
// only covered by hand, and proves each one is load-bearing:
//
//   * GET/OPTIONS /api/health is served by the tracked route module
//     (src/app/api/health/route.js) through the Next route contract, and a
//     mutated copy of that module carrying the OLD harness-only body is shown
//     to FAIL the same assertion (red-proof);
//   * a completion for the app's credentialless FREE-TIER model travels the
//     real /v1/chat/completions route (API-key gate, free-tier credential
//     injection, provider selection, translation, SSE) with the free
//     provider's outbound transport answered by a local fixture — including
//     through a LINKED edge (relayed client key) and from a DEGRADED edge
//     while central is down. The fixture records the request it served, so
//     "the free-tier provider really ran" is asserted, not inferred.
//
// Standalone runnable: `node tests/federation/e2e.mjs` (no .test. suffix so
// vitest does not auto-collect it). Prints a PASS/FAIL summary; exit code
// reflects the result. Self-contained: temp dirs are cleaned up on exit.
//
// Env knobs (all optional):
//   E2E_TIMEOUT_MS   overall budget (default 120000)
//   E2E_KEEP_TMP     keep temp dirs on failure (default: clean up)
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_TEXT, joinDeltaContent } from "./free-tier-fixture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const SRC = path.join(REPO, "src");
const LOADER = path.join(HERE, "e2e-loader.mjs");
const CHILD = path.join(HERE, "e2e-child.mjs");

const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 120000);
const KEEP_TMP = process.env.E2E_KEEP_TMP === "1";

const FED_TOKEN = "e2e-shared-federation-token";
const JWT_SECRET = "e2e-jwt-secret-not-shared-with-browser";
const API_KEY_SECRET = "e2e-api-key-secret";

// ─── FED-GAP-04 constants ────────────────────────────────────────────────
// The tracked health route the packaged app serves, and the pre-task
// harness-only body it replaced (used to prove the real-route assertion is
// load-bearing: a route module carrying this body must FAIL it).
const HEALTH_ROUTE_FILE = path.join(SRC, "app", "api", "health", "route.js");
const HARNESS_ONLY_HEALTH_ROUTE = `// MUTANT — the pre-FED-GAP-04 harness-only /api/health body.
import { NextResponse } from "next/server";

const ROLE = process.env.E2E_ROLE || "edge";
const EDGE_ID = process.env.E2E_EDGE_ID || process.env.FEDERATION_EDGE_ID || "edge";

export async function GET() {
  return NextResponse.json({ ok: true, role: ROLE, edgeId: EDGE_ID, state: null });
}
`;

// The real route's contract, asserted as properties of the HTTP response:
// 200 + an application/json body that is exactly {"ok":true} + the module's
// CORS headers. The old harness-only body ({ok, role, edgeId, state}) fails
// on the key set, which is the point.
function isRealHealthRouteResponse(res) {
  const keys = res?.json && typeof res.json === "object" ? Object.keys(res.json) : [];
  return (
    res?.status === 200 &&
    keys.length === 1 &&
    keys[0] === "ok" &&
    res.json.ok === true &&
    (res.headers.get("content-type") || "").includes("application/json") &&
    res.headers.get("access-control-allow-origin") === "*"
  );
}

const results = [];
let tmpRoot = null;
const children = new Set();

function log(msg) {
  console.log(`[e2e] ${msg}`);
}

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, { timeout = 30000, interval = 250, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}${lastErr ? ` (last: ${lastErr.message})` : ""}`);
}

// ─── Instance management ────────────────────────────────────────────────

function spawnInstance({ role, edgeId = null, port = 0, dataDir, extraEnv = {} }) {
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    E2E_ROLE: role,
    E2E_EDGE_ID: edgeId || "",
    E2E_PORT: String(port),
    "9ROUTER_E2E_SRC": SRC,
    FEDERATION_TOKEN: FED_TOKEN,
    JWT_SECRET,
    API_KEY_SECRET,
    ...extraEnv,
  };
  if (role !== "standalone") {
    env.FEDERATION_MODE = role;
  } else {
    delete env.FEDERATION_MODE;
  }
  if (role === "edge") {
    env.FEDERATION_EDGE_ID = edgeId;
  }

  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", LOADER, CHILD], {
    cwd: REPO,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => {
    stdout += c;
  });
  child.stderr.on("data", (c) => {
    stderr += c;
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`instance ${role}${edgeId ? ":" + edgeId : ""} did not become ready (stderr: ${stderr.slice(-500)})`)), 30000);
    child.stdout.on("data", function onData(c) {
      stdout += c;
      const m = stdout.match(/E2E_READY (\{.*\})/);
      if (m) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve(JSON.parse(m[1]));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`instance ${role}${edgeId ? ":" + edgeId : ""} exited early (code ${code}, stderr: ${stderr.slice(-500)})`));
    });
  });

  return {
    child,
    role,
    edgeId,
    dataDir,
    ready,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function stopInstance(inst) {
  if (!inst || inst.child.exitCode !== null) return;
  inst.child.kill("SIGTERM");
  await Promise.race([
    new Promise((r) => inst.child.once("exit", r)),
    sleep(5000),
  ]);
  if (inst.child.exitCode === null) inst.child.kill("SIGKILL");
  children.delete(inst.child);
}

async function killCentral(inst) {
  // SIGKILL — no graceful shutdown, simulates a hard outage.
  inst.child.kill("SIGKILL");
  await new Promise((r) => inst.child.once("exit", r));
  children.delete(inst.child);
}

// ─── HTTP helpers ───────────────────────────────────────────────────────

async function fetchJson(url, { method = "GET", token = null, body = null, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== null && body !== undefined) h["content-type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers: h,
    body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, headers: res.headers, json };
}

// Raw-text request — an SSE body is not JSON, so fetchJson's res.json() would
// swallow the frames. Returns the body verbatim for frame parsing.
async function fetchText(url, { method = "GET", token = null, body = null, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== null && body !== undefined) h["content-type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers: h,
    body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

// Parse an SSE body into its `data:` payloads (the terminal `[DONE]` included).
// The delta payloads are JSON objects; a frame that does not parse is kept as
// null so a malformed frame fails a check instead of being silently dropped.
function parseSseFrames(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice("data:".length).trim());
}

function parseSseDeltas(frames) {
  return frames
    .filter((f) => f !== "[DONE]")
    .map((f) => {
      try {
        return JSON.parse(f);
      } catch {
        return null;
      }
    });
}

// ─── FED-GAP-04 helpers ─────────────────────────────────────────────────
// The harness's own introspection path (never /api/health): role/edge id,
// the provenance of the health route module the instance serves, and the
// free-tier fixture evidence.
async function instanceInfo(baseUrl) {
  const r = await fetchJson(`${baseUrl}/api/e2e/instance`);
  return { status: r.status, ...(r.json || {}) };
}

// A real client API key created through the app's own write path
// (POST /api/keys → applyReplayMutation → createApiKey).
async function createClientKey(baseUrl, name) {
  const r = await fetchJson(`${baseUrl}/api/keys`, {
    method: "POST",
    token: FED_TOKEN,
    body: { name },
  });
  return { status: r.status, key: r.json?.key ?? null, id: r.json?.id ?? null };
}

// One streamed completion for the free-tier model through the real route.
async function freeTierCompletion(baseUrl, { key, model }) {
  const res = await fetchText(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    token: key,
    body: {
      model,
      stream: true,
      messages: [{ role: "user", content: "free-tier e2e probe" }],
    },
  });
  const frames = parseSseFrames(res.text);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    federationState: res.headers.get("x-federation-state"),
    frames,
    deltas: parseSseDeltas(frames),
    content: joinDeltaContent(res.text),
    body: res.text,
  };
}

// 200 + SSE + terminal [DONE] + exactly the fixture's delta content (the
// fixture splits its text across two frames, so joining them proves the
// pipeline re-emitted every frame rather than one blob).
function freeTierCompletionOk(r) {
  return (
    r.status === 200 &&
    r.contentType.startsWith("text/event-stream") &&
    r.frames.length > 0 &&
    r.frames[r.frames.length - 1] === "[DONE]" &&
    r.content === FIXTURE_TEXT
  );
}

function freeTierDetail(r, prefix = "") {
  return (
    `${prefix}status=${r.status} ct=${r.contentType} frames=${r.frames.length} ` +
    `content=${JSON.stringify(r.content)}`
  );
}

// ─── Scenario ───────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-e2e-"));
  log(`temp root: ${tmpRoot}`);

  let central = null;
  let edgeA = null;
  let edgeB = null;

  try {
    // ── Phase 0: standalone boot (all three boot clean, no FEDERATION_MODE)
    log("phase 0: standalone boot");
    const sa1 = spawnInstance({ role: "standalone", dataDir: path.join(tmpRoot, "sa1") });
    const sa2 = spawnInstance({ role: "standalone", dataDir: path.join(tmpRoot, "sa2") });
    const sa3 = spawnInstance({ role: "standalone", dataDir: path.join(tmpRoot, "sa3") });
    const saInfo = await Promise.all([sa1.ready, sa2.ready, sa3.ready]);
    check("standalone boot: 3 instances boot clean", saInfo.every((i) => i.role === "standalone"));

    // ── FED-GAP-04 (a): the REAL application health route ────────────────
    // GET /api/health is dispatched to src/app/api/health/route.js and its
    // own Response is relayed, so the asserted contract is the application's:
    // 200 + exactly {"ok":true} + the module's CORS headers. The pre-task
    // harness-only body ({ok, role, edgeId, state}) would fail this.
    const healthRouteSha = createHash("sha256").update(fs.readFileSync(HEALTH_ROUTE_FILE)).digest("hex");
    for (const info of saInfo) {
      const base = `http://127.0.0.1:${info.port}`;
      const h = await fetchJson(`${base}/api/health`);
      check(
        `real route: GET /api/health on :${info.port} returns 200 {ok:true} (src/app/api/health/route.js)`,
        isRealHealthRouteResponse(h),
        `status=${h.status} body=${JSON.stringify(h.json)} acao=${h.headers.get("access-control-allow-origin")}`
      );
    }

    const saBase = `http://127.0.0.1:${saInfo[0].port}`;
    const preflight = await fetchJson(`${saBase}/api/health`, { method: "OPTIONS" });
    check(
      "real route: OPTIONS /api/health answers the module's 204 CORS preflight",
      preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === "*",
      `status=${preflight.status} acao=${preflight.headers.get("access-control-allow-origin")}`
    );

    // Provenance: the route the instance serves is the tracked file itself —
    // the instance reports the module it loaded and its sha256, and the run
    // compares that against the repo's copy.
    const saInstance = await instanceInfo(saBase);
    check(
      "real route: /api/health is served by the tracked module (file + sha256 provenance)",
      saInstance.healthRoute?.file === HEALTH_ROUTE_FILE && saInstance.healthRoute?.sha256 === healthRouteSha,
      `served=${saInstance.healthRoute?.file} sha=${String(saInstance.healthRoute?.sha256).slice(0, 12)} ` +
        `expected=${HEALTH_ROUTE_FILE} sha=${healthRouteSha.slice(0, 12)}`
    );

    // The standalone lifecycle observation moved off /api/health (it is not
    // the application's contract) onto the harness-only introspection path.
    for (const info of saInfo) {
      const inst = await instanceInfo(`http://127.0.0.1:${info.port}`);
      check(
        `standalone harness: /api/e2e/instance reports role=standalone on :${info.port}`,
        inst.status === 200 && inst.role === "standalone",
        `role=${inst.role} edgeId=${inst.edgeId}`
      );
    }

    // ── FED-GAP-04 (b): a real FREE-TIER completion ──────────────────────
    // The model comes from the instance's own catalog derivation (the app's
    // credentialless free provider), and the request travels the REAL
    // /v1/chat/completions route: API-key gate → free-tier virtual
    // credential → provider selection → translation → SSE, with only the
    // provider's outbound transport answered locally.
    const FREE_MODEL = saInstance.freeTier?.model;
    check(
      "free-tier completion: the instance derives the model from the app's credentialless free catalog",
      typeof FREE_MODEL === "string" && FREE_MODEL.includes("/"),
      `provider=${saInstance.freeTier?.providerId} alias=${saInstance.freeTier?.alias} model=${FREE_MODEL}`
    );

    const saKey = await createClientKey(saBase, "e2e-free-tier-key");
    check(
      "free-tier completion: client API key created through the app's /api/keys path",
      saKey.status === 201 && !!saKey.key,
      `status=${saKey.status} id=${saKey.id ?? "none"}`
    );

    const freeCompletion = await freeTierCompletion(saBase, { key: saKey.key, model: FREE_MODEL });
    check(
      "free-tier completion: real /v1/chat/completions streams the free-tier model to a terminal [DONE]",
      freeTierCompletionOk(freeCompletion),
      freeTierDetail(freeCompletion)
    );

    // The fixture's own record is what makes "the free-tier provider really
    // ran" an assertion instead of an inference: the app's executor called the
    // provider's declared transport (bootstrap + chat), with the anti-abuse
    // system marker its transformRequest injects, and nothing escaped to a
    // live host.
    let saEvidence = null;
    try {
      const after = await instanceInfo(saBase);
      saEvidence = after.freeTier?.upstream ?? null;
    } catch {
      saEvidence = null;
    }
    check(
      "free-tier completion: the app's free-tier executor drove the provider transport (fixture evidence, no live network)",
      saEvidence?.chatRequests === 1 &&
        saEvidence?.bootstrapRequests >= 1 &&
        saEvidence?.offTargetBlocked === 0 &&
        saEvidence?.lastChatRequest?.model === "mimo-auto" &&
        saEvidence?.lastChatRequest?.stream === true &&
        saEvidence?.lastChatRequest?.systemMessages === 1,
      `evidence=${JSON.stringify(saEvidence)}`
    );

    // Negative control: the real route enforces the app's API-key gate. The
    // replica stand-in never checks keys, so a 401 here is the discriminator
    // between "the application answered" and "the harness answered".
    const bogus = await fetchText(`${saBase}/v1/chat/completions`, {
      method: "POST",
      token: "sk-not-a-valid-key",
      body: { model: FREE_MODEL, stream: true, messages: [{ role: "user", content: "hi" }] },
    });
    const afterBogus = await instanceInfo(saBase);
    check(
      "free-tier completion: an invalid API key is rejected 401 by the real route (the /v1 stand-in never checks keys)",
      bogus.status === 401 &&
        /invalid api key/i.test(bogus.text) &&
        afterBogus.freeTier?.upstream?.chatRequests === 1,
      `status=${bogus.status} body=${JSON.stringify(bogus.text.slice(0, 120))} ` +
        `upstreamChatRequests=${afterBogus.freeTier?.upstream?.chatRequests}`
    );

    await Promise.all([stopInstance(sa1), stopInstance(sa2), stopInstance(sa3)]);

    // ── Phase 0b: red-proof — the real-route check is load-bearing ───────
    // The same instance is booted with ONE route file overridden by the
    // pre-task harness-only body (`9ROUTER_E2E_SRC_OVERLAY` serves that one
    // file ahead of the repo source). If the assertion above still passed
    // against this endpoint it would be asserting nothing.
    log("phase 0b: route-boundary red-proof (mutated health route)");
    const mutantSrc = path.join(tmpRoot, "mutant-src");
    fs.mkdirSync(path.join(mutantSrc, "app", "api", "health"), { recursive: true });
    fs.writeFileSync(path.join(mutantSrc, "app", "api", "health", "route.js"), HARNESS_ONLY_HEALTH_ROUTE);
    const mutant = spawnInstance({
      role: "standalone",
      dataDir: path.join(tmpRoot, "mutant"),
      extraEnv: { "9ROUTER_E2E_SRC_OVERLAY": mutantSrc },
    });
    const mutantInfo = await mutant.ready;
    const mutantHealth = await fetchJson(`http://127.0.0.1:${mutantInfo.port}/api/health`);
    check(
      "red-proof: the old harness-only /api/health body FAILS the real-route assertion",
      !isRealHealthRouteResponse(mutantHealth) &&
        mutantHealth.json?.ok === true &&
        mutantHealth.json?.role === "standalone" &&
        !!mutantHealth.json?.edgeId,
      `status=${mutantHealth.status} body=${JSON.stringify(mutantHealth.json)}`
    );
    await stopInstance(mutant);

    // ── Phase 1: central + edges LINKED
    log("phase 1: central + edges link");
    central = spawnInstance({
      role: "central",
      dataDir: path.join(tmpRoot, "central"),
      extraEnv: { FEDERATION_EDGE_ID: "central" },
    });
    const centralInfo = await central.ready;
    const centralUrl = `http://127.0.0.1:${centralInfo.port}`;
    log(`central on :${centralInfo.port}`);

    edgeA = spawnInstance({
      role: "edge",
      edgeId: "edge-a",
      dataDir: path.join(tmpRoot, "edge-a"),
      extraEnv: {
        FEDERATION_CENTRAL_URL: centralUrl,
        FEDERATION_EDGE_ID: "edge-a",
        FEDERATION_SYNC_INTERVAL_MS: "500",
        FEDERATION_HEARTBEAT_INTERVAL_MS: "500",
        FEDERATION_OUTAGE_THRESHOLD_MS: "3000",
        FEDERATION_QUEUE_MAX: "100",
        FEDERATION_REPLAY_BATCH_SIZE: "10",
      },
    });
    edgeB = spawnInstance({
      role: "edge",
      edgeId: "edge-b",
      dataDir: path.join(tmpRoot, "edge-b"),
      extraEnv: {
        FEDERATION_CENTRAL_URL: centralUrl,
        FEDERATION_EDGE_ID: "edge-b",
        FEDERATION_SYNC_INTERVAL_MS: "500",
        FEDERATION_HEARTBEAT_INTERVAL_MS: "500",
        FEDERATION_OUTAGE_THRESHOLD_MS: "3000",
        FEDERATION_QUEUE_MAX: "100",
        FEDERATION_REPLAY_BATCH_SIZE: "10",
      },
    });
    const [edgeAInfo, edgeBInfo] = await Promise.all([edgeA.ready, edgeB.ready]);
    const edgeAUrl = `http://127.0.0.1:${edgeAInfo.port}`;
    const edgeBUrl = `http://127.0.0.1:${edgeBInfo.port}`;
    log(`edge-a on :${edgeAInfo.port}, edge-b on :${edgeBInfo.port}`);

    // Seed central with a provider connection + model alias (replicated
    // config) so edges have something to replicate.
    const seedConn = await fetchJson(`${centralUrl}/api/providers`, {
      method: "POST",
      token: FED_TOKEN,
      body: { provider: "openai", authType: "apikey", name: "e2e-main", apiKey: "sk-e2e-test" },
    });
    check("seed central: provider connection created", seedConn.status === 200, `status ${seedConn.status}`);
    const seedAlias = await fetchJson(`${centralUrl}/api/models/alias`, {
      method: "PUT",
      token: FED_TOKEN,
      body: { alias: "e2e-fast", model: "gpt-4o-mini" },
    });
    check("seed central: model alias set", seedAlias.status === 200, `status ${seedAlias.status}`);

    // Edges replicate: wait for both to reach the central watermark, then
    // assert the real lag METRIC on the responses that satisfied the wait.
    //
    // FED-GAP-02: lastAppliedRevision equality is an INFERENCE that the
    // replica is current — it is not the number the status surface reports.
    // The edge's revisionLag (src/lib/federation/server.js
    // buildLocalStatusPayload: max(0, centralMaxVersion - lastAppliedRevision),
    // FED-021 — the replica trailing the watermark central advertised) is what
    // the dashboard banner renders, so a regression that reported a stale or
    // positive lag while lastAppliedRevision still matched stayed invisible.
    // Retain the final local-status payloads that satisfied the catch-up
    // condition and assert the metric on THOSE (a re-fetch after the wait
    // would race a later delta and stop being the catch-up observation).
    const centralStatus = await fetchJson(`${centralUrl}/api/federation/status`, { token: FED_TOKEN });
    const centralWatermark = centralStatus.json?.maxVersion ?? 0;
    log(`central watermark: ${centralWatermark}`);

    let catchUp = null;
    await waitFor(
      async () => {
        const [sa, sb] = await Promise.all([
          fetchJson(`${edgeAUrl}/api/federation/local-status`),
          fetchJson(`${edgeBUrl}/api/federation/local-status`),
        ]);
        const upToDate =
          sa.json?.lastAppliedRevision === centralWatermark &&
          sb.json?.lastAppliedRevision === centralWatermark;
        if (upToDate) {
          catchUp = { a: sa.json, b: sb.json };
          return true;
        }
        return false;
      },
      { timeout: 30000, label: "edges to catch up to central watermark" }
    );
    check("edges replicate: both at central watermark", true, `revision ${centralWatermark}`);

    // The lag metric itself, per edge, off the real (tokenless) local-status
    // payload. Detail names the edge and every number the verdict rests on.
    const lagDetail = (status) =>
      `revisionLag=${JSON.stringify(status?.revisionLag)} (type ${typeof status?.revisionLag}) ` +
      `lastAppliedRevision=${JSON.stringify(status?.lastAppliedRevision)} ` +
      `centralMaxVersion=${JSON.stringify(status?.centralMaxVersion)} ` +
      `central watermark=${centralWatermark} ` +
      `last_state=${JSON.stringify(status?.last_state)} role=${JSON.stringify(status?.role)}`;
    const lagIsZero = (status) =>
      typeof status?.revisionLag === "number" &&
      Number.isFinite(status.revisionLag) &&
      status.revisionLag === 0;

    check(
      "edge-a: revisionLag === 0 after catch-up",
      lagIsZero(catchUp?.a),
      `edge=edge-a ${lagDetail(catchUp?.a)}`
    );
    check(
      "edge-b: revisionLag === 0 after catch-up",
      lagIsZero(catchUp?.b),
      `edge=edge-b ${lagDetail(catchUp?.b)}`
    );

    // Edges LINKED (heartbeat succeeded).
    await waitFor(
      async () => {
        const [sa, sb] = await Promise.all([
          fetchJson(`${edgeAUrl}/api/federation/local-status`),
          fetchJson(`${edgeBUrl}/api/federation/local-status`),
        ]);
        return sa.json?.last_state === "linked" && sb.json?.last_state === "linked";
      },
      { timeout: 15000, label: "edges LINKED" }
    );
    check("edges LINKED after heartbeat", true);

    // ── API-key replica chain (FED-GAP-01): the dogfood value-claims matrix
    //    (docs/dogfood/2026-09-18-federation-value-claims.md, row A2) claims
    //    "a key created through edge A replicated to central and both edges".
    //    The full three-hop chain was proven only for a model alias
    //    (post-recovery, below); the per-hop halves live in queue.test.js /
    //    failover.test.js / replication.test.js, so a regression breaking the
    //    apiKeys hop alone would have stayed green everywhere. The hops take
    //    DIFFERENT paths and are asserted separately:
    //      write  → edge-a's proxy forwards the mutating dashboard call to
    //               central (proxy.js MUTATING_API_PREFIXES includes /api/keys)
    //      central→ applied through the real federation write path
    //               (e2e-child → applyReplayMutation → server.js createApiKey)
    //      edges  → picked up from the delta poll into the local replica, read
    //               back directly (dashboard GETs are never proxied)
    const KEY_NAME = "e2e-replicated-key";
    const localKeys = async (baseUrl) =>
      (await fetchJson(`${baseUrl}/api/keys`, { token: FED_TOKEN })).json?.keys || [];
    const findKey = async (baseUrl) =>
      (await localKeys(baseUrl)).find((k) => k.name === KEY_NAME) || null;

    // Hop 1 — write THROUGH the edge (not central). The child answers the
    // real route's 201 {key, name, id, machineId}, so the created id is
    // portable into the read-back hops.
    const keyWrite = await fetchJson(`${edgeAUrl}/api/keys`, {
      method: "POST",
      token: FED_TOKEN,
      body: { name: KEY_NAME },
    });
    const centralKeyId = keyWrite.json?.id ?? null;
    // The plaintext key value is what a real client would present; the
    // free-tier completion checks reuse it so the federated request carries a
    // genuine client credential (relayed by proxy.js to central).
    const clientKey = keyWrite.json?.key ?? null;
    check(
      "api-key chain: edge-a write accepted (proxied to central)",
      keyWrite.status === 201 && !!centralKeyId && keyWrite.json?.name === KEY_NAME,
      `status=${keyWrite.status} id=${centralKeyId ?? "none"} name=${JSON.stringify(keyWrite.json?.name)}`
    );

    // Hop 2 — the row is at CENTRAL (authoritative). Bounded wait, never a
    // fixed sleep.
    let centralKey = null;
    try {
      centralKey = await waitFor(() => findKey(centralUrl), {
        timeout: 30000,
        interval: 250,
        label: `key '${KEY_NAME}' at central`,
      });
    } catch {
      centralKey = null;
    }
    check(
      "api-key chain: key row present at central",
      !!centralKey && !!centralKey.id,
      `central id=${centralKey?.id ?? "none"} (edge write id=${centralKeyId ?? "none"})`
    );

    // Hop 3 — the SAME row reached BOTH edges' replicas: id equality proves
    // it is the replicated row, not a coincidentally-named one. The last
    // observation is kept so a failure names WHICH edge is behind.
    let edgeHit = null;
    let lastEdges = { a: null, b: null, countA: 0, countB: 0 };
    try {
      edgeHit = await waitFor(
        async () => {
          const [ka, kb] = await Promise.all([localKeys(edgeAUrl), localKeys(edgeBUrl)]);
          const a = ka.find((k) => k.name === KEY_NAME) || null;
          const b = kb.find((k) => k.name === KEY_NAME) || null;
          lastEdges = { a, b, countA: ka.length, countB: kb.length };
          return a && b ? { a, b } : null;
        },
        { timeout: 30000, interval: 250, label: `key '${KEY_NAME}' replicated to both edges` }
      );
    } catch {
      edgeHit = null;
    }
    check(
      "api-key chain: key row replicated to both edges",
      !!edgeHit && !!centralKeyId && edgeHit.a.id === centralKeyId && edgeHit.b.id === centralKeyId,
      `edge-a id=${lastEdges.a?.id ?? "absent"} (${lastEdges.countA} keys), ` +
        `edge-b id=${lastEdges.b?.id ?? "absent"} (${lastEdges.countB} keys), ` +
        `central id=${centralKeyId ?? "none"}`
    );

    // Edge proxy: /v1 through the edge reaches central (source: central).
    const proxied = await fetchJson(`${edgeAUrl}/v1/models`, { token: FED_TOKEN });
    check(
      "edge proxy: /v1/models via edge-a reaches central",
      proxied.status === 200 && proxied.json?.source === "central",
      `source=${proxied.json?.source}`
    );

    // Edge proxy, product path: a completion travelling through the LINKED
    // edge's proxy to central (proxy.js:49 forwards every /v1/* request, any
    // method; relayResponse at proxy.js:136 pipes the reply back). The
    // `source: "central"` marker is produced ONLY by the central child
    // (e2e-child.mjs), so it proves the request traversed the proxy — the
    // edge's own stand-in answers `local-replica`. X-Federation-State is a
    // DEGRADED-only signal (headers.js / queue.js): a LINKED proxied response
    // carries none, and that absence is asserted here.
    const proxiedChat = await fetchJson(`${edgeAUrl}/v1/chat/completions`, {
      method: "POST",
      token: FED_TOKEN,
      body: { model: "e2e-model", messages: [{ role: "user", content: "hi" }] },
    });
    check(
      "edge proxy: LINKED completion via edge-a reaches central",
      proxiedChat.status === 200 &&
        proxiedChat.json?.source === "central" &&
        proxiedChat.json?.choices?.[0]?.message?.content === "ok" &&
        proxiedChat.headers.get("x-federation-state") === null,
      `status=${proxiedChat.status} source=${proxiedChat.json?.source} state=${proxiedChat.headers.get("x-federation-state")}`
    );

    // Same hop, streaming body: the SSE relay must preserve the event-stream
    // content type and relay every frame (two deltas + the terminal [DONE]),
    // with the deltas still carrying the central marker.
    const streamedChat = await fetchText(`${edgeAUrl}/v1/chat/completions`, {
      method: "POST",
      token: FED_TOKEN,
      body: { model: "e2e-model", messages: [{ role: "user", content: "hi" }], stream: true },
    });
    const streamedFrames = parseSseFrames(streamedChat.text);
    const streamedDeltas = parseSseDeltas(streamedFrames);
    check(
      "edge proxy: LINKED streamed completion relays SSE from central",
      streamedChat.status === 200 &&
        (streamedChat.headers.get("content-type") || "").startsWith("text/event-stream") &&
        streamedFrames[streamedFrames.length - 1] === "[DONE]" &&
        streamedDeltas.length >= 2 &&
        streamedDeltas.every((d) => d?.source === "central") &&
        streamedChat.headers.get("x-federation-state") === null,
      `status=${streamedChat.status} ct=${streamedChat.headers.get("content-type")} frames=${streamedFrames.length} ` +
        `deltas=${streamedDeltas.length} sources=${[...new Set(streamedDeltas.map((d) => d?.source))].join(",")}`
    );

    // ── FED-GAP-04 (b, federation path): a FREE-TIER completion through the
    //    LINKED edge → central. Same real /v1/chat/completions route as the
    //    standalone check, reached the way a client reaches a federated
    //    deployment: the edge proxies /v1 with its federation token and
    //    relays the client's own key in X-9r-Client-Authorization (proxy.js
    //    buildUpstreamHeaders), central authenticates the END client (FED-011)
    //    and runs the app pipeline. CENTRAL's fixture is the evidence that
    //    central's process really drove the free-tier provider's transport.
    const freeViaEdge = await freeTierCompletion(edgeAUrl, { key: clientKey, model: FREE_MODEL });
    check(
      "real free-tier completion: LINKED edge-a → central streams the free-tier model to a terminal [DONE]",
      freeTierCompletionOk(freeViaEdge) && freeViaEdge.federationState === null,
      freeTierDetail(freeViaEdge, "via edge-a ")
    );
    let centralEvidence = null;
    try {
      centralEvidence = (await instanceInfo(centralUrl)).freeTier?.upstream ?? null;
    } catch {
      centralEvidence = null;
    }
    check(
      "real free-tier completion: central's own pipeline drove the free-tier transport (fixture evidence)",
      centralEvidence?.chatRequests === 1 &&
        centralEvidence?.bootstrapRequests >= 1 &&
        centralEvidence?.offTargetBlocked === 0 &&
        centralEvidence?.lastChatRequest?.model === "mimo-auto" &&
        centralEvidence?.lastChatRequest?.systemMessages === 1,
      `evidence=${JSON.stringify(centralEvidence)}`
    );

    // ── Phase 2: kill central → DEGRADED
    log("phase 2: kill central");
    await killCentral(central);
    central = null;

    await waitFor(
      async () => {
        const [sa, sb] = await Promise.all([
          fetchJson(`${edgeAUrl}/api/federation/local-status`),
          fetchJson(`${edgeBUrl}/api/federation/local-status`),
        ]);
        return sa.json?.last_state === "degraded" && sb.json?.last_state === "degraded";
      },
      { timeout: 30000, label: "edges DEGRADED after central kill" }
    );
    check("edges flip DEGRADED after outage threshold", true);

    // Degraded serving: /v1 from the local replica, with the degraded header.
    const degradedModels = await fetchJson(`${edgeAUrl}/v1/models`, { token: FED_TOKEN });
    check(
      "degraded serving: edge-a serves /v1 from local replica",
      degradedModels.status === 200 &&
        degradedModels.json?.source === "local-replica" &&
        degradedModels.headers.get("x-federation-state") === "degraded",
      `source=${degradedModels.json?.source} header=${degradedModels.headers.get("x-federation-state")}`
    );
    const degradedChat = await fetchJson(`${edgeBUrl}/v1/chat/completions`, {
      method: "POST",
      token: FED_TOKEN,
      body: { model: "e2e-model", messages: [{ role: "user", content: "hi" }] },
    });
    check(
      "degraded serving: edge-b serves /v1/chat/completions from local replica",
      degradedChat.status === 200 &&
        degradedChat.json?.source === "local-replica" &&
        degradedChat.headers.get("x-federation-state") === "degraded",
      `source=${degradedChat.json?.source} header=${degradedChat.headers.get("x-federation-state")}`
    );

    // Degraded streaming: the same streamed request is served by the local
    // replica — SSE frames carry the `local-replica` marker and the response
    // says the edge is degraded.
    const degradedStream = await fetchText(`${edgeBUrl}/v1/chat/completions`, {
      method: "POST",
      token: FED_TOKEN,
      body: { model: "e2e-model", messages: [{ role: "user", content: "hi" }], stream: true },
    });
    const degradedFrames = parseSseFrames(degradedStream.text);
    const degradedDeltas = parseSseDeltas(degradedFrames);
    check(
      "degraded serving: edge-b streams /v1/chat/completions from local replica",
      degradedStream.status === 200 &&
        (degradedStream.headers.get("content-type") || "").startsWith("text/event-stream") &&
        degradedStream.headers.get("x-federation-state") === "degraded" &&
        degradedFrames[degradedFrames.length - 1] === "[DONE]" &&
        degradedDeltas.length >= 2 &&
        degradedDeltas.every((d) => d?.source === "local-replica"),
      `status=${degradedStream.status} ct=${degradedStream.headers.get("content-type")} ` +
        `header=${degradedStream.headers.get("x-federation-state")} deltas=${degradedDeltas.length} ` +
        `sources=${[...new Set(degradedDeltas.map((d) => d?.source))].join(",")}`
    );

    // ── FED-GAP-04 (b, outage path): the free-tier completion survives a
    //    central outage. The DEGRADED edge serves it from its OWN app
    //    pipeline — the app's credentialless free provider needs nothing from
    //    central — and its own fixture is the evidence that the free-tier
    //    transport was driven on the edge, not proxied away.
    const degradedFree = await freeTierCompletion(edgeAUrl, { key: clientKey, model: FREE_MODEL });
    check(
      "real free-tier completion: DEGRADED edge-a serves it from its own app pipeline (central down)",
      freeTierCompletionOk(degradedFree) && degradedFree.federationState === "degraded",
      freeTierDetail(degradedFree, `state=${degradedFree.federationState} `)
    );
    let edgeEvidence = null;
    try {
      edgeEvidence = (await instanceInfo(edgeAUrl)).freeTier?.upstream ?? null;
    } catch {
      edgeEvidence = null;
    }
    check(
      "real free-tier completion: the DEGRADED edge's own free-tier transport handled it (fixture evidence)",
      edgeEvidence?.chatRequests === 1 &&
        edgeEvidence?.offTargetBlocked === 0 &&
        edgeEvidence?.lastChatRequest?.model === "mimo-auto" &&
        edgeEvidence?.lastChatRequest?.systemMessages === 1,
      `evidence=${JSON.stringify(edgeEvidence)}`
    );

    // Degraded writes: queued locally (202 + queued-write-id), NOT applied
    // to the replica (the replica is read-only while degraded).
    const queuedWrite = await fetchJson(`${edgeAUrl}/api/settings`, {
      method: "PATCH",
      token: FED_TOKEN,
      body: { degradedWriteMarker: "queued-during-outage" },
    });
    check(
      "degraded write: queued locally with 202 + queued-write-id",
      queuedWrite.status === 202 &&
        queuedWrite.headers.get("x-federation-state") === "degraded" &&
        !!queuedWrite.headers.get("x-federation-queued-write-id"),
      `status=${queuedWrite.status} header=${queuedWrite.headers.get("x-federation-state")}`
    );

    // ── Phase 3: restart central (same address — real deployments restart
    //     in place, so the edges' FEDERATION_CENTRAL_URL stays valid)
    log("phase 3: restart central");
    central = spawnInstance({
      role: "central",
      dataDir: path.join(tmpRoot, "central"),
      port: centralInfo.port,
      extraEnv: { FEDERATION_EDGE_ID: "central" },
    });
    const centralInfo2 = await central.ready;
    const centralUrl2 = `http://127.0.0.1:${centralInfo2.port}`;
    log(`central restarted on :${centralInfo2.port}`);

    // Edges recover: RECOVERING → drain → catch up → LINKED.
    await waitFor(
      async () => {
        const [sa, sb] = await Promise.all([
          fetchJson(`${edgeAUrl}/api/federation/local-status`),
          fetchJson(`${edgeBUrl}/api/federation/local-status`),
        ]);
        return sa.json?.last_state === "linked" && sb.json?.last_state === "linked";
      },
      { timeout: 30000, label: "edges back to LINKED after recovery" }
    );
    check("edges recover to LINKED (replay drain + delta catch-up)", true);

    // Reconcile: the queued write reached central.
    const centralSettings = await fetchJson(`${centralUrl2}/api/settings`, { token: FED_TOKEN });
    const settings = centralSettings.json?.settings ?? {};
    check(
      "reconcile: queued degraded write applied on central",
      settings.degradedWriteMarker === "queued-during-outage",
      `marker=${JSON.stringify(settings.degradedWriteMarker)}`
    );

    // Replication resumed: a NEW central write propagates to both edges.
    const postRecoveryAlias = await fetchJson(`${centralUrl2}/api/models/alias`, {
      method: "PUT",
      token: FED_TOKEN,
      body: { alias: "e2e-after-recovery", model: "gpt-5.6-sol" },
    });
    check("post-recovery central write accepted", postRecoveryAlias.status === 200, `status ${postRecoveryAlias.status}`);
    await waitFor(
      async () => {
        const [ma, mb] = await Promise.all([
          fetchJson(`${edgeAUrl}/v1/models`, { token: FED_TOKEN }),
          fetchJson(`${edgeBUrl}/v1/models`, { token: FED_TOKEN }),
        ]);
        const has = (j) => (j?.data || []).some((m) => m.id === "e2e-after-recovery");
        return has(ma.json) && has(mb.json);
      },
      { timeout: 30000, label: "post-recovery write replicated to both edges" }
    );
    check("post-recovery write replicated to both edges", true);

    // ── Phase 4: cleanup
    log("phase 4: cleanup");
    await Promise.all([stopInstance(edgeA), stopInstance(edgeB)]);
    if (central) await stopInstance(central);
    central = null;
    edgeA = null;
    edgeB = null;
  } finally {
    for (const c of children) {
      try {
        c.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    if (tmpRoot && !KEEP_TMP) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      log(`cleaned ${tmpRoot}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  log("");
  log(`=== FEDERATION E2E SUMMARY (${elapsed}s) ===`);
  for (const r of results) {
    log(`  ${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  log(`  ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    log("E2E FAILED");
    process.exitCode = 1;
  } else {
    log("E2E PASSED");
    process.exitCode = 0;
  }
}

// Only run when executed directly — importing this file (e.g. for
// inspection/linting/analysis) must not spawn child processes (NR-GAP-003).
if (process.argv[1] && path.basename(process.argv[1]) === "e2e.mjs") {
  main().catch((err) => {
    console.error("[e2e] fatal:", err);
    process.exitCode = 1;
  });
}
