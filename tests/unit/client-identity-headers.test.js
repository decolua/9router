import { describe, expect, it } from "vitest";

import {
  normalizeClientIdentityData,
  parseClientIdentityHeaders,
} from "open-sse/config/clientIdentity.js";
import {
  applyClientIdentityHeaders,
  buildClientIdentityHeaders,
  keepsClaudeIdentityHeaders,
} from "open-sse/shared/clientIdentityHeaders.js";
import { PROVIDERS } from "open-sse/config/providers.js";

describe("client identity headers", () => {
  it("default profile does not add headers", () => {
    expect(buildClientIdentityHeaders({ clientIdentityProfile: "default" })).toEqual({});
    expect(buildClientIdentityHeaders(undefined)).toEqual({});
  });

  it("claude-cli profile includes Claude CLI fingerprint headers", () => {
    const headers = buildClientIdentityHeaders({ clientIdentityProfile: "claude-cli" });

    expect(headers["User-Agent"]).toContain("claude-cli/");
    expect(headers["X-App"]).toBe("cli");
    expect(headers["Anthropic-Beta"]).toContain("claude-code-20250219");
  });

  it("codex-cli profile reuses the Codex registry identity", () => {
    const headers = buildClientIdentityHeaders({ clientIdentityProfile: "codex-cli" });

    expect(headers.originator).toBe(PROVIDERS.codex.headers.originator);
    expect(headers["User-Agent"]).toBe(PROVIDERS.codex.headers["User-Agent"]);
  });

  it("openclaw profile includes OpenClaw user agent", () => {
    expect(buildClientIdentityHeaders({ clientIdentityProfile: "openclaw" })).toEqual({
      "User-Agent": "openclaw/2026.2.3",
    });
  });

  it("unknown profile normalizes to default", () => {
    expect(buildClientIdentityHeaders({ clientIdentityProfile: "unknown-profile" })).toEqual({});
    expect(normalizeClientIdentityData({ clientIdentityProfile: "unknown-profile" })).toEqual({
      clientIdentityProfile: "default",
      clientIdentityHeaders: {},
    });
  });

  it("parses custom headers from JSON and drops credential headers", () => {
    const { headers, error } = parseClientIdentityHeaders(JSON.stringify({
      "User-Agent": "custom/1.0",
      Authorization: "Bearer wrong",
      "x-api-key": "wrong",
      Cookie: "session=1",
      "X-Trace": "abc",
    }));

    expect(error).toBeUndefined();
    expect(headers).toEqual({ "User-Agent": "custom/1.0", "X-Trace": "abc" });
  });

  it("parses custom headers from Header: value lines", () => {
    const { headers } = parseClientIdentityHeaders([
      "# comment",
      "User-Agent: custom/1.0",
      "X-App: cli",
      "api-key: blocked",
    ].join("\n"));

    expect(headers).toEqual({ "User-Agent": "custom/1.0", "X-App": "cli" });
  });

  it("reports malformed custom headers instead of guessing", () => {
    expect(parseClientIdentityHeaders("User-Agent custom").error).toMatch(/Header: value/);
    expect(parseClientIdentityHeaders("{not json").error).toMatch(/valid JSON/);
    expect(parseClientIdentityHeaders("[1]").error).toMatch(/Header: value/);
    expect(normalizeClientIdentityData({
      clientIdentityProfile: "custom",
      clientIdentityHeaders: "{not json",
    }).error).toMatch(/valid JSON/);
  });

  it("custom headers are ignored unless the custom profile is selected", () => {
    expect(normalizeClientIdentityData({
      clientIdentityProfile: "openclaw",
      clientIdentityHeaders: { "X-Trace": "abc" },
    })).toEqual({ clientIdentityProfile: "openclaw", clientIdentityHeaders: {} });
  });

  it("overlays identity case-insensitively and never touches credentials", () => {
    const headers = applyClientIdentityHeaders(
      { "content-type": "application/json", "user-agent": "default/1.0", Authorization: "Bearer real-token" },
      {
        clientIdentityProfile: "custom",
        clientIdentityHeaders: { "User-Agent": "custom/1.0", authorization: "Bearer custom" },
      },
    );

    expect(headers).toEqual({
      "content-type": "application/json",
      "User-Agent": "custom/1.0",
      Authorization: "Bearer real-token",
    });
  });

  it("keeps Claude identity only for an explicit Claude profile", () => {
    expect(keepsClaudeIdentityHeaders({ clientIdentityProfile: "claude-cli" })).toBe(true);
    expect(keepsClaudeIdentityHeaders({
      clientIdentityProfile: "custom",
      clientIdentityHeaders: { "X-App": "cli" },
    })).toBe(true);
    expect(keepsClaudeIdentityHeaders({
      clientIdentityProfile: "custom",
      clientIdentityHeaders: { "User-Agent": "custom/1.0" },
    })).toBe(false);
    expect(keepsClaudeIdentityHeaders({ clientIdentityProfile: "openclaw" })).toBe(false);
    expect(keepsClaudeIdentityHeaders(undefined)).toBe(false);
  });
});
