import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";

const DAEMON_PORT = 29999;
const DAEMON_HEALTH_URL = `http://127.0.0.1:${DAEMON_PORT}/health`;
const ZCODE_BINARY_PATH = "/opt/zcode-engine/zcode";
const ZCODE_WORKER_PATH = "/opt/zcode-engine/bridge-worker.mjs";

let daemonProcess = null;
let spawnPromise = null;

export function hasNativeZcodeBinary() {
  return fs.existsSync(ZCODE_BINARY_PATH) && fs.existsSync(ZCODE_WORKER_PATH);
}

export async function isZcodeDaemonAlive(timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(DAEMON_HEALTH_URL, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function ensureZcodeDaemon() {
  if (!hasNativeZcodeBinary()) {
    return false;
  }

  if (await isZcodeDaemonAlive()) {
    return true;
  }

  if (spawnPromise) {
    return await spawnPromise;
  }

  spawnPromise = (async () => {
    try {
      console.log("[ZCodeBridge] Spawning native headless ZCode binary engine (Option B)...");
      daemonProcess = spawn(ZCODE_BINARY_PATH, [ZCODE_WORKER_PATH], {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          LD_LIBRARY_PATH: "/opt/zcode-engine",
          ELECTRON_RUN_AS_NODE: "1",
        },
      });

      daemonProcess.unref();

      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (await isZcodeDaemonAlive(300)) {
          console.log("[ZCodeBridge] Native ZCode binary engine is READY on port 29999.");
          return true;
        }
      }

      console.warn("[ZCodeBridge] Native ZCode binary engine failed to respond on health check.");
      return false;
    } catch (err) {
      console.error("[ZCodeBridge] Error spawning native ZCode binary engine:", err);
      return false;
    } finally {
      spawnPromise = null;
    }
  })();

  return await spawnPromise;
}

export async function forwardToZcodeDaemon(targetUrl, headers, body, signal) {
  const isReady = await ensureZcodeDaemon();
  if (!isReady) {
    throw new Error("ZCode native binary engine is not available");
  }

  const forwardHeaders = { ...headers };
  forwardHeaders["x-target-url"] = targetUrl;

  const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/v1/messages`, {
    method: "POST",
    headers: forwardHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });

  return res;
}
