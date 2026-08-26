import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const payload = process.argv[2];
if (!payload) process.exit(2);

const config = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
const { repoRoot, statePath, logPath, processName, operation } = config;
let state = { ...operation };

fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(logPath, `[${new Date().toISOString()}] Git update started\n`, "utf8");

function writeState(patch) {
  state = { ...state, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function appendLog(message) {
  fs.appendFileSync(logPath, message, "utf8");
}

function commandSpec(command, args) {
  if (process.platform !== "win32" || command === "git") {
    return { executable: command, args };
  }

  const tokens = [`${command}.cmd`, ...args];
  if (tokens.some((token) => !/^[a-zA-Z0-9._:@/+\-]+$/.test(token))) {
    throw new Error(`Unsafe ${command} command argument`);
  }

  return {
    executable: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", tokens.join(" ")],
  };
}

function run(command, args, { phase, message, timeoutMs }) {
  writeState({ phase, message, error: null });
  appendLog(`\n[${new Date().toISOString()}] $ ${command} ${args.join(" ")}\n`);
  const invocation = commandSpec(command, args);

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: repoRoot,
      windowsHide: true,
      shell: false,
      env: process.env,
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => appendLog(chunk.toString()));
    child.stderr.on("data", (chunk) => appendLog(chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

try {
  await run("git", ["pull", "--ff-only"], {
    phase: "pulling",
    message: "Downloading repository updates...",
    timeoutMs: 2 * 60 * 1000,
  });
  await run("npm", ["run", "build"], {
    phase: "building",
    message: "Building the updated application...",
    timeoutMs: 30 * 60 * 1000,
  });
  await run("pm2", ["restart", processName], {
    phase: "restarting",
    message: "Restarting application...",
    timeoutMs: 60 * 1000,
  });

  const finishedAt = new Date().toISOString();
  writeState({
    status: "success",
    phase: "done",
    message: "Update completed successfully.",
    error: null,
    finishedAt,
  });
  appendLog(`\n[${finishedAt}] Update completed successfully\n`);
  process.exit(0);
} catch (error) {
  const finishedAt = new Date().toISOString();
  const message = String(error?.message || error);
  writeState({
    status: "error",
    phase: "error",
    message: "Update failed.",
    error: message,
    finishedAt,
  });
  appendLog(`\n[${finishedAt}] ERROR: ${message}\n`);
  process.exit(1);
}
