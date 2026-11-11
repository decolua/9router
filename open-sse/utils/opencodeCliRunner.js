import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn, execSync } from "child_process";
import {
  hasTools,
  buildToolSystemPrompt,
  parseToolCallReply,
  generateToolCallId,
} from "../executors/deepseekWebToolBridge.js";
const binaryVersionCache = new Map();
const deadProxyUrls = new Set();
let cachedResolvedBinary = null;
let lastBinaryCheckTime = 0;
const BINARY_CACHE_TTL_MS = 60000;

// ── SINGLETON OPENCODE SERVE DAEMON ──────────────────────────────
const DAEMON_PORT = process.env.OPENCODE_DAEMON_PORT || 8772;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const DAEMON_WORKSPACE = "/tmp/opencode-workspace";
let daemonProcess = null;
let daemonStartingPromise = null;
const sessionCache = new Map(); // cacheKey -> { sid, turns }

async function checkDaemonHealthy() {
  try {
    const res = await fetch(`${DAEMON_URL}/global/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureOpencodeDaemon(opencodeBin) {
  if (await checkDaemonHealthy()) return true;
  if (daemonStartingPromise) return daemonStartingPromise;

  daemonStartingPromise = (async () => {
    try {
      if (!fs.existsSync(DAEMON_WORKSPACE)) {
        fs.mkdirSync(DAEMON_WORKSPACE, { recursive: true });
      }
      const gitDir = path.join(DAEMON_WORKSPACE, ".git");
      if (!fs.existsSync(gitDir)) {
        try { execSync("git init", { cwd: DAEMON_WORKSPACE, stdio: "ignore" }); } catch {}
      }

      const env = { ...process.env };
      env.OPENCODE_DISABLE_AUTOUPDATE = "true";
      env.OPENCODE_DISABLE_LSP_DOWNLOAD = "true";
      env.OPENCODE_DISABLE_MODELS_FETCH = "true";

      daemonProcess = spawn(opencodeBin, [
        "serve",
        "--port", String(DAEMON_PORT),
        "--hostname", "127.0.0.1",
      ], {
        cwd: DAEMON_WORKSPACE,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      daemonProcess.on("exit", () => {
        daemonProcess = null;
        sessionCache.clear();
      });

      if (daemonProcess.pid) {
        activeCliProcesses.add(daemonProcess);
      }

      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await checkDaemonHealthy()) {
          return true;
        }
      }
      return await checkDaemonHealthy();
    } catch {
      return false;
    } finally {
      daemonStartingPromise = null;
    }
  })();

  return daemonStartingPromise;
}

async function callOpencodeDaemon({ model, prompt, systemPrompt, signal }) {
  const healthy = await checkDaemonHealthy();
  if (!healthy) throw new Error("Daemon is not reachable");

  const cleanModel = String(model || "").replace(/^(opencode|oc)\//, "") || "deepseek-v4.1-flash-free";
  const sysHash = systemPrompt ? crypto.createHash("md5").update(systemPrompt).digest("hex").slice(0, 8) : "default";
  const cacheKey = `${cleanModel}:${sysHash}`;

  let entry = sessionCache.get(cacheKey);
  if (!entry || entry.turns >= 15) {
    const sRes = await fetch(`${DAEMON_URL}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal,
    });
    if (!sRes.ok) throw new Error(`Failed to create daemon session: ${sRes.status}`);
    const sData = await sRes.json();
    entry = { sid: sData.id, turns: 0 };
    sessionCache.set(cacheKey, entry);
  }
  entry.turns++;

  const payload = {
    model: { providerID: "opencode", modelID: cleanModel },
    parts: [{ type: "text", text: prompt || "Hello" }],
  };
  if (systemPrompt) payload.system = systemPrompt;

  const mRes = await fetch(`${DAEMON_URL}/session/${entry.sid}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!mRes.ok) {
    sessionCache.delete(cacheKey);
    throw new Error(`Daemon message dispatch error: ${mRes.status}`);
  }

  const mData = await mRes.json();
  let text = "";
  let tokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  for (const p of (mData.parts || [])) {
    if (p.type === "text" && p.text) text += p.text;
    if (p.type === "step-finish" && p.tokens) {
      tokens = {
        prompt_tokens: p.tokens.input || 0,
        completion_tokens: p.tokens.output || 0,
        total_tokens: p.tokens.total || ((p.tokens.input || 0) + (p.tokens.output || 0)),
      };
    }
  }

  return { text, tokens };
}

const activeCliProcesses = new Set();
export function terminateCliProcess(child) {
  if (!child) return;
  try {
    if (process.platform === "win32" && child.pid) {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore", windowsHide: true, timeout: 2000 });
    } else {
      try {
        execSync(`pkill -TERM -P ${child.pid} 2>/dev/null || true`, { stdio: "ignore", timeout: 1000 });
      } catch {}
      child.kill("SIGKILL");
    }
  } catch {
    try { child.kill(); } catch {}
  }
}

if (typeof process !== "undefined" && process.on) {
  const cleanup = () => {
    for (const p of activeCliProcesses) {
      terminateCliProcess(p);
    }
    activeCliProcesses.clear();
  };
  process.once("exit", cleanup);
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}

let currentRunningCliCount = 0;
const MAX_CONCURRENT_CLI = 3;
const cliWaitQueue = [];

async function acquireCliSlot(signal) {
  if (currentRunningCliCount < MAX_CONCURRENT_CLI) {
    currentRunningCliCount++;
    return;
  }
  await new Promise((resolve, reject) => {
    const entry = () => resolve();
    cliWaitQueue.push(entry);
    if (signal) {
      signal.addEventListener("abort", () => {
        const idx = cliWaitQueue.indexOf(entry);
        if (idx !== -1) cliWaitQueue.splice(idx, 1);
        reject(new Error("Request aborted while queued for CLI engine"));
      }, { once: true });
    }
  });
  currentRunningCliCount++;
}

function releaseCliSlot() {
  currentRunningCliCount = Math.max(0, currentRunningCliCount - 1);
  if (cliWaitQueue.length > 0) {
    const next = cliWaitQueue.shift();
    next();
  }
}

export function getOpencodeBinaryVersion(executable) {
  if (!executable) return "";
  if (binaryVersionCache.has(executable)) return binaryVersionCache.get(executable);

  // Fast path: inspect package.json in parent directories if located in node_modules
  try {
    const dir = path.dirname(executable);
    const pkgCandidates = [
      path.join(dir, "..", "package.json"),
      path.join(dir, "package.json"),
      path.join(dir, "..", "..", "package.json"),
    ];
    for (const pkgPath of pkgCandidates) {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.name === "@opencode/cli" || pkg.name === "opencode-ai" || pkg.name === "opencode") {
          const ver = String(pkg.version || "").trim();
          if (ver) {
            binaryVersionCache.set(executable, ver);
            return ver;
          }
        }
      }
    }
  } catch {
    /* fallback to execution */
  }

  // Slow path: probe via --version
  try {
    const v = execSync(`"${executable}" --version`, { encoding: "utf8", timeout: 2000 }).trim();
    binaryVersionCache.set(executable, v);
    return v;
  } catch {
    binaryVersionCache.set(executable, "");
    return "";
  }
}
function parseSemver(v) {
  const m = String(v || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || "0", 10)];
}

export function findOpencodeBinary(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedResolvedBinary && now - lastBinaryCheckTime < BINARY_CACHE_TTL_MS) {
    try {
      if (fs.existsSync(cachedResolvedBinary)) {
        return cachedResolvedBinary;
      }
    } catch {}
    cachedResolvedBinary = null;
  }

  const isWin = process.platform === "win32";
  const homeDir = os.homedir() || process.env.USERPROFILE || process.env.HOME || "";
  // 1. Explicit environment variable override
  if (process.env.OPENCODE_BIN) {
    try {
      if (fs.existsSync(process.env.OPENCODE_BIN)) {
        cachedResolvedBinary = process.env.OPENCODE_BIN;
        lastBinaryCheckTime = now;
        return process.env.OPENCODE_BIN;
      }
    } catch {}
  }

  // 2. Candidate collection for all platforms (npm, bun, pnpm, yarn, nvm, fnm, volta, asdf, homebrew, linux distro paths)
  const candidateList = [];

  // Standalone @opencode/cli package binaries (npm / bun / pnpm / yarn global install)
  if (isWin) {
    if (homeDir) {
      candidateList.push(
        path.join(homeDir, ".bun", "install", "global", "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
        path.join(homeDir, ".bun", "bin", "opencode.exe"),
        path.join(homeDir, ".yarn", "bin", "opencode.cmd"),
        path.join(homeDir, ".yarn", "bin", "opencode.exe")
      );
    }
    const appData = process.env.APPDATA || "";
    if (appData) {
      candidateList.push(
        path.join(appData, "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
        path.join(appData, "npm", "node_modules", "@opencode", "cli", "bin", "opencode.cmd"),
        path.join(appData, "npm", "opencode.cmd"),
        path.join(appData, "npm", "opencode.exe")
      );
    }
    const localAppData = process.env.LOCALAPPDATA || "";
    if (localAppData) {
      candidateList.push(
        path.join(localAppData, "Programs", "opencode", "opencode.exe"),
        path.join(localAppData, "pnpm", "opencode.cmd"),
        path.join(localAppData, "pnpm", "opencode.exe"),
        path.join(localAppData, "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe")
      );
    }
  } else {
    // Linux / macOS / Docker candidates
    candidateList.push(
      "/usr/local/bin/opencode",
      "/usr/bin/opencode",
      "/opt/homebrew/bin/opencode",
      "/root/bin/opencode",
      "/tmp/oc-cli/package/bin/opencode"
    );
    if (homeDir) {
      candidateList.push(
        path.join(homeDir, ".local", "bin", "opencode"),
        path.join(homeDir, ".bun", "bin", "opencode"),
        path.join(homeDir, ".bun", "install", "global", "node_modules", "@opencode", "cli", "bin", "opencode"),
        path.join(homeDir, ".npm-global", "bin", "opencode"),
        path.join(homeDir, ".npm-global", "lib", "node_modules", "@opencode", "cli", "bin", "opencode"),
        path.join(homeDir, ".pnpm", "bin", "opencode"),
        path.join(homeDir, "Library", "pnpm", "opencode"),
        path.join(homeDir, ".yarn", "bin", "opencode"),
        path.join(homeDir, ".volta", "bin", "opencode"),
        path.join(homeDir, ".asdf", "shims", "opencode"),
        path.join(homeDir, ".local", "share", "fnm", "current", "bin", "opencode"),
        "/usr/local/lib/node_modules/@opencode/cli/bin/opencode",
        "/usr/lib/node_modules/@opencode/cli/bin/opencode"
      );
      // Check nvm versions if present
      const nvmNodeDir = path.join(homeDir, ".nvm", "versions", "node");
      try {
        if (fs.existsSync(nvmNodeDir)) {
          const versions = fs.readdirSync(nvmNodeDir).sort().reverse();
          for (const ver of versions.slice(0, 3)) {
            candidateList.push(path.join(nvmNodeDir, ver, "bin", "opencode"));
          }
        }
      } catch {}
    }
  }

  // 3. System PATH probe via which / where
  try {
    const cmd = isWin ? "where opencode 2>nul" : "which opencode 2>/dev/null";
    const lines = execSync(cmd, { encoding: "utf8", timeout: 2000 })
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const p of lines) {
      if (isWin) {
        if (/\.(cmd|exe|bat)$/i.test(p)) candidateList.push(p);
        else {
          candidateList.push(`${p}.cmd`, `${p}.exe`, p);
        }
      } else {
        candidateList.push(p);
      }
    }
  } catch {
    /* ignore */
  }

  // 4. Local project node_modules fallback (npm / bun local install)
  candidateList.push(
    path.join(process.cwd(), "node_modules", ".bin", isWin ? "opencode.cmd" : "opencode"),
    path.join(process.cwd(), "node_modules", ".bin", isWin ? "opencode.exe" : "opencode"),
    path.join(process.cwd(), "node_modules", "@opencode", "cli", "bin", isWin ? "opencode.exe" : "opencode")
  );

  // Filter existing binaries
  const existing = [];
  const seen = new Set();
  for (const bin of candidateList) {
    if (!bin || seen.has(bin)) continue;
    seen.add(bin);
    try {
      if (fs.existsSync(bin)) existing.push(bin);
    } catch {}
  }

  if (existing.length === 0) return null;

  // Rank candidates: sort by semver descending so the latest available engine is always chosen
  // (e.g. @opencode/cli 2.1.x > 2.0.x > legacy opencode-ai 1.x).
  // If versions are identical, prefer native .exe over .cmd/.bat for direct spawn without cmd.exe.
  const ranked = existing.map((bin) => ({
    bin,
    ver: getOpencodeBinaryVersion(bin),
  }));

  ranked.sort((a, b) => {
    const [a1, a2, a3] = parseSemver(a.ver);
    const [b1, b2, b3] = parseSemver(b.ver);
    if (a1 !== b1) return b1 - a1;
    if (a2 !== b2) return b2 - a2;
    if (a3 !== b3) return b3 - a3;
    const aIsExe = /\.exe$/i.test(a.bin);
    const bIsExe = /\.exe$/i.test(b.bin);
    if (aIsExe && !bIsExe) return -1;
    if (!aIsExe && bIsExe) return 1;
    return 0;
  });

  const selectedBin = ranked[0]?.bin || existing[0];
  lastBinaryCheckTime = now;
  return selectedBin;
}

export function formatOpencodeCliPrompt(body) {
  if (!body) return "";

  const systemParts = [];

  // Add tool definitions to system prompt if tools are present
  if (hasTools(body)) {
    const toolPrompt = buildToolSystemPrompt(body.tools);
    if (toolPrompt) systemParts.push(toolPrompt);
  }

  // 1. Direct system field (Anthropic or custom)
  if (typeof body.system === "string" && body.system.trim()) {
    systemParts.push(body.system.trim());
  } else if (Array.isArray(body.system)) {
    const s = body.system
      .map((p) => (typeof p === "string" ? p : p?.text || ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (s) systemParts.push(s);
  }

  // 2. System and dialog messages from body.messages
  const dialogMsgs = [];
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!msg) continue;
      const role = String(msg.role || "").toLowerCase();
      const content = msg.content;
      const text = typeof content === "string"
        ? content.trim()
        : Array.isArray(content)
          ? content
              .map((c) => (typeof c === "string" ? c : c?.text || ""))
              .filter(Boolean)
              .join("\n")
              .trim()
          : "";

      if (role === "system" || role === "developer") {
        if (text) systemParts.push(text);
      } else if (role === "user") {
        if (text) dialogMsgs.push({ role: "user", text });
      } else if (role === "assistant") {
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          const tcLines = [];
          if (text) tcLines.push(text);
          for (const tc of msg.tool_calls) {
            const fn = tc.function || tc;
            let args = fn.arguments;
            if (typeof args !== "string") {
              try { args = JSON.stringify(args ?? {}); } catch { args = "{}"; }
            }
            tcLines.push(`<<TOOL_CALL>> {"name":"${fn.name || ""}","arguments":${args || "{}"}} <<TOOL_CALL>>`);
          }
          dialogMsgs.push({ role: "assistant", text: tcLines.join("\n") });
        } else if (text) {
          dialogMsgs.push({ role: "assistant", text });
        }
      } else if (role === "tool") {
        dialogMsgs.push({ role: "user", text: `<<TOOL_RESULT>> ${msg.name || "tool"}: ${text || ""} <<TOOL_RESULT>>` });
      }
    }
  }

  // If there are no system parts and only 1 user message, return it directly
  if (systemParts.length === 0 && dialogMsgs.length === 1 && dialogMsgs[0].role === "user") {
    return dialogMsgs[0].text;
  }

  const promptSections = [];

  // Add system instructions section
  if (systemParts.length > 0) {
    promptSections.push(`[System Instructions]\n${systemParts.join("\n\n")}`);
  }

  // If multi-turn conversation, format earlier history
  if (dialogMsgs.length > 1) {
    const earlierTurns = dialogMsgs.slice(0, -1);
    const historyText = earlierTurns
      .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.text}`)
      .join("\n\n");
    promptSections.push(`[Conversation History]\n${historyText}`);

    const lastMsg = dialogMsgs[dialogMsgs.length - 1];
    promptSections.push(`User: ${lastMsg.text}`);
  } else {
    // Single user turn with system instructions
    promptSections.push(`User: ${dialogMsgs[0].text}`);
  }

  return promptSections.join("\n\n").trim();
}

export async function executeOpencodeCli({
  opencodeBin,
  targetModel,
  promptText,
  body,
  proxyOptions,
  signal,
  log,
  rawModel,
  providerTag = "OPENCODE",
}) {
  const env = { ...process.env };
  const isWin = process.platform === "win32";
  if (isWin) {
    if (!env.HOME && env.USERPROFILE) {
      env.HOME = env.USERPROFILE;
    }
  } else {
    // Linux / macOS / Docker container fallback where HOME is '/' or unset
    if (!env.HOME || env.HOME === "/") {
      env.HOME = process.env.DATA_DIR || os.homedir() || "/tmp/opencode-home";
    }
    try {
      if (env.HOME && !fs.existsSync(env.HOME)) {
        fs.mkdirSync(env.HOME, { recursive: true });
      }
    } catch {}
  }
  let executable = opencodeBin;
  if (isWin && !/\.(cmd|exe|bat)$/i.test(executable)) {
    if (fs.existsSync(`${executable}.cmd`)) {
      executable = `${executable}.cmd`;
    } else if (fs.existsSync(`${executable}.exe`)) {
      executable = `${executable}.exe`;
    } else if (fs.existsSync(`${executable}.bat`)) {
      executable = `${executable}.bat`;
    }
  }

  // Attempt CLI execution with auto-retry on proxy connection error before falling back
  let finalResult = null;
  const maxAttempts = 3;
  let proxyBypassed = false;

  await acquireCliSlot(signal);
  try {
    // ── Fast path: Persistent singleton opencode serve daemon (<2s response, zero 429) ──
    try {
      const isDaemonReady = await ensureOpencodeDaemon(executable);
      if (isDaemonReady) {
        const clientHasTools = hasTools(body);
        let systemPrompt = "";
        if (clientHasTools) {
          systemPrompt = buildToolSystemPrompt(body) || "";
        } else {
          const sysList = [];
          if (body?.system) sysList.push(typeof body.system === "string" ? body.system : JSON.stringify(body.system));
          if (Array.isArray(body?.messages)) {
            for (const m of body.messages) {
              if (m.role === "system" || m.role === "developer") {
                const c = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map(x => x?.text || "").join("\n") : "";
                if (c) sysList.push(c);
              }
            }
          }
          systemPrompt = sysList.join("\n\n");
        }

        const daemonRes = await callOpencodeDaemon({
          model: rawModel,
          prompt: promptText,
          systemPrompt: systemPrompt || undefined,
          signal,
        });

        if (daemonRes && daemonRes.text) {
          finalResult = { success: true, text: daemonRes.text, tokens: daemonRes.tokens };
        }
      }
    } catch (daemonErr) {
      log?.debug?.(providerTag, `Daemon fast-path skipped, falling back to one-shot CLI: ${daemonErr.message}`);
    }

    if (!finalResult?.success) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const configuredProxy = proxyOptions?.connectionProxyEnabled ? proxyOptions.connectionProxyUrl : null;
    const candidateProxy = configuredProxy;
    if (candidateProxy && deadProxyUrls.has(candidateProxy)) {
      proxyBypassed = true;
    }
    const currentProxyUrl = !proxyBypassed ? candidateProxy : null;
    const runEnv = { ...env };
    if (currentProxyUrl) {
      runEnv.HTTP_PROXY = currentProxyUrl;
      runEnv.HTTPS_PROXY = currentProxyUrl;
      runEnv.http_proxy = currentProxyUrl;
      runEnv.https_proxy = currentProxyUrl;
      runEnv.all_proxy = currentProxyUrl;
      runEnv.NO_PROXY = "127.0.0.1,localhost,::1";
      runEnv.no_proxy = "127.0.0.1,localhost,::1";
    }

    try {
      const version = getOpencodeBinaryVersion(executable);
      const isV2 = /^v?[2-9]\./i.test(version) || version.includes("2.");
      const cliArgs = ["run"];
      if (isV2) {
        cliArgs.push("--standalone");
      }
      cliArgs.push("--model", targetModel, "--format", "default");

      finalResult = await new Promise((resolve, reject) => {
        let childProcess;
        try {
          childProcess = spawn(
            executable,
            cliArgs,
            {
              cwd: process.cwd(),
              env: runEnv,
              stdio: ["pipe", "pipe", "pipe"],
              shell: isWin && !/\.exe$/i.test(executable),
              windowsHide: true,
            }
          );
        } catch (spawnErr) {
          return reject(spawnErr);
        }

        if (childProcess.stdin) {
          try {
            childProcess.stdin.write(promptText || "");
            childProcess.stdin.end();
          } catch {
            /* ignore if closed early */
          }
        }
        let stdoutText = "";
        let stderrText = "";

        childProcess.stdout.on("data", (chunk) => {
          stdoutText += chunk.toString("utf-8");
        });

        childProcess.stderr.on("data", (chunk) => {
          stderrText += chunk.toString("utf-8");
        });

        activeCliProcesses.add(childProcess);

        const CLI_TIMEOUT_MS = 90000;
        const timer = setTimeout(() => {
          terminateCliProcess(childProcess);
          reject(new Error(`CLI execution timed out after ${CLI_TIMEOUT_MS / 1000}s`));
        }, CLI_TIMEOUT_MS);

        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            terminateCliProcess(childProcess);
          }, { once: true });
        }

        childProcess.on("error", (err) => {
          clearTimeout(timer);
          activeCliProcesses.delete(childProcess);
          if (currentProxyUrl) proxyBypassed = true;
          reject(err);
        });

        childProcess.on("close", (code) => {
          clearTimeout(timer);
          activeCliProcesses.delete(childProcess);
          if (code === 0 && stdoutText.trim()) {
            return resolve({ success: true, text: stdoutText.trim() });
          }

          const combined = `${stderrText} ${stdoutText}`.trim();
          if (/tunnel:\s*(400|407|502|503|504)|tunnel\s*failed|ECONNRESET|ETIMEDOUT|407\s*Proxy/i.test(combined)) {
            if (currentProxyUrl) {
              deadProxyUrls.add(currentProxyUrl);
              proxyBypassed = true;
            }
            return reject(new Error(`Proxy tunnel error (code ${code}): ${combined.slice(0, 150)}`));
          }

          if (code !== 0 && !stdoutText.trim()) {
            if (currentProxyUrl) proxyBypassed = true;
            return reject(new Error(`CLI exited with code ${code}: ${combined.slice(0, 150)}`));
          }

          resolve({ success: true, text: stdoutText.trim() });
        });
      });

      if (finalResult?.success && finalResult.text) {
        break;
      }
    } catch (err) {
      log?.warn?.(providerTag, `CLI attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  }
  } finally {
    releaseCliSlot();
  }

  const responseText = (finalResult?.text || "").trim();
  if (!finalResult?.success || !responseText) {
    throw new Error(`OpenCode CLI produced no output text (code: ${finalResult?.code ?? 'unknown'})`);
  }
  const responseId = `chatcmpl-oc-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const sseStream = new ReadableStream({
    start(controller) {
      const emit = (str) => {
        try {
          controller.enqueue(new TextEncoder().encode(str));
        } catch {
          /* fail open if stream closed */
        }
      };

      // Leading role chunk
      emit(
        `data: ${JSON.stringify({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model: rawModel,
          choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
        })}\n\n`
      );

      const clientHasTools = hasTools(body);
      const parsedTools = clientHasTools ? parseToolCallReply(responseText) : null;
      const isToolCall = Boolean(parsedTools?.calls && parsedTools.calls.length > 0);

      if (isToolCall) {
        // Emit any leading text content
        if (parsedTools.content) {
          emit(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model: rawModel,
              choices: [{ index: 0, delta: { content: parsedTools.content }, finish_reason: null }],
            })}\n\n`
          );
        }

        // Emit tool call deltas
        parsedTools.calls.forEach((call, idx) => {
          const callId = generateToolCallId();
          emit(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model: rawModel,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: idx,
                        id: callId,
                        type: "function",
                        function: {
                          name: call.name,
                          arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments || {}),
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`
          );
        });

        // Finish reason tool_calls
        emit(
          `data: ${JSON.stringify({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model: rawModel,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          })}\n\n`
        );
      } else {
        // Normal text chunk
        if (responseText) {
          emit(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model: rawModel,
              choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }],
            })}\n\n`
          );
        }

        // Stop chunk
        emit(
          `data: ${JSON.stringify({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model: rawModel,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`
        );
      }

      emit("data: [DONE]\n\n");
      controller.close();
    },
  });

  return {
    response: new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }),
    url: "opencode://cli/run",
    headers: {},
    transformedBody: { model: targetModel, prompt: promptText.slice(0, 100) },
  };
}
