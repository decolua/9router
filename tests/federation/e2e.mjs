// FED-006 — federation end-to-end lifecycle proof (spec §5 FED-006).
//
// Spawns THREE real instances (central + 2 edges) as child processes, each
// with its own temp DATA_DIR and port, running the REAL federation modules
// (server.js handlers, proxy.js, queue.js, failover.js, edgeClient.js) via
// the e2e-loader alias hook. Proves the full lifecycle:
//
//   standalone boot (all three boot clean with FEDERATION_MODE unset)
//   → central starts, edges LINKED (heartbeat + replication sync)
//   → kill central → edges flip DEGRADED after the outage threshold
//   → edges still serve /v1 from the local replica
//     (X-Federation-State: degraded + replicaRevision)
//   → degraded writes are queued locally (202 + X-Federation-Queued-Write-Id)
//   → restart central → edges RECOVERING → replay drain + delta catch-up
//     → LINKED → writes reconcile (central sees the queued write)
//
// Standalone runnable: `node tests/federation/e2e.mjs` (no .test. suffix so
// vitest does not auto-collect it). Prints a PASS/FAIL summary; exit code
// reflects the result. Self-contained: temp dirs are cleaned up on exit.
//
// Env knobs (all optional):
//   E2E_TIMEOUT_MS   overall budget (default 120000)
//   E2E_KEEP_TMP     keep temp dirs on failure (default: clean up)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    for (const info of saInfo) {
      const h = await fetchJson(`http://127.0.0.1:${info.port}/api/health`);
      check(`standalone health: role=standalone on :${info.port}`, h.status === 200 && h.json?.role === "standalone");
    }
    await Promise.all([stopInstance(sa1), stopInstance(sa2), stopInstance(sa3)]);

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

    // Edges replicate: wait for both to reach the central watermark.
    const centralStatus = await fetchJson(`${centralUrl}/api/federation/status`, { token: FED_TOKEN });
    const centralWatermark = centralStatus.json?.maxVersion ?? 0;
    log(`central watermark: ${centralWatermark}`);

    await waitFor(
      async () => {
        const [sa, sb] = await Promise.all([
          fetchJson(`${edgeAUrl}/api/federation/local-status`),
          fetchJson(`${edgeBUrl}/api/federation/local-status`),
        ]);
        return (
          sa.json?.lastAppliedRevision === centralWatermark &&
          sb.json?.lastAppliedRevision === centralWatermark
        );
      },
      { timeout: 30000, label: "edges to catch up to central watermark" }
    );
    check("edges replicate: both at central watermark", true, `revision ${centralWatermark}`);

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

    // Edge proxy: /v1 through the edge reaches central (source: central).
    const proxied = await fetchJson(`${edgeAUrl}/v1/models`, { token: FED_TOKEN });
    check(
      "edge proxy: /v1/models via edge-a reaches central",
      proxied.status === 200 && proxied.json?.source === "central",
      `source=${proxied.json?.source}`
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
