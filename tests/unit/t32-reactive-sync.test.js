// T3.2/RB — reactive model catalog sync on upstream 404 model_not_found.
//
// Layer A: unit tests of the REAL trigger logic (src/lib/modelSync/reactive.js
// via vi.importActual): burst→1 kickoff, syncable-provider gate, kill switch,
// 10min cooldown per connection, failure is only logged, and the F4
// interaction (default sync = syncConnectionCatalog single-flight).
// Layer B: integration of the chatCore hook (reactive module mocked — the
// handler test asserts placement, args, non-blocking, and that the ORIGINAL
// 404 propagates unchanged with no added executor retry; mirrors f26 mocks).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { executeMock, triggerMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  triggerMock: vi.fn(),
}));

// ── Hermetic deps of the REAL connectionCatalog (pulled in by importActual) ──
vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(async () => []),
  getProviderConnectionById: vi.fn(async () => null),
  updateProviderConnection: vi.fn(async () => ({})),
}));
// Same precedent as model-sync-catalog.test.js: no DNS in unit tests; the
// wrapper forwards to the per-test global fetch stub.
vi.mock("@/shared/utils/ssrfGuard.js", () => ({
  assertPublicUrl: vi.fn(),
  fetchPublic: (...args) => globalThis.fetch(...args),
}));

// ── chatCore-side mocks (f26 precedent) ──
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: false,
    execute: executeMock,
    refreshCredentials: vi.fn(),
    needsRefresh: () => false,
  }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));
vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));
vi.mock("@/lib/modelSync/reactive.js", () => ({
  triggerReactiveModelSync: (...args) => triggerMock(...args),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const {
  triggerReactiveModelSync,
  isReactiveSyncableProvider,
  clearReactiveSyncCooldown,
  REACTIVE_SYNC_COOLDOWN_MS,
} = await vi.importActual("@/lib/modelSync/reactive.js");
const dbMocks = await import("@/models");

const tick = () => new Promise((r) => setTimeout(r, 0));
const T0 = 1_700_000_000_000;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  clearReactiveSyncCooldown();
  delete process.env.CONNECTION_MODEL_SYNC;
  dbMocks.getProviderConnectionById.mockResolvedValue(null);
  dbMocks.updateProviderConnection.mockResolvedValue({});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.CONNECTION_MODEL_SYNC;
});

// ── A — trigger unit behavior (real reactive.js) ─────────────────────────────

describe("A — triggerReactiveModelSync (real module)", () => {
  it("A1: 20 simultaneous triggers on one connection → exactly 1 sync call, automatic:true", async () => {
    const sync = vi.fn(async () => ({ connectionId: "conn-b", updated: true }));
    const p = triggerReactiveModelSync(
      { connectionId: "conn-b", provider: "cline", model: "gpt-4o" },
      { sync, now: () => T0 },
    );
    for (let i = 0; i < 19; i++) {
      expect(
        triggerReactiveModelSync(
          { connectionId: "conn-b", provider: "cline", model: "gpt-4o" },
          { sync, now: () => T0 + i },
        ),
      ).toBeNull(); // suppressed synchronously, no background promise
    }
    await tick();
    await expect(p).resolves.toBeDefined();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("conn-b", { automatic: true });
  });

  it("A2: non-syncable provider (or unknown id / missing connectionId) → no-op", async () => {
    const sync = vi.fn(async () => ({}));
    // api-airforce: modelsFetcher type "airforce-free" — NOT in SYNCABLE_MODELS_FETCHER_TYPES
    expect(isReactiveSyncableProvider("api-airforce")).toBe(false);
    expect(isReactiveSyncableProvider("cline")).toBe(true); // type "openai"
    expect(isReactiveSyncableProvider("kilocode")).toBe(true); // type "openrouter-free"
    expect(isReactiveSyncableProvider("f26test")).toBe(false);

    triggerReactiveModelSync({ connectionId: "c1", provider: "api-airforce", model: "m" }, { sync, now: () => T0 });
    triggerReactiveModelSync({ connectionId: "c2", provider: "f26test", model: "m" }, { sync, now: () => T0 });
    triggerReactiveModelSync({ connectionId: "", provider: "cline", model: "m" }, { sync, now: () => T0 });
    triggerReactiveModelSync({ connectionId: "c3", provider: undefined, model: "m" }, { sync, now: () => T0 });
    await tick();
    expect(sync).not.toHaveBeenCalled();
  });

  it("A3: CONNECTION_MODEL_SYNC=off → no-op; re-enabling allows the kickoff (slot not burned)", async () => {
    const sync = vi.fn(async () => ({}));
    process.env.CONNECTION_MODEL_SYNC = "off";
    expect(
      triggerReactiveModelSync({ connectionId: "c-off", provider: "cline", model: "m" }, { sync, now: () => T0 }),
    ).toBeNull();
    await tick();
    expect(sync).not.toHaveBeenCalled();

    delete process.env.CONNECTION_MODEL_SYNC;
    const p = triggerReactiveModelSync({ connectionId: "c-off", provider: "cline", model: "m" }, { sync, now: () => T0 + 1000 });
    await expect(p).resolves.toBeDefined();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("A4: 10min cooldown per connection; other connections are independent", async () => {
    const sync = vi.fn(async () => ({}));
    let clock = T0;
    const now = () => clock;
    const call = (connId) =>
      triggerReactiveModelSync({ connectionId: connId, provider: "cline", model: "m" }, { sync, now });

    expect(call("c1")).not.toBeNull(); // kickoff #1 at T0
    clock = T0 + REACTIVE_SYNC_COOLDOWN_MS - 1000;
    expect(call("c1")).toBeNull(); // still inside the window
    expect(call("c2")).not.toBeNull(); // per-connection ledger
    clock = T0 + REACTIVE_SYNC_COOLDOWN_MS;
    expect(call("c1")).not.toBeNull(); // window elapsed → new kickoff
    await tick();
    expect(sync).toHaveBeenCalledTimes(3);
    expect(sync.mock.calls.map((c) => c[0]).sort()).toEqual(["c1", "c1", "c2"]);
  });

  it("A5: sync failure/throw only logs — trigger never rejects, never throws, and still burns the slot", async () => {
    const warn = vi.fn();
    const log = { warn };
    const pReject = triggerReactiveModelSync(
      { connectionId: "c-r", provider: "cline", model: "m" },
      { sync: () => Promise.reject(new Error("boom")), log, now: () => T0 },
    );
    await expect(pReject).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("MODELSYNC");
    expect(String(warn.mock.calls[0][1])).toContain("boom");

    // result-shaped failure (F4 returns {error} instead of rejecting)
    const pErr = triggerReactiveModelSync(
      { connectionId: "c-e", provider: "cline", model: "m" },
      { sync: async () => ({ connectionId: "c-e", updated: false, error: "model listing returned HTTP 502" }), log, now: () => T0 },
    );
    await expect(pErr).resolves.toMatchObject({ updated: false });
    expect(String(warn.mock.calls[1][1])).toContain("HTTP 502");

    // sync that throws SYNCHRONOUSLY must not surface at the call site
    const pThrow = triggerReactiveModelSync(
      { connectionId: "c-t", provider: "cline", model: "m" },
      {
        sync: () => { throw new Error("sync exploded"); },
        log,
        now: () => T0,
      },
    );
    await expect(pThrow).resolves.toBeNull();

    // a failed kickoff still consumed the cooldown (24h cycle is the backstop)
    const sync2 = vi.fn(async () => ({}));
    expect(
      triggerReactiveModelSync({ connectionId: "c-r", provider: "cline", model: "m" }, { sync: sync2, now: () => T0 + 5000 }),
    ).toBeNull();
    await tick();
    expect(sync2).not.toHaveBeenCalled();
  });

  it("A6: default sync is the F4 chokepoint — 20 triggers with cooldownMs=0 collapse into ONE fetch via single-flight", async () => {
    // Exercises the REAL syncConnectionCatalog: reactive passes { automatic: true }
    // and the connectionId; F4 loads the row, resolves the cline /models URL and
    // folds overlapping calls onto the in-flight promise.
    dbMocks.getProviderConnectionById.mockResolvedValue({ id: "conn-f4", provider: "cline" });
    let fetches = 0;
    globalThis.fetch = vi.fn(async () => {
      fetches++;
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "gpt-4o" }] }) };
    });

    const promises = [];
    for (let i = 0; i < 20; i++) {
      const p = triggerReactiveModelSync(
        { connectionId: "conn-f4", provider: "cline", model: "gpt-4o" },
        { cooldownMs: 0 }, // disable ONLY the local ledger → F4 must fold them
      );
      if (p) promises.push(p);
    }
    const results = await Promise.all(promises);
    expect(fetches).toBe(1);
    expect(dbMocks.getProviderConnectionById).toHaveBeenCalledTimes(1);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ connectionId: "conn-f4", updated: true });
    // every joiner resolved with the same run's result
    expect(results.every((r) => r && r.updated === true)).toBe(true);
  });
});

// ── B — chatCore 404 hook (integration, reactive mocked) ─────────────────────

function chatArgs(connectionId = "conn-1") {
  return {
    body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hi" }] },
    modelInfo: { provider: "cline", model: "gpt-4o" },
    credentials: { accessToken: "AT", connectionId },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    connectionId,
    rtkEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
  };
}

function upstreamResponse(status, message) {
  return () => ({
    response: new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { "content-type": "application/json" },
    }),
    url: `https://upstream.test/${status}/v1/chat/completions`,
    headers: {},
    transformedBody: null,
  });
}

describe("B — chatCore hook placement (reactive trigger mocked)", () => {
  it("B1: upstream 404 → trigger fires once with (connectionId, provider, model); the ORIGINAL error propagates identically and the request is never retried", async () => {
    executeMock.mockImplementation(upstreamResponse(404, "The model 'gpt-4o' does not exist"));
    const result = await handleChatCore(chatArgs("conn-9"));

    expect(triggerMock).toHaveBeenCalledTimes(1);
    expect(triggerMock.mock.calls[0][0]).toEqual({ connectionId: "conn-9", provider: "cline", model: "gpt-4o" });
    expect(triggerMock.mock.calls[0][1]).toMatchObject({ log: expect.objectContaining({ warn: expect.any(Function) }) });

    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(String(result.error)).toContain("The model 'gpt-4o' does not exist");
    expect(result.response.status).toBe(404);
    expect(executeMock).toHaveBeenCalledTimes(1); // no added retry — ONE upstream call only

    // Byte-identical propagation with the trigger fully disabled: the hook
    // cannot change what the client sees (same mocks, fresh handler call).
    triggerMock.mockImplementation(() => undefined);
    const withoutHook = await handleChatCore(chatArgs("conn-9"));
    expect(withoutHook).toEqual(result);
  });

  it("B2: the request never waits on the sync — a trigger promise that never settles still returns the 404 immediately", async () => {
    executeMock.mockImplementation(upstreamResponse(404, "model missing"));
    triggerMock.mockImplementation(() => new Promise(() => {})); // deliberately never settles
    const started = Date.now();
    const result = await handleChatCore(chatArgs("conn-n"));
    expect(Date.now() - started).toBeLessThan(4000);
    expect(result.status).toBe(404);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("B3: non-404 upstream errors and success do NOT trigger the sync", async () => {
    triggerMock.mockImplementation(() => undefined);

    executeMock.mockImplementation(upstreamResponse(429, "rate limited"));
    const r429 = await handleChatCore(chatArgs("conn-429"));
    expect(r429.status).toBe(429);
    expect(triggerMock).not.toHaveBeenCalled();

    executeMock.mockImplementation(upstreamResponse(400, "bad request"));
    const r400 = await handleChatCore(chatArgs("conn-400"));
    expect(r400.status).toBe(400);
    expect(triggerMock).not.toHaveBeenCalled();

    executeMock.mockImplementation(async () => ({
      response: new Response(
        JSON.stringify({
          id: "chatcmpl-t32",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      url: "https://upstream.test/ok/v1/chat/completions",
      headers: {},
      transformedBody: null,
    }));
    const ok = await handleChatCore(chatArgs("conn-ok"));
    expect(ok.success).toBe(true);
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("B4: 404 without a connectionId still propagates and hands the trigger a no-op-able context", async () => {
    executeMock.mockImplementation(upstreamResponse(404, "model missing"));
    const args = chatArgs(""); // "" avoids the default arg; then force the real undefined
    args.connectionId = undefined;
    const result = await handleChatCore(args);
    expect(result.status).toBe(404);
    expect(triggerMock).toHaveBeenCalledTimes(1);
    expect(triggerMock.mock.calls[0][0].connectionId).toBeUndefined();
    // real module returns null synchronously for a missing connectionId (A2)
    expect(
      triggerReactiveModelSync({ connectionId: undefined, provider: "cline", model: "m" }, { sync: vi.fn(), now: () => T0 }),
    ).toBeNull();
  });
});
