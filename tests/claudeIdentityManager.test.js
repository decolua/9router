import { afterEach, describe, expect, it } from "vitest";
import {
  captureClaudeIdentity,
  clearClaudeIdentity,
  getClaudeIdentityDebug,
  isTrustedClaudeIdentitySource,
  mergeClaudeIdentityHeaders,
} from "../open-sse/utils/claudeIdentityManager.js";

const namespace = "anthropic-compatible:anthropic-compatible-test-node";
const body = { model: "test/model", messages: [{ role: "user", content: "ping" }] };
const headers = {
  "user-agent": "claude-cli/1.2.3",
  "x-app": "cli",
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "claude-code-20250219",
  "x-stainless-lang": "js",
  authorization: "Bearer client-secret",
  "x-api-key": "client-key",
  cookie: "session=secret",
  "content-type": "application/json",
  "x-forwarded-for": "203.0.113.1",
  "x-future-identity-field": "future-value",
};

afterEach(() => clearClaudeIdentity());

describe("Claude identity safety baseline", () => {
  it("requires a trusted Claude Messages source before refreshing state", () => {
    expect(isTrustedClaudeIdentitySource(headers, body, { path: "/v1/messages", local: true })).toBe(true);
    expect(isTrustedClaudeIdentitySource({ "user-agent": "claude-cli/1.2.3" }, body, { path: "/v1/messages", local: true })).toBe(false);
    expect(captureClaudeIdentity(headers, { namespace, path: "/v1/messages", body, local: false })).toBe(false);
  });

  it("captures redacted observations and selectively replays only identity headers", () => {
    expect(captureClaudeIdentity(headers, { namespace, path: "/v1/messages", body, local: true })).toBe(true);

    const merged = mergeClaudeIdentityHeaders({
      "Content-Type": "application/json",
      Authorization: "Bearer provider-secret",
      "x-api-key": "provider-key",
    }, { namespace }).headers;

    expect(merged.Authorization).toBe("Bearer provider-secret");
    expect(merged["x-api-key"]).toBe("provider-key");
    expect(merged["user-agent"]).toBe("claude-cli/1.2.3");
    expect(merged["anthropic-version"]).toBe("2023-06-01");
    expect(merged.cookie).toBeUndefined();
    expect(merged["x-forwarded-for"]).toBeUndefined();
    expect(merged["x-future-identity-field"]).toBeUndefined();

    const debug = getClaudeIdentityDebug(namespace);
    const auth = debug.headers.find((header) => header.name === "authorization");
    const future = debug.headers.find((header) => header.name === "x-future-identity-field");
    expect(auth).toMatchObject({ policy: "sensitiveClientPreferred", valueHash: expect.stringMatching(/^sha256:/) });
    expect(auth.value).toBeUndefined();
    expect(future).toMatchObject({ policy: "observeOnly" });
  });

  it("does not inject identity captured for another compatible provider node", () => {
    captureClaudeIdentity(headers, { namespace, path: "/v1/messages", body, local: true });
    const other = mergeClaudeIdentityHeaders({}, { namespace: "anthropic-compatible:anthropic-compatible-other-node" });
    expect(other.injected).toBe(false);
    expect(other.skipped).toBe("no-identity");
  });

  it("replays the documented Claude Code fingerprint headers on the first trusted capture", () => {
    captureClaudeIdentity(headers, { namespace, path: "/v1/messages", body, local: true });
    expect(mergeClaudeIdentityHeaders({}, { namespace }).headers["x-stainless-lang"]).toBe("js");
  });

  it("marks repeatedly missing headers stale without deleting them", () => {
    const withoutStainless = { ...headers };
    delete withoutStainless["x-stainless-lang"];

    captureClaudeIdentity(headers, { namespace, path: "/v1/messages", body, local: true, now: 1_000 });
    captureClaudeIdentity(withoutStainless, { namespace, path: "/v1/messages", body, local: true, now: 2_000 });
    captureClaudeIdentity(withoutStainless, { namespace, path: "/v1/messages", body, local: true, now: 3_000 });

    const merged = mergeClaudeIdentityHeaders({}, { namespace, now: 3_000 });
    expect(merged.headers["x-stainless-lang"]).toBeUndefined();
    const debug = getClaudeIdentityDebug(namespace, { now: 3_000 });
    expect(debug.status).toBe("stale");
    expect(debug.headers.find((header) => header.name === "x-stainless-lang")).toMatchObject({ stale: true, missingCount: 2 });
  });

  it("stops replay after the context TTL has expired", () => {
    captureClaudeIdentity(headers, { namespace, path: "/v1/messages", body, local: true, now: 1_000 });
    const expiredAt = 1_000 + 24 * 60 * 60 * 1_000 + 1;

    expect(mergeClaudeIdentityHeaders({}, { namespace, now: expiredAt })).toMatchObject({ injected: false, skipped: "expired" });
    expect(getClaudeIdentityDebug(namespace, { now: expiredAt })).toMatchObject({ status: "expired", expired: true });
  });

  it("keeps the last replayable identity when a trusted capture is severely degraded", () => {
    captureClaudeIdentity(headers, { namespace, path: "/v1/messages", body, local: true, now: 1_000 });
    const sparse = { "user-agent": "claude-cli/9.9.9", "x-app": "cli" };
    captureClaudeIdentity(sparse, { namespace, path: "/v1/messages", body, local: true, now: 2_000 });

    const merged = mergeClaudeIdentityHeaders({}, { namespace, now: 2_000 }).headers;
    expect(merged["user-agent"]).toBe("claude-cli/1.2.3");
    expect(getClaudeIdentityDebug(namespace, { now: 2_000 }).degradedCaptureCount).toBe(1);
  });
});
