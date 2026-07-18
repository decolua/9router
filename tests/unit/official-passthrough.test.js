import { describe, expect, it, beforeEach } from "vitest";

import {
  isOfficialPassthroughModel,
  shouldOfficialPassthrough,
  resolveOfficialPassthroughUrl,
  normalizeRequestPath,
  modelPatternToRegExp,
  DEFAULT_MODEL_PATTERNS,
  _resetOfficialPassthroughCache,
  loadOfficialPassthroughConfig,
  buildForwardHeaders,
} from "../../open-sse/utils/officialPassthrough.js";
import {
  isOfficialPassthroughRequestPath,
  peekBodyForGate,
} from "../../open-sse/utils/officialCodexHttpPrehandler.js";

describe("official passthrough gates", () => {
  beforeEach(() => {
    _resetOfficialPassthroughCache();
  });

  it("normalizes /api/v1 paths", () => {
    expect(normalizeRequestPath("/api/v1/responses")).toBe("/v1/responses");
    expect(normalizeRequestPath("/v1/alpha/search/")).toBe("/v1/alpha/search");
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

  it("maps paths to ChatGPT codex backend for upstream URL only", () => {
    expect(resolveOfficialPassthroughUrl("/v1/responses")).toBe(
      "https://chatgpt.com/backend-api/codex/responses"
    );
    expect(resolveOfficialPassthroughUrl("/v1/responses/compact")).toBe(
      "https://chatgpt.com/backend-api/codex/responses/compact"
    );
    expect(resolveOfficialPassthroughUrl("/v1/alpha/search")).toBe(
      "https://chatgpt.com/backend-api/codex/alpha/search"
    );
    expect(resolveOfficialPassthroughUrl("/v1/images/generations")).toBe(
      "https://chatgpt.com/backend-api/codex/images/generations"
    );
    expect(resolveOfficialPassthroughUrl("/v1/images/edits")).toBe(
      "https://chatgpt.com/backend-api/codex/images/edits"
    );
    expect(resolveOfficialPassthroughUrl("/v1/models")).toBe(
      "https://chatgpt.com/backend-api/codex/models"
    );
    expect(resolveOfficialPassthroughUrl("/codex/responses")).toBe(
      "https://chatgpt.com/backend-api/codex/responses"
    );
    expect(resolveOfficialPassthroughUrl("/responses")).toBe(
      "https://chatgpt.com/backend-api/codex/responses"
    );
  });

  it("Codex client: passthrough unless model is present and outside patterns", () => {
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
      config: cfg,
    })).toBe(true);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "codex-auto-review" },
      config: cfg,
    })).toBe(true);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: {},
      config: cfg,
    })).toBe(true);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "cx/gpt-5.6-sol" },
      config: cfg,
    })).toBe(false);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "minimax-cn/MiniMax-M3" },
      config: cfg,
    })).toBe(false);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "gpt-image-1" },
      config: cfg,
    })).toBe(true);
  });

  it("non-Codex clients always route even with gpt-*", () => {
    const cfg = {
      enabled: true,
      fallbackCodexAuthJson: true,
      codexAuthPath: null,
      modelPatterns: [...DEFAULT_MODEL_PATTERNS],
      path: "",
    };

    expect(shouldOfficialPassthrough({
      headers: { "user-agent": "claude-cli/1.0" },
      body: { model: "gpt-5.6-sol" },
      config: cfg,
    })).toBe(false);

    expect(shouldOfficialPassthrough({
      headers: { "user-agent": "opencode/1.0" },
      body: { model: "gpt-5.6-sol" },
      config: cfg,
    })).toBe(false);

    expect(shouldOfficialPassthrough({
      headers: { "user-agent": "curl/8.0" },
      body: { model: "gpt-5.6-sol" },
      config: cfg,
    })).toBe(false);
  });

  it("respects enabled flag and custom patterns", () => {
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
      config: { ...cfg, enabled: false },
    })).toBe(false);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "o3-mini" },
      config: { ...cfg, modelPatterns: ["o3-*"] },
    })).toBe(true);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "gpt-5.6-sol" },
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

  it("preserves multipart content-type for image edits wire passthrough", () => {
    const headers = buildForwardHeaders(
      {
        "user-agent": "codex-cli/0.145.0",
        "content-type": "multipart/form-data; boundary=----x",
        authorization: "Bearer sk-gateway",
      },
      { authHeader: "Bearer eyJhbGciOi.test", accountId: "acct-1", contentEncoding: null }
    );
    expect(headers["content-type"]).toBe("multipart/form-data; boundary=----x");
  });
});

describe("unified Codex HTTP prehandler helpers", () => {
  it("detects gateway paths eligible for official passthrough", () => {
    expect(isOfficialPassthroughRequestPath("/v1/responses")).toBe(true);
    expect(isOfficialPassthroughRequestPath("/v1/images/generations")).toBe(true);
    expect(isOfficialPassthroughRequestPath("/v1/models?client_version=1")).toBe(true);
    expect(isOfficialPassthroughRequestPath("/api/v1/alpha/search")).toBe(true);
    expect(isOfficialPassthroughRequestPath("/responses")).toBe(true);
    expect(isOfficialPassthroughRequestPath("/codex/responses")).toBe(true);
    expect(isOfficialPassthroughRequestPath("/dashboard")).toBe(false);
    expect(isOfficialPassthroughRequestPath("/api/auth/login")).toBe(false);
  });

  it("peekBodyForGate reads model from JSON and skips multipart", () => {
    const json = Buffer.from(JSON.stringify({ model: "gpt-image-1", prompt: "x" }));
    expect(peekBodyForGate(json, { "content-type": "application/json" }).body.model).toBe("gpt-image-1");

    const multi = Buffer.from("------bound\r\nContent-Disposition: form-data\r\n\r\n");
    expect(peekBodyForGate(multi, { "content-type": "multipart/form-data; boundary=----bound" }).body).toEqual({});

    expect(peekBodyForGate(Buffer.alloc(0), {}).body).toEqual({});
  });

  it("Codex + gpt-image model is eligible for passthrough", () => {
    expect(shouldOfficialPassthrough({
      headers: { "user-agent": "codex_cli_rs/0.145.0", originator: "Codex Desktop" },
      body: { model: "gpt-image-1", prompt: "hi" },
    })).toBe(true);
  });
});
