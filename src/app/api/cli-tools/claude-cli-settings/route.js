"use server";

import { NextResponse } from "next/server";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import fsSync from "fs";
import { resolveClaudeBin } from "open-sse/executors/claude-cli.js";
import { CLAUDE_CLI_NESTED_ENV_KEYS } from "open-sse/config/claudeCli.js";

const execAsync = promisify(exec);
// execFile takes an argv array, so a path containing quotes or shell operators
// cannot become a command — `bin` comes from operator config, not a request.
const execFileAsync = promisify(execFile);

const VERSION_TIMEOUT_MS = 10000;

// Mirrors dashboardGuard's detection. An in-container update cannot be made
// durable — it lands in the writable layer and the next restart drops back to
// the image — so the card needs to know before the button is pressed, not
// after a failed install.
const IS_CONTAINER = (() => {
  if (process.env.NINEROUTER_HOST_ROUTES_REMOTE === "1") return true;
  if (process.env.NINEROUTER_HOST_ROUTES_REMOTE === "0") return false;
  if (process.env.KUBERNETES_SERVICE_HOST) return true;
  try {
    return fsSync.existsSync("/.dockerenv");
  } catch {
    return false;
  }
})();
// `claude update` downloads a build, so it needs far longer than a version
// probe — but still a bound, or a hung download holds the request open.
const UPDATE_TIMEOUT_MS = 300000;

// One update at a time per process. Two concurrent installs would race over the
// same files, and the button is easy to double-click while nothing looks busy.
const g = (global.__claudeCliUpdate ??= { running: false });

// Mirror the executor's env scrub so the probe behaves like a routed request.
function probeEnv() {
  const env = { ...process.env };
  for (const key of CLAUDE_CLI_NESTED_ENV_KEYS) delete env[key];
  return env;
}

async function readVersion(bin) {
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], {
      windowsHide: true,
      timeout: VERSION_TIMEOUT_MS,
      env: probeEnv(),
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Status for the Claude Code CLI provider (`claude -p`).
 * Reports the exact binary the executor would spawn, so the dashboard and the
 * runtime can never disagree about which install is in play.
 */
export async function GET() {
  const bin = resolveClaudeBin();
  const pinned = !!process.env.CLI_CLAUDE_BIN?.trim();

  let source = null;
  try {
    await fs.access(bin);
    source = pinned ? "env" : "filesystem";
  } catch {
    // Not an absolute hit — it may still resolve through PATH.
    try {
      const lookup = process.platform === "win32" ? "where" : "which";
      await execFileAsync(lookup, ["claude"], { windowsHide: true, timeout: VERSION_TIMEOUT_MS });
      source = "path";
    } catch {
      source = null;
    }
  }

  if (!source) {
    return NextResponse.json({
      installed: false,
      bin,
      version: null,
      source: null,
      hint: "Install Claude Code (https://claude.com/claude-code) and sign in once, or set CLI_CLAUDE_BIN to the binary path.",
    });
  }

  const version = await readVersion(bin);
  return NextResponse.json({
    installed: true,
    bin,
    source,
    version,
    // A version probe never touches the account, so this cannot confirm login;
    // the first routed request surfaces an auth problem as a stream error.
    authHint: version ? null : "Binary found but `claude --version` failed — check the install.",
    // Updating works here, but only until the container restarts.
    containerised: IS_CONTAINER,
  });
}

/**
 * POST — run `claude update` and report what happened.
 *
 * The CLI owns the upgrade; this only invokes it and reads the version back, so
 * there is no second notion of "latest" here to drift from the real one.
 *
 * Two things this cannot do anything about, and says so rather than failing
 * opaquely:
 *
 *   - In the container image Claude Code is installed with `npm install -g`
 *     into /usr/local, which the `node` runtime user cannot write. The update
 *     then fails on permissions.
 *   - Even where it succeeds in a container, the change lives in the writable
 *     layer and a restart drops back to the version baked into the image. The
 *     durable fix is to bump CLAUDE_CODE_VERSION and rebuild.
 */
export async function POST() {
  const bin = resolveClaudeBin();
  if (!bin) {
    return NextResponse.json({
      updated: false,
      error: "Claude Code is not installed here, so there is nothing to update.",
    }, { status: 400 });
  }

  if (g.running) {
    return NextResponse.json({
      updated: false,
      error: "An update is already running. Wait for it to finish.",
    }, { status: 409 });
  }

  const before = await readVersion(bin);
  g.running = true;
  let stdout = "";
  let stderr = "";
  let failed = null;
  try {
    const result = await execFileAsync(bin, ["update"], {
      windowsHide: true,
      timeout: UPDATE_TIMEOUT_MS,
      env: probeEnv(),
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout || "";
    stderr = result.stderr || "";
  } catch (e) {
    // A non-zero exit still carries the CLI's own explanation on stdout/stderr,
    // which is more useful than the exec wrapper's message.
    stdout = e.stdout || "";
    stderr = e.stderr || "";
    failed = e.killed || e.signal
      ? `The update did not finish within ${Math.round(UPDATE_TIMEOUT_MS / 1000)}s.`
      : (stderr.trim() || stdout.trim() || e.message);
  } finally {
    g.running = false;
  }

  const after = await readVersion(bin);
  const output = [stdout, stderr].map((s) => s.trim()).filter(Boolean).join("\n");

  // Permission failures are the expected case in the container image, so name
  // the real fix instead of leaving the operator with the CLI's raw advice
  // (which suggests sudo — there is no sudo in this image, and the change
  // would not survive a restart anyway).
  //
  // Matched against what the CLI actually prints, which is not a single
  // phrase: "Insufficient permissions to install update", "npm global folder
  // isn't writable", plus the usual errno spellings.
  const permissionDenied = /EACCES|EPERM|insufficient permission|permission denied|isn'?t writable|is not writable|not writable/i
    .test(`${output}\n${failed || ""}`);

  return NextResponse.json({
    updated: Boolean(after && before && after !== before),
    before,
    version: after,
    // Already current is a success, not a failure — the CLI exits 0 and says so.
    unchanged: Boolean(after && before && after === before) && !failed,
    error: failed,
    output: output.slice(0, 2000),
    hint: permissionDenied
      ? (IS_CONTAINER
        ? "Claude Code is installed with `npm install -g` under /usr/local in this image, and the container "
          + "runs as `node`, which cannot write there. Ignore the CLI's advice to use sudo or `claude install`: "
          + "there is no sudo here, and anything installed at runtime lives in the writable layer and is lost on "
          + "the next restart. Bump CLAUDE_CODE_VERSION in the Dockerfile and rebuild the image instead."
        : "The npm global folder is not writable by this user. Either run `claude install` to switch to the "
          + "native installer (no sudo), or reinstall Claude Code under a prefix you own — "
          + "`npm config set prefix ~/.npm-global`, add `~/.npm-global/bin` to PATH, reinstall.")
      : null,
  });
}
