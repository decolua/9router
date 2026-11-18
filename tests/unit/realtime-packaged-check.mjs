import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyStandaloneAssets } from "../../scripts/copy-standalone-assets.mjs";

const root = resolve(import.meta.dirname, "../..");
const fixture = mkdtempSync(join(tmpdir(), "9router-package-check-"));
let child;
try {
  mkdirSync(join(fixture, ".next/standalone"), { recursive: true });
  mkdirSync(join(fixture, "node_modules"));
  cpSync(join(root, "custom-server.js"), join(fixture, "custom-server.js"));
  cpSync(join(root, "realtime"), join(fixture, "realtime"), { recursive: true });
  cpSync(join(root, "node_modules/ws"), join(fixture, "node_modules/ws"), { recursive: true });
  const packaged = join(fixture, ".next/standalone");
  writeFileSync(join(packaged, "server.js"), `
    const server = require('http').createServer((req, res) => {
      res.writeHead(req.url === '/api/internal/realtime-credentials' ? 401 : 200);
      res.end('ok');
    });
    server.on('upgrade', (_req, socket) => socket.destroy());
    server.listen(0, '127.0.0.1', function () { console.log('PORT=' + this.address().port); });
  `);
  copyStandaloneAssets({ projectRoot: fixture });
  child = spawn(process.execPath, ["custom-server.js"], { cwd: packaged, env: { ...process.env, NEXT_TRACING_ROOT_MODE: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const output = await Promise.race([
    once(child.stdout, "data").then(([data]) => data.toString()),
    once(child, "exit").then(([code]) => { throw new Error(`packaged server exited: ${code}`); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("packaged server startup timed out")), 10000).unref()),
  ]);
  const port = Number(output.match(/PORT=(\d+)/)?.[1]);
  assert.ok(port, output);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  const { WebSocket } = createRequire(import.meta.url)("ws");
  const client = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime?model=gpt-realtime`);
  client.on("error", () => {});
  assert.equal((await once(client, "unexpected-response"))[1].statusCode, 401);
  const qualified = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime?model=openai%2Fgpt-realtime`);
  qualified.on("error", () => {});
  assert.equal((await once(qualified, "unexpected-response"))[1].statusCode, 401);
  console.log("packaged realtime wrapper checks passed");
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, "exit");
  }
  rmSync(fixture, { recursive: true, force: true });
}