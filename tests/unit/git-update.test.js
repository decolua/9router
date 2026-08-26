import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPm2ProcessName,
  getGitUpdateStatus,
  reconcileRestartedOperation,
  readGitUpdateState,
  startGitUpdate,
  writeGitUpdateState,
} from "../../src/lib/gitUpdate.js";

let tempDir;
let statePath;
let logPath;

function commandResult(stdout = "") {
  return { stdout, stderr: "" };
}

function createGitCommandMock({ counts = "0\t2", porcelain = "" } = {}) {
  return vi.fn(async (_command, args) => {
    const key = args.join(" ");
    const results = {
      "rev-parse --show-toplevel": tempDir,
      "fetch --quiet --prune": "",
      "branch --show-current": "main",
      "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": "origin/main",
      "rev-parse HEAD": "1111111111111111111111111111111111111111",
      "rev-parse @{upstream}": "2222222222222222222222222222222222222222",
      "rev-list --left-right --count HEAD...@{upstream}": counts,
      "status --porcelain": porcelain,
      "log -1 --pretty=%s @{upstream}": "Remote update",
    };

    if (!(key in results)) throw new Error(`Unexpected Git command: ${key}`);
    return commandResult(results[key]);
  });
}

beforeEach(() => {
  vi.stubEnv("PM2_PROCESS", "");
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-git-update-"));
  statePath = path.join(tempDir, "state.json");
  logPath = path.join(tempDir, "update.log");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("getPm2ProcessName", () => {
  it("uses 9router by default", () => {
    expect(getPm2ProcessName()).toBe("9router");
  });

  it("reads the configured PM2 process", () => {
    vi.stubEnv("PM2_PROCESS", "router-production");

    expect(getPm2ProcessName()).toBe("router-production");
  });

  it("rejects unsupported process names before updating", () => {
    vi.stubEnv("PM2_PROCESS", "router & shutdown");

    expect(() => getPm2ProcessName()).toThrow("unsupported characters");
  });
});

describe("reconcileRestartedOperation", () => {
  it("marks a restarting operation successful after the application process restarts", () => {
    const restartRequestedAt = Date.parse("2026-08-26T10:00:00.000Z");
    const state = {
      operationId: "operation-1",
      status: "running",
      phase: "restarting",
      message: "Restarting application...",
      startedAt: "2026-08-26T09:59:00.000Z",
      updatedAt: new Date(restartRequestedAt).toISOString(),
      finishedAt: null,
    };

    const result = reconcileRestartedOperation(
      state,
      statePath,
      restartRequestedAt + 10_000,
      restartRequestedAt + 5_000,
    );

    expect(result).toMatchObject({
      status: "success",
      phase: "done",
      message: "Update completed successfully.",
    });
    expect(readGitUpdateState(statePath)).toEqual(result);
  });

  it("keeps the operation running in the original application process", () => {
    const restartRequestedAt = Date.parse("2026-08-26T10:00:00.000Z");
    const state = {
      status: "running",
      phase: "restarting",
      updatedAt: new Date(restartRequestedAt).toISOString(),
    };

    const result = reconcileRestartedOperation(
      state,
      statePath,
      restartRequestedAt + 1_000,
      restartRequestedAt - 60_000,
    );

    expect(result).toBe(state);
    expect(fs.existsSync(statePath)).toBe(false);
  });
});

describe("getGitUpdateStatus", () => {
  it("fetches and enables fast-forward updates when the upstream is ahead", async () => {
    const runCommand = createGitCommandMock();

    const status = await getGitUpdateStatus({ cwd: tempDir, runCommand, statePath });

    expect(status).toMatchObject({
      pm2Process: "9router",
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 2,
      dirty: false,
      updateAvailable: true,
      canUpdate: true,
    });
    expect(runCommand).toHaveBeenCalledWith(
      "git",
      ["fetch", "--quiet", "--prune"],
      { cwd: tempDir },
    );
  });

  it("blocks automatic updates when the working tree is dirty", async () => {
    const status = await getGitUpdateStatus({
      cwd: tempDir,
      runCommand: createGitCommandMock({ porcelain: " M package.json" }),
      statePath,
    });

    expect(status.updateAvailable).toBe(true);
    expect(status.canUpdate).toBe(false);
    expect(status.blockedReason).toContain("local changes");
  });

  it("blocks divergent branches", async () => {
    const status = await getGitUpdateStatus({
      cwd: tempDir,
      runCommand: createGitCommandMock({ counts: "1\t3" }),
      statePath,
    });

    expect(status).toMatchObject({ ahead: 1, behind: 3, canUpdate: false });
    expect(status.blockedReason).toContain("diverged");
  });

  it("skips fetch while an update operation is running", async () => {
    const startedAt = new Date().toISOString();
    writeGitUpdateState({ status: "running", startedAt }, statePath);
    const runCommand = createGitCommandMock();

    const status = await getGitUpdateStatus({ cwd: tempDir, runCommand, statePath });

    expect(status.updateInProgress).toBe(true);
    expect(status.canUpdate).toBe(false);
    expect(runCommand).not.toHaveBeenCalledWith(
      "git",
      ["fetch", "--quiet", "--prune"],
      expect.anything(),
    );
  });
});

describe("startGitUpdate", () => {
  it("persists state and starts a detached Node worker", () => {
    vi.stubEnv("PM2_PROCESS", "router-production");
    const scriptsDir = path.join(tempDir, "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    const workerPath = path.join(scriptsDir, "git-update-worker.mjs");
    fs.writeFileSync(workerPath, "", "utf8");
    const child = { once: vi.fn(), unref: vi.fn() };
    const spawnProcess = vi.fn(() => child);

    const operation = startGitUpdate({
      repoRoot: tempDir,
      spawnProcess,
      statePath,
      logPath,
    });

    expect(operation).toMatchObject({ status: "running", phase: "starting" });
    expect(readGitUpdateState(statePath)).toMatchObject({
      operationId: operation.operationId,
      status: "running",
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      [workerPath, expect.any(String)],
      expect.objectContaining({ cwd: tempDir, detached: true, stdio: "ignore" }),
    );
    expect(child.unref).toHaveBeenCalled();

    const payload = spawnProcess.mock.calls[0][1][1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(decoded).toMatchObject({
      repoRoot: tempDir,
      statePath,
      logPath,
      processName: "router-production",
    });
  });

  it("rejects a second active update", () => {
    writeGitUpdateState({ status: "running", startedAt: new Date().toISOString() }, statePath);

    expect(() => startGitUpdate({ repoRoot: tempDir, statePath, logPath })).toThrow(
      "already in progress",
    );
  });
});
