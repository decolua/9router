#!/usr/bin/env node
const { spawnSync } = require("child_process");

const image = process.env.SMOKE_IMAGE || "9router-smoke:local";
const name = process.env.SMOKE_CONTAINER || `9router-smoke-${Date.now()}`;
const port = process.env.SMOKE_PORT || "20129";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}

function dockerAvailable() {
  const version = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (version.status !== 0) return false;
  const info = spawnSync("docker", ["info"], { stdio: "ignore" });
  return info.status === 0;
}

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Health check timed out: ${url}`);
}

async function main() {
  if (!dockerAvailable()) {
    console.log("Docker unavailable; skipping Docker runtime smoke test.");
    return;
  }

  try {
    run("docker", ["build", "-t", image, "."]);
    run("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-p",
      `${port}:20128`,
      "-e",
      "PORT=20128",
      "-e",
      "HOSTNAME=0.0.0.0",
      image,
    ]);
    await waitForHealth();
    console.log("Docker runtime smoke test passed.");
  } finally {
    spawnSync("docker", ["rm", "-f", name], {
      stdio: "ignore",
      shell: process.platform === "win32",
    });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
