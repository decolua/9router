/**
 * Unit tests for the codex bulk-import normalizer.
 *
 * Pure helpers, no I/O. We craft small synthetic id_tokens by base64-url-
 * encoding a header/payload/signature triple — only the payload is decoded.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeCodexImportRecord,
  flattenCodexImportPayload,
} from "@/lib/oauth/services/codexImport";

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeIdToken(payload) {
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const body = b64url(payload);
  return `${header}.${body}.signature`;
}

const FULL_RECORD = {
  id_token: makeIdToken({
    email: "test-jwt@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct-from-jwt",
      chatgpt_plan_type: "plus",
    },
  }),
  access_token: "access-xyz",
  refresh_token: "refresh-xyz",
  account_id: "acct-from-record",
  email: "test-record@example.com",
  type: "codex",
  expired: "2026-05-22T10:34:04+07:00",
};

describe("normalizeCodexImportRecord", () => {
  it("normalizes a full Codex export record", () => {
    const result = normalizeCodexImportRecord(FULL_RECORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { payload } = result;
    expect(payload.provider).toBe("codex");
    expect(payload.authType).toBe("oauth");
    expect(payload.accessToken).toBe("access-xyz");
    expect(payload.refreshToken).toBe("refresh-xyz");
    expect(payload.idToken).toBe(FULL_RECORD.id_token);
    expect(payload.testStatus).toBe("active");
    // JWT email wins over the record-level email.
    expect(payload.email).toBe("test-jwt@example.com");
    expect(payload.providerSpecificData).toEqual({
      chatgptAccountId: "acct-from-jwt",
      chatgptPlanType: "plus",
    });
    // ISO-formatted, parses back to the right instant.
    expect(new Date(payload.expiresAt).toISOString()).toBe(payload.expiresAt);
    expect(Date.parse(payload.expiresAt)).toBe(Date.parse(FULL_RECORD.expired));
  });

  it("falls back to record email when id_token has none", () => {
    const idToken = makeIdToken({
      "https://api.openai.com/auth": { chatgpt_account_id: "x" },
    });
    const result = normalizeCodexImportRecord({
      access_token: "a",
      refresh_token: "r",
      email: "fallback@example.com",
      id_token: idToken,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.email).toBe("fallback@example.com");
    expect(result.payload.providerSpecificData?.chatgptAccountId).toBe("x");
  });

  it("falls back to account_id when id_token is missing", () => {
    const result = normalizeCodexImportRecord({
      access_token: "a",
      refresh_token: "r",
      email: "no-jwt@example.com",
      account_id: "acct-top-level",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.providerSpecificData?.chatgptAccountId).toBe(
      "acct-top-level",
    );
    expect(result.payload.idToken).toBeUndefined();
  });

  it("synthesizes expiresAt when `expired` is missing", () => {
    const before = Date.now();
    const result = normalizeCodexImportRecord({
      access_token: "a",
      refresh_token: "r",
      email: "x@example.com",
    });
    const after = Date.now();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expiresMs = Date.parse(result.payload.expiresAt);
    expect(expiresMs).toBeGreaterThan(before);
    // Default lifetime is 10 days; allow a generous upper bound.
    expect(expiresMs).toBeLessThanOrEqual(after + 11 * 24 * 60 * 60 * 1000);
  });

  it("rejects invalid `expired` strings by falling back to default", () => {
    const result = normalizeCodexImportRecord({
      access_token: "a",
      refresh_token: "r",
      email: "x@example.com",
      expired: "not-a-date",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Number.isFinite(Date.parse(result.payload.expiresAt))).toBe(true);
  });

  it("rejects records missing required fields", () => {
    expect(normalizeCodexImportRecord({}).ok).toBe(false);
    expect(
      normalizeCodexImportRecord({ access_token: "a", email: "x@y.z" }).ok,
    ).toBe(false);
    expect(
      normalizeCodexImportRecord({
        access_token: "a",
        refresh_token: "r",
      }).ok,
    ).toBe(false); // no email anywhere
  });

  it("rejects records with non-codex `type`", () => {
    const result = normalizeCodexImportRecord({
      access_token: "a",
      refresh_token: "r",
      email: "x@example.com",
      type: "claude",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unsupported type/);
  });

  it("rejects non-objects", () => {
    expect(normalizeCodexImportRecord(null).ok).toBe(false);
    expect(normalizeCodexImportRecord("foo").ok).toBe(false);
    expect(normalizeCodexImportRecord([]).ok).toBe(false);
  });

  it("omits providerSpecificData when no account info is present", () => {
    const result = normalizeCodexImportRecord({
      access_token: "a",
      refresh_token: "r",
      email: "x@example.com",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.providerSpecificData).toBeUndefined();
  });

  it("unwraps the codex CLI auth.json shape", () => {
    const idToken = makeIdToken({
      email: "cli@example.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-cli",
        chatgpt_plan_type: "free",
      },
    });
    // Access token's `exp` is the only expiry signal in auth.json.
    const expEpoch = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = makeIdToken({ exp: expEpoch });
    const authJson = {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: idToken,
        access_token: accessToken,
        refresh_token: "rt-cli",
        account_id: "acct-cli",
      },
      last_refresh: "2026-05-16T11:35:58.322795500Z",
    };
    const result = normalizeCodexImportRecord(authJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.accessToken).toBe(accessToken);
    expect(result.payload.refreshToken).toBe("rt-cli");
    expect(result.payload.idToken).toBe(idToken);
    expect(result.payload.email).toBe("cli@example.com");
    expect(result.payload.providerSpecificData).toEqual({
      chatgptAccountId: "acct-cli",
      chatgptPlanType: "free",
    });
    // Falls back to the access_token's `exp` claim when no `expired` field exists.
    expect(Date.parse(result.payload.expiresAt)).toBe(expEpoch * 1000);
  });

  it("rejects auth.json when nested tokens are incomplete", () => {
    const result = normalizeCodexImportRecord({
      auth_mode: "chatgpt",
      tokens: { id_token: "x" }, // missing access_token + refresh_token
    });
    expect(result.ok).toBe(false);
  });
});

describe("flattenCodexImportPayload", () => {
  it("wraps a single object", () => {
    const result = flattenCodexImportPayload({ a: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toEqual([{ a: 1 }]);
  });

  it("passes arrays through", () => {
    const result = flattenCodexImportPayload([{ a: 1 }, { b: 2 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("rejects scalars", () => {
    expect(flattenCodexImportPayload("nope").ok).toBe(false);
    expect(flattenCodexImportPayload(42).ok).toBe(false);
    expect(flattenCodexImportPayload(null).ok).toBe(false);
  });
});
