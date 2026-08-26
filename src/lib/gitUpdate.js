import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { DATA_DIR } from "./dataDir.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 120000;
const UPDATE_STALE_MS = 60 * 60 * 1000;

export const GIT_UPDATE_STATE_PATH = path.join(DATA_DIR, "git-update-state.json");
export const GIT_UPDATE_LOG_PATH = path.join(DATA_DIR, "git-update.log");

function outputOf(result) {
  if (typeof result === "string") return result.trim();
  return String(result?.stdout || "").trim();
}

function safeErrorMessage(error) {
  const raw = String(error?.stderr || error?.message || error || "Unknown error");
  return raw
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export async function executeCommand(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: options.timeout || COMMAND_TIMEOUT_MS,
      windowsHide: true,
      env: process.env,
    });
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  }
}

export function readGitUpdateState(statePath = GIT_UPDATE_STATE_PATH) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

export function writeGitUpdateState(state, statePath = GIT_UPDATE_STATE_PATH) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function isGitUpdateRunning(state, now = Date.now()) {
  if (state?.status !== "running") return false;
  const startedAt = Date.parse(state.startedAt || "");
  return Number.isFinite(startedAt) && now - startedAt < UPDATE_STALE_MS;
}

function publicOperationState(state) {
  if (!state) return null;
  const { operationId, status, phase, message, error, startedAt, updatedAt, finishedAt } = state;
  return { operationId, status, phase, message, error, startedAt, updatedAt, finishedAt };
}

export async function getGitUpdateStatus({
  cwd = process.cwd(),
  refresh = true,
  runCommand = executeCommand,
  statePath = GIT_UPDATE_STATE_PATH,
} = {}) {
  const operationState = readGitUpdateState(statePath);
  const updateInProgress = isGitUpdateRunning(operationState);
  const repoRoot = outputOf(await runCommand("git", ["rev-parse", "--show-toplevel"], { cwd }));

  if (refresh && !updateInProgress) {
    await runCommand("git", ["fetch", "--quiet", "--prune"], { cwd: repoRoot });
  }

  const branch = outputOf(await runCommand("git", ["branch", "--show-current"], { cwd: repoRoot }));
  if (!branch) throw new Error("Git checkout is detached; switch to a tracked branch before updating");

  let upstream;
  try {
    upstream = outputOf(await runCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { cwd: repoRoot },
    ));
  } catch {
    throw new Error(`Branch ${branch} has no configured upstream`);
  }

  const [currentCommit, remoteCommit, counts, porcelain, latestSubject] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
    runCommand("git", ["rev-parse", "@{upstream}"], { cwd: repoRoot }),
    runCommand("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd: repoRoot }),
    runCommand("git", ["status", "--porcelain"], { cwd: repoRoot }),
    runCommand("git", ["log", "-1", "--pretty=%s", "@{upstream}"], { cwd: repoRoot }),
  ]);

  const [ahead = 0, behind = 0] = outputOf(counts).split(/\s+/).map((value) => Number(value) || 0);
  const dirty = Boolean(outputOf(porcelain));
  const updateAvailable = behind > 0;
  let blockedReason = null;

  if (dirty) blockedReason = "Working tree has local changes. Commit or stash them before updating.";
  else if (ahead > 0 && behind > 0) blockedReason = "Local and remote branches have diverged. Resolve them manually before updating.";
  else if (updateInProgress) blockedReason = "An update is already in progress.";

  return {
    repositoryAvailable: true,
    repoRoot,
    branch,
    upstream,
    currentCommit: outputOf(currentCommit),
    remoteCommit: outputOf(remoteCommit),
    latestSubject: outputOf(latestSubject),
    ahead,
    behind,
    dirty,
    updateAvailable,
    canUpdate: updateAvailable && !blockedReason && ahead === 0,
    blockedReason,
    updateInProgress,
    operation: publicOperationState(operationState),
    checkedAt: new Date().toISOString(),
  };
}

export function startGitUpdate({
  repoRoot,
  spawnProcess = spawn,
  statePath = GIT_UPDATE_STATE_PATH,
  logPath = GIT_UPDATE_LOG_PATH,
  processName = "9router",
} = {}) {
  const currentState = readGitUpdateState(statePath);
  if (isGitUpdateRunning(currentState)) throw new Error("An update is already in progress");

  const workerPath = path.join(repoRoot, "scripts", "git-update-worker.mjs");
  if (!fs.existsSync(workerPath)) throw new Error("Git update worker was not found in the repository");

  const startedAt = new Date().toISOString();
  const operation = {
    operationId: crypto.randomUUID(),
    status: "running",
    phase: "starting",
    message: "Starting Git update...",
    error: null,
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
  };
  writeGitUpdateState(operation, statePath);

  const payload = Buffer.from(JSON.stringify({
    repoRoot,
    statePath,
    logPath,
    processName,
    operation,
  })).toString("base64url");

  const child = spawnProcess(process.execPath, [workerPath, payload], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });

  child.once?.("error", (error) => {
    const failedAt = new Date().toISOString();
    writeGitUpdateState({
      ...operation,
      status: "error",
      phase: "error",
      message: "Failed to start update worker",
      error: safeErrorMessage(error),
      updatedAt: failedAt,
      finishedAt: failedAt,
    }, statePath);
  });
  child.unref?.();

  return publicOperationState(operation);
}
