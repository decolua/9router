
import { describe, it, expect } from "vitest";
import {
  buildOpenCodeServiceEnv,
  isBridgeOnlyOrchestratorInput,
  isServiceBridgeToolAllowed,
  resolveClientToolName,
  serviceBridgePermissions,
} from "../../open-sse/services/opencodeServiceBridge.js";

describe("OpenCode Tool Name Resolution & Isolation", () => {
  const primeTools = [
    { function: { name: "python_repl", description: "Execute Python code in a persistent Python REPL." } },
    { function: { name: "ctx_shell", description: "Run a shell command with lean-ctx compression.", parameters: { properties: { command: { type: "string" } } } } },
    { function: { name: "ctx_read", description: "Read file content." } }
  ];

  it("never resolves generic runner 'execute' to python_repl via description matching", () => {
    const res = resolveClientToolName("execute", primeTools);
    expect(res).not.toBe("python_repl");
    expect(res).toBe("execute");
  });

  it("resolves direct property matching when command is provided", () => {
    const res = resolveClientToolName("execute", primeTools, { command: "ls -la" });
    expect(res).toBe("ctx_shell");
  });

  it("keeps bridge policy and tool authorization dynamic", () => {
    const tools = [
      { function: { name: "read_file", description: "Read a file" } },
      { function: { name: "apply_patch", description: "Modify a file" } },
    ];
    const permissions = serviceBridgePermissions("ninerouter_abc123", tools);

    expect(permissions).toEqual([
      { action: "execute", resource: "*", effect: "allow" },
      { action: "ninerouter_abc123_*", resource: "*", effect: "allow" },
    ]);
    expect(isServiceBridgeToolAllowed("read_file", { relayName: "ninerouter_abc123", tools })).toBe(true);
    expect(isServiceBridgeToolAllowed("ninerouter_abc123_apply_patch", { relayName: "ninerouter_abc123", tools })).toBe(true);
    expect(isServiceBridgeToolAllowed("shell", { relayName: "ninerouter_abc123", tools })).toBe(false);
    expect(isServiceBridgeToolAllowed("ninerouter_abc123_shell", { relayName: "ninerouter_abc123", tools })).toBe(false);
  });

  it("disables the orchestrator when no external tools are declared", () => {
    expect(isServiceBridgeToolAllowed("execute", { relayName: "ninerouter_empty", tools: [] })).toBe(false);
    expect(serviceBridgePermissions("ninerouter_empty", [])).toEqual([]);
  });

  it("allows the orchestrator to compose external tools but not local access", () => {
    const relayName = "ninerouter_abc123";
    expect(isBridgeOnlyOrchestratorInput({ code: `return await tools["${relayName}"].read_file({ path: "README.md" });` }, relayName)).toBe(true);
    expect(isBridgeOnlyOrchestratorInput({ code: `return await tools["ninerouter_other_hash_123"].read_file({ path: "README.md" });` }, relayName)).toBe(true);
    expect(isBridgeOnlyOrchestratorInput({ code: `return await tools["${relayName}"].ctx_shell({ command: "grep 'export function' file.js" });` }, relayName)).toBe(true);
    expect(isBridgeOnlyOrchestratorInput({ code: `return await fetch("https://example.com");` }, relayName)).toBe(false);
    expect(isBridgeOnlyOrchestratorInput({ code: `return process.cwd();` }, relayName)).toBe(false);
    expect(isBridgeOnlyOrchestratorInput({ code: `return new Function("return 1")();` }, relayName)).toBe(false);
  });

  it("passes the native OpenCode daemon its proxy and no-proxy environment", () => {
    const env = buildOpenCodeServiceEnv({
      baseEnv: { PATH: "/bin", OPENCODE_API_KEY: "native-configured" },
      proxyUrl: "http://127.0.0.1:1080",
      noProxy: "localhost,10.0.0.0/8",
      apiKey: "public",
    });

    expect(env.OPENCODE_API_KEY).toBe("public");
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:1080");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:1080");
    expect(env.http_proxy).toBe("http://127.0.0.1:1080");
    expect(env.https_proxy).toBe("http://127.0.0.1:1080");
    expect(env.NO_PROXY).toBe("localhost,10.0.0.0/8,127.0.0.1,::1");
    expect(env.no_proxy).toBe(env.NO_PROXY);
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });
});
