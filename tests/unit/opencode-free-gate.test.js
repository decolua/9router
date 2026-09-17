// OpenCode Free gate: the free Zen tier classifies traffic by client identity.
// These lock the identity contract emitted by the public OpenCodeExecutor
// surface (prepareRequestCredentials/transformRequest → buildHeaders) so a bare
// `opencode` UA or a non-`ses_` session id can't silently regress the gate.
import { describe, expect, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const RESPONSES_MODEL = "muse-spark-1.2-contributor-free";
const CHAT_MODEL = "big-pickle";
const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const UA_RE = /^opencode\/(\d+)\.(\d+)(?:\.\d+)?(?:\s|$)/;
const NATIVE_SESSION = "ses_0123456789abABCDEFGHIJKLMN";

function requestBody() {
  return { messages: [{ role: "user", content: "hello" }] };
}

// Mirrors the executor pipeline: prepareRequestCredentials resolves the session
// identity, transformRequest may attach it, and buildHeaders emits it upstream.
function prepare(credentials = {}, body = requestBody()) {
  const executor = new OpenCodeExecutor();
  const prepared = executor.prepareRequestCredentials({ body, credentials });
  return { executor, prepared, body };
}

function emitSession(credentials = {}, model = RESPONSES_MODEL) {
  const { executor, prepared, body } = prepare(credentials);
  executor.transformRequest(model, body, true, prepared);
  return executor.buildHeaders(prepared, true)["x-opencode-session"];
}

function emitUserAgent(rawHeaders = {}) {
  return new OpenCodeExecutor().buildHeaders({ rawHeaders }, true)["User-Agent"];
}

function uaVersionAtLeast(ua, major, minor) {
  const match = String(ua).match(UA_RE);
  if (!match) return false;
  const gotMajor = Number(match[1]);
  const gotMinor = Number(match[2]);
  return gotMajor > major || (gotMajor === major && gotMinor >= minor);
}

describe("OpenCode Free gate session id", () => {
  it("emits a gate-shaped x-opencode-session", () => {
    expect(emitSession({ connectionId: "gate-session-a" })).toMatch(SESSION_RE);
    expect(emitSession({ connectionId: "gate-session-a" }, CHAT_MODEL)).toMatch(SESSION_RE);
  });

  it("keeps the same conversation identity stable", () => {
    const first = emitSession({ connectionId: "gate-stable" });
    const second = emitSession({ connectionId: "gate-stable" });

    expect(first).toMatch(SESSION_RE);
    expect(second).toBe(first);
  });

  it("isolates different conversation identities", () => {
    const a = emitSession({ connectionId: "gate-conversation-a" });
    const b = emitSession({ connectionId: "gate-conversation-b" });

    expect(a).toMatch(SESSION_RE);
    expect(b).toMatch(SESSION_RE);
    expect(a).not.toBe(b);
  });

  it("preserves a valid native session header case-insensitively", () => {
    const emitted = emitSession({ rawHeaders: { "X-OpenCode-Session": NATIVE_SESSION } });
    expect(emitted).toBe(NATIVE_SESSION);
  });

  it("replaces an invalid native session header", () => {
    const emitted = emitSession({ rawHeaders: { "x-opencode-session": "not-a-session" } });

    expect(emitted).not.toBe("not-a-session");
    expect(emitted).toMatch(SESSION_RE);
  });
});

describe("OpenCode Free gate User-Agent", () => {
  it("defaults to a gate-compatible opencode/<version> UA, not bare opencode", () => {
    const ua = emitUserAgent();

    expect(ua).not.toBe("opencode");
    expect(ua).toMatch(UA_RE);
    expect(uaVersionAtLeast(ua, 1, 17)).toBe(true);
  });

  it("preserves a compatible downstream OpenCode UA", () => {
    expect(emitUserAgent({ "user-agent": "opencode/1.17.5" })).toBe("opencode/1.17.5");
  });

  it("replaces bare, stale and incompatible UAs", () => {
    for (const ua of ["opencode", "opencode/1.16.9", "Mozilla/5.0 (Macintosh)"]) {
      const emitted = emitUserAgent({ "user-agent": ua });
      expect(emitted).not.toBe(ua);
      expect(emitted).toMatch(UA_RE);
      expect(uaVersionAtLeast(emitted, 1, 17)).toBe(true);
    }
  });
});

describe("OpenCode Free gate prompt caching", () => {
  it("sets prompt_cache_key to the emitted session on Responses requests when absent", () => {
    const { executor, prepared, body } = prepare({ connectionId: "gate-cache" });

    executor.transformRequest(RESPONSES_MODEL, body, true, prepared);
    const session = executor.buildHeaders(prepared, true)["x-opencode-session"];

    expect(body.prompt_cache_key).toBe(session);
    expect(body.prompt_cache_key).toMatch(SESSION_RE);
  });

  it("leaves chat/completions bodies without prompt_cache_key", () => {
    const { executor, prepared, body } = prepare({ connectionId: "gate-cache-chat" });

    executor.transformRequest(CHAT_MODEL, body, true, prepared);

    expect(body.prompt_cache_key).toBeUndefined();
  });
});
