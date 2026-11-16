// Qoder job-token lifecycle: the PAT (pt-) is exchanged for a short-lived job
// token (jt-) plus a rotating job refresh token (jrt-). qodercli 1.1.85 rotates
// via POST /api/v1/jobToken/refresh (Bearer = current jt-, body =
// {refresh_token: <jrt-}); the device-flow /api/v1/deviceToken/refresh only
// accepts drt- tokens and rejects jrt- ones. When upstream invalidates the
// cached jt- early (403/code 105 "Login expired"), the executor must drop the
// cache entry and retry once with a freshly exchanged token instead of
// surfacing a transient-looking 403 that cools the account down for 2 minutes
// and then fails identically forever.
//
// proxyAwareFetch captures globalThis.fetch at import time, so every test
// stubs the global BEFORE (re)importing the module — the same pattern as
// qoder-proxy-replay.test.js.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mockUndiciFetch } from "./helpers/mockUndiciFetch.js";

const PAT = "pt-testpat0000000000000000";
const JT_1 = "jt-first0000000000000000000";
const JT_2 = "jt-second000000000000000000";
const JRT_1 = "jrt-first000000000000000000";
const JRT_2 = "jrt-second00000000000000000";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeFetchMock() {
  const calls = [];
  const impl = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body || null });
    throw new Error(`unexpected url ${url}`);
  });
  impl.calls = calls;
  return impl;
}

async function loadModules(fetchImpl) {
  vi.resetModules();
  const fetchMock = mockUndiciFetch(fetchImpl);
  const mod = await import("../../open-sse/services/qoderModels.js");
  const constants = await import("../../open-sse/shared/qoder/constants.js");
  return { mod, constants, fetchMock };
}

const creds = (overrides = {}) => ({
  apiKey: PAT,
  accessToken: "",
  provider: "qoder",
  connectionId: "conn-1",
  providerSpecificData: {},
  ...overrides,
});

function routeExchange(mock, handlers) {
  mock.mockImplementation(async (url, init = {}) => {
    const u = String(url);
    mock.calls.push({ url: u, method: init.method || "GET", body: init.body || null });
    for (const [match, handler] of handlers) {
      if (u.includes(match)) return handler(url, init);
    }
    throw new Error(`unexpected url ${u}`);
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("qoderJobTokenRefreshUrl", () => {
  it("targets the openApi jobToken refresh endpoint, not the device-flow one", async () => {
    const { constants } = await loadModules(makeFetchMock());
    expect(constants.qoderJobTokenRefreshUrl("intl")).toBe("https://openapi.qoder.sh/api/v1/jobToken/refresh");
    expect(constants.qoderJobTokenRefreshUrl("intl")).not.toContain("deviceToken");
    expect(constants.qoderJobTokenRefreshUrl("cn")).toBe("https://openapi.qoder.com.cn/api/v1/jobToken/refresh");
  });

  it("is separate from the exchange endpoint", async () => {
    const { constants } = await loadModules(makeFetchMock());
    expect(constants.qoderJobTokenRefreshUrl("intl")).not.toBe(constants.qoderJobTokenExchangeUrl("intl"));
  });
});

describe("resolveQoderCredentials job-token cache", () => {
  it("exchanges a PAT and resolves the userId", async () => {
    const mock = makeFetchMock();
    routeExchange(mock, [
      ["jobToken/exchange", () => jsonResponse({ token: JT_1, refresh_token: JRT_1, expires_in: 86400000 })],
      ["userinfo", () => jsonResponse({ id: "user-1" })],
    ]);
    const { mod } = await loadModules(mock);

    const resolved = await mod.resolveQoderCredentials(creds(), null, null, "intl");
    expect(resolved.accessToken).toBe(JT_1);
    expect(resolved.apiKey).toBe("");
    expect(resolved.providerSpecificData.userId).toBe("user-1");
  });

  it("serves the cached jt- without a second exchange while it is fresh", async () => {
    const mock = makeFetchMock();
    routeExchange(mock, [
      ["jobToken/exchange", () => jsonResponse({ token: JT_1, refresh_token: JRT_1, expires_in: 86400000 })],
      ["userinfo", () => jsonResponse({ id: "user-1" })],
    ]);
    const { mod } = await loadModules(mock);

    await mod.resolveQoderCredentials(creds(), null, null, "intl");
    await mod.resolveQoderCredentials(creds(), null, null, "intl");
    const exchanges = mock.calls.filter((c) => c.url.includes("jobToken/exchange"));
    expect(exchanges).toHaveLength(1);
  });

  it("rotates via jobToken/refresh when the cache is invalidated and a jrt- is held", async () => {
    const mock = makeFetchMock();
    let exchanges = 0;
    let refreshes = 0;
    routeExchange(mock, [
      ["jobToken/exchange", () => {
        exchanges += 1;
        return jsonResponse({ token: JT_1, refresh_token: JRT_1, expires_in: 86400000 });
      }],
      ["jobToken/refresh", (_u, init) => {
        refreshes += 1;
        expect(JSON.parse(init.body)).toEqual({ refresh_token: JRT_1 });
        return jsonResponse({ token: JT_2, refresh_token: JRT_2, expires_in: 86400000 });
      }],
      ["userinfo", () => jsonResponse({ id: "user-1" })],
    ]);
    const { mod } = await loadModules(mock);

    await mod.resolveQoderCredentials(creds(), null, null, "intl");
    // Upstream invalidated the jt- early: drop the cache, resolve again.
    expect(mod.invalidateQoderJobToken(creds())).toBe(true);
    const resolved = await mod.resolveQoderCredentials(creds(), null, null, "intl");
    expect(resolved.accessToken).toBe(JT_2);
    expect(exchanges).toBe(1);
    expect(refreshes).toBe(1);
  });

  it("falls back to a PAT re-exchange when rotation is rejected", async () => {
    const mock = makeFetchMock();
    let exchanges = 0;
    routeExchange(mock, [
      ["jobToken/exchange", () => {
        exchanges += 1;
        return jsonResponse({ token: exchanges === 1 ? JT_1 : JT_2, refresh_token: JRT_1, expires_in: 86400000 });
      }],
      ["jobToken/refresh", () => jsonResponse({ errorCode: "JobRefreshTokenInvalid" }, 401)],
      ["userinfo", () => jsonResponse({ id: "user-1" })],
    ]);
    const { mod } = await loadModules(mock);

    await mod.resolveQoderCredentials(creds(), null, null, "intl");
    mod.invalidateQoderJobToken(creds());
    const resolved = await mod.resolveQoderCredentials(creds(), null, null, "intl");
    expect(resolved.accessToken).toBe(JT_2);
    expect(exchanges).toBe(2);
  });

  it("does not rotate non-PAT credentials and never touches the network", async () => {
    const mock = makeFetchMock();
    const { mod } = await loadModules(mock);
    const dtCreds = { apiKey: "dt-device000000000000000000", accessToken: "dt-device000000000000000000", providerSpecificData: { userId: "u" } };
    const resolved = await mod.resolveQoderCredentials(dtCreds, null, null, "intl");
    expect(resolved).toBe(dtCreds);
    expect(mock).not.toHaveBeenCalled();
  });

  it("re-exchanges a PAT after its cached token hit upstream expiry", async () => {
    const mock = makeFetchMock();
    let exchanges = 0;
    routeExchange(mock, [
      ["jobToken/exchange", () => {
        exchanges += 1;
        return jsonResponse({ token: exchanges === 1 ? JT_1 : JT_2, refresh_token: JRT_1, expires_in: 1000 });
      }],
      ["userinfo", () => jsonResponse({ id: "user-1" })],
    ]);
    const { mod } = await loadModules(mock);

    const first = await mod.resolveQoderCredentials(creds(), null, null, "intl");
    expect(first.accessToken).toBe(JT_1);
    // expires_in:1000 is inside the 5-minute refresh buffer → next resolve rotates.
    const second = await mod.resolveQoderCredentials(creds(), null, null, "intl");
    expect(second.accessToken).toBe(JT_2);
    expect(exchanges).toBe(2);
  });
});

describe("isQoderPat", () => {
  it("recognises the pt- prefix only", async () => {
    const { mod } = await loadModules(makeFetchMock());
    expect(mod.isQoderPat(PAT)).toBe(true);
    expect(mod.isQoderPat("jt-something")).toBe(false);
    expect(mod.isQoderPat("drt-something")).toBe(false);
    expect(mod.isQoderPat(undefined)).toBe(false);
  });
});
