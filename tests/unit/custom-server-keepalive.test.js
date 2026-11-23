import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
let directory;

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "9router-keepalive-"));
  // Run the real wrapper without loading the checkout's background refresh
  // scheduler or touching the developer's provider database.
  copyFileSync(fileURLToPath(new URL("../../custom-server.js", import.meta.url)), path.join(directory, "custom-server.js"));
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function probe(value, { idleMs = 0, serverTimeout } = {}) {
  const env = { ...process.env };
  delete env.KEEP_ALIVE_TIMEOUT;
  delete env.DEBUG_BACKGROUND_TOKEN_REFRESH;
  if (value !== undefined) env.KEEP_ALIVE_TIMEOUT = value;
  const script = `
    const http = require('node:http');
    require('./custom-server.js');
    const server = http.createServer(${JSON.stringify(serverTimeout === undefined ? {} : { keepAliveTimeout: serverTimeout })}, (req, res) => res.end('ok'));
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const get = () => new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port: server.address().port, agent }, (res) => {
        let text = '';
        const port = res.socket.localPort;
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ port, status: res.statusCode, text, header: res.headers['keep-alive'] || null }));
      });
      req.on('error', reject);
    });
    server.listen(0, '127.0.0.1', async () => {
      try {
        const first = await get();
        await new Promise((resolve) => setTimeout(resolve, ${idleMs}));
        const second = await get();
        console.log(JSON.stringify({ first, second, reused: first.port === second.port }));
      } catch (error) { console.error(error); process.exitCode = 1; }
      finally { agent.destroy(); server.close(); }
    });
  `;
  const { stdout } = await run(process.execPath, ["-e", script], { cwd: directory, env, timeout: 12000 });
  return JSON.parse(stdout);
}

describe("custom server idle keep-alive", () => {
  it.each([undefined, "", "invalid", "-1"])("uses a longer idle timeout when configured as %s", async (value) => {
    const result = await probe(value);
    expect(result.first).toMatchObject({ status: 200, text: "ok", header: "timeout=65" });
  });

  it("keeps a pooled connection reusable after Node's five-second default", async () => {
    const result = await probe(undefined, { idleMs: 6200 });
    expect(result.reused).toBe(true);
    expect(result.second).toMatchObject({ status: 200, text: "ok" });
  }, 15000);

  it("honors a configured KEEP_ALIVE_TIMEOUT", async () => {
    const result = await probe("120000");
    expect(result.first.header).toBe("timeout=120");
  });

  it("honors zero to disable the idle timeout", async () => {
    const result = await probe("0");
    expect(result.first.header).toBeNull();
    expect(result.reused).toBe(true);
  });

  it("retains an explicit HTTP server option", async () => {
    const result = await probe(undefined, { serverTimeout: 90000 });
    expect(result.first.header).toBe("timeout=90");
  });
});
