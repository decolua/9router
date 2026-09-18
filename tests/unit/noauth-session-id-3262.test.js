import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  })),
  pickProxyPoolId: vi.fn(() => null),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");

// Turn 1: nothing but the user prompt.
const userOnly = {
  model: "oc/deepseek-v4-flash-free",
  messages: [{ role: "user", content: "List the files in this repo." }],
};

// Turn 2 — the first tool call. The assistant item carries a tool_call and no
// prose, so the assistant-text heuristic cannot identify the conversation and
// the connection-level fallback is what has to hold the session together.
const afterFirstToolCall = {
  model: "oc/deepseek-v4-flash-free",
  messages: [
    { role: "user", content: "List the files in this repo." },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "ls", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "call_1", content: "README.md" },
  ],
};

function sessionFor(body, credentials) {
  const ex = new OpenCodeExecutor();
  ex.transformRequest("oc/deepseek-v4-flash-free", body, true, credentials);
  return ex.buildHeaders(credentials, true)["x-opencode-session"];
}

describe("#3262 no-auth free providers keep one upstream session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives the virtual no-auth connection the sentinel connectionId", async () => {
    const creds = await getProviderCredentials("opencode");
    expect(creds.connectionId).toBe("noauth");
    // The value markAccountUnavailable / clearAccountError already test for, so a
    // free provider is never cooled down as if it were a real account.
    expect(creds.id).toBe("noauth");
  });

  it("holds the session across the first tool call", () => {
    const creds = { rawHeaders: {}, connectionId: "noauth" };
    expect(sessionFor(afterFirstToolCall, creds)).toBe(sessionFor(userOnly, creds));
  });

  it("keeps the session reproducible for repeats of the same turn", () => {
    const creds = { rawHeaders: {}, connectionId: "noauth" };
    expect(sessionFor(userOnly, creds)).toBe(sessionFor(userOnly, creds));
  });

  // Without the field every call minted a new ses_, which is what burned the
  // free-tier quota on the second request of a conversation.
  it("mints a new session per call when connectionId is missing", () => {
    const creds = () => ({ rawHeaders: {} });
    expect(sessionFor(userOnly, creds())).not.toBe(sessionFor(userOnly, creds()));
  });

  it("still honours a client-supplied session id", () => {
    const creds = { rawHeaders: { "x-opencode-session": "ses_from_client" }, connectionId: "noauth" };
    expect(sessionFor(userOnly, creds)).toBe("ses_from_client");
  });
});
