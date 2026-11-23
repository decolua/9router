import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runQuotaAutoPingTick } from "@/shared/services/quotaAutoPing";
import { getExecutor } from "open-sse/executors/index.js";
import { QUOTA_AUTOPING_CONFIG } from "@/shared/constants/config";

/**
 * The keepalive through the REAL executor, with a stand-in `claude`: what the
 * card ends up saying for a good turn, an error turn and a child that hangs.
 * The binary is a POSIX script; the Windows shim path is covered elsewhere.
 */
const posix = process.platform !== "win32";
let root;
const saved = {};

const script = (root) => `#!/usr/bin/env node
const fs = require("fs");
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  let mode = "";
  try { mode = fs.readFileSync(${JSON.stringify(root)} + "/mode.txt", "utf8").trim(); } catch {}
  if (mode === "hang") { setInterval(() => {}, 1000); return; }
  if (mode === "error") {
    say({ type: "result", subtype: "success", is_error: true, api_error_status: 401, num_turns: 1, result: "Invalid authentication credentials" });
    return;
  }
  say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } } });
  say({ type: "result", subtype: "success", is_error: false, num_turns: 1, stop_reason: "end_turn", result: "Hi", usage: { input_tokens: 1, output_tokens: 1 } });
});
`;

beforeAll(() => {
  if (!posix) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "9r-keepalive-"));
  const bin = path.join(root, "claude");
  fs.writeFileSync(bin, script(root));
  fs.chmodSync(bin, 0o755);
  for (const key of ["CLI_CLAUDE_BIN", "CLI_CLAUDE_SESSION_CACHE", "CLI_CLAUDE_CACHE_RELAY"]) saved[key] = process.env[key];
  process.env.CLI_CLAUDE_BIN = bin;
  process.env.CLI_CLAUDE_SESSION_CACHE = "0";
  process.env.CLI_CLAUDE_CACHE_RELAY = "0";
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

const mode = (m) => fs.writeFileSync(path.join(root, "mode.txt"), m);

async function tick() {
  const conn = {
    id: "t1", provider: "claude-cli", authType: "none", isActive: true,
    providerSpecificData: { oauthToken: "sk-ant-oat01-test", kind: "token" },
  };
  const every = { enabled: true, expressions: ["* * * * *"], timezone: "UTC", via: "cli" };
  const deps = {
    getSettings: async () => ({ claudeCliAutoPing: { connections: {}, cron: { t1: every } } }),
    getProviderConnections: async () => [conn],
    updateProviderConnection: vi.fn(async () => {}),
    resolveConnectionProxyConfig: async () => ({}),
    refreshAndUpdateCredentials: vi.fn(),
    proxyAwareFetch: vi.fn(),
    getExecutor,
  };
  await runQuotaAutoPingTick(deps, { resetCache: {}, failureCache: {}, running: false });
  return deps.updateProviderConnection.mock.calls[0]?.[1];
}

describe.skipIf(!posix)("claude-cli keepalive through the real executor", () => {
  it("records a successful turn", async () => {
    mode("ok");
    const patch = await tick();
    expect(patch.lastCronPingAt).toBeTruthy();
    expect(patch.lastCronFailedAt).toBeUndefined();
  });

  it("records an error turn with the CLI's own reason", async () => {
    mode("error");
    const patch = await tick();
    expect(patch.lastCronFailedAt).toBeTruthy();
    expect(patch.lastCronError).toMatch(/Invalid authentication credentials/);
  });

  it("settles a child that never answers instead of hanging the tick", async () => {
    mode("hang");
    const original = QUOTA_AUTOPING_CONFIG.cliPingTimeoutMs;
    QUOTA_AUTOPING_CONFIG.cliPingTimeoutMs = 1500;
    try {
      const patch = await tick();
      expect(patch.lastCronFailedAt).toBeTruthy();
    } finally {
      QUOTA_AUTOPING_CONFIG.cliPingTimeoutMs = original;
    }
  }, 20000);
});
