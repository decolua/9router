import { describe, expect, it, beforeEach } from "vitest";

import {
  isOfficialSurfacePath,
  isGptOfficialModel,
  shouldOfficialPassthrough,
  resolveOfficialPassthroughUrl,
  normalizeRequestPath,
  _resetOfficialPassthroughCache,
  loadOfficialPassthroughConfig,
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

  it("gpt-* bare ids are official; prefixed are not", () => {
    expect(isGptOfficialModel("gpt-5.6-sol")).toBe(true);
    expect(isGptOfficialModel("GPT-5.4")).toBe(true);
    expect(isGptOfficialModel("cx/gpt-5.6-sol")).toBe(false);
    expect(isGptOfficialModel("minimax-cn/MiniMax-M3")).toBe(false);
    expect(isGptOfficialModel("gcli/grok-4.5")).toBe(false);
    expect(isGptOfficialModel(null)).toBe(null);
    expect(isGptOfficialModel("")).toBe(null);
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

  it("requires Codex client + surface path + gpt-* model", () => {
    const cfg = { enabled: true, fallbackCodexAuthJson: true, codexAuthPath: null, path: "" };
    const codexHeaders = { "user-agent": "codex-cli/0.145.0" };

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "gpt-5.6-sol" },
      pathname: "/v1/responses",
      config: cfg,
    })).toBe(true);

    expect(shouldOfficialPassthrough({
      headers: codexHeaders,
      body: { model: "gpt-5.6-sol" },
      pathname: "/v1/alpha/search",
      config: cfg,
    })).toBe(true);

    // non-gpt → route
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
  });

  it("loadOfficialPassthroughConfig returns defaults", () => {
    const cfg = loadOfficialPassthroughConfig({ forceReload: true });
    expect(cfg.enabled).toBe(true);
    expect(cfg.fallbackCodexAuthJson).toBe(true);
  });
});
