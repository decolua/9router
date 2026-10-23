import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ getProviderConnectionById: vi.fn() }));
const adapter = vi.hoisted(() => ({ driver: "fixture-native", transaction: vi.fn(), get: vi.fn(), run: vi.fn(), flush: undefined }));
vi.mock("@/lib/db/index.js", () => db);
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => adapter }));
import {
  assertMiniMaxResetAccount,
  canonicalMiniMaxResetCard,
  createMiniMaxResetPending,
  loadMiniMaxResetState,
  miniMaxAccountKey,
  publicMiniMaxResetPending,
  readMiniMaxResetPending,
  writeMiniMaxResetPending,
} from "../../src/lib/miniMaxResetState.js";
import { toProviderConnectionResponse } from "../../src/lib/providerConnectionResponse.js";

function token(claims) {
  return `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`;
}

const CARD = {
  cardId: " card-original ", source_type: " original-source ", out_biz_no: " original-business ",
  type: "FULL", expiresAt: "2099-01-01T00:00:00.000Z", createdAt: null,
};
const TOKEN = token({ sub: "private-account", iss: "https://issuer.example", email: "private@example.test" });
const ACCOUNT_KEY = miniMaxAccountKey(TOKEN);
let connection;

beforeEach(() => {
  connection = {
    id: "conn_1", provider: "minimax-code-global", authType: "oauth", accessToken: TOKEN,
    refreshToken: "private-refresh", email: "editable@example.test", displayName: "Keep",
    providerSpecificData: { nested: "keep", account: "editable-account" },
  };
  db.getProviderConnectionById.mockReset().mockImplementation(async () => structuredClone(connection));
  adapter.driver = "fixture-native";
  adapter.flush = undefined;
  adapter.transaction.mockReset().mockImplementation((fn) => fn());
  adapter.get.mockReset().mockImplementation(() => {
    const { id, provider, authType, ...data } = connection;
    return { id, provider, authType, data: JSON.stringify(data) };
  });
  adapter.run.mockReset().mockImplementation((_sql, [data]) => {
    connection = { ...connection, ...JSON.parse(data) };
    return { changes: 1 };
  });
});

describe("MiniMax reset account binding", () => {
  it("prefers sub, ignores exp/email/metadata changes, and hashes issuer plus claim identity", () => {
    expect(ACCOUNT_KEY).toMatch(/^[\da-f]{64}$/);
    expect(ACCOUNT_KEY).not.toContain("private-account");
    expect(miniMaxAccountKey(token({ sub: "private-account", iss: "https://issuer.example", email: "changed@example.test", exp: 1 }))).toBe(ACCOUNT_KEY);
    expect(miniMaxAccountKey(token({ sub: "other", iss: "https://issuer.example" }))).not.toBe(ACCOUNT_KEY);
    expect(miniMaxAccountKey(token({ sub: "private-account", iss: "https://other.example" }))).not.toBe(ACCOUNT_KEY);
    expect(miniMaxAccountKey(token({ sub: "private-account" }))).not.toBe(ACCOUNT_KEY);
    expect(miniMaxAccountKey(token({ email: "private-account", iss: "https://issuer.example" }))).not.toBe(ACCOUNT_KEY);
    expect(() => assertMiniMaxResetAccount({ ...connection, email: "other", providerSpecificData: { sub: "other" } }, ACCOUNT_KEY)).not.toThrow();
  });

  it("uses email then preferred_username only when a higher priority claim is absent", () => {
    const email = miniMaxAccountKey(token({ email: "email@example.test" }));
    expect(email).toMatch(/^[\da-f]{64}$/);
    expect(miniMaxAccountKey(token({ sub: "", email: "email@example.test", preferred_username: "other" }))).toBe(email);
    expect(miniMaxAccountKey(token({ preferred_username: "username" }))).toMatch(/^[\da-f]{64}$/);
    expect(miniMaxAccountKey(token({ email: " username " }))).not.toBe(miniMaxAccountKey(token({ email: "username" })));
  });

  it.each([undefined, "old", "a.b.c", "a..c", "a.b.c.d", token({}), token([]), token({ sub: 4 }), token({ sub: "  " }), token({ sub: "account", iss: {} })])("fails closed for malformed or unidentified JWT %s", (value) => {
    expect(miniMaxAccountKey(value)).toBeNull();
  });

  it("never falls back to editable email or providerSpecificData", () => {
    expect(() => assertMiniMaxResetAccount({ ...connection, accessToken: "old" }, ACCOUNT_KEY)).toThrow(/identity is unavailable/);
    expect(() => assertMiniMaxResetAccount({ ...connection, authType: "apikey" }, ACCOUNT_KEY)).toThrow(/connection changed/);
    expect(() => assertMiniMaxResetAccount({ ...connection, provider: "minimax-code" }, ACCOUNT_KEY)).toThrow(/connection changed/);
  });
});

describe("MiniMax durable recovery record", () => {
  it("creates a canonical UUID attempt and exposes only the public recovery projection", () => {
    const pending = createMiniMaxResetPending(ACCOUNT_KEY, { ...CARD, injected: "not persisted" });
    expect(pending.attemptId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(pending.card).toEqual(CARD);
    expect(pending.state).toBe("uncertain");
    expect(publicMiniMaxResetPending(pending)).toEqual({
      attemptId: pending.attemptId, state: "uncertain", startedAt: pending.startedAt,
      card: { cardId: CARD.cardId, type: "FULL", expiresAt: CARD.expiresAt },
    });
    expect(publicMiniMaxResetPending(null)).toBeNull();
  });

  it("absent/null journal is idle, malformed journal is never idle", () => {
    expect(readMiniMaxResetPending({})).toBeNull();
    expect(readMiniMaxResetPending({ miniMaxResetPending: null })).toBeNull();
    for (const value of [false, "", [], {}, { card: CARD }]) {
      expect(() => readMiniMaxResetPending({ miniMaxResetPending: value })).toThrow(/recovery state is invalid/);
    }
  });

  it.each([
    ["attemptId", "not-an-attempt"], ["accountKey", "raw-identity"], ["startedAt", "yesterday"],
    ["state", "idle"], ["card", { ...CARD, type: "WEEK" }], ["card", { ...CARD, expiresAt: "invalid" }],
    ["card", { ...CARD, source_type: "" }], ["card", { ...CARD, out_biz_no: null }],
  ])("blocks malformed stored %s", (key, value) => {
    const pending = createMiniMaxResetPending(ACCOUNT_KEY, CARD);
    expect(() => readMiniMaxResetPending({ miniMaxResetPending: { ...pending, [key]: value } })).toThrow(/recovery state is invalid/);
  });

  it("retains expired canonical identity for history recovery", () => {
    const card = { ...CARD, expiresAt: "2000-01-01T00:00:00.000Z" };
    expect(createMiniMaxResetPending(ACCOUNT_KEY, card).card).toEqual(card);
    expect(() => canonicalMiniMaxResetCard({ ...card, cardId: " " })).toThrow(/Invalid MiniMax reset card/);
  });

  it("writes only the top-level journal and preserves unrelated concurrent updates", async () => {
    const pending = createMiniMaxResetPending(ACCOUNT_KEY, CARD);
    await writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, null, pending);
    connection.displayName = "Changed elsewhere";
    connection.providerSpecificData = { nested: "updated elsewhere" };
    const saved = await writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, pending, { ...pending, state: "refreshing" });
    expect(saved.pending.state).toBe("refreshing");
    expect(connection).toMatchObject({ displayName: "Changed elsewhere", providerSpecificData: { nested: "updated elsewhere" } });
    expect(adapter.transaction).toHaveBeenCalledTimes(2);
    for (const [sql] of adapter.run.mock.calls) expect(sql).toBe("UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?");
  });

  it.each(["attempt", "native card", "same-id native card", "account", "provider", "auth"])("re-reads before writes and refuses a stale %s", async (change) => {
    const pending = createMiniMaxResetPending(ACCOUNT_KEY, CARD);
    connection.miniMaxResetPending = pending;
    if (change === "attempt") connection.miniMaxResetPending = createMiniMaxResetPending(ACCOUNT_KEY, CARD);
    if (change === "native card") connection.miniMaxResetPending = { ...pending, card: { ...CARD, cardId: "other" } };
    if (change === "same-id native card") connection.miniMaxResetPending = { ...pending, card: { ...CARD, out_biz_no: "other" } };
    if (change === "account") connection.accessToken = token({ sub: "other-account" });
    if (change === "provider") connection.provider = "minimax-code";
    if (change === "auth") connection.authType = "apikey";
    const stored = structuredClone(connection);
    await expect(writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, pending, null)).rejects.toThrow();
    expect(adapter.run).not.toHaveBeenCalled();
    expect(connection).toEqual(stored);
  });

  it.each(["attemptId", "card", "startedAt", "accountKey"])("cannot replace immutable %s during recovery", async (key) => {
    const pending = createMiniMaxResetPending(ACCOUNT_KEY, CARD);
    connection.miniMaxResetPending = pending;
    const other = createMiniMaxResetPending(miniMaxAccountKey(token({ sub: "other" })), { ...CARD, out_biz_no: "other" });
    other.startedAt = "2000-01-01T00:00:00.000Z";
    await expect(writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, pending, { ...pending, [key]: other[key] })).rejects.toThrow(/identity cannot change/);
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it("cannot downgrade refreshing back to uncertain", async () => {
    const pending = { ...createMiniMaxResetPending(ACCOUNT_KEY, CARD), state: "refreshing" };
    connection.miniMaxResetPending = pending;
    await expect(writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, pending, { ...pending, state: "uncertain" })).rejects.toThrow();
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it("read and write failures return constant recovery errors", async () => {
    db.getProviderConnectionById.mockRejectedValueOnce(new Error("db path secret"));
    await expect(loadMiniMaxResetState(connection.id, ACCOUNT_KEY, null)).rejects.toMatchObject({ code: "state_unavailable", status: 503 });
    adapter.run.mockImplementationOnce(() => { throw new Error("db path secret"); });
    await expect(writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, null, createMiniMaxResetPending(ACCOUNT_KEY, CARD)))
      .rejects.toMatchObject({ code: "state_unavailable", status: 503, pending: { card: CARD } });
  });
});

describe("atomic journal claims", () => {
  it("admits only one of two simultaneous first attempts", async () => {
    const first = createMiniMaxResetPending(ACCOUNT_KEY, CARD);
    const second = createMiniMaxResetPending(ACCOUNT_KEY, { ...CARD, cardId: "second", out_biz_no: "second-business" });
    const results = await Promise.allSettled([
      writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, null, first),
      writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, null, second),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(connection.miniMaxResetPending).toEqual(first);
    expect(adapter.run).toHaveBeenCalledTimes(1);
  });

  it("flushes deferred persistence after the transaction and before rereading the journal", async () => {
    adapter.driver = "sql.js";
    const calls = [];
    const transaction = adapter.transaction.getMockImplementation();
    adapter.transaction.mockImplementation((fn) => { calls.push("transaction"); return transaction(fn); });
    adapter.flush = vi.fn(() => { calls.push("flush"); });
    db.getProviderConnectionById.mockImplementation(async () => { calls.push("read"); return structuredClone(connection); });
    const pending = createMiniMaxResetPending(ACCOUNT_KEY, CARD);
    await expect(writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, null, pending)).resolves.toMatchObject({ pending });
    expect(calls).toEqual(["transaction", "flush", "flush", "read"]);
  });

  it("surfaces a deferred save failure and never reports the journal as durable", async () => {
    adapter.driver = "sql.js";
    adapter.flush = vi.fn(() => { throw new Error("private disk path"); });
    const pending = createMiniMaxResetPending(ACCOUNT_KEY, CARD);
    await expect(writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, null, pending))
      .rejects.toMatchObject({ code: "state_unavailable", status: 503, pending });
    expect(db.getProviderConnectionById).not.toHaveBeenCalled();
    await expect(loadMiniMaxResetState(connection.id, ACCOUNT_KEY, pending))
      .rejects.toMatchObject({ code: "state_unavailable", status: 503 });
    expect(db.getProviderConnectionById).not.toHaveBeenCalled();
  });

  it("fails closed for corrupt connection JSON", async () => {
    adapter.get.mockReturnValueOnce({ id: connection.id, provider: connection.provider, authType: connection.authType, data: "not JSON" });
    await expect(writeMiniMaxResetPending(connection.id, ACCOUNT_KEY, null, createMiniMaxResetPending(ACCOUNT_KEY, CARD)))
      .rejects.toMatchObject({ code: "state_unavailable", status: 503 });
    expect(adapter.run).not.toHaveBeenCalled();
  });
});

describe("provider connection recovery privacy", () => {
  it("redacts the complete private journal and credentials from the shared serializer", () => {
    const privateConnection = {
      ...connection, apiKey: "private-key", idToken: "private-id-token",
      miniMaxResetPending: createMiniMaxResetPending(ACCOUNT_KEY, CARD), custom: "keep",
    };
    const response = toProviderConnectionResponse(privateConnection);
    expect(response).toMatchObject({ id: "conn_1", displayName: "Keep", custom: "keep", providerSpecificData: connection.providerSpecificData });
    for (const field of ["miniMaxResetPending", "apiKey", "accessToken", "refreshToken", "idToken"]) expect(response).not.toHaveProperty(field);
    expect(privateConnection).toHaveProperty("miniMaxResetPending");
  });
});
