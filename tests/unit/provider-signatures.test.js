import { describe, expect, it } from "vitest";

function expectUuidLike(value) {
  expect(value).toMatch(/^[0-9a-f-]{36}$/i);
}

describe("provider signature/header matrix", () => {
  it("builds the OpenRouter header shape without any live request", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const executor = new DefaultExecutor("openrouter");
    const headers = executor.buildHeaders({ apiKey: "or-test-key" }, true);

    expect(headers["HTTP-Referer"]).toBe("https://endpoint-proxy.local");
    expect(headers["X-Title"]).toBe("Endpoint Proxy");
    expect(headers.Authorization).toBe("Bearer or-test-key");
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("builds Codex identity headers with the connection-scoped session id", async () => {
    const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
    const { CODEX_ORIGINATOR, CODEX_USER_AGENT } = await import("../../open-sse/config/providers.js");
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders(
      {
        accessToken: "codex-test-token",
        connectionId: "conn-123",
        providerSpecificData: { workspaceId: "workspace-abc" }
      },
      true
    );

    expect(headers.Authorization).toBe("Bearer codex-test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.originator).toBe(CODEX_ORIGINATOR);
    expect(headers.session_id).toBe("conn-123");
    expect(headers["chatgpt-account-id"]).toBe("workspace-abc");
    expect(headers["User-Agent"]).toBe(CODEX_USER_AGENT);
    expect(headers.Accept).toBe("text/event-stream");
  });

  it("accepts chatgptAccountId as the Codex account binding fallback", async () => {
    const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
    const { CODEX_ORIGINATOR } = await import("../../open-sse/config/providers.js");
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders(
      {
        accessToken: "codex-test-token",
        connectionId: "conn-456",
        providerSpecificData: { chatgptAccountId: "account-xyz" }
      },
      true
    );

    expect(headers["chatgpt-account-id"]).toBe("account-xyz");
    expect(headers.session_id).toBe("conn-456");
    expect(headers.originator).toBe(CODEX_ORIGINATOR);
  });

  it("keeps the Claude cold-start spoof User-Agent aligned with the installed version", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { CLAUDE_CLI_VERSION } = await import("../../open-sse/config/providers.js");
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "claude-test-key" }, true);

    expect(headers["User-Agent"]).toBe(`claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`);
    expect(headers["X-App"]).toBe("cli");
    expect(headers["Anthropic-Beta"]).toContain("oauth-2025-04-20");
  });

  it("builds Gemini CLI request headers from the current model", async () => {
    const { GeminiCLIExecutor } = await import("../../open-sse/executors/gemini-cli.js");
    const { geminiCLIUserAgent, GEMINI_CLI_API_CLIENT } = await import("../../open-sse/config/appConstants.js");
    const executor = new GeminiCLIExecutor();
    executor.transformRequest("gemini-2.5-pro", { contents: [] }, true, {});
    const headers = executor.buildHeaders({ accessToken: "gemini-test-token" }, true);

    expect(headers.Authorization).toBe("Bearer gemini-test-token");
    expect(headers["User-Agent"]).toBe(geminiCLIUserAgent("gemini-2.5-pro"));
    expect(headers["X-Goog-Api-Client"]).toBe(GEMINI_CLI_API_CLIENT);
    expect(headers.Accept).toBe("text/event-stream");
  });

  it("builds Kiro eventstream headers and preserves the AWS fingerprint shape", async () => {
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    const { KIRO_IDE_VERSION } = await import("../../open-sse/config/appConstants.js");
    const executor = new KiroExecutor();
    const headers = executor.buildHeaders({ accessToken: "kiro-test-token" }, true);

    expect(headers.Authorization).toBe("Bearer kiro-test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/vnd.amazon.eventstream");
    expect(headers["User-Agent"]).toBe(`AWS-SDK-JS/3.0.0 kiro-ide/${KIRO_IDE_VERSION}`);
    expect(headers["X-Amz-User-Agent"]).toBe(`aws-sdk-js/3.0.0 kiro-ide/${KIRO_IDE_VERSION}`);
    expect(headers["Amz-Sdk-Request"]).toBe("attempt=1; max=3");
    expectUuidLike(headers["Amz-Sdk-Invocation-Id"]);
  });

  it("builds Qoder COSY signing headers locally without a network call", async () => {
    const { buildCosyHeaders } = await import("../../src/lib/qoder/cosy.js");
    const headers = buildCosyHeaders(
      Buffer.from('{"messages":[{"role":"user","content":"ping"}]}'),
      "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common",
      {
        userId: "user-123",
        authToken: "dt-test-token",
        machineId: "machine-abc",
        email: "user@example.com",
        name: "Test User"
      }
    );

    expect(headers.Authorization).toMatch(/^Bearer COSY\./);
    expect(headers["Cosy-Key"]).toBeTruthy();
    expect(headers["Cosy-User"]).toBe("user-123");
    expect(headers["Cosy-Machineid"]).toBe("machine-abc");
    expect(headers["Cosy-Machinetoken"]).toBe("machine-abc");
    expect(headers["Cosy-Machinetype"]).toBe("5");
    expect(headers["Cosy-Machineos"]).toBe("x86_64_windows");
    expect(headers["Cosy-Clienttype"]).toBe("5");
    expect(headers["Cosy-Data-Policy"]).toBe("disagree");
    expect(headers["Cosy-Sigpath"]).toBe("/api/v2/service/pro/sse/agent_chat_generation");
    expect(headers["Cosy-Bodylength"]).toBe("47");
    expect(headers["Cosy-Bodyhash"]).toMatch(/^[0-9a-f]{32}$/);
    expect(headers["Login-Version"]).toBe("v2");
    expectUuidLike(headers["X-Request-Id"]);
  });

  it("keeps KiloCode on the generic OpenAI-compatible path", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const executor = new DefaultExecutor("kilocode");
    const headers = executor.buildHeaders({ apiKey: "kilo-test-key" }, true);

    // KiloCode has an official client fingerprint in its own repo/issues, but 9router
    // currently routes it as a plain OpenAI-compatible backend and does not synthesize
    // a KiloCode-specific UA/version header.
    expect(headers.Authorization).toBe("Bearer kilo-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["x-kilocode-version"]).toBeUndefined();
    expect(headers["user-agent"]).toBeUndefined();
  });

  it("builds the current OpenCode local proxy headers", async () => {
    const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");
    const executor = new OpenCodeExecutor();
    const headers = executor.buildHeaders();

    // OpenCode's own issues mention webfetch/browser-like UA behavior, but the local
    // 9router integration currently only marks the upstream as the desktop client.
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer public");
    expect(headers["x-opencode-client"]).toBe("desktop");
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["user-agent"]).toBeUndefined();
  });
});
