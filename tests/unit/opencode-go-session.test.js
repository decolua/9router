import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const TRANSPORTS = [
  { format: "openai", baseUrl: "https://opencode.ai/zen/go/v1/chat/completions" },
  { format: "claude", baseUrl: "https://opencode.ai/zen/go/v1/messages" },
  { format: "openai-responses", baseUrl: "https://opencode.ai/zen/go/v1/responses" },
];

function request(executor, {
  session = "conversation-a",
  connectionId = "connection-a",
  transport = TRANSPORTS[0],
  rawHeaders = { "x-session-id": session },
} = {}) {
  const credentials = { apiKey: "test-key", connectionId, rawHeaders, runtimeTransport: transport };
  executor.transformRequest(
    "muse-spark-1.3-contributor",
    { messages: [{ role: "user", content: "hello" }] },
    true,
    credentials,
  );
  return { credentials, headers: executor.buildHeaders(credentials, true) };
}

describe("OpenCode Go x-opencode-session", () => {
  it("sends the same opaque session on Chat, Messages, and Responses transports", () => {
    const executor = new DefaultExecutor("opencode-go");
    const values = TRANSPORTS.map((transport) => request(executor, { transport }).headers["x-opencode-session"]);
    expect(new Set(values).size).toBe(1);
    expect(values[0]).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(values[0]).not.toContain("conversation-a");
  });

  it("keeps one explicit conversation stable and separates different conversations", () => {
    const executor = new DefaultExecutor("opencode-go");
    const a1 = request(executor, { session: "conversation-a" }).headers["x-opencode-session"];
    const a2 = request(executor, { session: "conversation-a" }).headers["x-opencode-session"];
    const b = request(executor, { session: "conversation-b" }).headers["x-opencode-session"];
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("ignores inbound x-opencode-session (caller cannot influence provider-owned output)", () => {
    const executor = new DefaultExecutor("opencode-go");
    const body = { messages: [{ role: "user", content: "hello" }] };
    const connectionId = "conn-ignore-x-header";
    const baseHeaders = { "x-session-id": "conversation-a" };
    const injectedHeaders = { "x-session-id": "conversation-a", "x-opencode-session": "caller-controlled-session", "X-OpenCode-Session": "ATTACKER" };
    // baseline: without injected header
    const baseCreds = { apiKey: "test-key", connectionId, rawHeaders: baseHeaders, runtimeTransport: TRANSPORTS[0] };
    executor.transformRequest("muse-spark-1.3-contributor", body, true, baseCreds);
    const baseline = executor.buildHeaders(baseCreds, true)["x-opencode-session"];
    // with injected header: must produce same provider-owned output
    const injectedCreds = { apiKey: "test-key", connectionId, rawHeaders: injectedHeaders, runtimeTransport: TRANSPORTS[0] };
    executor.transformRequest("muse-spark-1.3-contributor", body, true, injectedCreds);
    const withInjected = executor.buildHeaders(injectedCreds, true)["x-opencode-session"];
    expect(baseline).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(withInjected).toBe(baseline);
    expect(withInjected).not.toContain("caller-controlled-session");
    expect(withInjected).not.toContain("ATTACKER");
    // also case-insensitive variant alone must be ignored
    const lowerCreds = { apiKey: "test-key", connectionId, rawHeaders: { "x-session-id": "conversation-a", "X-OPENCODE-SESSION": "lowercase-attack" }, runtimeTransport: TRANSPORTS[0] };
    executor.transformRequest("muse-spark-1.3-contributor", body, true, lowerCreds);
    expect(executor.buildHeaders(lowerCreds, true)["x-opencode-session"]).toBe(baseline);
  });

  it("ignores _clientSessionId (target-format scoped, violates provider isolation)", () => {
    const executor = new DefaultExecutor("opencode-go");
    const body = { messages: [{ role: "user", content: "hello" }] };
    const connectionId = "conn-ignore-client-session";
    const rawHeaders = { "x-session-id": "conversation-a" };
    const baseCreds = { apiKey: "test-key", connectionId, rawHeaders, runtimeTransport: TRANSPORTS[0] };
    executor.transformRequest("muse-spark-1.3-contributor", body, true, baseCreds);
    const baseline = executor.buildHeaders(baseCreds, true)["x-opencode-session"];
    // same connection/body but with target-format scoped _clientSessionId
    const poisonedCreds = { apiKey: "test-key", connectionId, rawHeaders, runtimeTransport: TRANSPORTS[0], _clientSessionId: "format-scoped-session-leak" };
    executor.transformRequest("muse-spark-1.3-contributor", body, true, poisonedCreds);
    const poisoned = executor.buildHeaders(poisonedCreds, true)["x-opencode-session"];
    expect(baseline).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(poisoned).toBe(baseline);
    expect(poisoned).not.toContain("format-scoped-session-leak");
  });

  it("uses a stable opaque per-connection fallback when the client has no session", () => {
    const executor = new DefaultExecutor("opencode-go");
    const first = request(executor, { rawHeaders: {}, connectionId: "connection-fallback" }).headers["x-opencode-session"];
    const second = request(executor, { rawHeaders: {}, connectionId: "connection-fallback" }).headers["x-opencode-session"];
    expect(first).toBe(second);
    expect(first).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(first).not.toContain("connection-fallback");
  });

  it("keeps session state on request credentials without singleton bleed", () => {
    const executor = new DefaultExecutor("opencode-go");
    const a = request(executor, { session: "conversation-a" });
    const b = request(executor, { session: "conversation-b" });
    expect(executor.buildHeaders(a.credentials, true)["x-opencode-session"]).toBe(a.headers["x-opencode-session"]);
    expect(a.headers["x-opencode-session"]).not.toBe(b.headers["x-opencode-session"]);
  });

  it("does not add the header to another DefaultExecutor provider", () => {
    expect(request(new DefaultExecutor("openai")).headers["x-opencode-session"]).toBeUndefined();
  });

  it("leaves OpenCode Free specialized session behavior intact", () => {
    const executor = new OpenCodeExecutor();
    const credentials = { rawHeaders: { "x-session-id": "free-conversation" }, connectionId: "free" };
    executor.transformRequest(
      "muse-spark-1.3-contributor-free",
      { input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }] },
      true,
      credentials,
    );
    const header = executor.buildHeaders(credentials)["x-opencode-session"];
    expect(header).toMatch(/^ses_/);
    expect(header).not.toBe("free-conversation");
  });
});
