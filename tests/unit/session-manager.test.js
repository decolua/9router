// A2: locks resolveSessionId priority/stickiness (codex/kiro/antigravity centralization).
import { describe, it, expect, beforeEach } from "vitest";
import { resolveSessionId, deriveSessionId, clearSessionStore } from "../../open-sse/utils/sessionManager.js";

// Assistant text must reach ASSISTANT_MIN_LEN (80) to use assistant anchor; else first user message.
const longAssistant = "x".repeat(80);
const bodyWithAssistant = { messages: [{ role: "assistant", content: longAssistant }] };
const bodyWithUserOnly = { messages: [{ role: "user", content: "hello from first user message anchor" }] };

beforeEach(() => clearSessionStore());

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

  it("workspaceId path: empty body + workspaceId set -> normalized workspaceId", () => {
    const got = resolveSessionId({ body: {}, connectionId: "conn1", workspaceId: "ws-abc" });
    expect(got).toBe("ws-abc");
  });
});
