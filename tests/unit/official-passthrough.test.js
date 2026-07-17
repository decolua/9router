import { describe, expect, it, beforeEach } from "vitest";

import {
  isOfficialSurfacePath,
  isOfficialPassthroughModel,
  isGptOfficialModel,
  shouldOfficialPassthrough,
  resolveOfficialPassthroughUrl,
  normalizeRequestPath,
  modelPatternToRegExp,
  DEFAULT_MODEL_PATTERNS,
  _resetOfficialPassthroughCache,
  loadOfficialPassthroughConfig,
  buildForwardHeaders,
} from "../../open-sse/utils/officialPassthrough.js";

describe("official passthrough gates", () => {
  beforeEach(() => {
    _resetOfficialPassthroughCache();
  });

  it("normalizes /api/v1 paths", () => {
    expect(normalizeRequestPath("/api/v1/responses")).toBe("/v1/responses");
    expect(normalizeRequestPath("/v1/alpha/search/")).toBe("/v1/alpha/search");
  });

  it("recognizes official surface paths", () => {
    expect(isOfficialSurfacePath("/v1/responses")).toBe(true);
    expect(isOfficialSurfacePath("/api/v1/responses")).toBe(true);
    expect(isOfficialSurfacePath("/v1/responses/compact")).toBe(true);
    expect(isOfficialSurfacePath("/v1/alpha/search")).toBe(true);
    expect(isOfficialSurfacePath("/codex/foo")).toBe(true);
    expect(isOfficialSurfacePath("/v1/messages")).toBe(false);
    expect(isOfficialSurfacePath("/v1/chat/completions")).toBe(false);
    expect(isOfficialSurfacePath("/v1/search")).toBe(false);
  });

  it("default patterns match gpt-* and codex-*; prefixed are not", () => {
    expect(isOfficialPassthroughModel("gpt-5.6-sol")).toBe(true);
    expect(isOfficialPassthroughModel("GPT-5.4")).toBe(true);
    expect(isOfficialPassthroughModel("codex-auto-review")).toBe(true);
    expect(isOfficialPassthroughModel("codex-mini")).toBe(true);
    expect(isOfficialPassthroughModel("cx/gpt-5.6-sol")).toBe(false);
    expect(isOfficialPassthroughModel("minimax-cn/MiniMax-M3")).toBe(false);
    expect(isOfficialPassthroughModel("gcli/grok-4.5")).toBe(false);
    expect(isOfficialPassthroughModel(null)).toBe(null);
    expect(isOfficialPassthroughModel("")).toBe(null);
    // alias still works
    expect(isGptOfficialModel("gpt-5.6-sol")).toBe(true);
  });

  it("supports custom modelPatterns (exact + glob)", () => {
    const patterns = ["gpt-*", "codex-*", "o3-*", "my-official-model"];
    expect(isOfficialPassthroughModel("o3-mini", patterns)).toBe(true);
    expect(isOfficialPassthroughModel("my-official-model", patterns)).toBe(true);
    expect(isOfficialPassthroughModel("codex-auto-review", patterns)).toBe(true);
    expect(isOfficialPassthroughModel("claude-opus", patterns)).toBe(false);
  });

  it("modelPatternToRegExp is case-insensitive glob", () => {
    expect(modelPatternToRegExp("gpt-*").test("GPT-5.6-sol")).toBe(true);
    expect(modelPatternToRegExp("codex-*").test("codex-auto-review")).toBe(true);
    expect(modelPatternToRegExp("codex-auto-review").test("codex-auto-review")).toBe(true);
    expect(modelPatternToRegExp("gpt-*").test("cx/gpt-5")).toBe(false);
  });

  it("maps paths to ChatGPT codex backend", () => {
    expect(resolveOfficialPassthroughUrl("/v1/responses")).toBe(
      "https://chatgpt.com/backend-api/codex/responses"
    );
    expect(resolveOfficialPassthroughUrl("/v1/responses/compact")).toBe(
      "https://chatgpt.com/backend-api/codex/responses/compact"
    );
    expect(resolveOfficialPassthroughUrl("/v1/alpha/search")).toBe(
      "https://chatgpt.com/backend-api/codex/alpha/search"
    );
    expect(resolveOfficialPassthroughUrl("/api/v1/alpha/search")).toBe(
      "https://chatgpt.com/backend-api/codex/alpha/search"
    );
  });

  it("requires Codex client + surface path + matching model pattern", () => {
    const cfg = {
      enabled: true,
      fallbackCodexAuthJson: true,
      codexAuthPath: null,
      modelPatterns: [...DEFAULT_MODEL_PATTERNS],
      path: "",
    };
    const codexHeaders = { "user-agent": "codex-cli/0.145.0" };

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "gpt-5.6-sol" },
      pathname: "/v1/responses",
      config: cfg,
    })).toBe(true);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "codex-auto-review" },
      pathname: "/v1/responses",
      config: cfg,
    })).toBe(true);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "gpt-5.6-sol" },
      pathname: "/v1/alpha/search",
      config: cfg,
    })).toBe(true);

    // non-matching → route
    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "cx/gpt-5.6-sol" },
      pathname: "/v1/responses",
      config: cfg,
    })).toBe(false);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "minimax-cn/MiniMax-M3" },
      pathname: "/v1/responses",
      config: cfg,
    })).toBe(false);

    // Claude Code must never passthrough even with gpt-*
    expect(shouldOfficialPassthrough({
      headers: { "user-agent": "claude-cli/1.0" },
      body: { model: "gpt-5.6-sol" },
      pathname: "/v1/responses",
      config: cfg,
    })).toBe(false);

    // messages path never
    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "gpt-5.6-sol" },
      pathname: "/v1/messages",
      config: cfg,
    })).toBe(false);

    // disabled
    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "gpt-5.6-sol" },
      pathname: "/v1/responses",
      config: { ...cfg, enabled: false },
    })).toBe(false);

    // custom patterns only
    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "o3-mini" },
      pathname: "/v1/responses",
      config: { ...cfg, modelPatterns: ["o3-*"] },
    })).toBe(true);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "gpt-5.6-sol" },
      pathname: "/v1/responses",
      config: { ...cfg, modelPatterns: ["o3-*"] },
    })).toBe(false);
  });

  it("loadOfficialPassthroughConfig includes default modelPatterns", () => {
    const cfg = loadOfficialPassthroughConfig({ forceReload: true });
    expect(cfg.enabled).toBe(true);
    expect(cfg.fallbackCodexAuthJson).toBe(true);
    expect(cfg.modelPatterns).toEqual(expect.arrayContaining(["gpt-*", "codex-*"]));
  });

  it("omits content-encoding for plain JSON re-serialize fallback", () => {
    const headers = buildForwardHeaders(
      {
        "user-agent": "codex-cli/0.145.0",
        "content-encoding": "zstd",
        "content-length": "99999",
        "content-type": "application/json",
        authorization: "Bearer sk-gateway",
        originator: "Codex Desktop",
      },
      { authHeader: "Bearer eyJhbGciOi.test", accountId: "acct-1", contentEncoding: null }
    );
    expect(headers["content-encoding"]).toBeUndefined();
    expect(headers["content-length"]).toBeUndefined();
    expect(headers.authorization).toBe("Bearer eyJhbGciOi.test");
    expect(headers["chatgpt-account-id"]).toBe("acct-1");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.originator).toBe("Codex Desktop");
  });

  it("keeps content-encoding when forwarding original zstd wire bytes", () => {
    const headers = buildForwardHeaders(
      {
        "user-agent": "codex-cli/0.145.0",
        "content-encoding": "zstd",
        "content-length": "99999",
        authorization: "Bearer sk-gateway",
        originator: "Codex Desktop",
      },
      { authHeader: "Bearer eyJhbGciOi.test", accountId: "acct-1", contentEncoding: "zstd" }
    );
    expect(headers["content-encoding"]).toBe("zstd");
    expect(headers["content-length"]).toBeUndefined();
    expect(headers.authorization).toBe("Bearer eyJhbGciOi.test");
  });
});



