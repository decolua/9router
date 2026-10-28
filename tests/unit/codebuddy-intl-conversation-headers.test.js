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

  it("treats blank values as absent", () => {
    const out = withConversationHeaders({ "X-Conversation-ID": "   " }, body);
    expect(out["X-Conversation-ID"]).toMatch(UUID_RE);
  });
});

// HTTP header names are case-insensitive. A caller that already sent a
// lowercase key must be recognised, or a second key is added and undici joins
// both into one comma-separated value, corrupting the id the caller supplied.
describe("header lookup is case-insensitive", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };

  it("does not duplicate a caller's lowercase conversation id", () => {
    const out = withConversationHeaders({ "x-conversation-id": "caller-lower" }, body);
    const idKeys = Object.keys(out).filter((k) => k.toLowerCase() === "x-conversation-id");
    expect(idKeys).toHaveLength(1);
    expect(out["x-conversation-id"]).toBe("caller-lower");
  });

  it("does not duplicate a caller's mixed-case message id", () => {
    const out = withConversationHeaders({ "X-Conversation-Message-Id": "caller-mixed" }, body);
    const msgKeys = Object.keys(out).filter((k) => k.toLowerCase() === "x-conversation-message-id");
    expect(msgKeys).toHaveLength(1);
    expect(out["X-Request-ID"]).toBe("caller-mixed");
  });

  it("recognises a lowercase X-Request-ID when mirroring", () => {
    const out = withConversationHeaders({ "x-request-id": "caller-trace" }, body);
    expect(out["x-request-id"]).toBe("caller-trace");
    expect(out["X-Conversation-Message-ID"]).toBe("caller-trace");
  });

  it("fills a fetch Headers instance instead of adding plain properties", () => {
    const h = new Headers({ "x-conversation-id": "caller-lower" });
    const out = withConversationHeaders(h, body);
    expect(out.get("X-Conversation-ID")).toBe("caller-lower");
    expect(out.get("X-Conversation-Request-ID")).toBeTruthy();
    expect(out.get("X-Conversation-Message-ID")).toBeTruthy();
    expect(out["X-Conversation-ID"]).toBeUndefined();
  });
});

// buildHeaders fails CLOSED: a request without the family is refused by the
// gateway every time, so a silent fall-through would be a 100%-failure with no
// cause. The throw must name the gate instead.
describe("buildHeaders fails closed when the family cannot be attached", () => {
  const exec = new CodeBuddyIntlExecutor();

  it("throws a message that names the gate, not a bare TypeError", () => {
    const realKeys = Object.keys;
    try {
      Object.keys = () => { throw new Error("simulated hostile headers"); };
      let caught = null;
      try {
        exec.buildHeaders({ accessToken: "x" }, true, URL_, "m", { messages: [] });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toMatch(/channel verification/i);
      expect(caught.message).toMatch(/X-Conversation/);
      expect(caught.message).toMatch(/11128/);
    } finally {
      Object.keys = realKeys;
    }
  });
});

describe("parseError classifies the 11128 variants", () => {
  const exec = new CodeBuddyIntlExecutor();
  const res = (status = 400) => ({ status });

  it("names channel verification for the conversation-id variant", () => {
    const body = JSON.stringify({
      code: 11128,
      msg: "conversation id missing",
      displayTips: { en: "This call failed channel verification" },
    });
    const out = exec.parseError(res(), body);
    expect(out.status).toBe(400);
    expect(out.message).toMatch(/channel verification/i);
    expect(out.message).toMatch(/X-Conversation/);
  });

  it("does NOT claim channel verification for the system-prompt variant", () => {
    const body = JSON.stringify({ code: 11128, msg: "first message is not system prompt" });
    const out = exec.parseError(res(), body);
    expect(out.message).not.toMatch(/channel verification/i);
  });

  it("still maps the frequency-limit code to 429", () => {
    const body = JSON.stringify({ code: 6004, msg: "超出频率限制 2026-10-16 10:00:00 UTC+8" });
    const out = exec.parseError(res(429), body);
    expect(out.status).toBe(429);
    expect(out.resetsAtMs).toBeGreaterThan(0);
  });
});
