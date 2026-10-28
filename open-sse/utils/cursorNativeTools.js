// Native IDE tool execution for the Cursor AgentService path.
//
// AgentService multiplexes IDE builtins (read/write/grep/ls/shell/fetch/…)
// through ExecServerMessage variants. Upstream 9router rejects them so the
// model falls back to MCP tools; this module instead EXECUTES them locally
// when the operator explicitly opts in.
//
// SECURITY MODEL (default-off, fail-closed):
//   - CURSOR_NATIVE_TOOLS must be exactly "1". Anything else — unset, "true",
//     "yes", inherited from a client request — leaves the executor on the
//     existing reject path. There is no per-request override.
//   - Path tools are confined to CURSOR_WORKSPACE (default: server cwd),
//     enforced AFTER resolving symlinks (realpath), so a symlink inside the
//     workspace cannot escape to /etc/passwd, and a symlink outside cannot
//     smuggle content in. Relative paths resolve against the workspace root.
//   - Mutating tools (write/delete/shell) additionally require
//     CURSOR_NATIVE_EXEC=1 — two independent flags, so a read-only deployment
//     can expose grep/ls/read without granting any write primitive.
//   - Output is capped (CURSOR_READ_CAP, default 1 MiB) and shell runs under
//     a hard timeout (CURSOR_SHELL_TIMEOUT_MS, default 30s, SIGKILL on
//     expiry), always via /bin/sh -c with cwd pinned inside the workspace.
//   - fetch is limited to http/https, 30s timeout, response body capped.
//
// Residual risks an operator must accept before enabling CURSOR_NATIVE_EXEC:
//   - shell is arbitrary code execution as the server user, *within* the
//     workspace cwd; commands can still address absolute paths outside it
//     (confinement is best-effort for shell by nature). Only enable it when
//     the 9router process runs in a container/sandbox of its own.
//   - read/grep see every file the server user can read inside the workspace,
//     including secrets committed there (.env files are NOT skipped).
//
// Threat model: the "attacker" is the upstream model output (prompt-driven):
// it decides which tool calls to issue. The gates below bound what those
// calls can reach on this host.

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

export const NATIVE_TOOLS_ENABLED = process.env.CURSOR_NATIVE_TOOLS === "1";
const NATIVE_EXEC_MUTATE = process.env.CURSOR_NATIVE_EXEC === "1";
const NATIVE_WORKSPACE = path.resolve(process.env.CURSOR_WORKSPACE || process.cwd());
const NATIVE_READ_CAP = Number(process.env.CURSOR_READ_CAP) || 1024 * 1024;
const NATIVE_SHELL_TIMEOUT_MS = Number(process.env.CURSOR_SHELL_TIMEOUT_MS) || 30000;
const NATIVE_GREP_MAX = 500;
const NATIVE_LS_MAX = 500;
const NATIVE_WALK_MAX_DEPTH = 4;
const NATIVE_FETCH_TIMEOUT_MS = 30000;

export const NATIVE_REJECT_MUTATIONS =
  "File mutations disabled. Set CURSOR_NATIVE_EXEC=1 to enable write/delete.";
export const NATIVE_REJECT_SHELL =
  "Shell disabled. Set CURSOR_NATIVE_EXEC=1 to enable shell.";
export const NATIVE_REJECT_OUTSIDE =
  "Path is outside the allowed workspace";

// ─── Workspace confinement ──────────────────────────────────────────────

// Resolve p (against the workspace when relative) and require the FINAL
// target (after symlink resolution) to stay inside the workspace. Throws on
// escape; callers convert to a rejection reply.
export async function resolveInWorkspace(p) {
  const joined = path.isAbsolute(p || "") ? (p || "") : path.join(NATIVE_WORKSPACE, p || "");
  const resolved = path.resolve(joined);
  let real;
  try {
    real = await fs.realpath(resolved);
  } catch (err) {
    // Target doesn't exist yet (write path) or is unreadable: fall back to
    // lexical resolution, but re-check the closest existing ancestor so a
    // dangling symlink still cannot point outside.
    real = await realpathPrefix(resolved);
  }
  const root = await fs.realpath(NATIVE_WORKSPACE).catch(() => NATIVE_WORKSPACE);
  if (real !== root && !real.startsWith(root + path.sep)) {
    const err = new Error(NATIVE_REJECT_OUTSIDE);
    err.outsideWorkspace = true;
    throw err;
  }
  return real;
}

async function realpathPrefix(target) {
  // Walk up to the nearest existing ancestor, resolve it, then re-append the
  // missing tail. A non-existent tail cannot be a symlink, so resolution of
  // the ancestor is sufficient to catch symlink-based escapes.
  const tail = [];
  let current = target;
  for (let i = 0; i < 64; i++) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...tail);
    } catch {
      tail.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) return target; // reached fs root
      current = parent;
    }
  }
  return target;
}

// ─── Tool implementations ───────────────────────────────────────────────

async function readFileSafe(p) {
  const buf = await fs.readFile(p);
  const truncated = buf.length > NATIVE_READ_CAP;
  const slice = truncated ? buf.subarray(0, NATIVE_READ_CAP) : buf;
  return { text: slice.toString("utf8"), truncated, size: buf.length };
}

export async function nativeRead({ path: requested }) {
  const resolved = await resolveInWorkspace(requested);
  const { text, truncated, size } = await readFileSafe(resolved);
  return { path: requested, content: text, truncated, fileSize: size };
}

export async function nativeLs({ path: requested }) {
  const root = requested ? await resolveInWorkspace(requested) : NATIVE_WORKSPACE;
  const files = [];
  const dirs = [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (e) {
    throw new Error(`Cannot read dir: ${e.message}`);
  }
  for (const e of entries) {
    if (files.length + dirs.length >= NATIVE_LS_MAX) break;
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) dirs.push(e.name);
    else if (e.isFile()) files.push(e.name);
  }
  return {
    path: root,
    files,
    dirs,
    numFiles: files.length,
    truncated: files.length + dirs.length >= NATIVE_LS_MAX,
  };
}

async function* walkFiles(dir, { depth = 0, maxDepth = NATIVE_WALK_MAX_DEPTH, cap = NATIVE_GREP_MAX } = {}) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(full, { depth: depth + 1, maxDepth, cap });
    else if (e.isFile()) { yield full; if (--cap <= 0) return; }
  }
}

export async function nativeGrep({ pattern, path: requested, caseInsensitive }) {
  const root = requested ? await resolveInWorkspace(requested) : NATIVE_WORKSPACE;
  const flags = caseInsensitive ? "i" : "";
  let re;
  try { re = new RegExp(pattern, flags); } catch { throw new Error(`Invalid regex: ${pattern}`); }
  const matches = [];
  for await (const file of walkFiles(root)) {
    if (matches.length >= NATIVE_GREP_MAX) break;
    let text;
    try { text = (await fs.readFile(file, "utf8")).slice(0, NATIVE_READ_CAP); } catch { continue; }
    const lines = [];
    text.split("\n").forEach((line, i) => { if (re.test(line)) lines.push({ lineNumber: i + 1, content: line }); });
    if (lines.length) matches.push({ file, lines });
  }
  return {
    pattern,
    path: path.relative(NATIVE_WORKSPACE, root) || ".",
    matches,
    truncated: matches.length >= NATIVE_GREP_MAX,
  };
}

export async function nativeDiagnostics({ path: requested }) {
  // No linter on the server; empty success means "no diagnostics".
  await resolveInWorkspace(requested || ".");
  return { path: requested || "" };
}

export async function nativeFetch({ url }) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NATIVE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const text = (await res.text()).slice(0, NATIVE_READ_CAP);
    return {
      url,
      content: text,
      statusCode: res.status,
      contentType: res.headers.get("content-type") || "",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeWrite({ path: requested, fileText }) {
  if (!NATIVE_EXEC_MUTATE) {
    const err = new Error(NATIVE_REJECT_MUTATIONS);
    err.mutationBlocked = true;
    throw err;
  }
  const resolved = await resolveInWorkspace(requested);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, fileText ?? "");
  const stat = await fs.stat(resolved);
  return {
    path: requested,
    linesCreated: (fileText || "").split("\n").length,
    fileSize: stat.size,
  };
}

export async function nativeDelete({ path: requested }) {
  if (!NATIVE_EXEC_MUTATE) {
    const err = new Error(NATIVE_REJECT_MUTATIONS);
    err.mutationBlocked = true;
    throw err;
  }
  const resolved = await resolveInWorkspace(requested);
  const prev = (await fs.readFile(resolved, "utf8")).slice(0, NATIVE_READ_CAP);
  const stat = await fs.stat(resolved);
  await fs.unlink(resolved);
  return {
    path: requested,
    deletedFile: requested,
    fileSize: stat.size,
    prevContent: prev,
  };
}

export async function nativeShell({ command = "", workingDir = "" }) {
  if (!NATIVE_EXEC_MUTATE) {
    const err = new Error(NATIVE_REJECT_SHELL);
    err.mutationBlocked = true;
    throw err;
  }
  // An escaping workingDir falls back to the workspace root rather than
  // rejecting: the command itself is the operator-sanctioned primitive, and
  // pinning cwd keeps the blast radius at the workspace.
  let cwd = NATIVE_WORKSPACE;
  if (workingDir) {
    try {
      cwd = await resolveInWorkspace(workingDir);
    } catch {
      cwd = NATIVE_WORKSPACE;
    }
  }
  const started = Date.now();
  const child = spawn("/bin/sh", ["-c", command], { cwd });
  const out = [];
  const err = [];
  child.stdout.on("data", (c) => { out.push(c); if (Buffer.concat(out).length > NATIVE_READ_CAP) child.stdout.pause(); });
  child.stderr.on("data", (c) => { err.push(c); if (Buffer.concat(err).length > NATIVE_READ_CAP) child.stderr.pause(); });
  const [code, error, timedOut] = await new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish([null, null, true]);
    }, NATIVE_SHELL_TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); finish([null, e.message, false]); });
    child.on("close", (c) => { clearTimeout(timer); finish([c, null, false]); });
  });
  const stdout = Buffer.concat(out).toString("utf8").slice(0, NATIVE_READ_CAP);
  const stderr = Buffer.concat(err).toString("utf8").slice(0, NATIVE_READ_CAP);
  const executionTime = Date.now() - started;
  if (timedOut) {
    const timeoutErr = new Error(`Shell timed out after ${NATIVE_SHELL_TIMEOUT_MS}ms`);
    timeoutErr.shellTimeout = { command, cwd, timeoutMs: NATIVE_SHELL_TIMEOUT_MS };
    throw timeoutErr;
  }
  if (error) {
    const failErr = new Error(error);
    failErr.shellFailure = { command, cwd, exitCode: 1, stderr: error, executionTime };
    throw failErr;
  }
  return {
    command,
    cwd,
    exitCode: code ?? 1,
    stdout,
    stderr,
    executionTime,
    failed: code !== 0,
  };
}

// Dispatch used by the executor. Returns the tool result object; throws with
// .mutationBlocked / .outsideWorkspace / .shellTimeout / .shellFailure markers
// so the caller can shape a typed rejection reply.
export async function runNativeTool(kind, event) {
  switch (kind) {
    case "exec_read": return nativeRead(event);
    case "exec_grep": return nativeGrep(event);
    case "exec_ls": return nativeLs(event);
    case "exec_diagnostics": return nativeDiagnostics(event);
    case "exec_fetch": return nativeFetch(event);
    case "exec_write": return nativeWrite(event);
    case "exec_delete": return nativeDelete(event);
    case "exec_shell": return nativeShell(event);
    default:
      const err = new Error(`Unsupported native tool kind: ${kind}`);
      err.unsupportedKind = true;
      throw err;
  }
}
