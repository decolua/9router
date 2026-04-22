#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout, env, exit } = require("node:process");
const { Writable } = require("node:stream");

async function main() {
  const {
    readRuntimeConfig,
    writeRuntimeConfig,
    upsertRedisServer,
    disableRedis,
    setRedisStatus,
    getRedisUrlFromConfig,
  } = await import("../src/lib/runtimeConfig.js");

  const args = parseArgs(process.argv.slice(2));
  let runtimeConfig = await readRuntimeConfig();

  if (args.redisServerUrl) {
      runtimeConfig = upsertRedisServer(runtimeConfig, {
        url: args.redisServerUrl,
        name: args.redisName,
        id: args.redisServerId,
      }, args.redisMode);
    await writeRuntimeConfig(runtimeConfig);
  }

  let redisUrl = resolveRedisUrl({
    cliRedisUrl: args.redisUrl,
    configRedisUrl: getRedisUrlFromConfig(runtimeConfig),
    envRedisUrl: env.REDIS_URL,
  });
  const redisStatus = await probeRedis(redisUrl);

  runtimeConfig = setRedisStatus(runtimeConfig, {
    ready: redisStatus.ready,
    checkedAt: new Date().toISOString(),
    url: redisUrl || null,
    error: redisStatus.error || null,
  });

  if (!redisStatus.ready && stdin.isTTY) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const shouldUseRedis = await askYesNo(rl, redisUrl ? `Redis belum aktif (${redisStatus.error || "gagal konek"}). Mau pakai Redis?` : "Redis belum disetel. Mau pakai Redis?", false);

      if (shouldUseRedis) {
        const hostPortOrUrl = await rl.question("Redis host:port atau URL Redis: ");
        const password = await askSecret("Redis password (kosong jika tidak ada): ");
        const redisMode = args.redisMode || "replace";
        const builtUrl = normalizeRedisUrl(hostPortOrUrl, password);

        runtimeConfig = upsertRedisServer(runtimeConfig, {
          url: builtUrl,
          name: args.redisName,
          id: args.redisServerId,
        }, redisMode);
        redisUrl = builtUrl;

        const nextProbe = await probeRedis(redisUrl);
        runtimeConfig = setRedisStatus(runtimeConfig, {
          ready: nextProbe.ready,
          checkedAt: new Date().toISOString(),
          url: redisUrl,
          error: nextProbe.error || null,
        });

        if (!nextProbe.ready) {
          console.log(`[Redis] Status belum siap: ${nextProbe.error || "unknown error"}`);
        } else {
          console.log(`[Redis] Siap: ${redisUrl}`);
        }
      } else {
        runtimeConfig = disableRedis(runtimeConfig);
        redisUrl = "";
        console.log("[Redis] Dinonaktifkan untuk sesi ini.");
      }

      await writeRuntimeConfig(runtimeConfig);
    } finally {
      rl.close();
    }
  } else if (!redisStatus.ready && !stdin.isTTY) {
    runtimeConfig = setRedisStatus(runtimeConfig, {
      ready: false,
      checkedAt: new Date().toISOString(),
      url: redisUrl || null,
      error: "stdin is not a tty",
    });
    await writeRuntimeConfig(runtimeConfig);
    console.log("[Redis] Tidak ada konfigurasi aktif dan stdin bukan TTY; lanjut tanpa Redis.");
  } else {
    if (redisUrl) {
      console.log(`[Redis] Status: ${redisStatus.ready ? "ready" : "not ready"} (${redisUrl})`);
    } else {
      console.log("[Redis] Tidak dikonfigurasi.");
    }
  }

  if (redisUrl) {
    env.REDIS_URL = redisUrl;
  } else {
    delete env.REDIS_URL;
    delete env.REDIS_HOST;
    delete env.REDIS_PORT;
    delete env.REDIS_DB;
    delete env.REDIS_USERNAME;
    delete env.REDIS_PASSWORD;
    delete env.REDIS_TLS;
  }

  await writeRuntimeConfig(runtimeConfig);

  const standaloneServerPath = path.join(process.cwd(), ".next", "standalone", "server.js");

  if (hasStandaloneRuntime(standaloneServerPath)) {
    syncStandaloneAssets(process.cwd(), standaloneServerPath);
  }

  const port = String(process.env.PORT || 20128);
  env.PORT = port;

  if (!(await isPortAvailable(port))) {
    console.error("");
    console.error(`[Start] Port ${port} is already in use.`);
    console.error(`[Start] Stop the process using it, then run npm start again.`);
    console.error(`[Start] Try one of these commands:`);
    console.error(`fuser -k ${port}/tcp`);
    console.error(`lsof -ti :${port} | xargs -r kill -9`);
    console.error("");
    exit(1);
  }

  const hasStandaloneServer = fs.existsSync(standaloneServerPath);
  const child = hasStandaloneServer
    ? spawn(process.execPath, [standaloneServerPath, ...args.forwardArgs], {
      stdio: "inherit",
      env,
      shell: false,
    })
    : spawn("next", ["start", "--port", port, ...args.forwardArgs], {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });

  if (!hasStandaloneServer) {
    console.log("[Start] .next/standalone/server.js not found; falling back to next start.");
  }

  if (!child) {
    throw new Error("Failed to start production server process.");
  }

  child.stdout?.on?.("error", () => {});
  child.stderr?.on?.("error", () => {});

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    exit(code ?? 0);
  });
}

function hasStandaloneRuntime(standaloneServerPath) {
  return fs.existsSync(standaloneServerPath);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ port: Number(port), host: "0.0.0.0" }, () => {
      server.close(() => resolve(true));
    });
  });
}

function syncStandaloneAssets(projectRoot, standaloneServerPath) {
  const standaloneRoot = path.dirname(standaloneServerPath);
  const sourceStaticDir = path.join(projectRoot, ".next", "static");
  const sourcePublicDir = path.join(projectRoot, "public");
  const standaloneStaticDir = path.join(standaloneRoot, ".next", "static");
  const standalonePublicDir = path.join(standaloneRoot, "public");

  if (fs.existsSync(sourceStaticDir)) {
    fs.mkdirSync(path.dirname(standaloneStaticDir), { recursive: true });
    fs.rmSync(standaloneStaticDir, { recursive: true, force: true });
    fs.cpSync(sourceStaticDir, standaloneStaticDir, { recursive: true, force: true });
  }

  if (fs.existsSync(sourcePublicDir)) {
    fs.rmSync(standalonePublicDir, { recursive: true, force: true });
    fs.cpSync(sourcePublicDir, standalonePublicDir, { recursive: true, force: true });
  }

  console.log("[Start] Synced standalone public/static assets.");
}

function parseArgs(argv) {
  const result = {
    redisServerUrl: "",
    redisServerId: "",
    redisName: "",
    redisUrl: "",
    redisMode: "replace",
    forwardArgs: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      result.forwardArgs.push(...argv.slice(i + 1));
      break;
    }

    if (arg === "--redis-url" && argv[i + 1]) {
      result.redisUrl = argv[++i];
      continue;
    }

    if (arg === "--redis-server" && argv[i + 1]) {
      result.redisServerUrl = argv[++i];
      continue;
    }

    if (arg === "--redis-server-id" && argv[i + 1]) {
      result.redisServerId = argv[++i];
      continue;
    }

    if (arg === "--redis-name" && argv[i + 1]) {
      result.redisName = argv[++i];
      continue;
    }

    if (arg === "--redis-mode" && argv[i + 1]) {
      result.redisMode = argv[++i] === "add" ? "add" : "replace";
      continue;
    }

    if (arg.startsWith("--redis-url=")) {
      result.redisUrl = arg.split("=", 2)[1];
      continue;
    }

    if (arg.startsWith("--redis-server=")) {
      result.redisServerUrl = arg.split("=", 2)[1];
      continue;
    }

    if (arg.startsWith("--redis-server-id=")) {
      result.redisServerId = arg.split("=", 2)[1];
      continue;
    }

    if (arg.startsWith("--redis-name=")) {
      result.redisName = arg.split("=", 2)[1];
      continue;
    }

    if (arg.startsWith("--redis-mode=")) {
      result.redisMode = arg.split("=", 2)[1] === "add" ? "add" : "replace";
      continue;
    }

    result.forwardArgs.push(arg);
  }

  return result;
}

function resolveRedisUrl({ cliRedisUrl = "", configRedisUrl = "", envRedisUrl = "" } = {}) {
  return cliRedisUrl || configRedisUrl || envRedisUrl || "redis://127.0.0.1:6379";
}

async function probeRedis(redisUrl) {
  if (!redisUrl) {
    return { ready: false, error: "no redis url" };
  }

  const { createClient } = await import("redis");
  const client = createClient({ url: redisUrl, socket: { connectTimeout: 5000 } });

  try {
    await client.connect();
    await client.ping();
    return { ready: true, error: null };
  } catch (error) {
    return { ready: false, error: error?.message || String(error) };
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore disconnect errors
    }
  }
}

function normalizeRedisUrl(input, password) {
  const value = String(input || "").trim();
  if (!value) return "";

  if (/^rediss?:\/\//i.test(value)) {
    return value;
  }

  const hostPort = value.includes("@") ? value.split("@").pop() : value;
  const [host, port = "6379"] = hostPort.split(":");
  const safeHost = host?.trim();
  const safePort = port?.trim() || "6379";

  if (!safeHost) return "";

  if (password) {
    return `redis://:${encodeURIComponent(password)}@${safeHost}:${safePort}`;
  }

  return `redis://${safeHost}:${safePort}`;
}

async function askYesNo(rl, question, defaultValue = false) {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = String(await rl.question(`${question}${suffix}`)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return ["y", "yes", "true", "1"].includes(answer);
}

async function askPassword(rl, question) {
  const answer = await rl.question(question);
  return String(answer || "").trim();
}

async function askSecret(question) {
  if (!stdin.isTTY) {
    return "";
  }

  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const secretRl = readline.createInterface({
    input: stdin,
    output: mutedOutput,
    terminal: true,
  });

  try {
    stdout.write(question);
    const answer = await secretRl.question("");
    stdout.write("\n");
    return String(answer || "").trim();
  } finally {
    secretRl.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[start] Failed to bootstrap server:", error);
    exit(1);
  });
}

module.exports = {
  askPassword,
  askSecret,
  askYesNo,
  hasStandaloneRuntime,
  isPortAvailable,
  main,
  normalizeRedisUrl,
  parseArgs,
  probeRedis,
  resolveRedisUrl,
  syncStandaloneAssets,
};
