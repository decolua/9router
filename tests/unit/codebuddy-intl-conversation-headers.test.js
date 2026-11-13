// #4892 — the intl gateway added "channel verification": requests without the
// X-Conversation-* header family are rejected with HTTP 400 code 11128
// "conversation id missing". The official IDE sends a conversation id derived
// stably from the session key plus fresh per-request/per-message UUIDs.
import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("CodeBuddyIntlExecutor sends the X-Conversation-* family (#4892)", () => {
  const exec = new CodeBuddyIntlExecutor();
  const creds = { accessToken: "***" };

  it("always sets the three headers", () => {
    const h = exec.buildHeaders(creds, true, "https://www.codebuddy.ai/v2/chat/completions", "deepseek-v4.1-flash", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Request-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Message-ID"]).toMatch(UUID_RE);
  });

  it("keeps the conversation id stable across retries of the same turn", () => {
    const body = { messages: [{ role: "user", content: "same opening message" }] };
    const a = exec.buildHeaders(creds, true, "u", "m", body);
    const b = exec.buildHeaders(creds, true, "u", "m", body);
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
    // per-request ids must stay fresh
    expect(a["X-Conversation-Request-ID"]).not.toBe(b["X-Conversation-Request-ID"]);
    expect(a["X-Conversation-Message-ID"]).not.toBe(b["X-Conversation-Message-ID"]);
  });

  it("prefers an explicit session id over message-derived key", () => {
    const body = {
      session_id: "sess-123",
      messages: [{ role: "user", content: "hi" }],
    };
    const a = exec.buildHeaders(creds, true, "u", "m", body);
    const b = exec.buildHeaders(creds, true, "u", "m", body);
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
    const c = exec.buildHeaders(creds, true, "u", "m", {
      session_id: "sess-456",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(c["X-Conversation-ID"]).not.toBe(a["X-Conversation-ID"]);
  });

  it("supports typed-block user content for the derived key", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "typed block" }] }],
    };
    const h = exec.buildHeaders(creds, true, "u", "m", body);
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
  });

  it("falls back to a random uuid when there is nothing to derive from", () => {
    const h = exec.buildHeaders(creds, true, "u", "m", { messages: [] });
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
  });
});
