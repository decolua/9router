import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGitUpdateStatus,
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-git-update-"));
  statePath = path.join(tempDir, "state.json");
  logPath = path.join(tempDir, "update.log");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("getGitUpdateStatus", () => {
  it("fetches and enables fast-forward updates when the upstream is ahead", async () => {
    const runCommand = createGitCommandMock();

    const status = await getGitUpdateStatus({ cwd: tempDir, runCommand, statePath });

    expect(status).toMatchObject({
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
      processName: "9router",
    });
  });

  it("rejects a second active update", () => {
    writeGitUpdateState({ status: "running", startedAt: new Date().toISOString() }, statePath);

    expect(() => startGitUpdate({ repoRoot: tempDir, statePath, logPath })).toThrow(
      "already in progress",
    );
  });
});
