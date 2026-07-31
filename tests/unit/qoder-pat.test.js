/**
 * Unit tests for the Qoder PAT → job-token exchange (protocol/qoder/pat.js).
 *
 * All network is stubbed: proxyAwareFetch is mocked, so nothing here talks to
 * openapi.qoder.sh / openapi.qoder.com.cn.
 *
 * Wire contract under test:
 *   POST {profile.jobTokenExchangeUrl}  { personal_token }  → { token, expires_* }
 *   GET  {profile.userInfoUrl}          Bearer <jobToken>   → { id | userId | user_id }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

import { isQoderPat, resolvePatCredential, clearPatCache } from "../../open-sse/protocol/qoder/pat.js";
import { INTL_PROFILE, CN_WORK_PROFILE } from "../../open-sse/protocol/qoder/profile.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Queue: exchange response, then userinfo response. */
function stubExchange({ token = "jt-abc", userId = "uid-1", expires_in, expires_at, userinfoStatus = 200 } = {}) {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("/jobToken/exchange")) {
      const body = { token, refresh_token: "rt-1" };
      if (expires_in !== undefined) body.expires_in = expires_in;
      if (expires_at !== undefined) body.expires_at = expires_at;
      return json(body);
    }
    if (String(url).includes("/userinfo")) {
      if (userinfoStatus !== 200) return json({ error: "nope" }, userinfoStatus);
      return json({ id: userId });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const callsTo = (fragment) =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes(fragment));

beforeEach(() => {
  fetchMock.mockReset();
  clearPatCache();
});

describe("isQoderPat", () => {
  it("accepts pt- tokens", () => {
    expect(isQoderPat("pt-abcdef")).toBe(true);
  });

  it("rejects device tokens, empty and non-strings", () => {
    expect(isQoderPat("dt-abcdef")).toBe(false);
    expect(isQoderPat("jt-abcdef")).toBe(false);
    expect(isQoderPat("")).toBe(false);
    expect(isQoderPat(undefined)).toBe(false);
    expect(isQoderPat(null)).toBe(false);
    expect(isQoderPat(123)).toBe(false);
    expect(isQoderPat({ token: "pt-x" })).toBe(false);
  });
});

describe("resolvePatCredential", () => {
  it("exchanges the PAT for a job token and resolves the userId", async () => {
    stubExchange({ token: "jt-live", userId: "uid-42" });

    const resolved = await resolvePatCredential("pt-secret", { profile: INTL_PROFILE });

    expect(resolved.accessToken).toBe("jt-live");
    expect(resolved.userId).toBe("uid-42");
    expect(resolved.expiresAt).toBeGreaterThan(Date.now());

    const [exchangeUrl, exchangeInit] = callsTo("/jobToken/exchange")[0];
    expect(String(exchangeUrl)).toBe(INTL_PROFILE.jobTokenExchangeUrl);
    expect(exchangeInit.method).toBe("POST");
    // Plain JSON, not cosy-signed.
    expect(JSON.parse(exchangeInit.body)).toEqual({ personal_token: "pt-secret" });
    expect(exchangeInit.headers["Content-Type"]).toBe("application/json");
    expect(exchangeInit.headers["User-Agent"]).toBe("qodercli/1.0.0");
    expect(exchangeInit.headers["Cosy-Version"]).toBe(INTL_PROFILE.ideVersion);
    expect(exchangeInit.headers["Cosy-ClientType"]).toBe(INTL_PROFILE.clientType);

    const [userinfoUrl, userinfoInit] = callsTo("/userinfo")[0];
    expect(String(userinfoUrl)).toBe(INTL_PROFILE.userInfoUrl);
    expect(userinfoInit.headers.Authorization).toBe("Bearer jt-live");
  });

  it("defaults to a 24h lifetime when the server reports no expiry", async () => {
    stubExchange({ token: "jt-nodefault" });
    const before = Date.now();

    const resolved = await resolvePatCredential("pt-secret", { profile: INTL_PROFILE });

    const ttl = resolved.expiresAt - before;
    expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
  });

  it("reuses the cache on a second call inside the validity window", async () => {
    stubExchange({ token: "jt-cached", userId: "uid-c" });

    const first = await resolvePatCredential("pt-secret", { profile: INTL_PROFILE });
    const second = await resolvePatCredential("pt-secret", { profile: INTL_PROFILE });

    expect(second).toEqual(first);
    expect(callsTo("/jobToken/exchange")).toHaveLength(1);
    expect(callsTo("/userinfo")).toHaveLength(1);
  });

  it("bypasses the cache once inside the 5min refresh buffer", async () => {
    // expires_in is treated as milliseconds (upstream semantics), so 60s of
    // remaining life sits inside the 5min refresh buffer.
    stubExchange({ token: "jt-short", userId: "uid-s", expires_in: 60 * 1000 });

    await resolvePatCredential("pt-secret", { profile: INTL_PROFILE });
    await resolvePatCredential("pt-secret", { profile: INTL_PROFILE });

    expect(callsTo("/jobToken/exchange")).toHaveLength(2);
  });

  it("honours an absolute expires_at", async () => {
    const when = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    stubExchange({ token: "jt-abs", expires_at: when });

    const resolved = await resolvePatCredential("pt-secret", { profile: INTL_PROFILE });

    expect(resolved.expiresAt).toBe(Date.parse(when));
  });

  it("throws when the exchange fails", async () => {
    fetchMock.mockImplementation(async () => json({ message: "bad pat" }, 401));

    await expect(
      resolvePatCredential("pt-bad", { profile: INTL_PROFILE }),
    ).rejects.toThrow(/qoder PAT exchange failed: 401/);
    expect(callsTo("/userinfo")).toHaveLength(0);
  });

  it("throws when the exchange returns no job token", async () => {
    fetchMock.mockImplementation(async () => json({ refresh_token: "rt" }));

    await expect(
      resolvePatCredential("pt-empty", { profile: INTL_PROFILE }),
    ).rejects.toThrow(/returned no job token/);
  });

  it("still yields the job token with an empty userId when userinfo fails", async () => {
    stubExchange({ token: "jt-nouser", userinfoStatus: 403 });

    const resolved = await resolvePatCredential("pt-secret", { profile: INTL_PROFILE });

    expect(resolved.accessToken).toBe("jt-nouser");
    expect(resolved.userId).toBe("");
  });

  it("tolerates a thrown userinfo request", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("/jobToken/exchange")) return json({ token: "jt-throw" });
      throw new Error("network down");
    });

    const resolved = await resolvePatCredential("pt-secret", { profile: INTL_PROFILE });

    expect(resolved.accessToken).toBe("jt-throw");
    expect(resolved.userId).toBe("");
  });
});

describe("profile-driven PAT endpoints", () => {
  it("intl hits the intl host", async () => {
    stubExchange();

    await resolvePatCredential("pt-secret", { profile: "intl" });

    expect(String(callsTo("/jobToken/exchange")[0][0])).toContain("openapi.qoder.sh");
    expect(String(callsTo("/userinfo")[0][0])).toContain("openapi.qoder.sh");
  });

  it("cn-work hits the CN host", async () => {
    stubExchange({ userId: "uid-cn" });

    const resolved = await resolvePatCredential("pt-secret", { profile: "cn-work" });

    expect(resolved.userId).toBe("uid-cn");
    expect(String(callsTo("/jobToken/exchange")[0][0])).toBe(CN_WORK_PROFILE.jobTokenExchangeUrl);
    expect(String(callsTo("/jobToken/exchange")[0][0])).toContain("openapi.qoder.com.cn");
    expect(String(callsTo("/userinfo")[0][0])).toContain("openapi.qoder.com.cn");
    expect(callsTo("/jobToken/exchange")[0][1].headers["Cosy-ClientType"]).toBe(
      CN_WORK_PROFILE.clientType,
    );
  });

  it("keys the cache per profile so a PAT never leaks across regions", async () => {
    fetchMock.mockImplementation(async (url) => {
      const s = String(url);
      if (s.includes("/jobToken/exchange")) {
        return json({ token: s.includes("com.cn") ? "jt-cn" : "jt-intl" });
      }
      return json({ id: s.includes("com.cn") ? "uid-cn" : "uid-intl" });
    });

    const intl = await resolvePatCredential("pt-shared", { profile: "intl" });
    const cn = await resolvePatCredential("pt-shared", { profile: "cn-work" });

    expect(intl.accessToken).toBe("jt-intl");
    expect(cn.accessToken).toBe("jt-cn");
    expect(callsTo("/jobToken/exchange")).toHaveLength(2);
  });
});
