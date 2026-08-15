import { describe, it, expect } from "vitest";
import { OpenCodeExecutor } from "open-sse/executors/opencode.js";

// Regression tests for the OpenCode Free (-free models) 429 fix:
// 1. versioned official User-Agent (bare "opencode" is still rate-limited by Zen)
// 2. x-real-ip forwarding so the upstream per-IP quota bucket is the user's own
// 3. per-request session isolation (singleton executor used to bleed sessions
//    across concurrent requests via the _currentSessionId instance field)
describe("OpenCodeExecutor fingerprint (free-tier 429 fix)", () => {
  it("sends the official versioned opencode User-Agent on free-tier requests", () => {
    const ex = new OpenCodeExecutor();
    const headers = ex.buildHeaders({ rawHeaders: {} });
    expect(headers["User-Agent"]).toMatch(/^opencode\//);
    expect(headers["User-Agent"]).not.toBe("opencode");
  });

  it("passes through a real opencode downstream User-Agent untouched", () => {
    const ex = new OpenCodeExecutor();
    const headers = ex.buildHeaders({ rawHeaders: { "user-agent": "opencode/1.18.18" } });
    expect(headers["User-Agent"]).toBe("opencode/1.18.18");
  });

  it("forwards the sanitized peer IP as x-real-ip for per-IP quota buckets", () => {
    const ex = new OpenCodeExecutor();
    const headers = ex.buildHeaders({ rawHeaders: { "x-9r-real-ip": "203.0.113.7" } });
    expect(headers["x-real-ip"]).toBe("203.0.113.7");
  });

  it("falls back to the client-supplied x-real-ip when the server did not stamp one", () => {
    const ex = new OpenCodeExecutor();
    const headers = ex.buildHeaders({ rawHeaders: { "x-real-ip": "198.51.100.9" } });
    expect(headers["x-real-ip"]).toBe("198.51.100.9");
  });

  it("omits x-real-ip when no client IP is known", () => {
    const ex = new OpenCodeExecutor();
    const headers = ex.buildHeaders({ rawHeaders: {} });
    expect(headers["x-real-ip"]).toBeUndefined();
  });

  it("keeps sessions per-request under concurrency (no singleton bleed)", () => {
    const ex = new OpenCodeExecutor();
    const body = { messages: [{ role: "user", content: "hi" }] };
    const credA = { rawHeaders: { "x-client-request-id": "conv-a" } };
    const credB = { rawHeaders: { "x-client-request-id": "conv-b" } };

    ex.transformRequest("deepseek-v4-flash-free", body, true, credA);
    const hA = ex.buildHeaders(credA);
    ex.transformRequest("deepseek-v4-flash-free", body, true, credB);
    const hB = ex.buildHeaders(credB);
    // A's next turn must NOT pick up B's session (old code: instance field bleed)
    ex.transformRequest("deepseek-v4-flash-free", body, true, credA);
    const hA2 = ex.buildHeaders(credA);

    expect(hA["x-opencode-session"]).toBe(hA2["x-opencode-session"]);
    expect(hA["x-opencode-session"]).not.toBe(hB["x-opencode-session"]);
    expect(hB["x-opencode-session"]).toMatch(/^ses_/);
  });

  it("keeps a stable session per conversation via client session headers", () => {
    const ex = new OpenCodeExecutor();
    const body = { messages: [{ role: "user", content: "hi" }] };
    const cred = { rawHeaders: { "x-session-id": "ses_abc" } };
    ex.transformRequest("deepseek-v4-flash-free", body, true, cred);
    const h1 = ex.buildHeaders(cred);
    ex.transformRequest("deepseek-v4-flash-free", body, true, cred);
    const h2 = ex.buildHeaders(cred);
    expect(h1["x-opencode-session"]).toBe(h2["x-opencode-session"]);
  });
});
