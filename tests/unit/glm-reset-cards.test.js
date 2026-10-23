import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getGlmResetCards, getGlmUsage, redeemGlmResetCard } from "../../open-sse/services/usage/glm.js";

const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.test:8080" };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
const envelope = (data, code = 200) => ({ success: true, code, data });
const inventory = (fiveHourResets = [], weekResets = []) => envelope({ fiveHourResets, weekResets });
const card = (recordId, expireTime = "2099-10-28 23:16:27", available = true) => ({ recordId, expireTime, available });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-28T16:00:00Z"));
});

afterEach(() => vi.restoreAllMocks());

describe("GLM reset-card inventory", () => {
  it("uses the registry URL, Bearer key, and connection proxy", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(inventory()));
    await expect(getGlmResetCards("key", proxyOptions)).resolves.toEqual({ availableCount: 0, cards: [] });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.z.ai/api/biz/customer-package-reset/list?targetType=PERSONAL",
      expect.objectContaining({ strictTls: true, redirect: "error", headers: { Authorization: "Bearer key", Accept: "application/json", "Content-Type": "application/json" } }),
      proxyOptions,
    );
  });

  it("filters unavailable, malformed IDs, and expired cards; sorts both types by expiry", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(inventory([
      card(2, "2099-01-03 03:04:05"), card(3, "2000-01-01 00:00:00"), card(4, undefined, false),
      card(true), card(" "), card(null), card({}), card(1.5), card(5, undefined, 1), null,
    ], [card("weekly", "2099-01-02 03:04:05"), card(0, "2099-01-04T00:00:00Z")])));
    const result = await getGlmResetCards("key");
    expect(result.availableCount).toBe(3);
    expect(result.cards.map(({ recordId, type }) => ({ recordId, type }))).toEqual([
      { recordId: "weekly", type: "WEEK" }, { recordId: 2, type: "FIVE_HOUR" }, { recordId: 0, type: "WEEK" },
    ]);
  });

  it("interprets timezone-less expiry as Beijing time and preserves explicit offsets", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(inventory([
      card(0), card(1, "2099-10-28T23:16:27Z"), card(2, "2099-10-28T23:16:27+08:00"),
      card(3, "2099-10-28T12:16:27-03:00"), card(4, "2099-10-28T23:16:27+0800"),
    ])));
    const { cards } = await getGlmResetCards("key");
    const expiry = Object.fromEntries(cards.map((c) => [c.recordId, c.expiresAt]));
    expect(expiry[0]).toBe("2099-10-28T15:16:27.000Z");
    expect(expiry[1]).toBe("2099-10-28T23:16:27.000Z");
    expect(expiry[2]).toBe(expiry[0]);
    expect(expiry[3]).toBe(expiry[0]);
    expect(expiry[4]).toBe(expiry[0]);
  });

  it("excludes the exact expiry boundary in Beijing time, not eight hours later", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(inventory([
      card(1, "2026-10-28 23:59:59"), card(2, "2026-10-29 00:00:00"), card(3, "2026-10-29 00:00:01"),
    ])));
    expect((await getGlmResetCards("key")).cards.map((c) => c.recordId)).toEqual([3]);
  });

  it.each([
    null, {}, { success: 1, code: 200, data: {} }, { success: true, code: "200", data: {} },
    { success: false, code: 200, data: {} }, envelope({}), envelope({ fiveHourResets: [], weekResets: null }),
    envelope({ fiveHourResets: {}, weekResets: [] }),
  ])("does not mistake a malformed or rejected envelope for empty inventory: %j", async (body) => {
    proxyAwareFetch.mockResolvedValueOnce(reply(body));
    await expect(getGlmResetCards("key")).rejects.toMatchObject({ status: 502 });
  });

  it.each([null, "", "garbage", "2099-02-30 00:00:00", "2099-01-01T25:00:00Z", 123])(
    "rejects invalid expiry: %j", async (expiry) => {
      proxyAwareFetch.mockResolvedValueOnce(reply(inventory([card(1, expiry)])));
      await expect(getGlmResetCards("key")).rejects.toMatchObject({ status: 502 });
    },
  );

  it.each([0, 200])("accepts successful business code %s", async (code) => {
    proxyAwareFetch.mockResolvedValueOnce(reply(envelope({ fiveHourResets: [], weekResets: [] }, code)));
    expect((await getGlmResetCards("key")).availableCount).toBe(0);
  });

  it.each([401, 403, 429, 500])("maps HTTP %s without leaking upstream response text", async (status) => {
    proxyAwareFetch.mockResolvedValueOnce(reply({ message: "secret-key-in-upstream-error" }, status));
    await expect(getGlmResetCards("key")).rejects.toMatchObject({ status: status < 500 ? status : 502 });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("sanitizes transport errors", async () => {
    proxyAwareFetch.mockRejectedValueOnce(new Error("key and proxy credentials"));
    await expect(getGlmResetCards("key")).rejects.toMatchObject({ status: 502 });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});

describe("GLM reset-card redemption", () => {
  it("posts only the selected card with one fresh UUID request ID per explicit attempt", async () => {
    proxyAwareFetch.mockImplementation(async () => reply(envelope(12)));
    for (let i = 0; i < 2; i++) {
      await expect(redeemGlmResetCard("key", { recordId: 12, type: "FIVE_HOUR" }, proxyOptions)).resolves.toMatchObject({ ok: true, uncertain: false });
    }
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    const bodies = proxyAwareFetch.mock.calls.map(([url, init, options]) => {
      expect(url).toBe("https://api.z.ai/api/biz/customer-package-reset/use");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer key");
      expect(init.strictTls).toBe(true);
      expect(init.redirect).toBe("error");
      expect(options).toEqual({ ...proxyOptions, strictProxy: true });
      const body = JSON.parse(init.body);
      expect(body).toEqual({ targetType: "PERSONAL", resetType: "FIVE_HOUR", recordId: 12, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      return body;
    });
    expect(bodies[0].requestId).not.toBe(bodies[1].requestId);
  });

  it.each([null, {}, { recordId: true, type: "WEEK" }, { recordId: " ", type: "WEEK" }, { recordId: 1.5, type: "WEEK" }, { recordId: 1, type: "FULL" }])(
    "rejects malformed card before network: %j", async (selected) => {
      await expect(redeemGlmResetCard("key", selected)).resolves.toMatchObject({ ok: false, uncertain: false, status: 400 });
      expect(proxyAwareFetch).not.toHaveBeenCalled();
    },
  );

  it.each([0, 200, 401, 403, 409, 500])("retains uncertainty after business rejection %s", async (code) => {
    proxyAwareFetch.mockResolvedValueOnce(reply({ success: false, code }));
    await expect(redeemGlmResetCard("key", { recordId: 1, type: "WEEK" })).resolves.toMatchObject({ ok: false, uncertain: true, status: 502 });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { success: true }, { success: true, code: 500 }])("marks ambiguous business reply uncertain: %j", async (body) => {
    proxyAwareFetch.mockResolvedValueOnce(reply(body));
    await expect(redeemGlmResetCard("key", { recordId: 1, type: "WEEK" })).resolves.toMatchObject({ ok: false, uncertain: true, status: 502 });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 408, 409, 429, 500, 503])("keeps failed HTTP %s uncertain and never retries", async (status) => {
    proxyAwareFetch.mockResolvedValueOnce(reply({}, status));
    await expect(redeemGlmResetCard("key", { recordId: 1, type: "WEEK" })).resolves.toMatchObject({ ok: false, uncertain: true, status: 502 });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry transport failure and never echoes the exception", async () => {
    proxyAwareFetch.mockRejectedValueOnce(new Error("secret-key"));
    const result = await redeemGlmResetCard("key", { recordId: 1, type: "WEEK" });
    expect(result).toMatchObject({ ok: false, uncertain: true, status: 502 });
    expect(result.message).not.toContain("secret-key");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("treats malformed JSON and HTTP 5xx as uncertain, without retries", async () => {
    for (const response of [new Response("not JSON"), reply({}, 500)]) {
      proxyAwareFetch.mockResolvedValueOnce(response);
      expect(await redeemGlmResetCard("key", { recordId: 1, type: "WEEK" })).toMatchObject({ ok: false, uncertain: true });
    }
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });
});

describe("best-effort GLM usage inventory", () => {
  const quota = envelope({ level: "pro", limits: [{ type: "CREDIT_LIMIT", unit: 3, number: 5, percentage: 25 }] });

  it("includes international inventory alongside quotas", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(quota)).mockResolvedValueOnce(reply(inventory([card(1)])));
    expect(await getGlmUsage("key", "glm", proxyOptions)).toMatchObject({ plan: "Pro", resetCards: { availableCount: 1 }, quotas: { "Session (5h)": { used: 25 } } });
  });

  it("omits failed inventory without losing quota data", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(quota)).mockRejectedValueOnce(new Error("inventory down"));
    const result = await getGlmUsage("key", "glm");
    expect(result).toMatchObject({ plan: "Pro", quotas: { "Session (5h)": { used: 25 } } });
    expect(result.resetCards).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("does not call unverified CN reset endpoints", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(quota));
    const result = await getGlmUsage("key", "glm-cn");
    expect(result.resetCards).toBeUndefined();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});
