import fs from "fs";
import { execFileSync } from "child_process";
import path from "path";

// Extras that improve headroom compression quality. `proxy` is the base;
// `code` adds tree-sitter AST compression; `ml` adds Kompress-v2 HF model.
// Other `[all]` extras (image, voice, otel, reports, evals, ...) are not
// useful for the 9router proxy use case, so we don't track them here.
export const HEADROOM_COMPRESSION_EXTRAS = ["code", "ml"];

// Marker packages that each extra pulls in. Detected from `pip list --format=json`
// so one call can answer both the installed version and active extras.
export const EXTRA_MARKERS = {
  code: ["tree-sitter", "tree-sitter-language-pack"],
  ml: ["torch", "huggingface-hub"],
};

const HEADROOM_PIP_TIMEOUT_MS = 8000;
export const HEADROOM_PROBE_TIMEOUT_MS = 2000;
export const HEADROOM_DETECTION_CACHE_TTL_MS = 10_000;
const HEADROOM_EXTRAS_CACHE_TTL_MS = 5000;

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where.exe" : "which";

// Extra bin dirs often missing from a packaged/launchd PATH (Python installs headroom here).
const EXTRA_BINS = IS_WIN
  ? [
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      `${process.env.HOME || ""}/.local/bin`,
      "/usr/bin",
      "/bin",
    ];

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const MIN_VERSION = [3, 10];
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

// Dashboard refreshes used to run `where` plus every Python candidate through
// a shell on every request. Keep both positive and negative results briefly so
// an unavailable optional integration cannot turn a status poll into a process
// storm. The short TTL also means a just-installed CLI appears without a
// restart.
const binaryCache = { value: undefined, expiresAt: 0 };
const pythonCache = { value: undefined, expiresAt: 0 };
const extrasCache = new Map();

function readCache(cache, loader, ttl = HEADROOM_DETECTION_CACHE_TTL_MS) {
  const now = Date.now();
  if (cache.value !== undefined && cache.expiresAt > now) return cache.value;
  const value = loader();
  cache.value = value;
  cache.expiresAt = now + ttl;
  return value;
}

function commandOptions(timeout = HEADROOM_PROBE_TIMEOUT_MS) {
  return {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
    timeout,
    maxBuffer: 64 * 1024,
    env: { ...process.env, PATH: EXTENDED_PATH },
  };
}

function isAbsoluteCandidate(candidate) {
  return path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate);
}

// Exported for installation/tests that need to force a fresh result. Normal
// dashboard status calls intentionally use the bounded cache above.
export function clearHeadroomDetectionCache() {
  binaryCache.value = undefined;
  binaryCache.expiresAt = 0;
  pythonCache.value = undefined;
  pythonCache.expiresAt = 0;
  extrasCache.clear();
}

// Detect whether the headroom CLI is installed and where its binary lives.
export function findHeadroomBinary() {
  return readCache(binaryCache, () => {
    try {
      const out = execFileSync(WHICH_CMD, ["headroom"], commandOptions()).toString().trim();
    // Windows `where` may return multiple lines — take the first.
    return out ? out.split(/\r?\n/)[0].trim() : null;
    } catch {
      return null;
    }
  });
}

// Find a Python interpreter >= 3.10 (headroom-ai requires it). Returns null if none.
// `python3`, `python3.13`, `python` can point at different envs on any OS. Prefer
// the interpreter that can also see the installed `headroom-ai` package so the
// dashboard probes and install action operate on the same interpreter as the CLI.
// Falls back to the first version-eligible candidate when headroom-ai is not yet
// installed anywhere (needed for the initial install).
// Interpreters to probe, most specific first: the python next to the headroom
// binary (guaranteed to have headroom-ai), then full paths from EXTRA_BINS, then
// bare names resolved via PATH.
function pythonCandidates() {
  const list = [];
  const bin = findHeadroomBinary();
  if (bin) {
    const dir = path.dirname(bin);
    const names = IS_WIN ? ["python.exe", "python3.exe"] : ["python3", "python3.13", "python"];
    for (const n of names) list.push(path.join(dir, n));
  }
  for (const dir of EXTRA_BINS) {
    if (!dir) continue;
    for (const n of PYTHON_CANDIDATES) list.push(path.join(dir, IS_WIN ? `${n}.exe` : n));
  }
  list.push(...PYTHON_CANDIDATES);
  return list;
}

export function findPython310() {
  return readCache(pythonCache, () => {
    let fallback = null;
  for (const candidate of pythonCandidates()) {
    // Do not create a child merely to learn that one of the packaged install
    // paths does not exist. Bare command names are still checked through the
    // configured PATH below.
    if (isAbsoluteCandidate(candidate) && !fs.existsSync(candidate)) continue;
    try {
      const ver = execFileSync(candidate, ["--version"], commandOptions()).toString().trim();
      const match = ver.match(/(\d+)\.(\d+)/);
      if (!match) continue;
      const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
      if (!(major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]))) continue;
      if (!fallback) fallback = candidate;
      try {
        execFileSync(candidate, ["-m", "pip", "show", "headroom-ai"], commandOptions(HEADROOM_PIP_TIMEOUT_MS));
        return candidate;
      } catch {
        // Keep scanning until an interpreter that sees headroom-ai is found.
      }
    } catch {
      // candidate not present, try next
    }
  }
    return fallback;
  });
}

// Probe whether a Headroom proxy is reachable at the given URL by hitting /health.
export async function probeProxyRunning(url) {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export function isLoopbackHeadroomUrl(url) {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// Aggregate status for the dashboard: installed, running, python interpreter.
export async function getHeadroomStatus(url) {
  const path = findHeadroomBinary();
  const python = findPython310();
  const installed = Boolean(path);
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);
  const extrasStatus = installed ? getInstalledHeadroomExtras(python) : { installed: false, version: null, extras: { code: false, ml: false } };
  return {
    installed,
    path,
    running,
    python,
    localUrl,
    canStart: installed && localUrl,
    version: extrasStatus.version,
    extras: extrasStatus.extras,
  };
}

// Parse installed headroom-ai version + which compression extras are
// actually installed (detected via marker package presence). One `pip list`
// call is enough to answer both questions.
//
// Returns: { installed: bool, version: string|null, extras: { code, ml } }
function getInstalledHeadroomExtrasUncached(python) {
  const py = python || findPython310();
  if (!py) return { installed: false, version: null, extras: { code: false, ml: false } };
  try {
    const out = execFileSync(py, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: HEADROOM_PIP_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString();
    const packages = JSON.parse(out);
    const names = new Set(packages.map((p) => String(p.name || "").toLowerCase()));
    const installed = names.has("headroom-ai");
    if (!installed) return { installed: false, version: null, extras: { code: false, ml: false } };
    const version = packages.find((p) => p.name?.toLowerCase() === "headroom-ai")?.version || null;
    const extras = {};
    for (const extra of HEADROOM_COMPRESSION_EXTRAS) {
      extras[extra] = EXTRA_MARKERS[extra].some((m) => names.has(m));
    }
    return { installed: true, version, extras };
  } catch {
    return { installed: false, version: null, extras: { code: false, ml: false } };
  }
}

export function getInstalledHeadroomExtras(python) {
  const py = python || findPython310();
  if (!py) return { installed: false, version: null, extras: { code: false, ml: false } };

  const cached = extrasCache.get(py);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const value = getInstalledHeadroomExtrasUncached(py);
  extrasCache.set(py, { value, expiresAt: now + HEADROOM_EXTRAS_CACHE_TTL_MS });
  return value;
}
