/**
 * Grok CLI connection-test semantics: 402 spending-limit is soft success (auth OK).
 */
import { describe, it, expect } from "vitest";
import { classifyOAuthProbeResult } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const GROK_CLI_PROBE = {
  url: PROVIDERS["grok-cli"]?.userUrl || "https://cli-chat-proxy.grok.com/v1/user",
  method: "GET",
  acceptStatuses: [402],
  softFailMessage: {
    402: "Connected, but Grok Build credits are exhausted (spending limit). Add credits or upgrade SuperGrok.",
  },
};

describe("classifyOAuthProbeResult (grok-cli)", () => {
  it("treats 200 as hard success", () => {
    const r = classifyOAuthProbeResult({ ok: true, status: 200 }, GROK_CLI_PROBE, "");
    expect(r).toEqual({ valid: true, error: null, soft: false });
  });

  it("treats 402 spending-limit as soft success (connected, out of credits)", () => {
    const body = JSON.stringify({
      code: "personal-team-blocked:spending-limit",
      error: "You have run out of credits",
    });
    const r = classifyOAuthProbeResult({ ok: false, status: 402 }, GROK_CLI_PROBE, body);
    expect(r.valid).toBe(true);
    expect(r.soft).toBe(true);
    expect(r.error).toMatch(/credits|SuperGrok|spending/i);
  });

  it("treats 401 as hard auth failure", () => {
    const r = classifyOAuthProbeResult({ ok: false, status: 401 }, GROK_CLI_PROBE, "unauthorized");
    expect(r).toEqual({ valid: false, error: "Token invalid or revoked", soft: false });
  });

  it("treats 403 as access denied", () => {
    const r = classifyOAuthProbeResult({ ok: false, status: 403 }, GROK_CLI_PROBE, "");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Access denied/i);
  });

  it("Codex-style acceptStatuses 400 stays silent success (no soft warning)", () => {
    const codex = { acceptStatuses: [400] };
    const r = classifyOAuthProbeResult({ ok: false, status: 400 }, codex, "bad request");
    expect(r).toEqual({ valid: true, error: null, soft: false });
  });
});
