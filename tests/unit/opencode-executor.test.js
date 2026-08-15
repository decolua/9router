import { describe, it, expect } from "vitest";
import { OpenCodeExecutor } from "open-sse/executors/opencode.js";

describe("OpenCodeExecutor fingerprint", () => {
  it("sends the official versioned opencode User-Agent", () => {
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

  it("does not forward loopback or client-supplied x-real-ip", () => {
    const ex = new OpenCodeExecutor();
    const fromLoopback = ex.buildHeaders({ rawHeaders: { "x-9r-real-ip": "127.0.0.1" } });
    const fromClient = ex.buildHeaders({ rawHeaders: { "x-real-ip": "198.51.100.9" } });
    expect(fromLoopback["x-real-ip"]).toBeUndefined();
    expect(fromClient["x-real-ip"]).toBeUndefined();
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
    ex.transformRequest("deepseek-v4-flash-free", body, true, credA);
    const hA2 = ex.buildHeaders(credA);

    expect(hA["x-opencode-session"]).toBe(hA2["x-opencode-session"]);
    expect(hA["x-opencode-session"]).not.toBe(hB["x-opencode-session"]);
    expect(hB["x-opencode-session"]).toMatch(/^ses_/);
  });
});
