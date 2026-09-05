import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";
import { __clearHeaderCache } from "open-sse/utils/headerCache.js";
import { beforeEach } from "vitest";
beforeEach(() => __clearHeaderCache());

const BASE = "https://api.example.com/v1";
function creds(customHeaders, extra = {}) {
  return { apiKey: "sk-test", providerSpecificData: { baseUrl: BASE, apiType: "chat", customHeaders }, ...extra };
}

describe("DefaultExecutor buildHeaders — custom headers", () => {
  it("adds a new custom header", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const h = ex.buildHeaders(creds([{ name: "X-Trace", value: "abc" }]), true);
    expect(h["X-Trace"]).toBe("abc");
  });

  it("overrides a preset header case-insensitively (no duplicate)", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const h = ex.buildHeaders(creds([{ name: "content-type", value: "text/custom" }]), true);
    const keys = Object.keys(h).filter((k) => k.toLowerCase() === "content-type");
    expect(keys).toHaveLength(1);
    expect(h[keys[0]]).toBe("text/custom");
  });

  it("can override Authorization (auth override allowed by design)", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const h = ex.buildHeaders(creds([{ name: "Authorization", value: "Bearer overridden" }]), true);
    const keys = Object.keys(h).filter((k) => k.toLowerCase() === "authorization");
    expect(keys).toHaveLength(1);
    expect(h[keys[0]]).toBe("Bearer overridden");
  });

  it("{remove} deletes a preset header entirely (case-insensitive, nothing sent)", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const h = ex.buildHeaders(creds([{ name: "content-type", value: "{remove}" }]), true);
    const keys = Object.keys(h).filter((k) => k.toLowerCase() === "content-type");
    expect(keys).toHaveLength(0);
  });

  it("{remove} on a non-existent header is a no-op (header simply absent)", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const h = ex.buildHeaders(creds([{ name: "X-Absent", value: "{remove}" }]), true);
    const keys = Object.keys(h).filter((k) => k.toLowerCase() === "x-absent");
    expect(keys).toHaveLength(0);
  });

  it("can override Accept (applied after stream Accept line)", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const h = ex.buildHeaders(creds([{ name: "Accept", value: "application/json" }]), true);
    const keys = Object.keys(h).filter((k) => k.toLowerCase() === "accept");
    expect(keys).toHaveLength(1);
    expect(h[keys[0]]).toBe("application/json");
  });

  it("resolves a dynamic tag", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const h = ex.buildHeaders(creds([{ name: "X-Session", value: "sess_{ralpha_num:26}" }]), true);
    expect(h["X-Session"]).toMatch(/^sess_[a-zA-Z0-9]{26}$/);
  });

  it("no customHeaders → base headers intact", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const h = ex.buildHeaders(creds(undefined), true);
    expect(h["Content-Type"]).toBe("application/json");
    expect(h.Authorization).toBe("Bearer sk-test");
  });

  it("fail-open: a resolver throw leaves base headers intact", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    // An array whose element access throws → forces resolveCustomHeaders to throw
    // inside buildHeaders' try, exercising the fail-open catch.
    const bad = [];
    Object.defineProperty(bad, 0, { enumerable: true, get() { throw new Error("boom"); } });
    bad.length = 1;
    const h = ex.buildHeaders(creds(bad), true);
    expect(h["Content-Type"]).toBe("application/json");
    expect(h.Authorization).toBe("Bearer sk-test");
  });
});

describe("DefaultExecutor buildHeaders — persistence", () => {
  it("persistent header (ttlMinutes 0) is identical across two calls, same connection", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const c = creds([{ name: "X-Session", value: "{ralpha_num:26}", ttlMinutes: 0 }], { connectionId: "conn-1" });
    const h1 = ex.buildHeaders(c, true);
    const h2 = ex.buildHeaders(c, true);
    expect(h1["X-Session"]).toMatch(/^[a-zA-Z0-9]{26}$/);
    expect(h2["X-Session"]).toBe(h1["X-Session"]);
  });

  it("non-persistent header (no ttlMinutes) varies across calls", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const c = creds([{ name: "X-Session", value: "{ralpha_num:26}" }], { connectionId: "conn-1" });
    const a = ex.buildHeaders(c, true)["X-Session"];
    const b = ex.buildHeaders(c, true)["X-Session"];
    expect(a).not.toBe(b); // 26 random chars colliding is effectively impossible
  });

  it("different connectionId → different persistent value", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    const h1 = ex.buildHeaders(creds([{ name: "X-Session", value: "{ralpha_num:26}", ttlMinutes: 0 }], { connectionId: "conn-1" }), true);
    const h2 = ex.buildHeaders(creds([{ name: "X-Session", value: "{ralpha_num:26}", ttlMinutes: 0 }], { connectionId: "conn-2" }), true);
    expect(h2["X-Session"]).not.toBe(h1["X-Session"]);
  });

  it("does not cache a persistent header when connection identity is absent (connId=default)", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    // creds() default extra has no connectionId/email/id
    const c = creds([{ name: "X-Session", value: "{ralpha_num:26}", ttlMinutes: 0 }]);
    const a = ex.buildHeaders(c, true)["X-Session"];
    const b = ex.buildHeaders(c, true)["X-Session"];
    expect(a).not.toBe(b);
  });

  it("timed-expiry regenerates through the executor with an injected clock", () => {
    const ex = new DefaultExecutor("openai-compatible-chat-x");
    let t = 1000;
    const mk = () => creds([{ name: "X-Session", value: "{ralpha_num:26}", ttlMinutes: 5 }], { connectionId: "conn-exp", _nowForTest: () => t });
    const a = ex.buildHeaders(mk(), true)["X-Session"];
    t = 1000 + 4 * 60000; // within 5 min → cached
    const b = ex.buildHeaders(mk(), true)["X-Session"];
    expect(b).toBe(a);
    t = 1000 + 6 * 60000; // past 5 min → regenerate
    const c2 = ex.buildHeaders(mk(), true)["X-Session"];
    expect(c2).not.toBe(a);
  });
});
