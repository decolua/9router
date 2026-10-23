import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => Object.fromEntries(["getProviderConnectionById", "resolveConnectionProxyConfig", "refreshAndUpdateCredentials", "getGlmResetCards", "redeemGlmResetCard"].map((name) => [name, vi.fn()])));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/db/index.js", () => ({ getProviderConnectionById: mocks.getProviderConnectionById }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig }));
vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({ refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials }));
vi.mock("open-sse/services/usage.js", () => ({ getGlmResetCards: mocks.getGlmResetCards, redeemGlmResetCard: mocks.redeemGlmResetCard }));

const connection = { id: "c1", provider: "glm", authType: "oauth", apiKey: "", accessToken: "old-token", refreshToken: "refresh-token", providerSpecificData: {} };
const card = { recordId: 9001, type: "FIVE_HOUR", expiresAt: "2099-01-01T00:00:00Z" };
const inventory = { availableCount: 1, cards: [card] };
const proxy = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.local:8080", strictProxy: false };
const success = { ok: true, code: "SUCCESS", message: "redeemed" };
const context = { params: Promise.resolve({ connectionId: "c1" }) };
const input = { recordId: 9001, type: "FIVE_HOUR" };
const error = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
async function get() {
  const { GET } = await import("../../src/app/api/usage/[connectionId]/glm-reset-cards/route.js");
  return GET(new Request("http://localhost/api/usage/c1/glm-reset-cards"), context);
}
async function post(body = input, headers = {}, url = "http://localhost/api/usage/c1/glm-reset-cards") {
  const { POST } = await import("../../src/app/api/usage/[connectionId]/glm-reset-cards/route.js");
  return POST(new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } }), context);
}

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  mocks.getProviderConnectionById.mockResolvedValue(connection);
  mocks.resolveConnectionProxyConfig.mockResolvedValue({ ...proxy, strictProxy: true });
  mocks.refreshAndUpdateCredentials.mockImplementation(async (connection) => ({ connection }));
  mocks.getGlmResetCards.mockResolvedValue(inventory);
  mocks.redeemGlmResetCard.mockResolvedValue(success);
});

describe("GLM route connection and read contracts", () => {
  it.each([[null, 404], [{ ...connection, provider: "glm-cn" }, 400], [{ ...connection, provider: "codex" }, 400], [{ ...connection, authType: "access_token" }, 400], [{ ...connection, apiKey: "", accessToken: "" }, 400]])("rejects unsupported connection %j before proxy/upstream", async (value, status) => {
    mocks.getProviderConnectionById.mockResolvedValue(value);
    expect((await get()).status).toBe(status);
    expect((await post()).status).toBe(status);
    expect(mocks.resolveConnectionProxyConfig).not.toHaveBeenCalled();
    expect(mocks.getGlmResetCards).not.toHaveBeenCalled();
    expect(mocks.redeemGlmResetCard).not.toHaveBeenCalled();
  });
  it.each(["apikey", "api_key"])("uses a pasted key with %s without refresh", async (authType) => {
    mocks.getProviderConnectionById.mockResolvedValue({ ...connection, authType, apiKey: "coding-key" });
    expect(await (await get()).json()).toEqual(inventory);
    expect((await post()).status).toBe(200);
    expect(mocks.refreshAndUpdateCredentials).not.toHaveBeenCalled();
    expect(mocks.getGlmResetCards).toHaveBeenCalledWith("coding-key", proxy);
    expect(mocks.redeemGlmResetCard).toHaveBeenCalledWith("coding-key", card, proxy);
  });
  it("reuses fresh OAuth credentials and relaxed resolved proxy options", async () => {
    mocks.refreshAndUpdateCredentials.mockResolvedValue({ connection: { ...connection, accessToken: "new-token" } });
    expect(await (await get()).json()).toEqual(inventory);
    expect(mocks.refreshAndUpdateCredentials).toHaveBeenCalledWith(connection, false, proxy);
    expect(mocks.getGlmResetCards).toHaveBeenCalledWith("new-token", proxy);
  });
  it.each([401, 403])("force-refreshes only once during reads on HTTP %s and uses fresh credentials for the sole POST", async (status) => {
    mocks.refreshAndUpdateCredentials.mockResolvedValueOnce({ connection }).mockResolvedValueOnce({ connection: { ...connection, accessToken: "forced-token" } });
    mocks.getGlmResetCards.mockRejectedValueOnce(error(status)).mockResolvedValueOnce(inventory);
    expect((await post()).status).toBe(200);
    expect(mocks.getGlmResetCards).toHaveBeenCalledTimes(2);
    expect(mocks.refreshAndUpdateCredentials).toHaveBeenNthCalledWith(2, connection, true, proxy);
    expect(mocks.redeemGlmResetCard).toHaveBeenCalledExactlyOnceWith("forced-token", card, proxy);
  });
  it.each([401, 403, 404, 429, 500, undefined])("maps repeated HTTP %s read failure without another retry or raw text", async (status) => {
    mocks.getGlmResetCards.mockRejectedValue(Object.assign(new Error("secret-unauthorized-401"), { status }));
    const response = await get();
    expect(response.status).toBe([401, 403].includes(status) ? 401 : [404, 429].includes(status) ? status : 502);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    expect(mocks.getGlmResetCards).toHaveBeenCalledTimes([401, 403].includes(status) ? 2 : 1);
  });
  it("never retries reads without a refresh token or based only on an auth-like message", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ ...connection, refreshToken: null });
    mocks.getGlmResetCards.mockRejectedValue(error(401));
    expect((await get()).status).toBe(401);
    expect(mocks.getGlmResetCards).toHaveBeenCalledTimes(1);
    mocks.getGlmResetCards.mockRejectedValue(new Error("Unauthorized 401"));
    expect((await post()).status).toBe(502);
    expect(mocks.getGlmResetCards).toHaveBeenCalledTimes(2);
    expect(mocks.redeemGlmResetCard).not.toHaveBeenCalled();
  });
  it.each([false, true])("sanitizes failed credential refresh (forced: %s)", async (forced) => {
    if (forced) {
      mocks.getGlmResetCards.mockRejectedValueOnce(error(401));
      mocks.refreshAndUpdateCredentials.mockResolvedValueOnce({ connection }).mockRejectedValueOnce(new Error("secret refresh"));
    } else mocks.refreshAndUpdateCredentials.mockRejectedValue(new Error("secret refresh"));
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Credential refresh failed. Please re-authorize the connection." });
  });
  it.each([null, {}, { cards: null }, { cards: {} }])("fails closed on malformed inventory %j", async (value) => {
    mocks.getGlmResetCards.mockResolvedValue(value);
    expect((await get()).status).toBe(502);
    expect((await post()).status).toBe(502);
    expect(mocks.redeemGlmResetCard).not.toHaveBeenCalled();
  });
  it("sanitizes unexpected database and proxy exceptions", async () => {
    mocks.getProviderConnectionById.mockRejectedValue(new Error("private/db.sqlite"));
    expect(await (await get()).json()).toEqual({ error: "Internal server error." });
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.resolveConnectionProxyConfig.mockRejectedValue(new Error("private proxy"));
    expect(await (await post()).json()).toEqual({ error: "Internal server error." });
  });
});

describe("GLM single-attempt mutation", () => {
  it.each(["{not json", "null", "[]", "true", { recordId: true }, { recordId: 1.5 }, { recordId: NaN }, { recordId: Infinity }, { recordId: Number.MAX_SAFE_INTEGER + 1 }, { recordId: "" }, { recordId: " " }, { recordId: "x".repeat(513) }, { recordId: {} }, { recordId: [] }, { recordId: null }, {}, { type: undefined }, { type: 5 }, { type: " " }, { type: "five_hour" }, { type: "MONTH" }])("validates body %j before database/upstream work", async (value) => {
    const body = typeof value === "string" ? value : { ...input, ...value };
    if (value && typeof value === "object" && !Object.keys(value).length) delete body.recordId;
    expect((await post(body)).status).toBe(400);
    expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
    expect(mocks.redeemGlmResetCard).not.toHaveBeenCalled();
  });
  it.each([{ ...card, recordId: 0, type: "WEEK" }, { ...card, recordId: "id-1" }, card])("resolves the canonical server card %j and ignores injected fields", async (serverCard) => {
    mocks.getGlmResetCards.mockResolvedValue({ cards: [serverCard] });
    expect((await post({ recordId: String(serverCard.recordId), type: serverCard.type, expiresAt: "2000-01-01", extra: "ignored" })).status).toBe(200);
    expect(mocks.redeemGlmResetCard).toHaveBeenCalledExactlyOnceWith("old-token", serverCard, proxy);
  });
  it("distinguishes the same record ID in both type buckets", async () => {
    const weekly = { ...card, type: "WEEK" };
    mocks.getGlmResetCards.mockResolvedValue({ cards: [card, weekly] });
    expect((await post({ ...input, type: "WEEK" })).status).toBe(200);
    expect(mocks.redeemGlmResetCard).toHaveBeenCalledWith("old-token", weekly, proxy);
    mocks.getGlmResetCards.mockResolvedValue(inventory);
    expect((await post({ ...input, type: "WEEK" })).status).toBe(409);
    expect(mocks.redeemGlmResetCard).toHaveBeenCalledTimes(1);
  });
  it.each([{ cards: [] }, { cards: [{ ...card, recordId: 123 }] }])("does not mutate without the selected fresh card: %j", async (value) => {
    mocks.getGlmResetCards.mockResolvedValue(value);
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "no_card", uncertain: false });
    expect(mocks.redeemGlmResetCard).not.toHaveBeenCalled();
  });
  it.each(["2000-01-01T00:00:00Z", "garbage", undefined, null])("fails closed on server expiry %j", async (expiresAt) => {
    mocks.getGlmResetCards.mockResolvedValue({ cards: [{ ...card, expiresAt }] });
    expect(await (await post()).json()).toMatchObject({ code: "expired", reset: false });
    expect(mocks.redeemGlmResetCard).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ok: true, alreadyUsed: true }, { ok: true, uncertain: true }, { ok: false, uncertain: false, status: 200 }, { ok: false, uncertain: false, status: 0 }, { ok: false, status: 403 }, { ok: false, status: 502, uncertain: true }])("keeps ambiguous result %j uncertain without POST/auth retry", async (value) => {
    mocks.redeemGlmResetCard.mockResolvedValue(value);
    const response = await post();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ reset: false, alreadyUsed: false, uncertain: true });
    expect(mocks.redeemGlmResetCard).toHaveBeenCalledTimes(1);
    expect(mocks.refreshAndUpdateCredentials).toHaveBeenCalledTimes(1);
  });
  it("preserves service-local validation refusals and bounds safe response text", async () => {
    mocks.redeemGlmResetCard.mockResolvedValue({ ok: false, uncertain: false, status: 422, code: "x".repeat(2000), message: "y".repeat(2000) });
    const response = await post(); const body = await response.json();
    expect(response.status).toBe(422); expect(body.uncertain).toBe(false);
    expect(body.code.length).toBe(400); expect(body.message.length).toBe(400);
  });
  it("treats a thrown mutation as uncertain without exposing its exception or retrying", async () => {
    mocks.redeemGlmResetCard.mockRejectedValue(new Error("secret socket"));
    const response = await post(); const body = await response.json();
    expect(response.status).toBe(502); expect(body.uncertain).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(mocks.redeemGlmResetCard).toHaveBeenCalledTimes(1);
  });
  it("excludes concurrent consuming requests and releases only its own lock", async () => {
    let finish;
    mocks.redeemGlmResetCard.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = post(); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const second = await post();
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "reset_in_progress", uncertain: true });
    expect((await post()).status).toBe(409);
    expect(mocks.redeemGlmResetCard).toHaveBeenCalledTimes(1);
    finish(success); expect((await first).status).toBe(200);
    expect((await post()).status).toBe(200);
  });
});

describe("GLM mutation origin and JSON guard", () => {
  it.each([
    { Host: "localhost", Origin: "https://evil.example" }, { Host: "localhost", Origin: "http://localhost:9999" },
    { Host: "localhost:20129", Origin: "http://127.0.0.1:20129" }, { Origin: "http://127.0.0.1:20129" },
    { Host: "localhost", Origin: ":://" }, { Host: "localhost:20129", Origin: "http://localhost:20129/x" },
    { Host: "localhost", Origin: "http://user:password@localhost" }, { Host: "localhost", Origin: "http://localhost?q=1" },
    { Host: "127.0.0.1:20129", Origin: "https://127.0.0.1:20129" },
    { Host: "127.0.0.1:20129", Origin: "https://127.0.0.1:20129", "Sec-Fetch-Site": "same-site" },
    { Host: "127.0.0.1:20129", Origin: "https://127.0.0.1:20129", "Sec-Fetch-Site": "cross-site" },
    { Host: "127.0.0.1:20129", Origin: "https://evil.example", "Sec-Fetch-Site": "same-origin" },
  ])("rejects cross-origin headers %j before database work", async (headers) => {
    expect((await post(input, headers, "http://localhost:20129/api/usage/c1/glm-reset-cards")).status).toBe(403);
    expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
  });
  it.each(["text/plain", "text/plain;foo=json", "application/x-www-form-urlencoded", ""])("rejects content type %j before database work", async (type) => {
    expect((await post(input, { "Content-Type": type })).status).toBe(400);
    expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
  });
  it("rejects a missing content type", async () => {
    const { POST } = await import("../../src/app/api/usage/[connectionId]/glm-reset-cards/route.js");
    const request = new Request("http://localhost/api/usage/c1/glm-reset-cards", { method: "POST", body: new TextEncoder().encode(JSON.stringify(input)) });
    expect((await POST(request, context)).status).toBe(400);
    expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
  });
  it.each(["application/json", "APPLICATION/JSON", "application/json; charset=utf-8"])("accepts exact JSON media type %s", async (type) => {
    expect((await post(input, { "Content-Type": type })).status).toBe(200);
  });
  it.each([
    {}, { Host: "localhost:20129", Origin: "http://localhost:20129" }, { Host: "localhost:80", Origin: "http://localhost" },
    { Origin: "http://localhost:20129" }, { Host: "127.0.0.1:20129", Origin: "http://127.0.0.1:20129" },
    { Host: "127.0.0.1:20129", Origin: "https://127.0.0.1:20129", "Sec-Fetch-Site": "same-origin" },
  ])("accepts matching authority or non-browser headers %j", async (headers) => {
    expect((await post(input, headers, "http://localhost:20129/api/usage/c1/glm-reset-cards")).status).toBe(200);
    expect(mocks.redeemGlmResetCard).toHaveBeenCalledTimes(1);
  });
});
