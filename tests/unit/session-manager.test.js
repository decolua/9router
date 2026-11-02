// A2: locks resolveSessionId priority/stickiness (codex/kiro/antigravity centralization).
import { describe, it, expect, beforeEach } from "vitest";
import { resolveContinuationId, resolveSessionId, resolveSessionIdentity, deriveSessionId, clearSessionStore } from "../../open-sse/utils/sessionManager.js";

// Assistant text must reach ASSISTANT_MIN_LEN (80) to use assistant anchor; else first user message.
const longAssistant = "x".repeat(80);
const bodyWithAssistant = { messages: [{ role: "assistant", content: longAssistant }] };
const bodyWithUserOnly = { messages: [{ role: "user", content: "hello from first user message anchor" }] };

beforeEach(() => {
  clearSessionStore();
});

describe("resolveSessionId", () => {
  it("stickiness: same body+connectionId+scope -> same id", () => {
    const opts = { body: bodyWithAssistant, connectionId: "conn1", scope: "codex" };
    expect(resolveSessionId(opts)).toBe(resolveSessionId(opts));
  });

  it("different connectionId -> different id", () => {
    const a = resolveSessionId({ body: bodyWithAssistant, connectionId: "connA", scope: "codex" });
    const b = resolveSessionId({ body: bodyWithAssistant, connectionId: "connB", scope: "codex" });
    expect(a).not.toBe(b);
  });

  it("different scope -> different id", () => {
    const a = resolveSessionId({ body: bodyWithAssistant, connectionId: "conn1", scope: "codex" });
    const b = resolveSessionId({ body: bodyWithAssistant, connectionId: "conn1", scope: "kiro" });
    expect(a).not.toBe(b);
  });

  it("first user message anchor when assistant text below cap", () => {
    const opts = { body: bodyWithUserOnly, connectionId: "conn1", scope: "codex" };
    expect(resolveSessionId(opts)).toBe(resolveSessionId(opts));
  });

  it("assistant anchor wins once assistant text reaches cap", () => {
    const shortAssistant = { messages: [{ role: "user", content: "same user" }, { role: "assistant", content: "y".repeat(80) }] };
    const a = resolveSessionId({ body: shortAssistant, connectionId: "conn1", scope: "codex" });
    const b = resolveSessionId({ body: shortAssistant, connectionId: "conn1", scope: "codex" });
    expect(a).toBe(b);
  });

  it("fallback: empty body+no header+no workspaceId -> deriveSessionId(connectionId)", () => {
    const got = resolveSessionId({ body: {}, connectionId: "connFallback" });
    expect(got).toBe(deriveSessionId("connFallback"));
  });

  it("client override: x-session-id header wins, skips later steps", () => {
    const got = resolveSessionId({
      headers: { "x-session-id": "client-sess-123" },
      body: bodyWithAssistant,
      connectionId: "conn1",
      workspaceId: "ws1",
      scope: "codex",
    });
    expect(got).toBe("client-sess-123");
  });

  it("does not treat request-scoped x-client-request-id as a session override", () => {
    const first = resolveSessionId({
      headers: { "x-client-request-id": "req-1" },
      body: bodyWithUserOnly,
      connectionId: "conn1",
      scope: "kiro",
    });
    const second = resolveSessionId({
      headers: { "x-client-request-id": "req-2" },
      body: bodyWithUserOnly,
      connectionId: "conn1",
      scope: "kiro",
    });

    expect(first).not.toBe("req-1");
    expect(second).not.toBe("req-2");
    expect(first).not.toBe(second);
  });

  it("does not treat request-scoped previous_response_id as a Kiro session override", () => {
    const first = resolveSessionId({
      body: { ...bodyWithUserOnly, previous_response_id: "resp-1" },
      connectionId: "conn1",
      scope: "kiro",
    });
    const second = resolveSessionId({
      body: { ...bodyWithUserOnly, previous_response_id: "resp-2" },
      connectionId: "conn1",
      scope: "kiro",
    });

    expect(first).not.toBe("resp-1");
    expect(second).not.toBe("resp-2");
    expect(first).not.toBe(second);
  });

  it("does not treat raw metadata.user_id as a Kiro conversation session", () => {
    const first = resolveSessionId({
      body: {
        metadata: { user_id: "user-123" },
        messages: [{ role: "user", content: "new chat about invoices" }],
      },
      connectionId: "conn1",
      scope: "kiro",
    });
    const second = resolveSessionId({
      body: {
        metadata: { user_id: "user-123" },
        messages: [{ role: "user", content: "unrelated new chat about refunds" }],
      },
      connectionId: "conn1",
      scope: "kiro",
    });

    expect(first).not.toBe("user-123");
    expect(second).not.toBe("user-123");
    expect(first).not.toBe(second);
  });

  it("keeps Claude Code session_id metadata as a Kiro conversation session", () => {
    const body = {
      metadata: { user_id: JSON.stringify({ session_id: "claude-code-session-123" }) },
      messages: [{ role: "user", content: "same Claude Code session" }],
    };

    expect(resolveSessionId({ body, connectionId: "conn1", scope: "kiro" })).toBe("claude:claude-code-session-123");
  });

  it("keeps raw metadata.user_id as a non-Kiro session fallback", () => {
    const got = resolveSessionId({
      body: {
        metadata: { user_id: "user-123" },
        messages: [{ role: "user", content: "non-Kiro provider" }],
      },
      connectionId: "conn1",
      scope: "codex",
    });

    expect(got).toBe("user-123");
  });

  it("keeps x-client-request-id as a session override outside Kiro scope", () => {
    const got = resolveSessionId({
      headers: { "x-client-request-id": "req-1" },
      body: bodyWithAssistant,
      connectionId: "conn1",
      scope: "codex",
    });

    expect(got).toBe("req-1");
  });


  it("workspaceId path: empty body + workspaceId set -> normalized workspaceId", () => {
    const got = resolveSessionId({ body: {}, connectionId: "conn1", workspaceId: "ws-abc" });
    expect(got).toBe("ws-abc");
  });

  it("uses fresh Kiro sessions for unrelated headerless requests on the same connection", () => {
    const a = resolveSessionId({ body: bodyWithUserOnly, connectionId: "conn1", scope: "kiro" });
    const b = resolveSessionId({ body: bodyWithUserOnly, connectionId: "conn1", scope: "kiro" });
    expect(a).not.toBe(b);
  });

  it("marks generated headerless Kiro sessions as ephemeral", () => {
    const generated = resolveSessionIdentity({ body: bodyWithUserOnly, connectionId: "conn1", scope: "kiro" });
    const explicit = resolveSessionIdentity({
      headers: { "x-session-id": "client-sess-123" },
      body: bodyWithUserOnly,
      connectionId: "conn1",
      scope: "kiro",
    });

    expect(generated.ephemeral).toBe(true);
    expect(explicit).toEqual({ sessionId: "client-sess-123", ephemeral: false });
  });

  it("does not switch Kiro headerless requests to assistant-text session ids mid-conversation", () => {
    const withAssistant = { messages: [{ role: "user", content: "same user" }, { role: "assistant", content: "y".repeat(80) }] };
    const a = resolveSessionId({ body: withAssistant, connectionId: "conn1", scope: "kiro" });
    const b = resolveSessionId({ body: withAssistant, connectionId: "conn1", scope: "kiro" });
    expect(a).not.toBe(b);
  });
});

describe("resolveContinuationId", () => {
  it("keeps continuation id stable for the same Kiro session", () => {
    const opts = { sessionId: "kiro-session-1", connectionId: "conn1", scope: "kiro" };
    expect(resolveContinuationId(opts)).toBe(resolveContinuationId(opts));
  });

  it("uses a different continuation id for a different Kiro session", () => {
    const a = resolveContinuationId({ sessionId: "kiro-session-1", connectionId: "conn1", scope: "kiro" });
    const b = resolveContinuationId({ sessionId: "kiro-session-2", connectionId: "conn1", scope: "kiro" });
    expect(a).not.toBe(b);
  });

  it("does not evict a recently used continuation id when the store exceeds its cap", () => {
    const first = resolveContinuationId({ sessionId: "kiro-session-0", connectionId: "conn1", scope: "kiro" });
    for (let i = 1; i < 5000; i++) {
      resolveContinuationId({ sessionId: `kiro-session-${i}`, connectionId: "conn1", scope: "kiro" });
    }
    expect(resolveContinuationId({ sessionId: "kiro-session-0", connectionId: "conn1", scope: "kiro" })).toBe(first);
    resolveContinuationId({ sessionId: "kiro-session-5000", connectionId: "conn1", scope: "kiro" });

    expect(resolveContinuationId({ sessionId: "kiro-session-0", connectionId: "conn1", scope: "kiro" })).toBe(first);
  });

  it("evicts old continuation ids when the store exceeds its cap", () => {
    const first = resolveContinuationId({ sessionId: "kiro-session-0", connectionId: "conn1", scope: "kiro" });
    for (let i = 1; i <= 5000; i++) {
      resolveContinuationId({ sessionId: `kiro-session-${i}`, connectionId: "conn1", scope: "kiro" });
    }

    const afterEviction = resolveContinuationId({ sessionId: "kiro-session-0", connectionId: "conn1", scope: "kiro" });
    expect(afterEviction).not.toBe(first);
  });

  it("does not let ephemeral Kiro continuations evict explicit session continuations", () => {
    const stable = resolveContinuationId({ sessionId: "explicit-session", connectionId: "conn1", scope: "kiro" });
    for (let i = 0; i <= 5000; i++) {
      resolveContinuationId({ sessionId: `ephemeral-session-${i}`, connectionId: "conn1", scope: "kiro", ephemeral: true });
    }

    expect(resolveContinuationId({ sessionId: "explicit-session", connectionId: "conn1", scope: "kiro" })).toBe(stable);
  });
});
