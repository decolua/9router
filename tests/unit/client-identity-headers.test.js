import { describe, expect, it } from "vitest";

import {
  buildClientIdentityHeaders,
  mergeClientIdentityHeaders,
  parseClientIdentityHeaders,
} from "open-sse/shared/clientIdentityHeaders.js";

describe("client identity headers", () => {
  it("default profile does not add headers", () => {
    expect(buildClientIdentityHeaders({ clientIdentityProfile: "default" })).toEqual({});
  });

  it("claude-cli profile includes Claude CLI fingerprint headers", () => {
    const headers = buildClientIdentityHeaders({ clientIdentityProfile: "claude-cli" });

    expect(headers["User-Agent"]).toContain("claude-cli/");
    expect(headers["X-App"]).toBe("cli");
    expect(headers["Anthropic-Beta"]).toContain("claude-code-20250219");
  });

  it("codex-cli profile includes Codex originator headers", () => {
    const headers = buildClientIdentityHeaders({ clientIdentityProfile: "codex-cli" });

    expect(headers.originator).toBe("codex_cli_rs");
    expect(headers["User-Agent"]).toContain("codex_cli_rs/");
  });

  it("openclaw profile includes OpenClaw user agent", () => {
    expect(buildClientIdentityHeaders({ clientIdentityProfile: "openclaw" })).toEqual({
      "User-Agent": "openclaw/2026.2.3",
    });
  });

  it("invalid profile normalizes to default headers", () => {
    expect(buildClientIdentityHeaders({ clientIdentityProfile: "unknown-profile" })).toEqual({});
  });

  it("parses custom headers from JSON and blocks auth headers", () => {
    const headers = parseClientIdentityHeaders(JSON.stringify({
      "User-Agent": "custom/1.0",
      Authorization: "Bearer wrong",
      "x-api-key": "wrong",
      "X-Trace": "abc",
    }));

    expect(headers).toEqual({
      "User-Agent": "custom/1.0",
      "X-Trace": "abc",
    });
  });

  it("parses custom headers from Header: value lines", () => {
    const headers = parseClientIdentityHeaders([
      "User-Agent: custom/1.0",
      "X-App: cli",
      "api-key: blocked",
      "Malformed",
    ].join("\n"));

    expect(headers).toEqual({
      "User-Agent": "custom/1.0",
      "X-App": "cli",
    });
  });

  it("merges base, identity, and auth with auth winning", () => {
    const headers = mergeClientIdentityHeaders(
      { "Content-Type": "application/json", Authorization: "Bearer base" },
      {
        clientIdentityProfile: "custom",
        clientIdentityHeaders: {
          "User-Agent": "custom/1.0",
          Authorization: "Bearer custom",
        },
      },
      { Authorization: "Bearer real-token" },
    );

    expect(headers).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "custom/1.0",
      Authorization: "Bearer real-token",
    });
  });
});
