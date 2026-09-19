// Cutover guard: keeps a build from silently downgrading the machine it will
// be installed on.
//
// This exists because it happened: the main checkout sat on the previous
// release line (enhanced/0.5.69) while the live service ran 0.5.75 from
// update/upstream-0.5.75, and `npm run cli:pack` from the wrong tree happily
// packed 0.5.69 — the install then downgraded the running service and the
// dashboard announced an update. Nothing in the pack pipeline compared the
// tree being built against the package that was already installed.
//
// Modes:
//   pre     run before packing (wired as `precli:pack`); fails closed when the
//           candidate is older than the installed package
//   verify  run after `npm install -g`; checks the live service answers with the
//           version that was just installed
//
// What is compared: `cli/package.json` — that is the package npm publishes as
// `9router` and the one that ends up in the tarball. The root `package.json`
// (`9router-app`, the dashboard) is versioned independently (see CLAUDE.md), so
// reading it here checked the wrong artifact (T1.6 H2).
//
// Where the install is found: the real global prefix (`npm root -g` /
// `npm prefix -g`) plus the common per-user prefixes (~/.local, nvm, asdf, mise,
// fnm, Volta, Homebrew, /usr/local, %APPDATA%\npm) — not one personal path
// (T1.6 H3).
//
// Failure policy: the guard FAILS CLOSED when it cannot locate an installed
// package. "Nothing found" used to mean "nothing installed", which approved any
// pack on any machine whose prefix it did not guess. To pack on a genuinely
// clean machine, declare it: NINE_ROUTER_NOT_INSTALLED=1 (or
// NINE_ROUTER_PACKAGE_ROOT=none). A deliberate rollback stays ALLOW_DOWNGRADE=1.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR_NAME = "9router";

export function readJsonField(packageJsonPath, field) {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const value = parsed?.[field];
    return typeof value === "string" ? value.trim() : null;
  } catch {
    return null;
  }
}

export function readVersion(packageJsonPath) {
  return readJsonField(packageJsonPath, "version");
}

/** Numeric-segment compare: 0.5.9 < 0.5.10, so lexical ordering would be wrong. */
export function compareVersions(a, b) {
  const parts = (v) =>
    String(v)
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Compare the pack candidate against what this machine already runs.
 *
 * `installedVersion === null` means the detector found nothing. That is no
 * longer treated as "no install to downgrade" (T1.6 H3): it returns ok:false
 * unless an operator explicitly declared a clean machine or asked for a
 * downgrade.
 */
export function evaluateCutover({
  candidateVersion,
  installedVersion,
  allowDowngrade = false,
  confirmedAbsent = false,
}) {
  if (!candidateVersion) {
    return { ok: false, reason: "no version in the tree being packed (cli/package.json)" };
  }
  if (!installedVersion) {
    if (allowDowngrade) {
      return { ok: true, reason: "downgrade allowed by ALLOW_DOWNGRADE=1 (no install located)" };
    }
    if (confirmedAbsent) {
      return {
        ok: true,
        reason: "clean machine declared (NINE_ROUTER_NOT_INSTALLED=1 / NINE_ROUTER_PACKAGE_ROOT=none): no prior install to downgrade",
      };
    }
    return {
      ok: false,
      reason:
        "cannot locate an installed 9router package, so the guard refuses to guess: set " +
        "NINE_ROUTER_PACKAGE_ROOT=<install dir> to point it at the live install, or " +
        "NINE_ROUTER_NOT_INSTALLED=1 to declare a clean machine (allow a stale comparison with ALLOW_DOWNGRADE=1)",
    };
  }
  const cmp = compareVersions(candidateVersion, installedVersion);
  if (cmp > 0) return { ok: true, reason: `upgrade ${installedVersion} -> ${candidateVersion}` };
  if (cmp === 0) return { ok: true, reason: `same-version hot cut (${candidateVersion})` };
  if (allowDowngrade) return { ok: true, reason: `downgrade allowed by ALLOW_DOWNGRADE=1` };
  return {
    ok: false,
    reason:
      `this tree builds ${candidateVersion}, the installed package is ${installedVersion}: ` +
      `packing here would DOWNGRADE the live service`,
  };
}

/** The prefix `npm i -g` writes to, asked of npm itself rather than assumed. */
export function npmGlobalRoots(env = process.env, deps = {}) {
  const run = deps.exec || execNpm;
  const roots = [];
  for (const args of [["root", "-g"], ["prefix", "-g"]]) {
    const out = run(args, env);
    const value = String(out || "").trim();
    if (!value) continue;
    roots.push(value);
    // `npm prefix -g` names the prefix, not the node_modules dir; `npm root -g`
    // already names node_modules, so do not graft a second one onto it.
    if (!/(^|[\\/])node_modules$/.test(value)) {
      roots.push(path.join(value, "lib", "node_modules"));
      roots.push(path.join(value, "node_modules"));
    }
  }
  return [...new Set(roots)];
}

function execNpm(args, env) {
  try {
    return execFileSync("npm", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, ...env },
      timeout: 15000,
    });
  } catch {
    return "";
  }
}

/**
 * Every place an install could plausibly live, in priority order. A `*`
 * segment is expanded by expandRootCandidates() against the real filesystem,
 * which keeps this function pure enough to assert on in tests.
 */
export function installedRootCandidates({
  home = os.homedir(),
  globalRoots = [],
  platform = process.platform,
  env = {},
} = {}) {
  const out = [];
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  const pkg = (dir) => path.join(dir, PACKAGE_DIR_NAME);

  // 1. Whatever npm itself says the global prefix is.
  for (const root of globalRoots) push(pkg(root));

  // 2. Per-user prefixes that npm setups commonly end up with.
  push(pkg(path.join(home, ".local", "lib", "node_modules")));
  push(pkg(path.join(home, ".volta", "lib", "node_modules")));
  // The personal path the old resolver hardcoded as "the standard prefix"; it
  // stays a candidate, just no longer a silent answer.
  push(pkg(path.join(home, ".hermes", "node", "lib", "node_modules")));

  if (platform === "win32") {
    const appdata = env.APPDATA || path.join(home, "AppData", "Roaming");
    push(pkg(path.join(appdata, "npm", "node_modules")));
    push(pkg(path.join(home, "AppData", "Local", "Volta", "lib", "node_modules")));
  } else {
    for (const prefix of [
      "/usr/local/lib/node_modules",
      "/usr/lib/node_modules",
      "/opt/homebrew/lib/node_modules",
      "/home/linuxbrew/.linuxbrew/lib/node_modules",
    ]) {
      push(pkg(prefix));
    }
  }

  // 3. Version managers: one install per Node version, hence the wildcards.
  for (const pattern of [
    path.join(home, ".nvm", "versions", "node", "*", "lib", "node_modules", PACKAGE_DIR_NAME),
    path.join(home, ".asdf", "installs", "nodejs", "*", "lib", "node_modules", PACKAGE_DIR_NAME),
    path.join(home, ".local", "share", "mise", "installs", "node", "*", "lib", "node_modules", PACKAGE_DIR_NAME),
    path.join(home, ".fnm", "node-versions", "*", "installation", "lib", "node_modules", PACKAGE_DIR_NAME),
  ]) {
    push(pattern);
  }

  return out;
}

/** Expand `*` segments (version-manager layouts) against the filesystem. */
export function expandRootCandidates(patterns) {
  const out = [];
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      out.push(pattern);
      continue;
    }
    const absolute = pattern.startsWith(path.sep);
    const segments = pattern.split(path.sep).filter(Boolean);
    let partials = [absolute ? path.sep : ""];
    for (const segment of segments) {
      const next = [];
      for (const base of partials) {
        if (segment === "*") {
          for (const child of safeReaddirDirs(base)) next.push(path.join(base, child));
          continue;
        }
        const candidate = path.join(base, segment);
        if (isDirectory(candidate) || candidateExists(candidate)) next.push(candidate);
      }
      partials = next;
      if (partials.length === 0) break;
    }
    out.push(...partials);
  }
  return [...new Set(out)];
}

function safeReaddirDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function candidateExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function labelSource(root, { home, globalRoots }) {
  const normalized = String(root).split(path.sep).join("/");
  if (globalRoots.some((g) => normalized.startsWith(String(g).split(path.sep).join("/")))) {
    return "npm root -g";
  }
  const homeN = String(home).split(path.sep).join("/");
  const relative = normalized.startsWith(homeN) ? normalized.slice(homeN.length) : normalized;
  const known = [
    [".nvm/", "nvm"],
    [".asdf/", "asdf"],
    [".local/share/mise/", "mise"],
    [".fnm/", "fnm"],
    [".local/", "~/.local"],
    [".volta/", "Volta"],
    [".hermes/", "~/.hermes"],
  ];
  for (const [fragment, label] of known) {
    if (relative.includes(fragment)) return label;
  }
  if (relative.startsWith("/usr") || relative.includes("/home/linuxbrew") || relative.includes("/opt/homebrew")) {
    return "system prefix";
  }
  return "heuristic";
}

/**
 * Locate every installed `9router` this machine can show.
 *
 * Returns, besides the installs: `confirmedAbsent` (an operator declared that
 * there is nothing installed), `broken` (NINE_ROUTER_PACKAGE_ROOT pointed at a
 * directory holding no package.json) and `stalePointers` (the launcher state
 * file pointing at a removed install).
 */
export function detectInstalls(env = process.env, deps = {}) {
  const platform = deps.platform || process.platform;
  const home = deps.home || env.HOME || env.USERPROFILE || os.homedir();
  const globalRoots =
    typeof deps.globalRoots === "function"
      ? deps.globalRoots(env)
      : deps.globalRoots ?? npmGlobalRoots(env, deps);

  const result = {
    home,
    globalRoots,
    installs: [],
    broken: [],
    stalePointers: [],
    searched: [],
    confirmedAbsent: false,
  };

  const explicit = String(env.NINE_ROUTER_PACKAGE_ROOT || "").trim();
  if (/^(none|absent|no|false|0)$/i.test(explicit)) {
    result.confirmedAbsent = true;
    result.searched.push(`NINE_ROUTER_PACKAGE_ROOT=${explicit}`);
    return result;
  }
  if (/^(1|true|yes)$/i.test(String(env.NINE_ROUTER_NOT_INSTALLED || "").trim())) {
    result.confirmedAbsent = true;
  }

  const ordered = [];
  if (explicit) ordered.push({ root: explicit, source: "NINE_ROUTER_PACKAGE_ROOT" });

  const stateFile = path.join(home, ".9router", "9router-package-root");
  let fromState = "";
  try {
    fromState = fs.readFileSync(stateFile, "utf8").trim();
  } catch {
    fromState = "";
  }
  if (fromState) ordered.push({ root: fromState, source: "state file" });

  for (const root of expandRootCandidates(
    installedRootCandidates({ home, globalRoots, platform, env }),
  )) {
    ordered.push({ root, source: labelSource(root, { home, globalRoots }) });
  }

  for (const { root, source } of ordered) {
    if (result.searched.includes(root)) continue;
    result.searched.push(root);
    const pkgPath = path.join(root, "package.json");
    const version = readVersion(pkgPath);
    if (!version) {
      if (source === "NINE_ROUTER_PACKAGE_ROOT") result.broken.push(root);
      else if (source === "state file") result.stalePointers.push(root);
      continue;
    }
    result.installs.push({ root, version, name: readJsonField(pkgPath, "name"), source });
  }

  // Compare against the newest install found: downgrading any of them is the
  // incident this guard exists for, and this machine really has two.
  result.installs.sort((a, b) => compareVersions(b.version, a.version));
  result.highestInstalledVersion = result.installs.length ? result.installs[0].version : null;
  if (result.installs.length) result.confirmedAbsent = false;
  return result;
}

/** First located install root, or null. Never a guessed path (T1.6 H3). */
export function resolveInstalledRoot(env = process.env, deps = {}) {
  const detection = detectInstalls(env, deps);
  if (detection.installs.length) return detection.installs[0].root;
  const explicit = String(env.NINE_ROUTER_PACKAGE_ROOT || "").trim();
  // A pointer the operator set wins the report even when it leads nowhere, so
  // callers printing "which install" echo what was asked for.
  return explicit && !/^(none|absent|no|false|0)$/i.test(explicit) ? explicit : null;
}

function gitRunner(rootDir, deps = {}) {
  if (deps.git) return deps.git;
  return (args) => {
    try {
      // stderr goes to the bit bucket: `ls-files --error-unmatch` on a tarball
      // that was never tracked used to spray a git error into a green run.
      return execFileSync("git", args, {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "";
    }
  };
}

/**
 * The decision `pre` reports, computed from data instead of ambient state so
 * it can be tested without touching this machine (rootDir/env/deps injectable).
 */
export function planPreflight({ rootDir = ROOT, env = process.env } = {}, deps = {}) {
  const cliPkgPath = path.join(rootDir, "cli", "package.json");
  const appPkgPath = path.join(rootDir, "package.json");
  const candidateVersion = readVersion(cliPkgPath);
  const candidatePackage = path.relative(rootDir, cliPkgPath).split(path.sep).join("/");
  const rootVersion = readVersion(appPkgPath);
  const runGit = gitRunner(rootDir, deps);
  const branch = runGit(["branch", "--show-current"]) || "(detached)";
  const detection = detectInstalls(env, deps);
  const installedVersion = detection.highestInstalledVersion;
  const allowDowngrade = env.ALLOW_DOWNGRADE === "1";
  const verdict = evaluateCutover({
    candidateVersion,
    installedVersion,
    allowDowngrade,
    confirmedAbsent: detection.confirmedAbsent,
  });

  const lines = [];
  lines.push(`[cutover-guard] candidate: ${candidateVersion || "?"} (${candidatePackage}) on ${branch}`);
  if (detection.installs.length) {
    for (const install of detection.installs) {
      lines.push(`[cutover-guard] installed: ${install.version} (${install.root}) via ${install.source}`);
    }
  } else {
    lines.push("[cutover-guard] installed: none located");
    lines.push(`[cutover-guard] searched: ${detection.searched.slice(0, 12).join(", ")}`);
  }
  for (const broken of detection.broken) {
    lines.push(`[cutover-guard] NINE_ROUTER_PACKAGE_ROOT points at ${broken}, which holds no package.json`);
  }
  for (const stale of detection.stalePointers) {
    lines.push(`[cutover-guard] note: ~/.9router/9router-package-root points at ${stale} (not an install)`);
  }
  lines.push(`[cutover-guard] ${verdict.ok ? "ok" : "BLOCKED"}: ${verdict.reason}`);

  let exitCode = 0;
  if (!verdict.ok) {
    lines.push(
      "[cutover-guard] pack the deployed line instead, or ALLOW_DOWNGRADE=1 for a deliberate rollback",
    );
    exitCode = 1;
  }

  // `npm pack` writes 9router-<ver>.tgz into the repo root, and some of those
  // tarballs are tracked release artifacts — packing would dirty them. The
  // name comes from the CLI version, which is what npm will actually write.
  const tarball = candidateVersion ? `9router-${candidateVersion}.tgz` : null;

  if (candidateVersion && rootVersion && rootVersion !== candidateVersion) {
    lines.push(
      `[cutover-guard] note: independent versioning — app/package.json is ${rootVersion} while the packed CLI is ${candidateVersion}; ` +
        `the staged copy is rewritten to ${candidateVersion} by cli/scripts/build-cli.js`,
    );
  }

  return {
    candidateVersion,
    candidatePackage,
    rootVersion,
    installedVersion,
    installs: detection.installs,
    detection,
    branch,
    verdict,
    exitCode,
    lines,
    tarball,
    runGit,
  };
}

function preflight() {
  const plan = planPreflight();
  for (const line of plan.lines) console.log(line);
  if (plan.exitCode !== 0) return plan.exitCode;

  if (plan.tarball && plan.runGit(["ls-files", "--error-unmatch", plan.tarball])) {
    console.log(
      `[cutover-guard] note: ${plan.tarball} is tracked; restore it with \`git checkout -- ${plan.tarball}\` after packing`,
    );
  }
  return 0;
}

async function getJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || "request failed" };
  }
}

async function verify() {
  const port = process.env.NINE_ROUTER_PORT || "20128";
  const base = `http://127.0.0.1:${port}`;
  const detection = detectInstalls();
  let failed = false;

  if (!detection.installs.length) {
    // F20: this used to compare against a guessed path whose version read as
    // null, and a null-vs-null comparison could look like a match.
    console.log(
      `[cutover-guard] FAIL: cannot locate an installed 9router package — set NINE_ROUTER_PACKAGE_ROOT (searched: ${detection.searched.slice(0, 6).join(", ")})`,
    );
    return 1;
  }
  for (const install of detection.installs) {
    console.log(`[cutover-guard] installed: ${install.version} (${install.root}) via ${install.source}`);
  }
  const installedVersions = new Set(detection.installs.map((install) => install.version));

  const health = await getJson(`${base}/api/health`);
  const healthy = health.ok && health.body?.ok === true;
  console.log(`[cutover-guard] health: ${healthy ? "ok" : `FAIL (${health.error || health.status})`}`);
  failed ||= !healthy;

  const version = await getJson(`${base}/api/version`);
  if (!version.ok) {
    console.log(`[cutover-guard] version endpoint: FAIL (${version.error || version.status})`);
    return 1;
  }
  const live = version.body?.currentVersion;
  const matches = Boolean(live) && installedVersions.has(live);
  console.log(
    `[cutover-guard] live ${live || "?"} vs installed ${[...installedVersions].join(", ")}: ${matches ? "match" : "MISMATCH"}`,
  );
  if (!matches && live) {
    // A split nobody chose: /api/version answers with the version webpack inlined
    // from app/package.json at build time (src/app/api/version/route.js:2), while
    // npm's identity for this artifact is cli/package.json. The pack no longer
    // rewrites the app's package.json to hide that (T1.6 H2), so the two numbers
    // may legitimately differ until the endpoint reads the artifact's own.
    console.log(
      "[cutover-guard] hint: the live version comes from app/package.json baked into the bundle; the installed npm package is versioned by cli/package.json (independent versioning). Reconciling them is src/app/api/version/route.js's job, not the pack's.",
    );
  }
  failed ||= !matches;

  if (version.body?.hasUpdate) {
    // Expected whenever the fork trails the upstream npm release — the endpoint
    // compares against registry npm `9router`, not against this fork — so it is
    // reported, not counted as a failure.
    console.log(
      `[cutover-guard] note: dashboard offers ${version.body?.latestVersion} (upstream npm) over ${live}`,
    );
  }
  return failed ? 1 : 0;
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const mode = process.argv[2];
  const run = mode === "pre" ? preflight : mode === "verify" ? verify : null;
  if (!run) {
    console.error("usage: node scripts/cutover-guard.mjs pre|verify");
    process.exit(2);
  }
  process.exit(await run());
}
