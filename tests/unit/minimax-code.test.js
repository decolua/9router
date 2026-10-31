// MiniMax Code (mcode) provider — registry wiring, thinking mapping, OAuth
// device flow module, refresh discipline, and quota-error normalization.
// Protocol reference: docs/minimax-code-proxy-plan.md (reverse-engineered from
// @magpie-community/opencode-minimax-auth 0.1.1).
import { afterEach, describe, expect, it, vi } from "vitest";

// ── pure modules (no @/ or db deps) ─────────────────────────────────────────
import { PROVIDERS, PROVIDER_OAUTH } from "../../open-sse/config/providers.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { createMinimaxCodeProvider } from "../../src/lib/oauth/providers/minimax-code-shared.js";

// ── executor under test (mock the heavy base + its refresh import) ──────────
class StubBase {
  constructor(provider) { this.provider = provider; }
  async execute() { return { response: new Response("{}", { status: 200 }) }; }
}
vi.mock("../../open-sse/executors/default.js", () => ({
  DefaultExecutor: StubBase,
}));
const refreshMiniMaxMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshMiniMaxCodeToken: refreshMiniMaxMock,
}));

const { MinimaxCodeExecutor, normalizeQuotaResponse } = await import("../../open-sse/executors/minimax-code.js");
const { getExecutor } = await import("../../open-sse/executors/index.js");
// The real refresh handler (vi.importActual bypasses the mock above — it is
// only in place to intercept the executor's import).
const { refreshMiniMaxCodeToken } = await vi.importActual("../../open-sse/services/tokenRefresh.js");

describe("minimax-code registry wiring", () => {
  it("declares claude transport with adaptive thinking and combined bearer auth", () => {
    const t = PROVIDERS["minimax-code"];
    expect(t.format).toBe("claude");
    expect(t.thinkingFormat).toBe("claude-adaptive");
    expect(t.baseUrl).toBe("https://agent.minimax.cn/mavis/api/v1/llm/v1/messages");
    expect(t.auth.combined).toBe(true);
    expect(t.auth.scheme).toBe("bearer");
    expect(t.auth.hooks).toContain("minimaxHeaders");
    expect(t.auth.anthropicVersion).toBe(true);
    expect(t.headers["User-Agent"]).toBe("MiniMaxAgent");
    expect(t.headers["X-Mavis-Agent-Id"]).toBe("main");
  });

  it("global site points at agent.minimax.io with its own alias", () => {
    const t = PROVIDERS["minimax-code-global"];
    expect(t.baseUrl).toBe("https://agent.minimax.io/mavis/api/v1/llm/v1/messages");
    expect(t.thinkingFormat).toBe("claude-adaptive");
    expect(PROVIDER_OAUTH["minimax-code"].tokenUrl).toBe("https://account.minimax.cn/oauth2/token");
    expect(PROVIDER_OAUTH["minimax-code-global"].tokenUrl).toBe("https://account.minimax.io/oauth2/token");
    expect(PROVIDER_OAUTH["minimax-code"].refreshLeadMs).toBe(10 * 60 * 1000);
  });
});

describe("minimax-code capabilities + thinking levels", () => {
  it("M3.1-Flash-Preview is forced-adaptive with the five efforts and vision", () => {
    const caps = getCapabilitiesForModel("minimax-code", "MiniMax-M3.1-Flash-Preview");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("claude-adaptive");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.vision).toBe(true);
    expect(getThinkingLevels("minimax-code", "MiniMax-M3.1-Flash-Preview")).toEqual([
      "low", "medium", "high", "xhigh", "max",
    ]);
  });

  it("M3 is switchable (none allowed), M2.7 pair cannot disable", () => {
    expect(getThinkingLevels("minimax-code", "MiniMax-M3")).toEqual(["none", "high"]);
    expect(getCapabilitiesForModel("minimax-code", "MiniMax-M2.7").thinkingCanDisable).toBe(false);
    expect(getThinkingLevels("minimax-code", "MiniMax-M2.7")).not.toContain("none");
  });

  it("global provider shares the capability table", () => {
    expect(getCapabilitiesForModel("minimax-code-global", "MiniMax-M3.1-Flash-Preview").thinkingFormat).toBe("claude-adaptive");
  });
});

describe("minimax-code thinking → wire body (claude-adaptive)", () => {
  it("maps an effort level to the permanent-adaptive wire shape (effort only)", () => {
    // M3.1 cannot disable thinking (like Fable 5.1): the claude-adaptive branch
    // drops the thinking object and sends output_config.effort alone — the
    // same shape MiniMax Code's own client puts on the wire.
    const body = { model: "MiniMax-M3.1-Flash-Preview", messages: [] };
    applyThinking("claude", "MiniMax-M3.1-Flash-Preview(xhigh)", body, "minimax-code");
    expect(body.thinking).toBeUndefined();
    expect(body.output_config.effort).toBe("xhigh");
  });

  it("keeps an advertised level verbatim (xhigh is in M3.1's efforts)", () => {
    const body = { model: "MiniMax-M3.1-Flash-Preview", messages: [] };
    applyThinking("claude", "MiniMax-M3.1-Flash-Preview(xhigh)", body, "minimax-code");
    expect(body.output_config.effort).toBe("xhigh");
  });

  it("maps none on a switchable model to disabled thinking without effort", () => {
    const body = { model: "MiniMax-M3", messages: [] };
    applyThinking("claude", "MiniMax-M3(none)", body, "minimax-code");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toBeUndefined();
  });

  it("a switchable model's effort keeps the adaptive switch on the wire", () => {
    // canDisable → thinking {type:"adaptive"} rides along with effort
    const body = { model: "MiniMax-M3", messages: [] };
    applyThinking("claude", "MiniMax-M3(high)", body, "minimax-code");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config.effort).toBe("high");
  });
});

describe("minimax-code OAuth device flow module", () => {
  const provider = createMinimaxCodeProvider({ account: "https://account.minimax.cn" });
  const originalFetch = globalThis.fetch;

  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  it("requestDeviceCode posts PKCE S256 params and passes the standard shape through", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        device_code: "dev-1",
        user_code: "ABCD-1234",
        verification_uri: "https://account.minimax.cn/activate",
        expires_in: 300,
        interval: 5,
      }), { status: 200 });
    });
    const d = await provider.requestDeviceCode(provider.config, "challenge-xyz");
    const form = new URLSearchParams(calls[0].init.body);
    expect(calls[0].url).toBe("https://account.minimax.cn/oauth2/device/code");
    expect(form.get("client_id")).toBe("mcode-public");
    expect(form.get("scope")).toBe("agent.default");
    expect(form.get("audience")).toBe("agent-backend");
    expect(form.get("code_challenge")).toBe("challenge-xyz");
    expect(form.get("code_challenge_method")).toBe("S256");
    expect(d.device_code).toBe("dev-1");
    expect(d._minimaxPollByUser).toBe(false);
    expect(d.interval).toBe(5);
    expect(d.expires_in).toBe(300);
  });

  it("falls back to user_code polling when MiniMax omits device_code", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      user_code: "XYZ-9",
      verification_uri: "https://account.minimax.cn/activate",
      expired_in: Date.now() + 60_000,
      interval: 1500,
    }), { status: 200 }));
    const d = await provider.requestDeviceCode(provider.config, "challenge-xyz");
    expect(d.device_code).toBe("XYZ-9");
    expect(d._minimaxPollByUser).toBe(true);
    expect(d.interval).toBe(2); // ms → seconds
    expect(d.expires_in).toBeGreaterThan(55);
  });

  it("pollToken maps MiniMax status envelopes to framework error fields", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ status: "pending" }), { status: 200 }));
    let r = await provider.pollToken(provider.config, "dev-1", "verifier", {});
    expect(r.ok).toBe(true);
    expect(r.data.error).toBe("authorization_pending");

    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ status: "slow_down" }), { status: 200 }));
    r = await provider.pollToken(provider.config, "dev-1", "verifier", {});
    expect(r.data.error).toBe("slow_down");

    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }));
    r = await provider.pollToken(provider.config, "dev-1", "verifier", {});
    expect(r.data.error).toBe("authorization_pending");
  });

  it("pollToken posts user_code for the variant, device_code otherwise", async () => {
    const bodies = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      bodies.push(new URLSearchParams(init.body));
      return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
    });
    await provider.pollToken(provider.config, "XYZ-9", "verifier", { _minimaxPollByUser: true });
    expect(bodies[0].get("user_code")).toBe("XYZ-9");
    expect(bodies[0].get("device_code")).toBeNull();
    await provider.pollToken(provider.config, "dev-1", "verifier", { _minimaxPollByUser: false });
    expect(bodies[1].get("device_code")).toBe("dev-1");
    expect(bodies[1].get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
  });

  it("mapTokens normalizes the token answer", () => {
    const t = provider.mapTokens({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    expect(t).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  });
});

describe("minimax-code refresh handler", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  it("routes both providers through the single-use-token handler", async () => {
    const ex = getExecutor("minimax-code-global");
    refreshMiniMaxMock.mockResolvedValue({ accessToken: "a2", refreshToken: "r2", expiresIn: 3600 });
    const out = await ex.refreshCredentials({ refreshToken: "r1" });
    expect(refreshMiniMaxMock).toHaveBeenCalledWith("minimax-code-global", "r1", undefined);
    expect(out.accessToken).toBe("a2");
  });

  it("refreshMiniMaxCodeToken posts the mcode grant and rotates the refresh token", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: new URLSearchParams(init.body) });
      return new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }), { status: 200 });
    });
    const out = await refreshMiniMaxCodeToken("minimax-code", "r1");
    expect(calls[0].url).toBe("https://account.minimax.cn/oauth2/token");
    expect(calls[0].body.get("grant_type")).toBe("refresh_token");
    expect(calls[0].body.get("client_id")).toBe("mcode-public");
    expect(calls[0].body.get("scope")).toBe("agent.default");
    expect(calls[0].body.get("audience")).toBe("agent-backend");
    expect(out).toEqual({ accessToken: "a2", refreshToken: "r2", expiresIn: 3600 });
  });

  it("returns invalid_grant (the one sign-out answer) on 400 reuse", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const out = await refreshMiniMaxCodeToken("minimax-code", "spent");
    expect(out).toEqual({ error: "invalid_grant" });
  });

  it("returns null on transient failures (sign-in stays)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 502 }));
    expect(await refreshMiniMaxCodeToken("minimax-code", "r-transient")).toBeNull();
  });

  it("dedupes concurrent refreshes of the same refresh token", async () => {
    let hits = 0;
    globalThis.fetch = vi.fn(async () => {
      hits++;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }), { status: 200 });
    });
    const [a, b] = await Promise.all([
      refreshMiniMaxCodeToken("minimax-code", "shared"),
      refreshMiniMaxCodeToken("minimax-code", "shared"),
    ]);
    expect(hits).toBe(1);
    expect(a).toEqual(b);
  });

  it("global site hits account.minimax.io", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 60 }), { status: 200 });
    });
    await refreshMiniMaxCodeToken("minimax-code-global", "r9");
    expect(calls[0]).toBe("https://account.minimax.io/oauth2/token");
  });
});

describe("minimax-code executor quota normalization", () => {
  const jsonResponse = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

  it("rewrites 402/403 credits refusals to 429 rate_limit_error", async () => {
    for (const status of [402, 403]) {
      const res = await normalizeQuotaResponse(jsonResponse(status, {
        error: { message: "积分不足，请充值或签到" },
      }));
      expect(res.status).toBe(429);
      const v = await res.json();
      expect(v.error.type).toBe("rate_limit_error");
      expect(v.error.message).toContain("积分不足");
    }
  });

  it("matches balance words in English and raw Chinese bodies", async () => {
    const a = await normalizeQuotaResponse(jsonResponse(403, { message: "insufficient balance" }));
    expect(a.status).toBe(429);
    const b = await normalizeQuotaResponse(jsonResponse(402, "额度已用完"));
    expect(b.status).toBe(429);
  });

  it("passes a real 403 auth refusal through with its status intact", async () => {
    const res = await normalizeQuotaResponse(jsonResponse(403, { error: { message: "invalid token" } }));
    expect(res.status).toBe(403);
    const v = await res.json();
    expect(v.error.message).toBe("invalid token");
  });

  it("passes 429 through unchanged in status", async () => {
    const res = await normalizeQuotaResponse(jsonResponse(429, { error: { message: "slow down" } }));
    expect(res.status).toBe(429);
  });

  it("ignores statuses outside the refusal set", async () => {
    const res = await normalizeQuotaResponse(jsonResponse(500, { error: { message: "x" } }));
    expect(res.status).toBe(500);
  });

  it("executor delegates refresh to the deduped handler by provider id", () => {
    const ex = getExecutor("minimax-code");
    expect(ex.constructor.name).toBe("MinimaxCodeExecutor");
    expect(ex.provider).toBe("minimax-code");
    expect(getExecutor("minimax-code")).toBe(ex); // shared instance per provider
  });
});
