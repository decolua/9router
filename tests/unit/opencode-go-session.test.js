import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const TRANSPORTS = [
  { format: "openai", baseUrl: "https://opencode.ai/zen/go/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  { format: "claude", baseUrl: "https://opencode.ai/zen/go/v1/messages", auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true } },
  { format: "openai-responses", baseUrl: "https://opencode.ai/zen/go/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
];

function makeCredentials(overrides = {}) {
  return {
    apiKey: "test-key",
    connectionId: "connection-a",
    rawHeaders: {},
    runtimeTransport: TRANSPORTS[0],
    ...overrides,
  };
}

function prepare(executor, overrides = {}) {
  const credentials = overrides.credentials || makeCredentials();
  const prepared = executor.prepareRequestCredentials({
    body: overrides.body || { messages: [{ role: "user", content: "hello" }] },
    credentials,
    providerSessionId: "providerSessionId" in overrides ? overrides.providerSessionId : "conversation-a",
    clientTool: "clientTool" in overrides ? overrides.clientTool : "claude",
  });
  return { credentials, prepared };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
});

describe("OpenCode Go x-opencode-session", () => {
  it("uses a dedicated executor with request-local session credentials", () => {
    const executor = getExecutor("opencode-go");
    const { credentials, prepared } = prepare(executor);

    expect(executor.constructor.name).toBe("OpenCodeGoExecutor");
    expect(prepared).not.toBe(credentials);
    expect(prepared._opencodeGoSession).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(credentials).not.toHaveProperty("_opencodeGoSession");
    expect(executor).not.toHaveProperty("_currentSessionId");
    expect(executor).not.toHaveProperty("_opencodeGoSession");
  });

  it("preserves a valid native session header case-insensitively", () => {
    const executor = getExecutor("opencode-go");
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "X-OpenCode-Session": " native-session-a " } }),
    });

    expect(prepared._opencodeGoSession).toBe("native-session-a");
  });

  it("ignores an oversized native session and uses the translated identity", () => {
    const executor = getExecutor("opencode-go");
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "x-opencode-session": "x".repeat(257) } }),
    });

    expect(prepared._opencodeGoSession).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it("keeps the same translated conversation stable across all transports", () => {
    const executor = getExecutor("opencode-go");
    const values = TRANSPORTS.map((runtimeTransport) => {
      const { prepared } = prepare(executor, {
        credentials: makeCredentials({ runtimeTransport }),
      });
      return executor.buildHeaders(prepared, true)["x-opencode-session"];
    });

    expect(new Set(values).size).toBe(1);
    expect(values[0]).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(values[0]).not.toContain("conversation-a");
  });

  it("isolates different conversations", () => {
    const executor = getExecutor("opencode-go");
    const a = prepare(executor, { providerSessionId: "conversation-a" }).prepared._opencodeGoSession;
    const b = prepare(executor, { providerSessionId: "conversation-b" }).prepared._opencodeGoSession;

    expect(a).not.toBe(b);
  });

  it("isolates different downstream agents that reuse the same raw id", () => {
    const executor = getExecutor("opencode-go");
    const claude = prepare(executor, { clientTool: "claude" }).prepared._opencodeGoSession;
    const codex = prepare(executor, { clientTool: "codex" }).prepared._opencodeGoSession;

    expect(claude).not.toBe(codex);
  });

  it("uses a stable opaque connection fallback when no session is supplied", () => {
    const executor = getExecutor("opencode-go");
    const options = {
      credentials: makeCredentials({ connectionId: "fallback-connection" }),
      providerSessionId: null,
      clientTool: null,
      body: { messages: [{ role: "user", content: "headerless" }] },
    };
    const first = prepare(executor, options).prepared._opencodeGoSession;
    const second = prepare(executor, options).prepared._opencodeGoSession;

    expect(first).toBe(second);
    expect(first).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(first).not.toContain("fallback-connection");
  });

  it("adds the prepared session to the actual fetch headers", async () => {
    const executor = getExecutor("opencode-go");
    const credentials = makeCredentials();
    const result = await executor.execute({
      model: "glm-5.2",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials,
      providerSessionId: "conversation-fetch",
      clientTool: "codex",
    });

    expect(result.headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(result.headers["User-Agent"]).toBe("codex-tui/1.0");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["x-opencode-session"]).toBe(result.headers["x-opencode-session"]);
    expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toBe("codex-tui/1.0");
    expect(credentials).not.toHaveProperty("_opencodeGoSession");
    expect(credentials).not.toHaveProperty("_opencodeGoUserAgent");
  });

  it("does not add the header to unrelated default executors", () => {
    const headers = new DefaultExecutor("openai").buildHeaders({ apiKey: "test-key" }, false);
    expect(headers["x-opencode-session"]).toBeUndefined();
    expect(headers["User-Agent"]).toBeUndefined();
  });
});

describe("OpenCode Go User-Agent", () => {
  it("uses request-local user agent credentials without singleton state", () => {
    const executor = getExecutor("opencode-go");
    const { credentials, prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "user-agent": "my-coding-agent/1.0" } }),
    });

    expect(prepared._opencodeGoUserAgent).toBe("my-coding-agent/1.0");
    expect(credentials).not.toHaveProperty("_opencodeGoUserAgent");
    expect(executor).not.toHaveProperty("_currentUserAgent");
    expect(executor).not.toHaveProperty("_opencodeGoUserAgent");
  });

  it("preserves legitimate coding agent user-agents", () => {
    const executor = getExecutor("opencode-go");
    const agents = [
      "claude-cli/2.1.258 (external, sdk-cli)",
      "Cursor/0.45.1",
      "opencode/1.0.0",
      "cline/3.2.0",
      "aider/0.75.0",
      "windsurf/1.2.0",
      "my-coding-agent/1.0",
      "custom-build-agent/2.0",
      "team-coder/1.5",
      "void/0.1.0",
      "bolt/1.0",
      "zed/0.120.0",
    ];

    for (const ua of agents) {
      const { prepared } = prepare(executor, {
        credentials: makeCredentials({ rawHeaders: { "user-agent": ua } }),
        clientTool: null,
      });
      expect(prepared._opencodeGoUserAgent).toBe(ua);
      const headers = executor.buildHeaders(prepared, true);
      expect(headers["User-Agent"]).toBe(ua);
      expect(headers["user-agent"]).toBeUndefined();
    }
  });

  it("does not match non-agent substrings like avoid or thunderbolt", () => {
    const executor = getExecutor("opencode-go");
    const falsePositives = [
      "avoid/1.0",
      "thunderbolt/2.0",
      "analyzed/1.0",
    ];

    for (const ua of falsePositives) {
      const { prepared } = prepare(executor, {
        credentials: makeCredentials({ rawHeaders: { "user-agent": ua } }),
        clientTool: null,
      });
      expect(prepared._opencodeGoUserAgent).toBe("9router-coding-agent/1.0");
      const headers = executor.buildHeaders(prepared, true);
      expect(headers["User-Agent"]).toBe("9router-coding-agent/1.0");
    }
  });

  it("clamps synthetic user-agent to MAX_UA_LENGTH", () => {
    const executor = getExecutor("opencode-go");
    const longTool = "custom-agent-tool-".repeat(30);
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: {} }),
      clientTool: longTool,
    });

    expect(prepared._opencodeGoUserAgent.length).toBe(256);
    expect(prepared._opencodeGoUserAgent.startsWith(`${longTool.toLowerCase()}-agent/1.0`.slice(0, 20))).toBe(true);
  });

  it("replaces generic HTTP libraries and SDKs with fallback when clientTool is null", () => {
    const executor = getExecutor("opencode-go");
    const genericUas = [
      "curl/8.5.0",
      "wget/1.21",
      "python-requests/2.31.0",
      "requests/2.28.1",
      "axios/1.6.8",
      "node-fetch/3.3.0",
      "undici",
      "Go-http-client/1.1",
      "OpenAI/Python 1.12.0",
      "openai-node/4.30.0",
      "anthropic-python/0.18.0",
      "langchain/0.1.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    ];

    for (const ua of genericUas) {
      const { prepared } = prepare(executor, {
        credentials: makeCredentials({ rawHeaders: { "user-agent": ua } }),
        clientTool: null,
      });
      expect(prepared._opencodeGoUserAgent).toBe("9router-coding-agent/1.0");
      const headers = executor.buildHeaders(prepared, true);
      expect(headers["User-Agent"]).toBe("9router-coding-agent/1.0");
    }
  });

  it("handles missing, empty, or whitespace-only user-agent headers", () => {
    const executor = getExecutor("opencode-go");
    const emptyHeaders = [
      {},
      { "user-agent": "" },
      { "user-agent": "   " },
      { "User-Agent": "\t\n" },
    ];

    for (const rawHeaders of emptyHeaders) {
      const { prepared } = prepare(executor, {
        credentials: makeCredentials({ rawHeaders }),
        clientTool: null,
      });
      expect(prepared._opencodeGoUserAgent).toBe("9router-coding-agent/1.0");
      const headers = executor.buildHeaders(prepared, true);
      expect(headers["User-Agent"]).toBe("9router-coding-agent/1.0");
    }
  });

  it("synthesizes tool-specific user-agent when clientTool is detected and UA is generic or missing", () => {
    const executor = getExecutor("opencode-go");
    const toolMap = [
      { tool: "claude", expected: "claude-cli/1.0" },
      { tool: "codex", expected: "codex-tui/1.0" },
      { tool: "gemini-cli", expected: "gemini-cli/1.0" },
      { tool: "github-copilot", expected: "github-copilot/1.0" },
      { tool: "deepseek-tui", expected: "deepseek-tui/1.0" },
      { tool: "antigravity", expected: "antigravity-agent/1.0" },
      { tool: "customtool", expected: "customtool-agent/1.0" },
    ];

    for (const { tool, expected } of toolMap) {
      const { prepared } = prepare(executor, {
        credentials: makeCredentials({ rawHeaders: { "user-agent": "curl/7.81.0" } }),
        clientTool: tool,
      });
      expect(prepared._opencodeGoUserAgent).toBe(expected);
      const headers = executor.buildHeaders(prepared, true);
      expect(headers["User-Agent"]).toBe(expected);
    }
  });

  it("handles case-insensitive User-Agent header in rawHeaders", () => {
    const executor = getExecutor("opencode-go");
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "USER-AGENT": " my-coding-agent/1.0 " } }),
      clientTool: null,
    });

    expect(prepared._opencodeGoUserAgent).toBe("my-coding-agent/1.0");
  });

  it("keeps the same User-Agent across all transports", () => {
    const executor = getExecutor("opencode-go");
    const values = TRANSPORTS.map((runtimeTransport) => {
      const { prepared } = prepare(executor, {
        credentials: makeCredentials({
          runtimeTransport,
          rawHeaders: { "user-agent": "my-coding-agent/1.0" },
        }),
      });
      return executor.buildHeaders(prepared, true)["User-Agent"];
    });

    expect(new Set(values).size).toBe(1);
    expect(values[0]).toBe("my-coding-agent/1.0");
  });

  it("uses fallback preparation if buildHeaders is called without prepared credentials", () => {
    const executor = getExecutor("opencode-go");
    const credentials = makeCredentials({ rawHeaders: {} });
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["User-Agent"]).toBe("9router-coding-agent/1.0");
    expect(headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{32}$/);
  });
});

describe("chatCore provider session forwarding", () => {
  it("passes the original provider session and client tool on initial and retry execution", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../open-sse/handlers/chatCore.js", import.meta.url)),
      "utf8",
    );
    const calls = [...source.matchAll(/executor\.execute\(\{([\s\S]*?)\}\)/g)].map((match) => match[1]);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatch(/providerSessionId:\s*sessionSeed/);
      expect(call).toMatch(/\bclientTool\b/);
    }
  });
});
