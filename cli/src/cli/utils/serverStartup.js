// Startup readiness + failure detection for the CLI launcher, plus the port
// resolution the launcher seeds everything from.
//
// Why this module exists (DF-9ROUTER-18): the launcher used to decide "server is
// ready" from a bare TCP connect to 127.0.0.1:<port>. ANY listener answered that
// probe — a stale/foreign server, an unrelated app, a docker-published port — so
// when the spawned child died with EADDRINUSE the launcher still printed
// "Router is now running" and exited 0. Process status became untrustworthy for
// automation and for users.
//
// The rules implemented here:
//   * port resolution (DF-9ROUTER-28) — the port comes from `--port/-p`, else the
//     `PORT` env var, else the default 20128. The launcher used to carry a
//     hardcoded DEFAULT_PORT and never read the ambient PORT, so the documented
//     `PORT=20129 node cli/cli.js …` still aimed at 20128 and died on the
//     pre-flight refusal below whenever the host already ran 9router.
//   * pre-flight — an occupied port is refused (EADDRINUSE, exit non-zero)
//     BEFORE spawning, instead of starting a child that is guaranteed to die.
//     The port is only "usable" when nothing answers.
//   * readiness — the answering server must pass the 9router identity probe
//     (GET <IDENTITY_PATH> → {"ok":true}, the app's own health route) AND our
//     own child must still be alive. "Something answers on the port" is not
//     proof that OUR child bound it.
//   * child death — an early exit (non-zero code, signal, or even code 0)
//     before readiness is reported as a startup failure — never as success.
//
// Everything here is side-effect free apart from opening probe sockets, so the
// launcher and the unit tests can drive it directly.
const http = require("http");
const net = require("net");

// Single source of truth for the launcher's port (cli/cli.js requires this — it
// no longer keeps a copy of its own).
const DEFAULT_PORT = 20128;
const PORT_ENV_VAR = "PORT";
const MIN_PORT = 1;
const MAX_PORT = 65535;

// The app's health route (src/app/api/health/route.js) answers {"ok":true} with
// CORS headers — cheap, dependency-free, and served by the standalone server
// under plain node (no Next dev machinery needed).
const IDENTITY_PATH = "/api/health";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_INTERVAL_MS = 150;
const PROBE_TIMEOUT_MS = 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A port is usable when it is an integer in 1..65535, or a string spelling one
// (surrounding whitespace ignored). Everything else — "", "abc", "0", "-1",
// "70000", "20.5", "20128x" — is REJECTED rather than coerced: `parseInt("20128x")`
// is 20128 and `Number("")` is 0, and both would silently move or break the
// server on a typo.
function parsePort(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= MIN_PORT && parsed <= MAX_PORT ? parsed : null;
}

// Port precedence, highest first: `--port/-p` → `PORT` → `defaultPort` (20128).
// An unusable `--port` argument is ignored, never an error (its legacy behavior —
// the launcher used to do `parseInt(arg) || DEFAULT_PORT`), and resolution then
// continues down the chain. An unusable `PORT` is ignored too, but LOUDLY: the
// caller prints `warning`, so a user who exported a bad port gets told which port
// the server actually took instead of silently serving somewhere unexpected.
function resolvePort({ argPort, env = process.env, defaultPort = DEFAULT_PORT } = {}) {
  const flagPort = parsePort(argPort);
  if (flagPort !== null) return { port: flagPort, source: "flag" };

  const rawEnv = env ? env[PORT_ENV_VAR] : undefined;
  const envPort = parsePort(rawEnv);
  if (envPort !== null) return { port: envPort, source: "env" };

  if (rawEnv !== undefined && rawEnv !== null) {
    return {
      port: defaultPort,
      source: "default",
      warning: `⚠ Ignoring invalid PORT="${rawEnv}" — using ${defaultPort}.`,
    };
  }
  return { port: defaultPort, source: "default" };
}

// True while the child handle reports neither an exit code nor a signal.
// Non-ChildProcess objects (test doubles) report `undefined` for both and are
// treated as alive — the caller, not this helper, decides their lifetime.
function isChildAlive(child) {
  if (!child) return true;
  return child.exitCode == null && child.signalCode == null;
}

// Snapshot of an already-dead child, so a probe that starts after the death is
// still reported as a failure instead of waiting for an event that never comes.
function readChildFailure(child) {
  if (!child) return null;
  const exited = child.exitCode != null;
  const signalled = child.signalCode != null;
  if (!exited && !signalled) return null;
  return {
    reason: "child-exit",
    code: exited ? child.exitCode : null,
    signal: signalled ? child.signalCode : null,
  };
}

// TCP reachability only — "something is listening", NOT "9router is ready".
function tcpProbe(port, { host = "127.0.0.1", timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(reachable);
    };
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
}

// GET <path> on the local server, returning { status, body } or null when the
// connection fails / times out.
function httpGetText(port, path, { host = "127.0.0.1", timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path, timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) req.destroy();
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => req.destroy(new Error("probe timeout")));
    req.on("error", () => resolve(null));
  });
}

function is9routerHealthBody(body) {
  try {
    const parsed = JSON.parse(body);
    return Boolean(parsed) && parsed.ok === true;
  } catch {
    return false;
  }
}

// Identity probe: is the server answering on this port a 9router instance?
function probeServerIdentity({ port, host = "127.0.0.1", timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return httpGetText(port, IDENTITY_PATH, { host, timeoutMs }).then((res) => {
    if (!res) return { reachable: false, identified: false, status: null };
    return {
      reachable: true,
      identified: res.status === 200 && is9routerHealthBody(res.body),
      status: res.status,
    };
  });
}

// Pre-flight: may we bind this port? A port with a live listener is refused —
// either it is another 9router (which the caller failed to stop) or a foreign
// process, and in both cases the child we are about to spawn would die with
// EADDRINUSE.
async function checkPortAvailable({ port, host = "127.0.0.1", timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const reachable = await tcpProbe(port, { host, timeoutMs });
  if (!reachable) return { ok: true, free: true, occupied: false, identified: false };

  const identity = await probeServerIdentity({ port, host, timeoutMs });
  return {
    ok: false,
    free: false,
    occupied: true,
    identified: identity.identified,
    status: identity.status,
  };
}

// Human-readable refusal for an occupied port. Names EADDRINUSE explicitly so
// the failure is greppable by automation and matches what the child would say.
// Both variants name the flag AND the env alternative, because the launcher
// honours either (DF-9ROUTER-28) and "which switch do I flip?" is the whole
// question a user has at this point.
function describeOccupiedPort(port, state = {}) {
  if (state.identified) {
    return [
      `❌ Port ${port} is already in use by an existing 9router server (EADDRINUSE).`,
      `   Nothing was started. Stop that instance first, or start with --port <other port> (or PORT=<other port>).`,
    ].join("\n");
  }
  return [
    `❌ Port ${port} is already in use by another process (EADDRINUSE).`,
    `   Nothing was started. Free the port, or start with --port <other port> (or PORT=<other port>).`,
  ].join("\n");
}

// Readiness: the port answers the 9router identity probe AND our child is alive.
// Resolves (never rejects) with { ok: true } or
// { ok: false, reason: "child-exit" | "child-error" | "timeout", ... }.
async function waitForServerReady({
  port,
  child,
  host = "127.0.0.1",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  probe = probeServerIdentity,
} = {}) {
  let failure = readChildFailure(child);
  const onExit = (code, signal) => {
    if (!failure) failure = { reason: "child-exit", code: code ?? null, signal: signal ?? null };
  };
  const onError = (err) => {
    if (!failure) failure = { reason: "child-error", error: (err && err.message) || String(err) };
  };
  const watching = child && typeof child.once === "function";
  if (watching) {
    child.once("exit", onExit);
    child.once("error", onError);
  }

  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (failure) return { ok: false, ...failure };

      let ready = false;
      try {
        ready = await probe({ port, host, timeoutMs: Math.min(PROBE_TIMEOUT_MS, timeoutMs) });
      } catch {
        ready = false;
      }

      // Re-check after the probe: the child may have died while it was in
      // flight, and an answering socket could belong to someone else entirely.
      if (failure) return { ok: false, ...failure };
      if (ready && ready.identified === true && isChildAlive(child)) return { ok: true };

      if (Date.now() >= deadline) return { ok: false, reason: "timeout", timeoutMs };
      await delay(Math.max(10, Math.min(intervalMs, deadline - Date.now())));
    }
  } finally {
    if (watching) {
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    }
  }
}

// Exit-code/stream diagnostic for a startup that never became ready.
function describeStartupFailure(port, result = {}) {
  if (result.reason === "child-exit") {
    const detail =
      result.code == null
        ? `killed by signal ${result.signal || "unknown"}`
        : `exit code ${result.code}`;
    return [
      `❌ Server failed to start (${detail}) — the process exited before it became ready.`,
      `   A busy port (EADDRINUSE) or a broken standalone build are the usual causes.`,
      `   Re-run with --log to see the full server output.`,
    ].join("\n");
  }
  if (result.reason === "child-error") {
    return [
      `❌ Server failed to start (${result.error || "spawn error"}).`,
      `   Re-run with --log to see the full server output.`,
    ].join("\n");
  }
  return [
    `❌ Server did not become ready on port ${port} within ${Math.round((result.timeoutMs || 0) / 1000)}s.`,
    `   Nothing is being reported as running. Re-run with --log to see the full server output.`,
  ].join("\n");
}

module.exports = {
  DEFAULT_PORT,
  IDENTITY_PATH,
  PORT_ENV_VAR,
  checkPortAvailable,
  describeOccupiedPort,
  describeStartupFailure,
  httpGetText,
  is9routerHealthBody,
  isChildAlive,
  parsePort,
  probeServerIdentity,
  readChildFailure,
  resolvePort,
  tcpProbe,
  waitForServerReady,
};
