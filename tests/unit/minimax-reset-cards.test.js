import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getMiniMaxResetCards, redeemMiniMaxResetCard, getMiniMaxResetCardFlows, getMiniMaxCodeUsage } from "../../open-sse/services/minimaxCodeUsage.js";

const provider = "minimax-code-global";
const envelope = (body) => ({ base_resp: { status_code: 0 }, ...body });
const reply = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const card = (id, expires = Date.now() + 60000) => ({ card_id: String(id), source_type: " mcode_signin ", out_biz_no: ` original-${id} `, expire_time: expires });
const originalFetch = globalThis.fetch;
beforeEach(() => proxyAwareFetch.mockReset());
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("MiniMax reset-card API", () => {
  it("paginates, deduplicates before expiry filtering, preserves identity and sorts by expiry", async () => {
    const a = card(1), b = card(2, Date.now() + 30000), expired = card(0, 1);
    proxyAwareFetch.mockResolvedValueOnce(reply(envelope({ cards: [expired, a], total: 3 })))
      .mockResolvedValueOnce(reply(envelope({ cards: [a, b], total: 3 })));
    const result = await getMiniMaxResetCards("token", provider, { trace: true });
    expect(result.availableCount).toBe(2);
    expect(result.cards.map((entry) => entry.cardId)).toEqual(["2", "1"]);
    expect(result.cards[0]).toMatchObject({ source_type: b.source_type, out_biz_no: b.out_biz_no, type: "FULL", createdAt: null });
    expect(proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual([1, 2].map((page) => `https://platform.minimax.io/backend/account/reset_card/list?page=${page}&size=5`));
    expect(proxyAwareFetch.mock.calls[0].slice(1)).toEqual([expect.objectContaining({ headers: { Authorization: "Bearer token", Accept: "application/json", "Content-Type": "application/json" }, strictTls: true, redirect: "error", signal: expect.any(AbortSignal) }), { trace: true }]);
  });

  it("accepts absent cards only with a successful valid empty envelope", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(envelope({ total: 0 })));
    expect(await getMiniMaxResetCards("token", provider)).toEqual({ availableCount: 0, cards: [] });
  });

  it.each([
    { total: 0 }, envelope({ total: 0, base_resp: { status_code: false } }), envelope({ total: 0, base_resp: { status_code: "0" } }),
    envelope({ total: "1", cards: [] }), envelope({ total: 10001, cards: [] }), envelope({ total: 1, cards: null }),
    ...[{ card_id: 3 }, { source_type: " " }, { out_biz_no: null }, { expire_time: 0 }, { expire_time: 1.5 }, { expire_time: 1e21 }].map((patch) => envelope({ total: 1, cards: [{ ...card(1), ...patch }] })),
  ])("rejects malformed inventory rather than reporting no cards: %j", async (body) => {
    proxyAwareFetch.mockResolvedValueOnce(reply(body));
    await expect(getMiniMaxResetCards("token", provider)).rejects.toMatchObject({ status: 502 });
  });

  it.each([[401, 401], [403, 403], [429, 429], [500, 502]])("maps HTTP %s without leaking response details", async (http, status) => {
    proxyAwareFetch.mockResolvedValueOnce(reply({ message: "private credential" }, http));
    const error = await getMiniMaxResetCards("token", provider).catch((value) => value);
    expect(error.status).toBe(status);
    expect(error.message).not.toContain("private credential");
  });
  it.each([1004, 1011, 1024])("classifies OAuth refusal %s", async (status_code) => {
    proxyAwareFetch.mockResolvedValueOnce(reply({ base_resp: { status_code } }));
    await expect(getMiniMaxResetCards("token", provider)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects empty/repeating/infinite pagination instead of returning partial inventory", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(envelope({ cards: [], total: 1 })));
    await expect(getMiniMaxResetCards("token", provider)).rejects.toMatchObject({ status: 502 });
    proxyAwareFetch.mockResolvedValue(reply(envelope({ cards: [card(1)], total: 3 })));
    await expect(getMiniMaxResetCards("token", provider)).rejects.toMatchObject({ status: 502 });
    let id = 0;
    proxyAwareFetch.mockReset().mockImplementation(async () => reply(envelope({ cards: [card(++id)], total: 10000 })));
    await expect(getMiniMaxResetCards("token", provider)).rejects.toMatchObject({ status: 502 });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(100);
  });

  it.each(["SUCCESS", "REPLAYED", "EXPIRED", "NOT_FOUND", "RETRYABLE_FAIL", "LOCK_BUSY"])("handles %s after exactly one POST with original identity", async (outcome) => {
    const selected = card(1);
    proxyAwareFetch.mockResolvedValueOnce(reply(envelope({ outcome })));
    expect(await redeemMiniMaxResetCard("token", provider, selected, { trace: true })).toMatchObject({
      ok: outcome === "SUCCESS", alreadyUsed: outcome === "REPLAYED", uncertain: outcome === "LOCK_BUSY", code: outcome,
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch).toHaveBeenCalledWith("https://platform.minimax.io/backend/account/reset_card/use", expect.objectContaining({ method: "POST", body: JSON.stringify({ source_type: selected.source_type, out_biz_no: selected.out_biz_no }), strictTls: true, redirect: "error" }), { trace: true, strictProxy: true });
  });

  it.each([reply(envelope({})), reply(envelope({ outcome: "UNKNOWN" })), reply("bad JSON"), reply({}, 401), reply({}, 500), reply({ outcome: "SUCCESS" }), reply({ outcome: "SUCCESS", base_resp: { status_code: 1004 } })])("keeps ambiguous mutations uncertain without replay", async (response) => {
    proxyAwareFetch.mockResolvedValueOnce(response);
    expect(await redeemMiniMaxResetCard("token", provider, card(1))).toMatchObject({ ok: false, uncertain: true });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry transport failures or expose exceptions", async () => {
    proxyAwareFetch.mockRejectedValueOnce(new Error("private proxy credential"));
    const result = await redeemMiniMaxResetCard("token", provider, card(1));
    expect(result).toMatchObject({ ok: false, uncertain: true });
    expect(result.message).not.toContain("private proxy credential");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
  it("never sends malformed or expired identities", async () => {
    for (const selected of [null, { ...card(1), card_id: "" }, { ...card(1), source_type: " " }, { ...card(1), expire_time: 1e21 }, card(1, 1)]) {
      expect(await redeemMiniMaxResetCard("token", provider, selected)).toMatchObject({ ok: false, attempted: false });
    }
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("reads all history pages, including short pages, with a fixed 30-day cutoff and exact USE semantics", async () => {
    const flows = [{ card_id: "1", event_type: "GRANT", create_time: 1 }, { card_id: "1", event_type: "USE", create_time: 2 }];
    proxyAwareFetch.mockResolvedValueOnce(reply(envelope({ flows: [flows[0]], total: 2 })))
      .mockResolvedValueOnce(reply(envelope({ flows: [flows[1]], total: 2 })));
    expect(await getMiniMaxResetCardFlows("token", provider)).toEqual([
      { cardId: "1", eventType: "GRANT", createdAt: new Date(1).toISOString() }, { cardId: "1", eventType: "USE", createdAt: new Date(2).toISOString() },
    ]);
    const urls = proxyAwareFetch.mock.calls.map(([url]) => new URL(url));
    expect(urls[1].searchParams.get("page")).toBe("2");
    expect(urls[0].searchParams.get("create_time")).toBe(urls[1].searchParams.get("create_time"));
    expect(Number(urls[0].searchParams.get("create_time"))).toBeGreaterThan(Date.now() - 31 * 86400000);
  });
  it.each([envelope({ flows: null, total: 1 }), envelope({ flows: [], total: 2 }), envelope({ flows: ["bad"], total: 1 })])("rejects incomplete or malformed history", async (body) => {
    proxyAwareFetch.mockResolvedValueOnce(reply(body));
    await expect(getMiniMaxResetCardFlows("token", provider)).rejects.toMatchObject({ status: 502 });
  });
  it("rejects repeating history pages and caps unlimited unique pages", async () => {
    proxyAwareFetch.mockResolvedValue(reply(envelope({ flows: [{ card_id: "1", event_type: "USE", create_time: 1 }], total: 3 })));
    await expect(getMiniMaxResetCardFlows("token", provider)).rejects.toMatchObject({ status: 502 });
    let id = 0;
    proxyAwareFetch.mockReset().mockImplementation(async () => reply(envelope({ flows: [{ card_id: String(++id), event_type: "USE", create_time: id }], total: 10000 })));
    await expect(getMiniMaxResetCardFlows("token", provider)).rejects.toMatchObject({ status: 502 });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(100);
  });
  it("never contacts unverified CN reset hosts", async () => {
    for (const operation of [getMiniMaxResetCards, getMiniMaxResetCardFlows]) await expect(operation("token", "minimax-code")).rejects.toMatchObject({ status: 400 });
    await expect(redeemMiniMaxResetCard("token", "minimax-code", card(1))).rejects.toMatchObject({ status: 400 });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("adds public inventory best-effort to OAuth usage and leaves other connections untouched", async () => {
    globalThis.fetch = vi.fn(async () => reply({ workspaces: [] }));
    const connection = { provider, authType: "oauth", accessToken: "token", providerSpecificData: { realUserID: "123" } };
    proxyAwareFetch.mockResolvedValueOnce(reply(envelope({ cards: [card(1)], total: 1 })));
    const usage = await getMiniMaxCodeUsage(connection);
    expect(usage.quotas.Plan).toBeDefined();
    expect(usage.resetCards.availableCount).toBe(1);
    expect(usage.resetCards.cards[0]).not.toHaveProperty("out_biz_no");
    proxyAwareFetch.mockRejectedValueOnce(new Error("down"));
    expect((await getMiniMaxCodeUsage(connection)).resetCards).toBeUndefined();
    proxyAwareFetch.mockClear();
    await getMiniMaxCodeUsage({ ...connection, authType: "apikey" });
    await getMiniMaxCodeUsage({ ...connection, authType: "mcode-lease", accessToken: "" });
    await getMiniMaxCodeUsage({ ...connection, provider: "minimax-code" });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
