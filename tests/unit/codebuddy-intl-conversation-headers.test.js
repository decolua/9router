// The intl gateway's channel verification rejects requests without the
// X-Conversation-* header family with HTTP 400 code 11128 "conversation id
// missing". The official IDE sends a conversation id derived stably from the
// session key plus fresh per-request/per-message ids, and mirrors the message
// id on X-Request-ID.
import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor, withConversationHeaders } from "../../open-sse/executors/codebuddy-intl.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_ = "https://www.codebuddy.ai/v2/chat/completions";

describe("CodeBuddyIntlExecutor sends the X-Conversation-* family", () => {
  const exec = new CodeBuddyIntlExecutor();
  const creds = { accessToken: "***" };

  it("always sets the three required headers", () => {
    const h = exec.buildHeaders(creds, true, URL_, "glm-5.2", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Request-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Message-ID"]).toMatch(UUID_RE);
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Message-ID"]);
  });

  it("keeps the conversation id stable across retries of the same turn", () => {
    const body = { messages: [{ role: "user", content: "same opening message" }] };
    const a = exec.buildHeaders(creds, true, URL_, "m", body);
    const b = exec.buildHeaders(creds, true, URL_, "m", body);
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
    // per-request ids must stay fresh between separate builds
    expect(a["X-Conversation-Request-ID"]).not.toBe(b["X-Conversation-Request-ID"]);
    expect(a["X-Conversation-Message-ID"]).not.toBe(b["X-Conversation-Message-ID"]);
  });

  it("prefers an explicit session id over the message-derived key", () => {
    const a = exec.buildHeaders(creds, true, URL_, "m", {
      session_id: "sess-123",
      messages: [{ role: "user", content: "hi" }],
    });
    const b = exec.buildHeaders(creds, true, URL_, "m", {
      session_id: "sess-456",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(a["X-Conversation-ID"]).not.toBe(b["X-Conversation-ID"]);
  });

  it("supports typed-block user content for the derived key", () => {
    const h = exec.buildHeaders(creds, true, URL_, "m", {
      messages: [{ role: "user", content: [{ type: "text", text: "typed block" }] }],
    });
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
  });

  it("falls back to a random uuid when there is nothing to derive from", () => {
    const h = exec.buildHeaders(creds, true, URL_, "m", { messages: [] });
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
  });

  it("does not throw on a missing or null body", () => {
    for (const body of [undefined, null]) {
      const h = exec.buildHeaders(creds, true, URL_, "m", body);
      expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
    }
  });
});

// The per-request ids are fresh per *build*, and a second pass over an already
// built bag must NOT rotate them: base.js retries an attempt with the same
// headers, where a stable pair is what the gateway expects.
describe("idempotency of a second pass over the same header bag", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };

  it("keeps every id when re-run on the same bag", () => {
    const first = withConversationHeaders({}, body);
    const second = withConversationHeaders({ ...first }, body);
    expect(second["X-Conversation-ID"]).toBe(first["X-Conversation-ID"]);
    expect(second["X-Conversation-Request-ID"]).toBe(first["X-Conversation-Request-ID"]);
    expect(second["X-Conversation-Message-ID"]).toBe(first["X-Conversation-Message-ID"]);
    expect(second["X-Request-ID"]).toBe(first["X-Request-ID"]);
  });
});

describe("caller-supplied ids are preserved", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };

  it("keeps non-empty values and only fills the gaps", () => {
    const out = withConversationHeaders(
      {
        "X-Conversation-ID": "11111111-1111-1111-1111-111111111111",
        "X-Conversation-Message-ID": "fixed-message-id",
      },
      body,
    );
    expect(out["X-Conversation-ID"]).toBe("11111111-1111-1111-1111-111111111111");
    expect(out["X-Conversation-Message-ID"]).toBe("fixed-message-id");
    expect(out["X-Request-ID"]).toBe("fixed-message-id");
    expect(out["X-Conversation-Request-ID"]).toMatch(UUID_RE);
  });

  it("blank caller values are treated as absent and replaced", () => {
    const out = withConversationHeaders(
      {
        "X-Conversation-ID": "",
        "X-Conversation-Message-ID": "   ",
      },
      body,
    );
    expect(out["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(out["X-Conversation-Message-ID"]).toMatch(UUID_RE);
  });
});

describe("case-insensitive header handling", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };

  it("reads caller ids regardless of case", () => {
    const out = withConversationHeaders(
      {
        "x-conversation-id": "lowercase-id",
        "X-CONVERSATION-MESSAGE-ID": "uppercase-mid",
      },
      body,
    );
    expect(out["X-Conversation-ID"]).toBe("lowercase-id");
    expect(out["X-Conversation-Message-ID"]).toBe("uppercase-mid");
  });

  it("does not duplicate headers when case differs", () => {
    const out = withConversationHeaders(
      {
        "x-conversation-id": "existing-id",
      },
      body,
    );
    const keys = Object.keys(out).filter((k) => k.toLowerCase() === "x-conversation-id");
    expect(keys).toHaveLength(1);
  });

  it("writes with canonical casing", () => {
    const out = withConversationHeaders({}, body);
    expect(out["X-Conversation-ID"]).toBeDefined();
    expect(out["x-conversation-id"]).toBeUndefined();
  });
});

describe("parseError recognises the channel verification gate", () => {
  const exec = new CodeBuddyIntlExecutor();

  it("returns a clear error for 11128 conversation id missing", () => {
    const bodyText = JSON.stringify({
      code: 11128,
      msg: "conversation id missing",
      displayTips: { en: "Please use official client" },
    });
    const res = exec.parseError({ status: 400 }, bodyText);
    expect(res.status).toBe(400);
    expect(res.message).toContain("channel verification failed");
    expect(res.message).toContain("11128");
    expect(res.message).toContain("X-Conversation-*");
  });

  it("does not match 11128 with different message (e.g. first message not system prompt)", () => {
    const bodyText = JSON.stringify({
      code: 11128,
      msg: "first message is not system prompt",
    });
    const res = exec.parseError({ status: 400 }, bodyText);
    // Falls through to super.parseError (generic 400)
    expect(res.message).not.toContain("channel verification failed");
  });

  it("works when displayMsg is used instead of displayTips", () => {
    const bodyText = JSON.stringify({
      code: 11128,
      msg: "conversation id missing",
      displayMsg: { en: "Use official IDE" },
    });
    const res = exec.parseError({ status: 400 }, bodyText);
    expect(res.message).toContain("Upstream said: Use official IDE");
  });

  it("recognises 11128 request illegal as channel verification", () => {
    const bodyText = JSON.stringify({
      code: 11128,
      msg: "request illegal",
      displayTips: { en: "This call failed channel verification, possibly because it was not sent from an official client. Please resend from the official client." },
    });
    const res = exec.parseError({ status: 400 }, bodyText);
    expect(res.status).toBe(400);
    expect(res.message).toContain("channel verification failed");
    expect(res.message).toContain("11128");
    expect(res.message).toContain("request illegal");
    expect(res.message).toContain("X-Conversation-*");
  });
});