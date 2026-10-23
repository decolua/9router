// Compact contract matrix for the MiniMax reset-card route (the old mixin
// helper was deleted; outcome normalization is proven through POST results).
// Services, DB, proxy resolution and credential refresh are mocked; the
// durable state helpers (miniMaxResetState) run real against a fake DB map.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
  getMiniMaxResetCards: vi.fn(),
  redeemMiniMaxResetCard: vi.fn(),
  getMiniMaxResetCardFlows: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/db/index.js", () => ({ getProviderConnectionById: mocks.getProviderConnectionById, updateProviderConnection: mocks.updateProviderConnection }));
vi.mock("@/lib/miniMaxResetState.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Real CAS load/save against the fake DB map; updateProviderConnection is the write.
    writeMiniMaxResetPending: async (id, accountKey, expected, next) => {
      await actual.loadMiniMaxResetState(id, accountKey, expected);
      try {
        if (!await mocks.updateProviderConnection(id, { miniMaxResetPending: next })) throw new Error();
      } catch {
        throw actual.miniMaxResetStateError("state_unavailable", "Could not save MiniMax reset recovery state.", expected || next, 503);
      }
      return actual.loadMiniMaxResetState(id, accountKey, next);
    },
  };
});
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig }));
vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({ refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials }));
vi.mock("open-sse/services/usage.js", () => ({
  getMiniMaxResetCards: mocks.getMiniMaxResetCards,
  redeemMiniMaxResetCard: mocks.redeemMiniMaxResetCard,
  getMiniMaxResetCardFlows: mocks.getMiniMaxResetCardFlows,
}));

const route = () => import("../../src/app/api/usage/[connectionId]/minimax-reset-cards/route.js");
const ctx = (id = "conn_1") => ({ params: Promise.resolve({ connectionId: id }) });
const mmGet = (query = "", id = "conn_1") => new Request(`http://localhost/api/usage/${id}/minimax-reset-cards${query}`);
const mmPost = (body, id = "conn_1") => {
  if (body?.retry === true && !Object.hasOwn(body, "attemptId")) {
    body = { ...body, attemptId: connections.get(id)?.miniMaxResetPending?.attemptId || "missing-attempt" };
  }
  return new Request(`http://localhost/api/usage/${id}/minimax-reset-cards`, {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
};
const authError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
const mmToken = (claims = { sub: "account-fixture", iss: "https://identity.example" }) =>
  `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`;

const MM_CONNECTION = { id: "conn_1", provider: "minimax-code-global", authType: "oauth", accessToken: mmToken(), refreshToken: "mm-refresh-token", providerSpecificData: {} };
const MM_CARD = { cardId: "card_mm_1", source_type: "subscription_reset", out_biz_no: "biz-7", type: "FULL", expiresAt: "2099-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" };
const MM_INVENTORY = { availableCount: 1, cards: [MM_CARD] };
const MM_PUBLIC_CARD = { cardId: "card_mm_1", type: "FULL", expiresAt: MM_CARD.expiresAt };
const MM_SUCCESS = { ok: true, alreadyUsed: false, uncertain: false, status: 200, code: "SUCCESS", message: "reset applied", attempted: true };
const MM_UNKNOWN = { ok: false, alreadyUsed: false, uncertain: true, status: 502, code: "uncertain", message: "not confirmed", attempted: true };
// The shared resolver returns pool metadata; the route spreads it into service
// options with strictProxy relaxed. Pool data must never appear in responses.
const PROXY_RESOLVED = { source: "pool", proxyPoolId: "pool_mm", proxyPool: { id: "pool_mm", proxyUrl: "http://proxy.local:8080", strictProxy: true }, connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.local:8080", connectionNoProxy: "", strictProxy: true };
const SERVICE_PROXY = { ...PROXY_RESOLVED, strictProxy: false };

let connections;
const storedMM = () => connections.get("conn_1");
const setMM = (patch) => connections.set("conn_1", { ...storedMM(), ...patch });

async function seedPending(state = "uncertain", card = MM_CARD) {
  const { createMiniMaxResetPending, miniMaxAccountKey } = await import("../../src/lib/miniMaxResetState.js");
  const pending = { ...createMiniMaxResetPending(miniMaxAccountKey(MM_CONNECTION.accessToken), card), state };
  setMM({ miniMaxResetPending: pending });
  return pending;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  connections = new Map([["conn_1", structuredClone(MM_CONNECTION)]]);
  mocks.getProviderConnectionById.mockReset().mockImplementation(async (id) => structuredClone(connections.get(id) || null));
  mocks.updateProviderConnection.mockReset().mockImplementation(async (id, patch) => {
    if (!connections.has(id)) return null;
    const updated = { ...connections.get(id), ...structuredClone(patch) };
    connections.set(id, updated);
    return structuredClone(updated);
  });
  mocks.resolveConnectionProxyConfig.mockReset().mockResolvedValue(structuredClone(PROXY_RESOLVED));
  mocks.getMiniMaxResetCards.mockReset().mockResolvedValue(MM_INVENTORY);
  mocks.getMiniMaxResetCardFlows.mockReset().mockResolvedValue([]);
  mocks.redeemMiniMaxResetCard.mockReset().mockResolvedValue(MM_SUCCESS);
  mocks.refreshAndUpdateCredentials.mockReset().mockImplementation(async (connection) => ({ connection }));
});

describe("minimax reset-card guards", () => {
  it.each([
    ["CN provider", { provider: "minimax-code" }],
    ["plain provider", { provider: "minimax" }],
    ["API key auth", { authType: "apikey" }],
    ["lease auth", { authType: "mcode-lease" }],
    ["missing access token", { accessToken: "" }],
  ])("rejects %s before proxy or upstream work", async (_label, patch) => {
    setMM(patch);
    const { GET, POST } = await route();
    expect((await GET(mmGet(), ctx())).status).toBe(400);
    expect((await POST(mmPost({ cardId: MM_CARD.cardId }), ctx())).status).toBe(400);
    expect(mocks.resolveConnectionProxyConfig).not.toHaveBeenCalled();
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
  });

  it("404 for missing connection; invalid query/body rejected before DB reads", async () => {
    const { GET, POST } = await route();
    expect((await GET(mmGet("", "missing"), ctx("missing"))).status).toBe(404);
    for (const invalid of ["?cardId=%20", `?cardId=${"x".repeat(257)}`]) expect((await GET(mmGet(invalid), ctx())).status).toBe(400);
    for (const body of ["{not json", "null"]) expect((await POST(mmPost(body), ctx())).status).toBe(400);
    expect((await POST(mmPost({ cardId: "x".repeat(257) }), ctx())).status).toBe(400);
    expect(mocks.getProviderConnectionById).toHaveBeenCalledTimes(1); // only the 404 lookup
  });

  it.each([{ retry: "true" }, { acknowledge: "true" }, { retry: true, acknowledge: true }, { acknowledge: true }])("rejects malformed recovery controls %o", async (extra) => {
    const { POST } = await route();
    expect((await POST(mmPost({ cardId: MM_CARD.cardId, ...extra }), ctx())).status).toBe(400);
    expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
  });

  it("blocks malformed durable records instead of discarding them", async () => {
    setMM({ miniMaxResetPending: { card: MM_CARD } });
    const { GET, POST } = await route();
    expect(await (await GET(mmGet(), ctx())).json()).toMatchObject({ code: "invalid_pending", uncertain: true });
    expect(await (await POST(mmPost({ cardId: MM_CARD.cardId }), ctx())).json()).toMatchObject({ code: "invalid_pending", uncertain: true });
    expect(storedMM().miniMaxResetPending).toEqual({ card: MM_CARD });
    expect(mocks.getMiniMaxResetCards).not.toHaveBeenCalled();
  });

  it.each(["changed", "unknown"])("refuses reads, retries and ack when account is %s", async (kind) => {
    const pending = await seedPending();
    setMM({ accessToken: kind === "changed" ? mmToken({ sub: "other-account" }) : "old" });
    const { GET, POST } = await route();
    for (const request of [mmGet(), mmPost({ cardId: MM_CARD.cardId, retry: true }), mmPost({ cardId: MM_CARD.cardId, acknowledge: true, attemptId: pending.attemptId })]) {
      const response = await (request.method === "GET" ? GET : POST)(request, ctx());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ uncertain: true, code: kind === "changed" ? "account_changed" : "account_unavailable", pending: { attemptId: pending.attemptId } });
    }
    expect(storedMM().miniMaxResetPending).toEqual(pending);
    expect(mocks.refreshAndUpdateCredentials).not.toHaveBeenCalled();
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
  });
});

describe("minimax reset-card reads", () => {
  it.each([401, 403])("force-refreshes once and retries inventory on explicit HTTP %i with shared relaxed proxy options", async (status) => {
    const token = mmToken({ sub: "account-fixture", iss: "https://identity.example", iat: 1234 });
    mocks.refreshAndUpdateCredentials.mockImplementation(async (connection, force) => {
      if (!force) return { connection };
      setMM({ accessToken: token });
      return { connection: { ...connection, accessToken: token } };
    });
    mocks.getMiniMaxResetCards.mockRejectedValueOnce(authError(status)).mockResolvedValue(MM_INVENTORY);
    const { GET } = await route();
    const body = await (await GET(mmGet(), ctx())).json();
    expect(mocks.refreshAndUpdateCredentials).toHaveBeenNthCalledWith(2, MM_CONNECTION, true, SERVICE_PROXY);
    expect(mocks.getMiniMaxResetCards).toHaveBeenNthCalledWith(2, token, "minimax-code-global", SERVICE_PROXY);
    expect(mocks.getMiniMaxResetCards).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(body)).not.toContain("pool_mm"); // pool metadata never leaves the server
  });

  it("no retry without a refresh token, none for non-auth 4xx, none for message-only auth hints", async () => {
    const { GET } = await route();
    setMM({ refreshToken: null });
    mocks.getMiniMaxResetCards.mockRejectedValueOnce(authError(403));
    expect((await GET(mmGet(), ctx())).status).toBe(401);
    setMM({ refreshToken: "mm-refresh-token" });
    mocks.getMiniMaxResetCards.mockRejectedValueOnce(authError(429));
    expect((await GET(mmGet(), ctx())).status).toBe(429);
    mocks.getMiniMaxResetCards.mockRejectedValueOnce(new Error("Unauthorized 401 in body"));
    expect((await GET(mmGet(), ctx())).status).toBe(502);
    expect(mocks.refreshAndUpdateCredentials).toHaveBeenCalledTimes(3);
    expect(mocks.getMiniMaxResetCards).toHaveBeenCalledTimes(3); // exactly one call each
  });

  it.each([false, true])("sanitizes credential refresh failures (forced: %s)", async (forced) => {
    mocks.refreshAndUpdateCredentials.mockImplementation(async (connection, force) => {
      if (forced && !force) return { connection };
      throw new Error("refresh token revoked: fixture-secret");
    });
    if (forced) mocks.getMiniMaxResetCards.mockRejectedValueOnce(authError(401));
    const { GET } = await route();
    const body = await (await GET(mmGet(), ctx())).json();
    expect(body.error).toBe("Credential refresh failed. Please re-authorize the connection.");
    expect(JSON.stringify(body)).not.toContain("fixture-secret");
    expect(mocks.getMiniMaxResetCards).toHaveBeenCalledTimes(forced ? 1 : 0);
  });

  it("sanitizes unexpected DB exceptions; malformed inventories fail closed; responses strip native identity", async () => {
    const { GET } = await route();
    mocks.getProviderConnectionById.mockRejectedValueOnce(new Error("SQLite: fixture-private-path"));
    const crashed = await GET(mmGet(), ctx());
    expect(crashed.status).toBe(500);
    expect(JSON.stringify(await crashed.json())).not.toContain("fixture-private-path");
    mocks.getMiniMaxResetCards.mockResolvedValueOnce({ nope: true });
    expect((await GET(mmGet(), ctx())).status).toBe(502);
    const body = await (await GET(mmGet(), ctx())).json();
    expect(body).toEqual({ availableCount: 1, cards: [MM_PUBLIC_CARD], pending: null });
    for (const secret of ["subscription_reset", "biz-7", "account-fixture", "pool_mm"]) expect(JSON.stringify(body)).not.toContain(secret);
  });

  it.each([
    ["no events", [], false],
    ["GRANT only", [{ cardId: MM_CARD.cardId, eventType: "GRANT" }], false],
    ["padded cardId", [{ cardId: ` ${MM_CARD.cardId} `, eventType: "USE" }], false],
    ["exact USE", [{ cardId: MM_CARD.cardId, eventType: "USE" }], true],
  ])("proof requires an exact USE event: %s", async (_label, flows, used) => {
    const pending = await seedPending();
    mocks.getMiniMaxResetCardFlows.mockResolvedValue(flows);
    const { GET } = await route();
    const response = await GET(mmGet(`?cardId=${MM_CARD.cardId}`), ctx());
    expect(await response.json()).toMatchObject({ used, pending: { attemptId: pending.attemptId, state: used ? "refreshing" : "uncertain" } });
    expect(storedMM().miniMaxResetPending).toEqual({ ...pending, state: used ? "refreshing" : "uncertain" });
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
  });

  it("history errors are never proof; USE for other cards cannot reconcile; no pending means no write", async () => {
    const pending = await seedPending();
    mocks.getMiniMaxResetCardFlows.mockRejectedValueOnce(authError(500));
    const { GET } = await route();
    const failed = await GET(mmGet(`?cardId=${MM_CARD.cardId}`), ctx());
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ uncertain: true, pending: { state: "uncertain" } });
    expect(storedMM().miniMaxResetPending).toEqual(pending);
    mocks.getMiniMaxResetCardFlows.mockResolvedValue([{ cardId: "other", eventType: "USE" }]);
    expect(await (await GET(mmGet("?cardId=other"), ctx())).json()).toMatchObject({ used: true, pending: { state: "uncertain" } });
    setMM({ miniMaxResetPending: null });
    mocks.getMiniMaxResetCardFlows.mockResolvedValue([{ cardId: MM_CARD.cardId, eventType: "USE" }]);
    expect(await (await GET(mmGet(`?cardId=${MM_CARD.cardId}`), ctx())).json()).toEqual({ used: true, pending: null });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});

describe("minimax reset-card POST", () => {
  it("persists the canonical server card before its single POST; injected native fields ignored", async () => {
    mocks.redeemMiniMaxResetCard.mockImplementation(async (_token, _provider, card) => {
      expect(storedMM().miniMaxResetPending).toMatchObject({ card: MM_CARD, state: "uncertain" });
      expect(card).toEqual(MM_CARD);
      return MM_SUCCESS;
    });
    const { POST } = await route();
    const response = await POST(mmPost({ cardId: MM_CARD.cardId, source_type: "injected", out_biz_no: "injected" }), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reset: true, alreadyUsed: false, pending: { card: MM_PUBLIC_CARD, state: "refreshing" } });
    expect(mocks.redeemMiniMaxResetCard).toHaveBeenCalledTimes(1);
  });

  it("first journal write failure sends no redemption (503)", async () => {
    mocks.updateProviderConnection.mockRejectedValueOnce(new Error("disk full secret"));
    const { POST } = await route();
    const response = await POST(mmPost({ cardId: MM_CARD.cardId }), ctx());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reset: false, uncertain: true, code: "state_unavailable" });
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
  });

  it("journal read-back failure aborts before redemption and retains identity", async () => {
    const update = mocks.updateProviderConnection.getMockImplementation();
    mocks.updateProviderConnection.mockImplementationOnce(async (...args) => {
      const result = await update(...args);
      mocks.getProviderConnectionById.mockRejectedValueOnce(new Error("read failed"));
      return result;
    });
    const { POST } = await route();
    const response = await POST(mmPost({ cardId: MM_CARD.cardId }), ctx());
    expect(response.status).toBe(503);
    expect(storedMM().miniMaxResetPending.card).toEqual(MM_CARD);
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
  });

  it.each([false, true])("explicit retry reuses the durable original identity without inventory (inventory changed: %s)", async (changed) => {
    const pending = await seedPending();
    mocks.getMiniMaxResetCards.mockResolvedValue(changed ? { availableCount: 1, cards: [{ ...MM_CARD, source_type: "changed", out_biz_no: "changed" }] } : { availableCount: 0, cards: [] });
    mocks.redeemMiniMaxResetCard.mockResolvedValue(MM_UNKNOWN);
    const { POST } = await route();
    const response = await POST(mmPost({ cardId: MM_CARD.cardId, retry: true, source_type: "injected", out_biz_no: "injected" }), ctx());
    expect(response.status).toBe(502);
    expect(mocks.getMiniMaxResetCards).not.toHaveBeenCalled();
    expect(mocks.redeemMiniMaxResetCard).toHaveBeenCalledWith(MM_CONNECTION.accessToken, "minimax-code-global", pending.card, SERVICE_PROXY);
    expect(storedMM().miniMaxResetPending).toEqual(pending);
  });

  it.each([
    ["regular same card", { cardId: MM_CARD.cardId }, true, 409, "reset_pending"],
    ["regular other card", { cardId: "other" }, true, 409, "reset_pending"],
    ["retry for another card", { cardId: "other", retry: true }, true, 409, "reset_pending"],
    ["retry with stale attempt ID", { cardId: MM_CARD.cardId, retry: true, attemptId: "stale" }, true, 409, "reset_pending"],
    ["retry with missing attempt ID", { cardId: MM_CARD.cardId, retry: true, attemptId: "" }, true, 400, "invalid_body"],
    ["retry without a pending attempt", { cardId: MM_CARD.cardId, retry: true, attemptId: "irrelevant" }, false, 409, "no_pending"],
  ])("%s is rejected without a mutation", async (_label, body, seed, status, code) => {
    const pending = seed ? await seedPending() : null;
    const { POST } = await route();
    const response = await POST(mmPost(body), ctx());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    if (pending) expect(storedMM().miniMaxResetPending).toEqual(pending);
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
  });

  it.each(["EXPIRED", "NOT_FOUND", "RETRYABLE_FAIL"])("known reject %s on retry clears the journal", async (code) => {
    await seedPending();
    mocks.redeemMiniMaxResetCard.mockResolvedValue({ ok: false, alreadyUsed: false, uncertain: false, status: 200, code, attempted: true });
    const { POST } = await route();
    const response = await POST(mmPost({ cardId: MM_CARD.cardId, retry: true }), ctx());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reset: false, uncertain: false, code, pending: null });
    expect(storedMM().miniMaxResetPending).toBeNull();
  });

  it.each([
    ["LOCK_BUSY (uncertain)", { uncertain: true, status: 409, code: "LOCK_BUSY", attempted: true }],
    ["local expiry (not attempted)", { uncertain: false, status: 409, code: "EXPIRED", attempted: false }],
    ["local invalid card (not attempted)", { uncertain: false, status: 400, code: "INVALID_CARD", attempted: false }],
    ["auth refusal (uncertain)", { uncertain: true, status: 401, code: "AUTH", attempted: true }],
    ["unknown outcome code", { uncertain: false, status: 400, code: "BAD_REQUEST", attempted: true }],
    ["contradictory LOCK_BUSY flags", { ok: true, alreadyUsed: true, uncertain: false, status: 200, code: "LOCK_BUSY", attempted: true }],
    ["unknown success code", { ok: true, uncertain: false, status: 200, code: "UNKNOWN", attempted: true }],
    ["contradictory rejection flags", { ok: true, uncertain: false, status: 200, code: "EXPIRED", attempted: true }],
  ])("%s retains the uncertain journal — never a second POST, never reset:true", async (_label, result) => {
    const pending = await seedPending();
    mocks.redeemMiniMaxResetCard.mockResolvedValue({ ok: false, alreadyUsed: false, ...result });
    const { POST } = await route();
    const response = await POST(mmPost({ cardId: MM_CARD.cardId, retry: true }), ctx());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ reset: false, alreadyUsed: false, uncertain: true, pending: { attemptId: pending.attemptId, state: "uncertain" } });
    expect(storedMM().miniMaxResetPending).toEqual(pending);
    expect(mocks.redeemMiniMaxResetCard).toHaveBeenCalledTimes(1);
  });

  it("a locally expired pending card never reaches redemption; REPLAYED confirms a prior reset without reset:true", async () => {
    const pending = await seedPending("uncertain", { ...MM_CARD, expiresAt: "2000-01-01T00:00:00.000Z" });
    const { POST } = await route();
    const expired = await POST(mmPost({ cardId: MM_CARD.cardId, retry: true }), ctx());
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ code: "expired", uncertain: true });
    expect(storedMM().miniMaxResetPending).toEqual(pending);
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
    setMM({ miniMaxResetPending: null });
    mocks.redeemMiniMaxResetCard.mockResolvedValue({ ok: false, alreadyUsed: true, uncertain: false, status: 200, code: "REPLAYED", attempted: true });
    expect(await (await POST(mmPost({ cardId: MM_CARD.cardId }), ctx())).json()).toMatchObject({ reset: false, alreadyUsed: true, pending: { state: "refreshing" } });
  });

  it("a thrown mutation stays uncertain with exactly one attempt; persistence failure keeps the original identity", async () => {
    const pending = await seedPending();
    mocks.redeemMiniMaxResetCard.mockRejectedValueOnce(new Error("socket error secret"));
    const { POST } = await route();
    const thrown = await POST(mmPost({ cardId: MM_CARD.cardId, retry: true }), ctx());
    expect(thrown.status).toBe(502);
    const thrownBody = await thrown.json();
    expect(thrownBody).toMatchObject({ reset: false, uncertain: true, pending: { state: "uncertain" } });
    expect(JSON.stringify(thrownBody)).not.toContain("socket error secret");
    expect(mocks.redeemMiniMaxResetCard).toHaveBeenCalledTimes(1);
    mocks.updateProviderConnection.mockRejectedValue(new Error("disk full"));
    const failed = await POST(mmPost({ cardId: MM_CARD.cardId, retry: true }), ctx());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ code: "state_unavailable", pending: { attemptId: pending.attemptId } });
    expect(storedMM().miniMaxResetPending).toEqual(pending);
  });

  it("rechecks the account after inventory and aborts before journal or POST", async () => {
    mocks.getMiniMaxResetCards.mockImplementation(async () => {
      setMM({ accessToken: mmToken({ sub: "other-account" }) });
      return MM_INVENTORY;
    });
    const { POST } = await route();
    expect(await (await POST(mmPost({ cardId: MM_CARD.cardId }), ctx())).json()).toMatchObject({ code: "account_changed", uncertain: true });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
  });

  it("selects cardId verbatim (no trim, no substitution); a history failure is not proof of use", async () => {
    mocks.getMiniMaxResetCards.mockResolvedValue({ availableCount: 1, cards: [{ ...MM_CARD, cardId: "other" }] });
    mocks.getMiniMaxResetCardFlows.mockRejectedValue(authError(500));
    const { POST } = await route();
    expect(await (await POST(mmPost({ cardId: MM_CARD.cardId }), ctx())).json()).toMatchObject({ code: "not_found", alreadyUsed: false });
    const spaced = { ...MM_CARD, cardId: ` ${MM_CARD.cardId} ` };
    mocks.getMiniMaxResetCards.mockResolvedValue({ availableCount: 1, cards: [spaced] });
    expect((await POST(mmPost({ cardId: MM_CARD.cardId }), ctx())).status).toBe(409);
    expect((await POST(mmPost({ cardId: spaced.cardId }), ctx())).status).toBe(200);
    expect(mocks.redeemMiniMaxResetCard.mock.calls[0][2].cardId).toBe(spaced.cardId);
  });
});

describe("minimax reset-card acknowledgement and exclusion", () => {
  it("ack clears only after a fresh inventory succeeds and is non-consuming", async () => {
    const pending = await seedPending("refreshing");
    mocks.getMiniMaxResetCards.mockImplementation(async () => {
      expect(storedMM().miniMaxResetPending).toEqual(pending);
      return { availableCount: 0, cards: [] };
    });
    const { POST } = await route();
    const response = await POST(mmPost({ cardId: MM_CARD.cardId, attemptId: pending.attemptId, acknowledge: true, out_biz_no: "injected" }), ctx());
    expect(await response.json()).toEqual({ reset: false, alreadyUsed: true, confirmed: true, pending: null });
    expect(storedMM().miniMaxResetPending).toBeNull();
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
  });

  it("ack inventory failure preserves the refreshing journal for the next attempt", async () => {
    const pending = await seedPending("refreshing");
    mocks.getMiniMaxResetCards.mockRejectedValue(authError(500));
    const { POST } = await route();
    const response = await POST(mmPost({ cardId: MM_CARD.cardId, attemptId: pending.attemptId, acknowledge: true }), ctx());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ uncertain: true, pending: { state: "refreshing" } });
    expect(storedMM().miniMaxResetPending).toEqual(pending);
  });

  it.each([
    ["uncertain state", (id) => ({ cardId: MM_CARD.cardId, attemptId: id, acknowledge: true }), "uncertain"],
    ["stale attempt", () => ({ cardId: MM_CARD.cardId, attemptId: "stale", acknowledge: true }), "refreshing"],
    ["other card", () => ({ cardId: "other", attemptId: "irrelevant", acknowledge: true }), "refreshing"],
  ])("cannot acknowledge %s", async (_label, makeBody, state) => {
    const pending = await seedPending(state);
    const { POST } = await route();
    expect((await POST(mmPost(makeBody(pending.attemptId)), ctx())).status).toBe(409);
    expect(storedMM().miniMaxResetPending).toEqual(pending);
    expect(mocks.getMiniMaxResetCards).not.toHaveBeenCalled();
  });

  it("a newer attempt appearing mid-flight cannot be cleared or overwritten", async () => {
    const pending = await seedPending("refreshing");
    let newer;
    mocks.getMiniMaxResetCards.mockImplementation(async () => { newer = await seedPending(); return MM_INVENTORY; });
    const { POST } = await route();
    const ack = await POST(mmPost({ cardId: MM_CARD.cardId, attemptId: pending.attemptId, acknowledge: true }), ctx());
    expect(await ack.json()).toMatchObject({ code: "attempt_changed", pending: { attemptId: newer.attemptId } });
    expect(storedMM().miniMaxResetPending).toEqual(newer);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    mocks.getMiniMaxResetCards.mockReset().mockResolvedValue(MM_INVENTORY);
    mocks.redeemMiniMaxResetCard.mockImplementation(async () => { await seedPending(); return MM_SUCCESS; });
    const retry = await POST(mmPost({ cardId: MM_CARD.cardId, retry: true }), ctx());
    expect(await retry.json()).toMatchObject({ code: "attempt_changed", reset: false, uncertain: true });
    expect(storedMM().miniMaxResetPending.attemptId).not.toBe(newer.attemptId);
  });

  it("the per-connection lock excludes concurrent GET/POST and only the owner releases it", async () => {
    let finishRead;
    const readStarted = new Promise((resolve) => {
      mocks.getMiniMaxResetCardFlows.mockImplementation(() => { resolve(); return new Promise((done) => { finishRead = done; }); });
    });
    const { GET, POST } = await route();
    const reader = GET(mmGet(`?cardId=${MM_CARD.cardId}`), ctx());
    await readStarted;
    expect((await POST(mmPost({ cardId: MM_CARD.cardId }), ctx())).status).toBe(409);
    finishRead([]);
    expect((await reader).status).toBe(200);
    let finishRedeem;
    const redeemStarted = new Promise((resolve) => {
      mocks.redeemMiniMaxResetCard.mockImplementation(() => { resolve(); return new Promise((done) => { finishRedeem = done; }); });
    });
    const writer = POST(mmPost({ cardId: MM_CARD.cardId }), ctx());
    await redeemStarted;
    const blocked = await POST(mmPost({ cardId: MM_CARD.cardId }), ctx());
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "reset_in_progress", uncertain: true });
    expect((await GET(mmGet(), ctx())).status).toBe(409);
    finishRedeem(MM_SUCCESS);
    expect((await writer).status).toBe(200);
    expect(mocks.redeemMiniMaxResetCard).toHaveBeenCalledTimes(1);
    expect((await GET(mmGet(), ctx())).status).toBe(200);
  });
});

describe("minimax reset-card POST origin/content-type guard", () => {
  const guardedPost = (headers) => new Request("http://localhost:20129/api/usage/conn_1/minimax-reset-cards", {
    method: "POST", body: JSON.stringify({ cardId: MM_CARD.cardId }), headers: { "Content-Type": "application/json", ...headers },
  });

  it.each([
    ["cross-origin host", { Host: "127.0.0.1:20129", Origin: "https://evil.example" }, 403],
    ["pathful Origin (not a browser serialization)", { Host: "localhost:20129", Origin: "http://localhost:20129/x" }, 403],
    ["https Origin over internal http without Sec-Fetch-Site", { Host: "127.0.0.1:20129", Origin: "https://127.0.0.1:20129" }, 403],
    ["plain-text Content-Type", { Origin: "http://localhost:20129", "Content-Type": "text/plain" }, 400],
  ])("%s rejected before any work", async (_label, headers, status) => {
    const { POST } = await route();
    expect((await POST(guardedPost(headers), ctx())).status).toBe(status);
    expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
    expect(mocks.redeemMiniMaxResetCard).not.toHaveBeenCalled();
  });

  it.each([
    ["matching authority incl port", { Host: "localhost:20129", Origin: "http://localhost:20129" }],
    ["default port stripped on Host side", { Host: "localhost:80", Origin: "http://localhost" }],
    ["TLS-terminating proxy (Sec-Fetch-Site: same-origin)", { Host: "127.0.0.1:20129", Origin: "https://127.0.0.1:20129", "Sec-Fetch-Site": "same-origin" }],
  ])("allows same-origin %s and reaches the mutation", async (_label, headers) => {
    const { POST } = await route();
    expect((await POST(guardedPost(headers), ctx())).status).toBe(200);
    expect(mocks.redeemMiniMaxResetCard).toHaveBeenCalledTimes(1);
  });

  it("regression: Host 127.0.0.1 passes although Next normalizes request.url to localhost; no-Origin clients pass", async () => {
    mocks.getProviderConnectionById.mockResolvedValueOnce(null);
    const { POST } = await route();
    expect((await POST(guardedPost({ Host: "127.0.0.1:20129", Origin: "http://127.0.0.1:20129" }), ctx("nonexistent"))).status).toBe(404);
    expect((await POST(mmPost({ cardId: MM_CARD.cardId }), ctx())).status).toBe(200);
  });
});
