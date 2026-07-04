import { spawn, execSync } from "node:child_process";
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT || 20128);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

function portTaken(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(true));
    tester.once("listening", () => tester.close(() => resolve(false)));
    tester.listen(port, "0.0.0.0");
  });
}

function freePort(port) {
  if (process.platform === "win32") {
    try {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (!line.includes("LISTENING")) continue;
        const pid = line.trim().split(/\s+/).at(-1);
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          console.log(`[dev] Stopped previous process on port ${port} (PID ${pid})`);
        } catch {}
      }
    } catch {}
    return;
  }

  try {
    execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
    console.log(`[dev] Stopped previous process on port ${port}`);
  } catch {
    try {
      const pid = execSync(`lsof -ti:${port}`, { encoding: "utf8" }).trim();
      if (pid) {
        execSync(`kill -9 ${pid}`, { stdio: "ignore" });
        console.log(`[dev] Stopped previous process on port ${port} (PID ${pid})`);
      }
    } catch {}
  }
}

async function ensurePortFree(port) {
  if (!(await portTaken(port))) return;
  console.log(`[dev] Port ${port} is already in use`);
  freePort(port);
  await new Promise((r) => setTimeout(r, 1000));
  if (await portTaken(port)) {
    console.error(`[dev] Could not free port ${port}. Stop the other process and retry.`);
    process.exit(1);
  }
}

function probe(path) {
  return new Promise((resolve) => {
    http
      .get(`${BASE}${path}`, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      })
      .on("error", () => resolve(0));
  });
}

async function waitForServer(maxMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const code = await probe("/api/health");
    if (code === 200) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Dev server did not become ready in time");
}

async function warmup() {
  console.log("[dev] Pre-compiling login page (first load can take ~15s)...");
  const t0 = Date.now();
  await probe("/login");
  await probe("/api/auth/status");
  console.log(`[dev] Warmup done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[dev] Open ${BASE}/login`);
  console.log("[dev] If the tab stays blank, clear cached HSTS for localhost:");
  console.log("[dev]   chrome://net-internals/#hsts  →  Delete domain: localhost");
}

const env = { ...process.env, NODE_ENV: "development" };
delete env.NEXT_DEV;

await ensurePortFree(PORT);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--webpack", "--port", String(PORT)],
  { stdio: "inherit", env, shell: process.platform === "win32" }
);

let warmed = false;
child.on("exit", (code) => process.exit(code ?? 0));

waitForServer()
  .then(async () => {
    if (warmed) return;
    warmed = true;
    await warmup();
  })
  .catch((err) => {
    console.warn(`[dev] Warmup skipped: ${err.message}`);
  });
