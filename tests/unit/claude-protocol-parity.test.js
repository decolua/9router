import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import claude from "../../open-sse/providers/registry/claude.js";
import {
  CLAUDE_CLI_SPOOF_HEADERS,
  mapStainlessArch,
  mapStainlessOs,
} from "../../open-sse/providers/shared.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { applyCloaking } from "../../open-sse/utils/claudeCloaking.js";

describe("direct Claude protocol parity", () => {
  it("uses one shared Claude CLI header source in the registry", () => {
    expect(claude.transport.headers).toBe(CLAUDE_CLI_SPOOF_HEADERS);
  });

  it("matches the current CLI and SDK fingerprint on the host OS and architecture", () => {
    expect(CLAUDE_CLI_SPOOF_HEADERS).toMatchObject({
      "User-Agent": "claude-cli/2.1.220 (external, sdk-cli)",
      "X-Stainless-Package-Version": "0.94.0",
      "X-Stainless-Os": mapStainlessOs(),
      "X-Stainless-Arch": mapStainlessArch(),
    });
  });

  it("maps Stainless OS and architecture independently of test host", () => {
    expect(mapStainlessOs("darwin")).toBe("MacOS");
    expect(mapStainlessOs("win32")).toBe("Windows");
    expect(mapStainlessOs("linux")).toBe("Linux");
    expect(mapStainlessArch("x64")).toBe("x64");
    expect(mapStainlessArch("arm64")).toBe("arm64");
    expect(mapStainlessArch("ia32")).toBe("x86");
  });

  it("keeps the current beta feature list", () => {
    expect(CLAUDE_CLI_SPOOF_HEADERS["Anthropic-Beta"]).toBe(
      "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28"
    );
  });

  it("uses the beta query URL for direct messages", () => {
    expect(new DefaultExecutor("claude").buildUrl("claude-fable-5", true)).toBe(
      "https://api.anthropic.com/v1/messages?beta=true"
    );
  });

  it("uses the current CLI version in the billing header", () => {
    const body = applyCloaking(
      { messages: [{ role: "user", content: "hello" }] },
      "sk-ant-oat-test",
      "session-123"
    );

    expect(body.system[0].text).toMatch(/cc_version=2\.1\.220\.[0-9a-f]{3};/);
  });

  it("matches the session header to cloaked metadata", () => {
    const credentials = {
      accessToken: "sk-ant-oat-test",
      rawHeaders: { "x-session-id": "session-123" },
    };
    const body = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-fable-5",
      { messages: [{ role: "user", content: "hello" }] },
      true,
      credentials,
      "claude",
      null,
      [],
      "connection-123"
    );
    const sessionId = JSON.parse(body.metadata.user_id).session_id;
    const headers = new DefaultExecutor("claude").buildHeaders(credentials, true);

    expect(credentials._clientSessionId).toBe("session-123");
    expect(headers["X-Claude-Code-Session-Id"]).toBe(sessionId);
  });

  it("keeps incoming Claude metadata aligned with the session header", () => {
    const credentials = { accessToken: "sk-ant-oat-test" };
    const body = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      "claude-fable-5",
      {
        metadata: { user_id: JSON.stringify({ session_id: "session-456" }) },
        messages: [{ role: "user", content: "hello" }],
      },
      true,
      credentials,
      "claude"
    );
    const sessionId = JSON.parse(body.metadata.user_id).session_id;
    const headers = new DefaultExecutor("claude").buildHeaders(credentials, true);

    expect(credentials._clientSessionId).toBe("session-456");
    expect(headers["X-Claude-Code-Session-Id"]).toBe(sessionId);
  });

  it("does not add the Claude session header to unrelated providers", () => {
    const headers = new DefaultExecutor("openai").buildHeaders(
      { apiKey: "sk-test", _clientSessionId: "session-123" },
      true
    );

    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain(
      "x-claude-code-session-id"
    );
  });
});
