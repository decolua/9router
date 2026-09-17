/**
 * Regression guard for `403 FreeTierError: OpenCode's free tier can only be used
 * from within OpenCode` — the bare "opencode" UA 9router used to send is rejected.
 * Values locked against opencode-ai 1.18.31.
 */
import { describe, expect, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import {
  OPENCODE_USER_AGENT,
  OPENCODE_CLI_VERSION,
  OPENCODE_FREE_TIER_ERROR,
  isAcceptableDownstreamUserAgent,
} from "../../open-sse/config/opencodeCli.js";

const MODEL = "mimo-v2.5-free";

function headersFor(rawHeaders = {}) {
  const executor = new OpenCodeExecutor();
  const credentials = { connectionId: "opencode-fingerprint-test", rawHeaders };
  executor.transformRequest(MODEL, { messages: [{ role: "user", content: "hi" }] }, true, credentials);
  return executor.buildHeaders(credentials, true);
}

describe("OpenCode free-tier User-Agent fingerprint", () => {
  it("sends the versioned AI-SDK product string, not a bare 'opencode'", () => {
    const ua = headersFor()["User-Agent"];
    expect(ua).toBe(OPENCODE_USER_AGENT);
    expect(ua).not.toBe("opencode");
    expect(ua).toContain(`opencode/${OPENCODE_CLI_VERSION}`);
    expect(ua).toContain("ai-sdk/provider-utils/");
  });

  it("identifies as the cli client", () => {
    expect(headersFor()["x-opencode-client"]).toBe("cli");
  });

  it("emits opencode-shaped session and request ids", () => {
    const headers = headersFor();
    expect(headers["x-opencode-session"]).toMatch(/^ses_/);
    expect(headers["x-opencode-request"]).toMatch(/^msg_/);
    expect(headers["x-opencode-project"]).toBe("global");
  });

  it("keeps the session stable for the same connection", () => {
    expect(headersFor()["x-opencode-session"]).toBe(headersFor()["x-opencode-session"]);
  });
});

describe("OpenCode downstream User-Agent forwarding", () => {
  it("does not forward a bare 'opencode' UA (it would trip the gate)", () => {
    expect(headersFor({ "user-agent": "opencode" })["User-Agent"]).toBe(OPENCODE_USER_AGENT);
  });

  it("does not forward unrelated client UAs", () => {
    for (const ua of ["claude-cli/1.0", "curl/8.0", "opencode-ish"]) {
      expect(headersFor({ "user-agent": ua })["User-Agent"]).toBe(OPENCODE_USER_AGENT);
    }
  });

  it("preserves a downstream UA that already carries the product string", () => {
    const real = "opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14";
    expect(headersFor({ "user-agent": real })["User-Agent"]).toBe(real);
  });

  it("is case-insensitive on the header key", () => {
    expect(headersFor({ "User-Agent": "opencode" })["User-Agent"]).toBe(OPENCODE_USER_AGENT);
  });

  it("classifies UAs through the shared predicate", () => {
    expect(isAcceptableDownstreamUserAgent("opencode/1.18.31 ai-sdk/provider-utils/4.0.23")).toBe(true);
    expect(isAcceptableDownstreamUserAgent("opencode")).toBe(false);
    expect(isAcceptableDownstreamUserAgent("")).toBe(false);
    expect(isAcceptableDownstreamUserAgent(undefined)).toBe(false);
  });
});

describe("OpenCode FreeTierError mapping", () => {
  const freeTierBody = JSON.stringify({
    type: "error",
    error: {
      type: OPENCODE_FREE_TIER_ERROR,
      message:
        "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode",
    },
  });

  it("rewrites the opaque 403 into an actionable message", () => {
    const executor = new OpenCodeExecutor();
    const parsed = executor.parseError({ status: 403 }, freeTierBody);
    expect(parsed.status).toBe(403);
    expect(parsed.message).toMatch(/OpenCode Go/);
    expect(parsed.message).not.toContain("FreeTierError");
  });

  it("leaves other upstream errors untouched", () => {
    const executor = new OpenCodeExecutor();
    expect(executor.parseError({ status: 401 }, '{"error":{"message":"nope"}}').message)
      .toBe('{"error":{"message":"nope"}}');
    expect(executor.parseError({ status: 429 }, "").message).toBe("HTTP 429");
  });

  it("does not rewrite a 403 that is not the free-tier rejection", () => {
    const executor = new OpenCodeExecutor();
    const body = '{"error":{"message":"forbidden for another reason"}}';
    expect(executor.parseError({ status: 403 }, body).message).toBe(body);
  });
});
