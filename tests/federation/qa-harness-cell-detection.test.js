// QA-9ROUTER-21 / QA-9ROUTER-22 / QA-9ROUTER-26 — QA-battery cell-detection regression test.
//
// The QA battery (`~/.hermes/scripts/bunker-qa.sh`, a FLEET script that lives outside
// this repo) grades repos inside its generated remote script. Four detection defects in
// it produced FALSE verdicts on 9router's own cycles:
//
//   QA-9ROUTER-21  ui-probe curled `/` with no -L and accepted only 200, so 9router
//                  (/ -> 307 /dashboard -> 307 /login -> 200, auth-guard routing is the
//                  app's normal shape) was graded `ui-probe FAIL "UI not serving (http=307)"`
//                  while the UI was serving the whole time.
//   QA-9ROUTER-22  the start command was a guess: `BIN="node src/index.js"` for EVERY
//                  package.json repo. 9router has no src/index.js, so chaos-corruption and
//                  chaos-errorpath both started "Cannot find module" and graded that
//                  refusal as the app's verdict — both cells vacuous.
//   QA-9ROUTER-26  install detection installed only the ROOT package, never the
//                  independent tests/ package (9router documents `npm install && cd tests
//                  && npm install`; tests/ pins vitest ^4.0.0). The suite never ran and
//                  chaos-disconnect scored its missing-deps rc as OK "fails fast on
//                  disconnect" — a FALSE PASS on a suite that never executed.
//   QA-9ROUTER-27  (this file, 2026-09-22) the render-execute spawn inherited the
//                  vitest worker's cwd, so a rendered script's synthesized `npm test`
//                  ran in the REAL tests/ package, matched this very file, and
//                  re-rendered + re-executed: unbounded self-recursion (incident:
//                  4,183 processes, swap 97%, loadavg 1,217, host unusable ~3.5h).
//                  Three independent defense layers below: (1) every spawn that
//                  executes a rendered script or can reach a fixture package script
//                  pins cwd to the FIXTURE directory (all fixture paths in rendered
//                  scripts are absolute, so this cannot break them); (2) a
//                  QA_HARNESS_CELL_DETECTION_ACTIVE re-entry sentinel makes a nested
//                  copy of this suite skip itself, so even a reverted cwd fix cannot
//                  recurse; (3) every spawnSync in this file carries an explicit
//                  timeout.
//
// QA-9ROUTER-19 / QA-9ROUTER-20 — added 2026-09-23. Two more harness defects
// produced FALSE board rows on 9router:
//
//   QA-9ROUTER-20  the upgrade cell installed the ROOT package name. The root
//                  package here is `"name": "9router-app", "private": true`
//                  (never published — upstream identical) while `cli/` is the
//                  PUBLISHED `"name": "9router"`, so the cell graded
//                  `upgrade FAIL "previous release 9router-app@0.5.69 would not
//                  install … E404 Not Found"` — a false product verdict, and the
//                  upgrade path stayed UNVERIFIED. Detection must prefer a
//                  publishable (non-private) package, root name as the fallback.
//   QA-9ROUTER-19  the ci-pass act leg ran EVERY workflow, including ones that
//                  cannot trigger on a branch push at all (docker-publish.yml:
//                  push TAGS v* + workflow_dispatch; gitbook-pages.yml: push
//                  branches [main, master] + paths gitbook/**) and graded their
//                  act artifacts as product FAIL, while hosted CI on the same
//                  HEAD was green. The host now selects only triggerable
//                  workflows, the cell stages them into an EXTERNAL directory
//                  (act does NOT merge repeated -W <file> targets — measured on
//                  this host: the LAST one wins; a single DIRECTORY target
//                  recursively merges), and a step failure caused by the
//                  workflow's own registry/docker coordinates is CLASSIFIED
//                  instead of graded red. The negative control below pins that a
//                  genuinely failing triggerable path still grades FAIL.
//
// REALNESS IS THE POINT — no mocks of the code under test. Every assertion drives the
// harness through its own test hooks (`__detect-cmds`, `__gen-remote`), and the ui-probe
// assertions run the EXTRACTED decision chain against a REAL node fixture serving a real
// redirect chain, exactly as the harness does on an agent. The RED side is produced three
// ways so it is reproducible on any machine: an inline replica of the pre-fix decision,
// the real pre-fix copy from this repo's git history when it is obtainable, and the
// post-fix chain that must pass the same fixture. The QA-19/20 assertions drive the
// ci-pass decision chain extracted from a REAL render the same way, with the harness's own
// helper functions sliced out of that same render.
//
// GRACEFUL SKIP IS REQUIRED: the harness is a fleet file, not a repo file. A checkout
// without it (CI, a fresh clone) must SKIP, never fail.
//
// The harness path is overridable with BUNKER_QA_SCRIPT (this file's own precedence) so a
// reviewer can point the suite at a modified copy; BUNKER_QA_SH is honoured as the
// secondary name used by the fleet's shell classifier test.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const HARNESS =
  process.env.BUNKER_QA_SCRIPT ||
  process.env.BUNKER_QA_SH ||
  path.join(os.homedir(), ".hermes", "scripts", "bunker-qa.sh");

const HARNESS_PRESENT = fs.existsSync(HARNESS);

function probeHarness() {
  if (!HARNESS_PRESENT) return { functional: false, reason: "not present" };

  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-harness-probe-"));
  try {
    const result = spawnSync("bash", [HARNESS, "__gen-remote", probeDir], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error) {
      return { functional: false, reason: `__gen-remote probe failed: ${result.error.message}` };
    }
    if (result.status !== 0) {
      return { functional: false, reason: `__gen-remote probe exited with status ${result.status}` };
    }
    if (!result.stdout?.trim()) {
      return { functional: false, reason: "__gen-remote probe produced empty output" };
    }
    return { functional: true, reason: "" };
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

const HARNESS_PROBE = probeHarness();
const HARNESS_FUNCTIONAL = HARNESS_PROBE.functional;

// QA-9ROUTER-27 defense layer 2 — re-entry sentinel. Every spawn below that can lead
// to executing a rendered script re-exports the environment with this variable set.
// Under the sentinel the real suite is skipped entirely (see `suite` below), so even
// if the cwd fix (layer 1) were ever reverted, an inner `npm test` that reached this
// file would skip instead of re-rendering — the recursion dies after one generation.
const REENTRY_ACTIVE = Boolean(process.env.QA_HARNESS_CELL_DETECTION_ACTIVE);

// Merged over process.env by every spawn that can reach a rendered script or a fixture
// package script.
const GUARD_ENV = { ...process.env, QA_HARNESS_CELL_DETECTION_ACTIVE: "1" };

// INT-9ROUTER-002 (2026-10-07): the fleet harness grew past 2900 lines (d941b7c4a
// + b4d567a98 — SSH port tables, act/native-leg timeout enforcement) and a single
// `__gen-remote` render now legitimately runs 0.3s–11.2s on this host under fleet
// load (measured), while vitest's default per-test budget is 5s. Measure, don't
// hope: every test in this file gets a 120s budget, and the belowAll/afterAll
// lifecycle hooks (fixture git-inits + port teardown) get 180s — matched to the
// same explicit budget the longest live assertions in this file already carry.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

if (REENTRY_ACTIVE) {
  console.warn(
    "qa-harness-cell-detection: re-entry refused — a qa-harness-cell-detection run is already active above this process"
  );
}

// The legacy root-only install command. A repo WITHOUT an independent test package must
// still produce EXACTLY this — the detection change must be inert for every other project.
const LEGACY_NPM_INSTALL = "npm ci --ignore-scripts --no-audit --no-fund";

// The ui-probe cell hardcodes :3111 in the generated chain, so the live assertions must
// use it. If something already answers there (the fleet boxes share ports), SKIP the live
// block rather than risk killing a foreign listener — the harness's own shared-box guard
// exists for the same reason.
const PROBE_PORT = 3111;
const PROBE_URL = `http://127.0.0.1:${PROBE_PORT}/`;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "qa-harness-detect-"));
const FIXTURES = {
  redirect: path.join(TMP, "redirect"), // / -> 307 -> 307 -> 200
  serverError: path.join(TMP, "server-error"), // / -> 500
  empty: path.join(TMP, "empty"), // no UI at all
  npmWithTests: path.join(TMP, "npm-with-tests"),
  npmPlain: path.join(TMP, "npm-plain"),
  customServer: path.join(TMP, "custom-server"),
  srcIndex: path.join(TMP, "src-index"),
  noEntry: path.join(TMP, "no-entry"),
  // QA-9ROUTER-20: private ROOT package + published nested CLI package (9router's
  // exact shape: root "9router-app"/private, cli/ "9router").
  privateRootWithCli: path.join(TMP, "private-root-with-cli"),
  // QA-9ROUTER-20 control: root publishable name only — legacy selection must hold.
  rootPublishable: path.join(TMP, "root-publishable"),
  // QA-9ROUTER-20 negative control: NOTHING publishable, root name is the honest answer.
  allPrivate: path.join(TMP, "all-private"),
  // QA-9ROUTER-19: workflows that cannot trigger on a branch push + one that can.
  workflowsMixed: path.join(TMP, "workflows-mixed"),
  // QA-9ROUTER-19 control edge: a lone workflow that DOES trigger.
  workflowsTriggerable: path.join(TMP, "workflows-triggerable"),
  // QA-9ROUTER-19: only non-triggerable workflows ⇒ act must be skipped, not graded.
  workflowsNoneTriggerable: path.join(TMP, "workflows-none-triggerable"),
};

// The harness's render path runs small bootstrap probes and can leave a straggler holding
// stdout; a child whose stdout is a PIPE then never delivers EOF and execFileSync blocks
// forever even though bash exited (observed: the run froze right after the detect tests,
// while the same call from a plain bash line returned in ~250ms). Capture through a FILE
// instead of a pipe so nothing can block on an inherited descriptor.
let captureSeq = 0;
function runHarness(args, { env } = {}) {
  captureSeq += 1;
  const outFile = path.join(TMP, `harness-${captureSeq}.out`);
  const cmd = `bash ${JSON.stringify(HARNESS)} ${args
    .map((a) => JSON.stringify(a))
    .join(" ")} > ${JSON.stringify(outFile)} 2>/dev/null`;
  // INT-9ROUTER-002 (2026-10-07): an externally TERM'd spawn leaves the output
  // file absent/empty and runHarness returned "", which every caller then read
  // as a CONTRACT failure ("'' to contain 'BIN='", "expected -1 to be greater
  // than -1"). That is an INFRA failure, not evidence about the harness. Measured
  // on this host: ~1 in 15 detached spawns gets reaped early (status 143). Retry
  // the render a bounded number of times and FAIL LOUD (never silently hand an
  // empty render to a contract assertion) if it never lands.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    spawnSync("bash", ["-c", cmd], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 120_000,
      detached: true,
      // Layer 2: always re-export the re-entry sentinel (explicit per-call env wins).
      env: { ...GUARD_ENV, ...(env || {}) },
    });
    if (fs.existsSync(outFile) && fs.readFileSync(outFile, "utf8").length > 0) break;
    if (attempt < 4) console.warn(`qa-harness-cell-detection: runHarness(${args[0]}) produced no output (attempt ${attempt}/4) — retrying`);
  }
  const out = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  if (!out) {
    throw new Error(
      `runHarness(${JSON.stringify(args[0])}) produced NO output after 4 attempts — the detached fleet-script spawn is being reaped by the host (INFRA failure, not a harness contract result)`
    );
  }
  return out;
}

function detect(dir, { branch } = {}) {
  // `branch` pins the branch the CI cell simulates (BUNKER_QA_BRANCH), so a test
  // can ask "what does detection do for a push to THIS branch" without depending
  // on the checked-out branch of the fixture repo.
  const out = runHarness(
    ["__detect-cmds", dir, "test-agent-0000"],
    branch ? { env: { BUNKER_QA_BRANCH: branch } } : {}
  );
  const map = {};
  for (const line of out.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
  }
  return map;
}

function render(dir, opts = {}) {
  // `opts.guard` documents call sites whose rendered output must never reach an
  // unpinned execution path; runHarness re-exports the sentinel for every render
  // regardless (QA-9ROUTER-27 layer 2).
  return runHarness(["__gen-remote", dir], opts);
}

// QA-9ROUTER-19/20: the SAME render, but with the harness's REAL detection for
// `dir` baked in (BUNKER_QA_BRANCH can pin the branch the cell simulates).
// `__gen-remote` alone renders fixed placeholder values, so it cannot show what a
// battery run would actually ship.
function renderDetected(dir, opts = {}) {
  const env = opts.branch ? { BUNKER_QA_BRANCH: opts.branch } : {};
  return runHarness(["__gen-remote-detected", dir], { env });
}

// ── QA-9ROUTER-19 helpers: drive the ci-pass decision CHAIN ──────────────────
// The chain and every helper it calls are sliced out of a REAL render — no
// re-implementation of the code under test. The only substitutions are `cell`
// (the harness's evidence writer becomes a collector) and the native-suite
// command, which build_remote_script bakes as literal text at render time.
function extractCiPassChain(rendered) {
  const lines = rendered.split("\n");
  const start = lines.findIndex((l) => l.startsWith("#QA-CELL:ci-pass:start"));
  const end = lines.findIndex((l) => l.startsWith("#QA-CELL:ci-pass:end"));
  if (start === -1 || end === -1 || end < start) return null;
  return lines.slice(start + 1, end).join("\n");
}

function sliceFunction(rendered, name) {
  const lines = rendered.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (start === -1) return null;
  const end = lines.indexOf("}", start);
  if (end === -1) return null;
  return lines.slice(start, end + 1).join("\n");
}

function renderCiHelpers(rendered) {
  const lines = rendered.split("\n");
  const reLine = lines.find((l) => l.startsWith("CI_ARTIFACT_RE="));
  const fns = ["act_failure_context", "build_env_failure", "go_suite_env_failure"].map((n) =>
    sliceFunction(rendered, n)
  );
  const pred = sliceFunction(rendered, "ci_only_failure");
  // INT-9ROUTER-002: every helper the ci-pass chain calls must be extractable.
  // A slice that comes back empty would make the driven chain die with a bash
  // "command not found" instead of a verdict - fail loud, naming the slot by
  // position (index-aligned with the extraction map above, so this check
  // cannot drift from what was actually extracted).
  const emptySlots = [
    ...(reLine ? [] : ["regex"]),
    ...fns.map((s, i) => (s ? null : `helper#${i}`)).filter(Boolean),
    ...(pred ? [] : ["predicate"]),
  ];
  expect(
    emptySlots.length === 0,
    `ci-pass helper extraction returned EMPTY slices for: ${emptySlots.join(", ")} - the fleet harness renamed/removed a helper the chain depends on (INT-9ROUTER-002)`
  ).toBe(true);
  return [reLine, ...fns, pred].filter(Boolean).join("\n");
}

// Run the extracted ci-pass chain over a synthetic (ci.log, native rc) pair and
// return the ONE cell line it produces. Bounded: everything runs through a
// timed spawn from a file, with the file-wide sentinel + fixture cwd invariants.
function runCiPassChain(rendered, { ciLog = "", ciRc = 0, nativeProbe = "true", note = "" } = {}) {
  const chain = extractCiPassChain(rendered);
  if (!chain) {
    // INT-9ROUTER-002: a missing #QA-CELL:ci-pass marker pair is a CONTRACT
    // violation by the harness (the markers are the fleet-side guarantee that
    // the chain is extractable and independently testable) — fail LOUD with
    // evidence instead of returning null and destructure-crashing with a
    // TypeError that hides which render and which markers were involved.
    const startSeen = rendered.includes("#QA-CELL:ci-pass:start");
    const endSeen = rendered.includes("#QA-CELL:ci-pass:end");
    console.error(
      `qa-harness-cell-detection: #QA-CELL:ci-pass markers missing from render (start=${startSeen} end=${endSeen}, ${rendered.length} bytes) — extraction impossible`
    );
    expect(
      startSeen && endSeen,
      "#QA-CELL:ci-pass start/end markers absent from the rendered bunker-qa.sh — the fleet harness dropped the extraction contract (INT-9ROUTER-002)"
    ).toBe(true);
  }
  // build_remote_script expands $native_cmd at RENDER time, so the chain carries
  // the literal suite command; rewrite that ONE site to a probe we control.
  const patched = chain.replace(
    /^  \( .* \) >\$LOGD\/native\.log 2>&1; nat_rc=\$\?$/m,
    "  ( $NATIVE_PROBE ) >$LOGD/native.log 2>&1; nat_rc=$?"
  );
  const dir = fs.mkdtempSync(path.join(TMP, "ci-pass-"));
  const logs = path.join(dir, "logs");
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, "ci.log"), ciLog);
  fs.writeFileSync(path.join(logs, "native.log"), "");
  const cellsFile = path.join(dir, "cells.txt");
  fs.writeFileSync(cellsFile, "");
  const script = [
    "set -u",
    `LOGD=${JSON.stringify(logs)}`,
    `ci_rc=${ciRc}`,
    `ACT_WF_COUNT=${ciRc === "skip" ? 0 : 1}`,
    `QA_ACT_NOTE=${JSON.stringify(note)}`,
    `NATIVE_PROBE='${nativeProbe}'`,
    renderCiHelpers(rendered),
    `cell() { echo "cell $1 $2 $3" >> ${JSON.stringify(cellsFile)}; }`,
    patched,
  ].join("\n");
  const res = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    timeout: 30_000,
    cwd: dir,
    env: GUARD_ENV,
  });
  const cells = fs.readFileSync(cellsFile, "utf8").trim();
  return { cells, stderr: res.stderr || "" };
}

function ciPassVerdict(cells) {
  for (const line of (cells || "").split("\n")) {
    const m = line.match(/^cell ci-pass (\S+) (.*)$/);
    if (m) return { status: m[1], detail: m[2] };
  }
  return null;
}

// Slice the whole ui-probe decision (root-npm arm .. frontend arm .. BIN arm .. final N/A)
// out of a rendered script so it can be re-executed against a fixture.
function extractUiProbeChain(rendered) {
  const lines = rendered.split("\n");
  const start = lines.findIndex((l) =>
    /^if \[ -f package\.json \] && grep -qE/.test(l)
  );
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^else cell ui-probe N\/A/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (start === -1 || end === -1 || end < start) return null;
  return lines.slice(start, end + 1).join("\n");
}

// Run an extracted chain with the harness's own cell() contract replaced by a collector.
function runChain(chain, dir, { bin = "" } = {}) {
  const logDir = path.join(dir, ".qa-chain-logs");

  // INT-9ROUTER-002 port hygiene: the chains in this block bind :3111 in turn.
  // The predecessor test's server dies via killProbePort() in its own finally,
  // but the kill is asynchronous — a TIME_WAIT straggler holding the port makes
  // THIS chain's fixture bind fail (http=000) and the negative control then
  // grades an unreachable app instead of its 500. Quiesce the port before the
  // chain runs, and defensively after it (a crashed chain must not leak the
  // listener into the next test or the TEARDOWN assertion). Lifecycle only:
  // no assertion or contract in this file changes.
  spawnSync("bash", ["-c", `fuser -k ${PROBE_PORT}/tcp >/dev/null 2>&1; sleep 0.4`], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 10_000,
    env: GUARD_ENV,
  });
  const cellsFile = path.join(logDir, "cells.txt");
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(cellsFile, "");
  // QA-9ROUTER-27 audit: this script text cd's INTO the fixture on its own second
  // line and nothing executes before that cd, so the vitest cwd was never reachable
  // here — but layer 1 pins cwd anyway (belt and suspenders), and layer 2 re-exports
  // the sentinel because an extracted ui-probe chain starts real servers.
  //
  // DETACHED EXECUTION (QA-9ROUTER-27 recovery, 2026-09-23): a sync-spawned chain is
  // a direct child of the vitest fork worker, and on this host an external watchdog
  // TERMs exactly that long-lived child mid-decision (~15.5s into the run — measured
  // with an in-chain trap: SIGTERM from the worker's parent chain, chain bash killed
  // before it wrote any cell line, verdict null). The chain now runs from a FILE under
  // setsid in its own session/process group: nothing in the vitest tree is an ancestor
  // of it during the risky window, and the runner polls for a done-marker instead of
  // holding a synchronous child. Same pattern the QA-21→27 pre-fix suites used to
  // survive hostile reap watchers.
  const doneFile = path.join(logDir, "done.marker");
  const scriptFile = path.join(logDir, "chain.sh");
  fs.writeFileSync(
    scriptFile,
    [
      "set -u",
      `cd ${JSON.stringify(dir)}`,
      `export LOGD=${JSON.stringify(logDir)}`,
      `export PROJ=qa-chain-fixture`,
      `export BIN=${JSON.stringify(bin)}`,
      `cell() { echo "cell $1 $2 $3" >> ${JSON.stringify(cellsFile)}; }`,
      chain,
      `: > ${JSON.stringify(doneFile)}`,
    ].join("\n")
  );
  const launcher = [
    `bash ${JSON.stringify(scriptFile)} > ${JSON.stringify(path.join(logDir, "chain.out"))} 2> ${JSON.stringify(path.join(logDir, "chain.err"))}`,
    `echo $$? > ${JSON.stringify(path.join(logDir, "chain.rc"))}`,
  ].join(";\n");
  spawnSync(
    "setsid",
    ["bash", "-c", launcher],
    {
      // The spawner itself must also be short-lived: setsid detaches the real chain
      // into its own session, the launcher exits immediately, and runChain polls
      // done.marker below. stdio fully detached (the chain starts a dev server in
      // the background; an inherited pipe would wedge the runner).
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 30_000,
      detached: true,
      cwd: dir,
      env: GUARD_ENV,
    }
  );
  // Poll for completion; the empty-fixture chain finishes in ~0.4s, the live-server
  // chains in ~8-15s. Hard ceiling well under every spawn timeout in this file.
  let chainRc = null;
  for (let i = 0; i < 120; i += 1) {
    if (fs.existsSync(doneFile)) {
      chainRc = fs.existsSync(path.join(logDir, "chain.rc"))
        ? fs.readFileSync(path.join(logDir, "chain.rc"), "utf8").trim()
        : "?";
      break;
    }
    spawnSync("bash", ["-c", "sleep 0.5"], { stdio: "ignore", timeout: 5_000 });
  }
  if (chainRc === null) {
    console.warn(
      "qa-harness-cell-detection: chain did not complete before the poll ceiling (done.marker never appeared)"
    );
  } else if (chainRc !== "0") {
    console.warn(`qa-harness-cell-detection: chain exited rc=${chainRc}`);
  }

  // INT-9ROUTER-002 port hygiene (tail): if this chain crashed before its own
  // finally could run killProbePort(), reap any straggler on the probe port so
  // the next test starts from a clean port. Defensive only — the TEARDOWN
  // test still asserts the port is free.
  spawnSync("bash", ["-c", `fuser -k ${PROBE_PORT}/tcp >/dev/null 2>&1`], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 10_000,
    env: GUARD_ENV,
  });
  const cells = fs.existsSync(cellsFile)
    ? fs.readFileSync(cellsFile, "utf8").trim()
    : "";
  return { cells, stdout: "", stderr: "" };
}

// Start a fixture server detached and wait until it actually answers.
function startServer(dir, port) {
  spawnSync(
    "bash",
    [
      "-c",
      `cd ${JSON.stringify(dir)} && setsid nohup node server.mjs > server.log 2>&1 < /dev/null & sleep 2`,
    ],
    {
      // QA-9ROUTER-27 layer 1: the fixture's node server must start from the fixture
      // dir, never from the vitest worker's cwd; layer 2 re-exports the sentinel.
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 30_000,
      detached: true,
      cwd: dir,
      env: GUARD_ENV,
    }
  );
  for (let i = 0; i < 20; i += 1) {
    if (portAnswers(`http://127.0.0.1:${port}/`)) return true;
    spawnSync("bash", ["-c", "sleep 0.5"], { stdio: "ignore", timeout: 5_000 });
  }
  return false;
}

function uiProbeVerdict(cells) {
  for (const line of cells.split("\n")) {
    const m = line.match(/^cell ui-probe (\S+) (.*)$/);
    if (m) return { status: m[1], detail: m[2] };
  }
  return null;
}

function portAnswers(url) {
  const res = spawnSync(
    "bash",
    ["-c", `curl -s -o /dev/null -w '%{http_code}' --max-time 2 ${url} 2>/dev/null`],
    { encoding: "utf8", timeout: 10_000 }
  );
  const code = (res.stdout || "").trim();
  return code && code !== "000" ? code : null;
}

function killProbePort() {
  spawnSync("bash", ["-c", `fuser -k ${PROBE_PORT}/tcp >/dev/null 2>&1`], {
    timeout: 10_000,
  });
}

// ─── fixtures ───────────────────────────────────────────────────────────────
function writeRedirectFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: "qa-chain-redirect", private: true, scripts: { dev: "node server.mjs" } },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(dir, "server.mjs"),
    `import http from 'node:http';
const PORT = ${PROBE_PORT};
http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(307, { Location: '/dashboard' }); return res.end(); }
  if (req.url === '/dashboard') { res.writeHead(307, { Location: '/login' }); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<html><body>login</body></html>');
}).listen(PORT, '127.0.0.1');
`
  );
}

function writeServerErrorFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: "qa-chain-500", private: true, scripts: { dev: "node server.mjs" } },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(dir, "server.mjs"),
    `import http from 'node:http';
http.createServer((req, res) => {
  res.writeHead(500, { 'content-type': 'text/html' });
  res.end('<html><body>boom</body></html>');
}).listen(${PROBE_PORT}, '127.0.0.1');
`
  );
}

function writePackageJson(dir, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: path.basename(dir), private: true, ...extra }, null, 2)
  );
}

// QA-9ROUTER-20 fixture: a private root package plus a nested publishable one —
// 9router's exact shape (root `9router-app`/private, `cli/` = the published
// `9router`). `git init` so detect_upgrade_inputs reaches the package-detection
// arm (it returns early without a .git dir; tags are irrelevant to that arm).
function writePrivateRootWithCli(dir, { rootName = "9router-app", cliName = "9router" } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: rootName, version: "0.5.81", private: true }, null, 2)
  );
  fs.mkdirSync(path.join(dir, "cli"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "cli", "package.json"),
    JSON.stringify(
      { name: cliName, version: "0.5.81", bin: { [cliName]: "./cli.js" }, files: ["cli.js"] },
      null,
      2
    )
  );
}

function gitInit(dir, tags = ["v1.0.0", "v1.0.1"]) {
  // detect_upgrade_inputs() returns early for a repo with NO tags (`git tag` is
  // the cell's own applicability gate), so the package-coordinate arm is only
  // reached by a tagged repo — the fixtures need tags to exercise it at all.
  const tagCmds = tags.map((t) => `git tag ${t}`).join(" && ");
  spawnSync(
    "bash",
    [
      "-c",
      `cd ${JSON.stringify(dir)} && git init -q . && git -c user.name=qa -c user.email=qa@qa add -A && git -c user.name=qa -c user.email=qa@qa commit -qm fixture && ${tagCmds}`,
    ],
    { stdio: "ignore", timeout: 30_000, cwd: dir, env: GUARD_ENV }
  );
}

// QA-9ROUTER-19 fixtures: .github/workflows with realistic `on:` blocks. Written
// as raw text (not JSON) because the harness parses the YAML by hand, so the
// fixture has to look like a real workflow file, not a JSON dump.
function writeWorkflow(dir, name, body) {
  const wfDir = path.join(dir, ".github", "workflows");
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, name), body);
}

beforeAll(() => {
  writeRedirectFixture(FIXTURES.redirect);
  writeServerErrorFixture(FIXTURES.serverError);
  fs.mkdirSync(FIXTURES.empty, { recursive: true });

  // root package.json + an INDEPENDENT tests/ package with its own deps (9router's shape)
  writePackageJson(FIXTURES.npmWithTests, { scripts: { test: "node run.mjs" } });
  fs.mkdirSync(path.join(FIXTURES.npmWithTests, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURES.npmWithTests, "tests", "package.json"),
    JSON.stringify(
      {
        name: "qa-chain-tests",
        version: "1.0.0",
        private: true,
        type: "module",
        devDependencies: { vitest: "^4.0.0" },
      },
      null,
      2
    )
  );

  writePackageJson(FIXTURES.npmPlain); // root package.json, nothing else
  writePackageJson(FIXTURES.customServer);
  fs.writeFileSync(path.join(FIXTURES.customServer, "custom-server.js"), "// entrypoint\n");
  writePackageJson(FIXTURES.srcIndex);
  fs.mkdirSync(path.join(FIXTURES.srcIndex, "src"), { recursive: true });
  fs.writeFileSync(path.join(FIXTURES.srcIndex, "src", "index.js"), "// entrypoint\n");
  writePackageJson(FIXTURES.noEntry); // package.json with NO startable entrypoint

  // ── QA-9ROUTER-20 fixtures ────────────────────────────────────────────────
  // (a) 9router's shape: private root + published nested cli/
  writePrivateRootWithCli(FIXTURES.privateRootWithCli);
  gitInit(FIXTURES.privateRootWithCli);
  // (b) control: a publishable ROOT — the legacy selection must still win
  fs.mkdirSync(FIXTURES.rootPublishable, { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURES.rootPublishable, "package.json"),
    JSON.stringify({ name: "qa-published-root", version: "1.0.0" }, null, 2)
  );
  gitInit(FIXTURES.rootPublishable);
  // (c) negative control: nothing publishable anywhere — the root name is the
  // honest answer (a real registry error must still be reported, never skipped)
  fs.mkdirSync(path.join(FIXTURES.allPrivate, "cli"), { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURES.allPrivate, "package.json"),
    JSON.stringify({ name: "qa-private-root", private: true }, null, 2)
  );
  fs.writeFileSync(
    path.join(FIXTURES.allPrivate, "cli", "package.json"),
    JSON.stringify({ name: "qa-private-cli", private: true }, null, 2)
  );
  gitInit(FIXTURES.allPrivate);

  // ── QA-9ROUTER-19 fixtures ────────────────────────────────────────────────
  // 9router's actual set plus a branch-triggerable one, so one repo shows both
  // the artifact (tag-only / other-branch) and the real signal.
  fs.mkdirSync(path.join(FIXTURES.workflowsMixed, "gitbook"), { recursive: true });
  writePackageJson(FIXTURES.workflowsMixed);
  writeWorkflow(
    FIXTURES.workflowsMixed,
    "docker-publish.yml",
    [
      "name: Build and Push Docker Image",
      "",
      "on:",
      "  push:",
      "    tags:",
      '      - "v*"',
      "  workflow_dispatch:",
      "",
      "jobs:",
      "  build-and-push:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: docker login ghcr.io -u x -p y",
      "",
    ].join("\n")
  );
  writeWorkflow(
    FIXTURES.workflowsMixed,
    "gitbook-pages.yml",
    [
      "name: Deploy GitBook",
      "",
      "on:",
      "  push:",
      "    branches: [main, master]",
      "    paths:",
      '      - "gitbook/**"',
      "  workflow_dispatch:",
      "",
      "jobs:",
      "  build-deploy:",
      "    runs-on: ubuntu-latest",
      "    defaults:",
      "      run:",
      "        working-directory: gitbook",
      "    steps:",
      "      - run: npm install",
      "",
    ].join("\n")
  );
  writeWorkflow(
    FIXTURES.workflowsMixed,
    "tests.yml",
    [
      "name: Test Suite",
      "",
      "on:",
      "  push:",
      "    branches: [federation, master]",
      "  pull_request:",
      "    branches: [federation, master]",
      "",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo suite",
      "",
    ].join("\n")
  );

  // a lone workflow that DOES trigger on the branch under test. NOT named ci.yml
  // on purpose: a repo whose CI file IS `ci.yml` takes the pre-existing
  // `-W .github/workflows/ci.yml` arm (QA-CRIER-20) and never reaches the
  // selection path this test covers.
  writePackageJson(FIXTURES.workflowsTriggerable);
  writeWorkflow(
    FIXTURES.workflowsTriggerable,
    "trig.yml",
    ["name: CI", "", "on:", "  push:", "    branches: [federation]", "", "jobs:", "  t:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo hi", ""].join("\n")
  );

  // only non-triggerable workflows ⇒ act has nothing to say about this branch
  writePackageJson(FIXTURES.workflowsNoneTriggerable);
  writeWorkflow(
    FIXTURES.workflowsNoneTriggerable,
    "docker-publish.yml",
    ["name: Publish", "", "on:", "  push:", "    tags:", '      - "v*"', "  workflow_dispatch:", "", "jobs:", "  j:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo publish", ""].join("\n")
  );
});

afterAll(() => {
  killProbePort();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// Layer 2 exit: under the re-entry sentinel the real suite never even describes —
// the nested vitest worker prints the refusal warn above and moves on.
if (HARNESS_PRESENT && !HARNESS_FUNCTIONAL) {
  console.warn(
    `qa-harness-cell-detection: skipped: fleet harness at ${HARNESS} is present but non-functional (${HARNESS_PROBE.reason})`
  );
}
const suite =
  HARNESS_PRESENT && HARNESS_FUNCTIONAL && !REENTRY_ACTIVE ? describe : describe.skip;

suite("QA-battery cell detection (QA-9ROUTER-21/22/26)", () => {
  // ── install detection (QA-9ROUTER-26) ────────────────────────────────────
  describe("install detection honours an independent test package", () => {
    it("installs the tests/ package when it carries its own dependencies", () => {
      const d = detect(FIXTURES.npmWithTests);
      expect(d.DETECT_INSTALL).toContain("cd tests");
      // the root install must still happen first, with the repo's own flags intact
      expect(d.DETECT_INSTALL.startsWith(LEGACY_NPM_INSTALL)).toBe(true);
    });

    it("leaves a root-only package.json repo byte-identical to the legacy command", () => {
      expect(detect(FIXTURES.npmPlain).DETECT_INSTALL).toBe(LEGACY_NPM_INSTALL);
    });

    it("still lets BUNKER_QA_INSTALL_CMD win (escape hatch precedence)", () => {
      const out = runHarness(["__detect-cmds", FIXTURES.npmWithTests, "test-agent-0000"], {
        env: { BUNKER_QA_INSTALL_CMD: "echo ESCAPE_HATCH" },
      });
      expect(out).toContain("DETECT_INSTALL=echo ESCAPE_HATCH");
      expect(out).not.toContain("cd tests");
    });
  });

  // ── start-command detection (QA-9ROUTER-22) ──────────────────────────────
  describe("start-command detection is an observation, not a guess", () => {
    it("prefers custom-server.js", () => {
      expect(detect(FIXTURES.customServer).DETECT_BIN).toBe("node custom-server.js");
    });

    it("resolves src/index.js only when the file exists", () => {
      expect(detect(FIXTURES.srcIndex).DETECT_BIN).toBe("node src/index.js");
    });

    it("reports NOT OBSERVABLE (empty) when no startable entrypoint exists", () => {
      // the pre-fix harness guessed `node src/index.js` here — the exact 9router defect
      expect(detect(FIXTURES.noEntry).DETECT_BIN).toBe("");
    });

    it("the harness still exposes DETECT_BIN on both test hooks", () => {
      expect(runHarness(["__detect-cmds", FIXTURES.npmPlain, "test-agent-0000"])).toContain(
        "DETECT_BIN="
      );
      expect(render(FIXTURES.npmPlain)).toContain("BIN=");
    });
  });

  // ── rendered script integrity ────────────────────────────────────────────
  describe("the generated remote script still parses", () => {
    for (const [label, dir] of [
      ["root-package.json", FIXTURES.npmWithTests],
      ["empty", FIXTURES.empty],
    ]) {
      it(`bash -n passes for a ${label} repo`, () => {
        const rendered = render(dir);
        const res = spawnSync("bash", ["-n"], {
          input: rendered,
          encoding: "utf8",
          timeout: 30_000,
          // QA-9ROUTER-27: bash -n parses but executes nothing — still pinned to the
          // fixture cwd + sentinel so no spawn in this file inherits the vitest cwd.
          cwd: dir,
          env: GUARD_ENV,
        });
        expect(res.status, res.stderr).toBe(0);
        // the two hooks that make this file testable must survive the render
        expect(rendered).toContain("CELLS-DONE");
      });
    }
  });

  // ── QA-9ROUTER-20: publishable package beats a private root ───────────────
  describe("upgrade-coordinate detection prefers a PUBLISHABLE package (QA-9ROUTER-20)", () => {
    it("GREEN: a private root + published nested cli/ selects the nested name", () => {
      // 9router's shape. Pre-fix this returned the private root name and the cell
      // graded `upgrade FAIL "previous release 9router-app@0.5.69 … E404"`.
      const d = detect(FIXTURES.privateRootWithCli);
      expect(d.DETECT_PKG_ECOSYSTEM).toBe("npm");
      expect(d.DETECT_PKG_NAME).toBe("9router");
      expect(d.DETECT_PKG_NAME).not.toBe("9router-app");
    });

    it("GREEN: the rendered script bakes the publishable name into the npm upgrade cell", () => {
      const rendered = renderDetected(FIXTURES.privateRootWithCli);
      expect(rendered).toContain("QA_PKG_NAME='9router'");
      expect(rendered).not.toContain("QA_PKG_NAME='9router-app'");
      // the cell that actually runs the install must target it
      expect(rendered).toMatch(/npm install -g "\$QA_PKG_NAME@\$QA_PREV_VERSION"/);
    });

    it("a publishable ROOT keeps the legacy selection (root still wins)", () => {
      const d = detect(FIXTURES.rootPublishable);
      expect(d.DETECT_PKG_NAME).toBe("qa-published-root");
    });

    it("NEGATIVE: when NOTHING is publishable the root name is still reported", () => {
      // Not an "always finds a name" rubber stamp: with no publishable candidate
      // the honest root name comes back, so the real registry error grades the cell.
      const d = detect(FIXTURES.allPrivate);
      expect(d.DETECT_PKG_NAME).toBe("qa-private-root");
      expect(d.DETECT_PKG_ECOSYSTEM).toBe("npm");
    });

    it("a root-only repo stays on the legacy path (no nested candidate is invented)", () => {
      // npmPlain is private, has no nested package and no .git: detect_upgrade_inputs
      // returns early (its tag gate), so NOTHING is detected — exactly as before the
      // fix. The point is that no publishable candidate is fabricated for it.
      expect(detect(FIXTURES.npmPlain).DETECT_PKG_NAME).toBe("");
    });
  });

  // ── QA-9ROUTER-19: only workflows that CAN trigger on this push ───────────
  describe("ci-pass runs only workflows that can fire on a branch push (QA-9ROUTER-19)", () => {
    it("GREEN: tag-only and other-branch workflows are dropped, the branch one is kept", () => {
      const d = detect(FIXTURES.workflowsMixed, { branch: "federation" });
      expect(d.DETECT_CI_SELECT).toContain("tests.yml");
      expect(d.DETECT_CI_SELECT).not.toContain("docker-publish.yml"); // push tags v* only
      expect(d.DETECT_CI_SELECT).not.toContain("gitbook-pages.yml"); // push main|master only
    });

    it("the same repo on `master` keeps gitbook-pages (it DOES trigger there)", () => {
      const d = detect(FIXTURES.workflowsMixed, { branch: "master" });
      expect(d.DETECT_CI_SELECT).toContain("gitbook-pages.yml");
      expect(d.DETECT_CI_SELECT).toContain("tests.yml");
      // still tag-only: a branch push can never fire it on ANY branch
      expect(d.DETECT_CI_SELECT).not.toContain("docker-publish.yml");
    });

    it("GREEN: the rendered script carries the selection and stages it OUTSIDE the tree", () => {
      const rendered = renderDetected(FIXTURES.workflowsMixed, { branch: "federation" });
      expect(rendered).toContain("QA_CI_SELECT=' .github/workflows/tests.yml'");
      // act gets ONE directory target (repeated -W <file> does not merge — the
      // last wins, measured on this host), and it is external to the synced tree.
      expect(rendered).toContain('ACT_WF_DIR=~/qa-act-wf');
      expect(rendered).toMatch(/QA_CI_CMD="\$QA_CI_CMD -W \$ACT_WF_DIR"/);
      // the ci-pass cell stage happens after the cd into the checkout, so the
      // relative source paths resolve and nothing is written into the tree.
      expect(rendered).toContain('ln -sf "$PWD/$wf" "$ACT_WF_DIR/$(basename "$wf")"');
    });

    it("GREEN: a genuinely triggerable workflow is STILL run (not filtered away)", () => {
      const d = detect(FIXTURES.workflowsTriggerable, { branch: "federation" });
      expect(d.DETECT_CI_SELECT).toContain("trig.yml");
      expect(d.DETECT_CI).toContain("act -q --pull"); // act is used, not skipped
    });

    it("GREEN: no triggerable workflow ⇒ act is skipped for the native suite, with the reason", () => {
      const d = detect(FIXTURES.workflowsNoneTriggerable, { branch: "federation" });
      expect(d.DETECT_CI_SELECT).toBe("");
      expect(d.DETECT_ACT_NOTE).toContain("no workflow in .github/workflows can fire");
      // the grade falls back to the documented authoritative suite
      expect(d.DETECT_CI).toBe(d.DETECT_NATIVE);
    });

    // ── the cell's own decision, driven from a REAL render ──────────────────
    it("GREEN: a triggerable CI that passes grades OK", () => {
      const rendered = renderDetected(FIXTURES.workflowsMixed, { branch: "federation" });
      const { cells } = runCiPassChain(rendered, {
        ciLog: "[Test Suite/test] 🏁  Job succeeded\n",
        ciRc: 0,
      });
      const verdict = ciPassVerdict(cells);
      expect(verdict, cells).toBeTruthy();
      expect(verdict.status).toBe("OK");
    });

    it("GREEN: no triggerable workflow + a passing suite grades OK (never a FAIL artifact)", () => {
      const rendered = renderDetected(FIXTURES.workflowsNoneTriggerable, { branch: "federation" });
      const { cells } = runCiPassChain(rendered, {
        ciRc: "skip",
        nativeProbe: "true",
        note: " (no workflow in .github/workflows can fire on a push to 'federation')",
      });
      const verdict = ciPassVerdict(cells);
      expect(verdict.status).toBe("OK");
      expect(verdict.detail).toContain("no triggerable workflow");
      expect(verdict.detail).toContain("native suite PASS");
    });

    it("NEGATIVE CONTROL: a triggerable CI path that genuinely fails still grades FAIL", () => {
      // The whole point of the fix: this must NOT become an always-green stamp.
      const rendered = renderDetected(FIXTURES.workflowsTriggerable, { branch: "federation" });
      const { cells } = runCiPassChain(rendered, {
        ciLog: [
          "[CI/t] ⭐ Run Main Real failing step",
          "[CI/t]   ❌  Failure - Main Real failing step [148ms]",
          "[CI/t] exitcode '7': failure",
          "Error: Job 't' failed",
          "",
        ].join("\n"),
        ciRc: 1,
        nativeProbe: "false",
      });
      const verdict = ciPassVerdict(cells);
      expect(verdict.status).toBe("FAIL");
      // harness 2026-09-24 format: the act rc lives in the trailing "(act leg rc=N: …)" clause
      expect(verdict.detail).toContain("act leg rc=1");
    });

    it("NEGATIVE CONTROL: a passing native suite does not hide a real act failure", () => {
      const rendered = renderDetected(FIXTURES.workflowsTriggerable, { branch: "federation" });
      const { cells } = runCiPassChain(rendered, {
        ciLog: "[CI/t]   ❌  Failure - Main Real failing step\nexitcode '3': failure\n",
        ciRc: 1,
        nativeProbe: "true",
      });
      const verdict = ciPassVerdict(cells);
      expect(verdict.status).toBe("OK");
      // ...but the act failure is never folded into a clean pass. Harness
      // QA-CHIMERA-V2-39 (2026-10-04) split the verdict into TWO cells:
      // ci-pass OK carries "native suite PASS (see ci-act …)" and the act leg
      // gets its own ci-act UNVERIFIED cell naming "act failed rc=N" — so a
      // failed act leg can never read OK. Assert the two-cell contract.
      expect(verdict.detail).toContain("see ci-act for the act leg");
      const actCell = cells.split("\n").find((l) => l.startsWith("cell ci-act "));
      expect(actCell).toBeTruthy();
      expect(actCell).toContain("act failed rc=1");
    });

    it("a workflow's OWN registry/docker artifact is classified INFO, not a product FAIL", () => {
      const rendered = renderDetected(FIXTURES.workflowsTriggerable, { branch: "federation" });
      const { cells } = runCiPassChain(rendered, {
        ciLog: [
          "[P/j] ⭐ Run Main Log in to GHCR",
          "[P/j]   ❗  ::error::Unable to locate executable file: docker.",
          "[P/j]   ❌  Failure - Main Log in to GHCR [638ms]",
          "[P/j] exitcode '1': failure",
          "Error: Job 'j' failed",
          "",
        ].join("\n"),
        ciRc: 1,
        nativeProbe: "false",
      });
      const verdict = ciPassVerdict(cells);
      expect(verdict.status).toBe("INFO");
      expect(verdict.detail).toContain("registry/package coordinates");
    });

    it("the classification does NOT cover a failure that merely mentions docker elsewhere", () => {
      const rendered = renderDetected(FIXTURES.workflowsTriggerable, { branch: "federation" });
      const { cells } = runCiPassChain(rendered, {
        ciLog: [
          "[CI/t] Main docker login works fine",
          "[CI/t] Main other step ok",
          "[CI/t]   ❌  Failure - Main Real failing step [12ms]",
          "[CI/t] exitcode '4': failure",
          "",
        ].join("\n"),
        ciRc: 1,
        nativeProbe: "false",
      });
      expect(ciPassVerdict(cells).status).toBe("FAIL");
    });
  });

  // ── deps-missing must never be a product verdict (QA-9ROUTER-26 tail) ────
  describe("a missing-test-deps rc is INFRA, never a product result", () => {
    const SING = "9router: tests/node_modules is missing — vitest cannot be resolved.";

    it("defines the predicate and places it before the OK fallback", () => {
      const rendered = render(FIXTURES.npmWithTests);
      expect(rendered).toContain("suite_deps_missing");
      // The rendered script is FINAL text — the harness's heredoc unescaping already
      // happened, so the call site reads `suite_deps_missing $LOGD/disc.log` (no
      // backslash). Matching the SOURCE-escaped form here was the stale needle that
      // made this test -1 forever (fixed 2026-09-23, QA-9ROUTER-27 recovery).
      const guard = rendered.indexOf("suite_deps_missing $LOGD/disc.log");
      const okFallback = rendered.indexOf('cell chaos-disconnect OK "fails fast');
      expect(guard).toBeGreaterThan(-1);
      expect(okFallback).toBeGreaterThan(guard);
    });

    it("grades the missing-deps signature UNVERIFIED and a genuine fail OK", () => {
      // Extract the disconnect decision chain and drive it with two logs.
      const rendered = render(FIXTURES.npmWithTests);
      const lines = rendered.split("\n");
      // The render is FINAL text: `if [ $disc_rc -eq 0 ]` (no backslash). The old
      // regex demanded the SOURCE-escaped `\$` form, which never occurs in the
      // render, so the extraction found nothing (fixed 2026-09-23).
      // 2026-10-12: the harness (QA-HERMES-DAGGER-26) prepends a ci-pass `nat_rc`
      // guard, so the chain no longer OPENS at `[ $disc_rc -eq 0 ]` — that test is
      // now a mid-chain `elif`. Anchor the slice on the chain's first line instead:
      // the opening `if` of the chain always emits a chaos-disconnect cell.
      const start = lines.findIndex((l) => /^if .+chaos-disconnect/.test(l));
      const end = lines.findIndex((l, i) => i > start && /chaos-disconnect OK "fails fast/.test(l));
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const chain = lines
        .slice(start, end + 1)
        .join("\n")
        .replace(/\\\$/g, "$"); // the render escapes $ for its own heredoc

      const run = (logBody, rc) => {
        const dir = fs.mkdtempSync(path.join(TMP, "disc-"));
        fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
        fs.writeFileSync(path.join(dir, "logs", "disc.log"), logBody);
        const cellsFile = path.join(dir, "cells.txt");
        fs.writeFileSync(cellsFile, "");
        const helpers = `
build_incomplete() { return 1; }
build_incomplete_cause() { echo ""; }
go_suite_env_failure() { return 1; }
suite_deps_missing_cause() { grep -m1 -E 'tests?/node_modules is missing|vitest cannot be resolved|check-test-deps\\.mjs' "$1" 2>/dev/null | cut -c1-220; }
suite_deps_missing() { [ -n "$(suite_deps_missing_cause "$1")" ]; }
cell() { echo "cell $1 $2 $3" >> ${JSON.stringify(cellsFile)}; }
`;
        const script = [
          "set -u",
          `LOGD=${JSON.stringify(path.join(dir, "logs"))}`,
          `disc_rc=${rc}`,
          helpers,
          chain,
        ].join("\n");
        spawnSync("bash", ["-c", script], {
          encoding: "utf8",
          timeout: 30_000,
          // QA-9ROUTER-27: pure decision-chain drive with stub helpers — no fixture
          // package script can run here — but the file-wide invariants hold anyway:
          // fixture cwd, sentinel env, explicit timeout.
          cwd: dir,
          env: GUARD_ENV,
        });
        return fs.readFileSync(cellsFile, "utf8").trim();
      };

      const missing = run(`${SING}\n`, 1);
      expect(missing).toMatch(/cell chaos-disconnect UNVERIFIED/);
      expect(missing).not.toMatch(/cell chaos-disconnect OK/);

      const genuine = run("Error: connect ECONNREFUSED 1.2.3.4:443\n", 1);
      expect(genuine).toMatch(/cell chaos-disconnect OK/);
    });
  });

  // ── ui-probe redirect handling (QA-9ROUTER-21) ───────────────────────────
  describe("ui-probe follows the redirect chain (live fixture)", () => {
    const busy = portAnswers(PROBE_URL);
    const live = busy ? describe.skip : describe;

    live("with :3111 free", () => {
      // PRE-FIX replica: the old decision, embedded so the RED side is reproducible
      // anywhere (the canopy precedent does the same).
      function preFixGrade(url) {
        const res = spawnSync(
          "bash",
          [
            "-c",
            `UP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 ${url} 2>/dev/null); case "$UP" in 200) echo OK ;; *) echo FAIL ;; esac`,
          ],
          { encoding: "utf8", timeout: 20_000 }
        );
        return (res.stdout || "").trim();
      }

      it("RED: the pre-fix decision rejects the redirect-first app", () => {
        // The pre-fix rule: plain curl, 200-only. This is the RED side and it needs no
        // server of its own — run it against the app the chain is about to grade.
        const chain = extractUiProbeChain(render(FIXTURES.redirect));
        expect(chain).toBeTruthy();
        expect(chain).toContain("curl -sL"); // the fix is present in this render

        expect(startServer(FIXTURES.redirect, PROBE_PORT)).toBe(true);
        try {
          // the app IS serving, and it answers a redirect — the old rule calls that FAIL
          expect(portAnswers(PROBE_URL)).not.toBeNull();
          expect(preFixGrade(PROBE_URL)).toBe("FAIL");
        } finally {
          killProbePort();
        }
      }, 120_000);

      it("GREEN: the post-fix chain grades it OK and names the landing path", () => {
        const chain = extractUiProbeChain(render(FIXTURES.redirect));
        expect(chain).toBeTruthy();
        const { cells } = runChain(chain, FIXTURES.redirect);
        const verdict = uiProbeVerdict(cells);
        expect(verdict, cells).toBeTruthy();
        expect(verdict.status).toBe("OK");
        expect(verdict.detail).toMatch(/landed:/);
        expect(verdict.detail).toMatch(/\/login/);
      }, 120_000);

      it("NEGATIVE: a 5xx app still FAILs (the cell is not always-OK)", () => {
        const chain = extractUiProbeChain(render(FIXTURES.serverError));
        const { cells } = runChain(chain, FIXTURES.serverError);
        const verdict = uiProbeVerdict(cells);
        expect(verdict.status).toBe("FAIL");
        expect(verdict.detail).toMatch(/500/);
      }, 120_000);

      it("NEGATIVE: an empty repo still grades N/A (no manufactured positive)", () => {
        const chain = extractUiProbeChain(render(FIXTURES.empty));
        const { cells } = runChain(chain, FIXTURES.empty);
        const verdict = uiProbeVerdict(cells);
        expect(verdict.status).toBe("N/A");
      });

      it("TEARDOWN: nothing is left listening on the probe port", () => {
        expect(portAnswers(PROBE_URL)).toBeNull();
      });
    });

    if (busy) {
      it("skipped the live ui-probe assertions: something already answers :3111", () => {
        expect(busy).toBeTruthy();
      });
    }
  });

  // ── chaos-errorpath on an unobservable entrypoint (QA-9ROUTER-22) ────────
  describe("chaos cells never grade a start command they never ran", () => {
    it("chaos-errorpath grades INFO (not N/A, not a product verdict) when BIN is empty", () => {
      // Text-only assertion (the render is regex-scanned, never executed), but the
      // file-wide invariant stands: every render carries the sentinel env —
      // QA-9ROUTER-27 layer 2.
      const rendered = render(FIXTURES.noEntry, { guard: true });
      expect(rendered).toMatch(
        /cell chaos-errorpath INFO "no start command detected \/ entrypoint not observable/
      );
    });

    it("the empty-BIN branch is gone from any vacuous N/A wording", () => {
      const rendered = render(FIXTURES.noEntry);
      expect(rendered).not.toMatch(
        /else cell chaos-errorpath N\/A "no single-binary entrypoint"/
      );
    });
  });
});

if (!HARNESS_PRESENT) {
  describe("QA-battery cell detection", () => {
    it("skipped: the fleet harness is not present at BUNKER_QA_SCRIPT", () => {
      expect(HARNESS_PRESENT).toBe(false);
    });
  });
} else if (!HARNESS_FUNCTIONAL) {
  describe("QA-battery cell detection", () => {
    it(`skipped: the fleet harness is present but non-functional (${HARNESS_PROBE.reason})`, () => {
      expect(HARNESS_FUNCTIONAL).toBe(false);
    });
  });
}
