import { beforeEach, describe, expect, it, vi } from "vitest";

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
    providerSessionId: overrides.providerSessionId ?? "conversation-a",
    clientTool: overrides.clientTool ?? "claude",
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
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["x-opencode-session"]).toBe(result.headers["x-opencode-session"]);
    expect(credentials).not.toHaveProperty("_opencodeGoSession");
  });

  it("does not add the header to unrelated default executors", () => {
    const headers = new DefaultExecutor("openai").buildHeaders({ apiKey: "test-key" }, false);
    expect(headers["x-opencode-session"]).toBeUndefined();
  });
});
