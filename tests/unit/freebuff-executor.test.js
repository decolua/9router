import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const fitnessMocks = vi.hoisted(() => ({ markPoolUnfit: vi.fn(), clearPoolUnfit: vi.fn(), observePoolFitnessVersion: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
vi.mock("../../open-sse/services/proxyPoolFitness.js", () => ({ ...fitnessMocks, observeActivePoolFitness: async (...args) => { const version = await fitnessMocks.observePoolFitnessVersion(...args); return version ? { version, until: Date.now() + 60_000 } : null; }, POOL_UNFIT_MS: 300_000 }));

import { FreebuffExecutor, __test__ } from "../../open-sse/executors/freebuff.js";
import { markFreebuffPoolFailure } from "../../open-sse/executors/freebuffProxyFitness.js";

const MODEL = "deepseek/deepseek-v4-flash";
const SESSION_URL = "https://www.codebuff.com/api/v1/freebuff/session";
const RUN_URL = "https://www.codebuff.com/api/v1/agent-runs";
const CHAT_URL = "https://www.codebuff.com/api/v1/chat/completions";
const credentials = { accessToken: "tok-1", providerSpecificData: { fingerprintId: "fp-1" } };

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  fetchMock.mockReset();
  fitnessMocks.markPoolUnfit.mockReset();
  fitnessMocks.clearPoolUnfit.mockReset();
  fitnessMocks.observePoolFitnessVersion.mockReset();
  fitnessMocks.observePoolFitnessVersion.mockResolvedValue(7);
  fitnessMocks.markPoolUnfit.mockImplementation(async (poolId, scope, until, reason) => ({ poolId, scope, until, reason, version: 7 }));
  __test__.resetSessionCache();
});

describe("Freebuff executor", () => {
  it("uses the Codebuff endpoint and creates the required top-level request metadata", () => {
    const executor = new FreebuffExecutor();
    const body = { model: MODEL, reasoning_effort: "high", reasoning: { effort: "high" }, messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "read_file" } }] };

    const transformed = executor.transformRequest(MODEL, body, false, credentials);

    expect(executor.buildUrl()).toBe(CHAT_URL);
    expect(transformed).toMatchObject({ codebuff_metadata: { client_id: "fp-1", cost_mode: "free" }, provider: { allow_fallbacks: false } });
    expect(transformed.codebuff).toBeUndefined();
    expect(transformed.reasoning_effort).toBeUndefined();
    expect(transformed.reasoning).toBeUndefined();
    expect(transformed.tools.map((tool) => tool.function.name)).toEqual(["read_file", "end_turn"]);
    expect(transformed.messages[0].role).toBe("system");
  });

  it("reclaims a stale session once with a new run and finishes each run once", async () => {
    let chatAttempts = 0;
    let runStarts = 0;
    fetchMock.mockImplementation((url, options) => {
      if (url === SESSION_URL) return Promise.resolve(response({ status: "active", instanceId: `inst-${chatAttempts + 1}`, expiresAt: new Date(Date.now() + 3600000).toISOString() }));
      if (url === RUN_URL) {
        const request = JSON.parse(options.body);
        if (request.action === "START") return Promise.resolve(response({ runId: `run-${++runStarts}` }));
        return Promise.resolve(response({}));
      }
      chatAttempts += 1;
      return Promise.resolve(chatAttempts === 1 ? response({ error: "waiting_room_required" }, 428) : response({ choices: [] }));
    });

    const result = await new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials });

    expect(result.response.status).toBe(200);
    expect(fetchMock.mock.calls.filter(([url]) => url === SESSION_URL)).toHaveLength(2);
    const runRequests = fetchMock.mock.calls.filter(([url]) => url === RUN_URL).map(([, options]) => JSON.parse(options.body));
    expect(runRequests.filter((request) => request.action === "START")).toHaveLength(2);
    expect(runRequests.filter((request) => request.action === "FINISH").map((request) => request.status)).toEqual(["cancelled", "completed"]);
  });

  it("fails before network activity when no access token is available", async () => {
    await expect(new FreebuffExecutor().execute({
      model: MODEL,
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {},
    })).rejects.toThrow(/no access token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches an active session per token and model", async () => {
    fetchMock.mockImplementation((url, options) => {
      if (url === SESSION_URL) return Promise.resolve(response({ status: "active", instanceId: "inst-1", expiresAt: new Date(Date.now() + 60_000).toISOString() }));
      if (url === RUN_URL) return Promise.resolve(response({ runId: "run-1" }));
      return Promise.resolve(response({ choices: [] }));
    });
    const executor = new FreebuffExecutor();
    const request = { model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials };

    await executor.execute(request);
    await executor.execute(request);

    expect(fetchMock.mock.calls.filter(([url]) => url === SESSION_URL)).toHaveLength(1);
  });

  it("surfaces a session 401 as a re-login failure", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 401));

    await expect(new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials }))
      .rejects.toMatchObject({ status: 401 });
  });

  it("fails fast on a model lock without beginning a chat run", async () => {
    fetchMock.mockResolvedValueOnce(response({ status: "model_locked" }));
    const lockedCredentials = { ...credentials, accessToken: "tok-weak-model-lock" };

    await expect(new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: lockedCredentials }))
      .rejects.toThrow(/locked/i);
    expect(fetchMock.mock.calls.filter(([url]) => url === RUN_URL)).toHaveLength(0);
  });

  it("routes a session model_locked through the structured gate: 409, future resetsAt, cooldown, and fail-fast retry", async () => {
    const lockedCredentials = { accessToken: "tok-model-lock", providerSpecificData: { fingerprintId: "fp-lock" } };

    fetchMock.mockResolvedValueOnce(response({ status: "model_locked", currentModel: "deepseek/deepseek-v4-pro" }));

    let firstError;
    try {
      await new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: lockedCredentials });
    } catch (error) { firstError = error; }

    expect(firstError.status).toBe(409);
    expect(firstError.message).toMatch(/locked/);
    expect(firstError.message).toContain("deepseek/deepseek-v4-pro");
    expect(firstError.resetsAtMs).toBeGreaterThan(Date.now());
    expect(firstError.resetsAtMs).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);

    fetchMock.mockReset();
    let secondError;
    try {
      await new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: lockedCredentials });
    } catch (error) { secondError = error; }

    expect(secondError.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("safely classifies a hostile throwing message getter and circular sensitive object", async () => {
    const hostile = { token: "secret-value" }; hostile.self = hostile;
    Object.defineProperty(hostile, "message", { get() { throw new Error("getter must not run"); } });
    const result = await markFreebuffPoolFailure({ model: MODEL, proxyOptions: { proxyPoolId: "pool-a" }, stage: "session_acquire", error: hostile });
    expect(result).toMatchObject({ poolId: "pool-a", scope: `freebuff::${MODEL}`, fitnessVersion: 7 });
    expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledWith("pool-a", `freebuff::${MODEL}`, expect.any(Number), expect.not.stringContaining("secret-value"));
  });

  it("marks limited_ip once for initial session with committed metadata", async () => {
    fetchMock.mockResolvedValueOnce(response({ status: "session_model_mismatch", message: "limited IP" }));
    await expect(new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials, proxyOptions: { proxyPoolId: "pool-a" } }))
      .rejects.toMatchObject({ status: 409, poolScoped: { poolId: "pool-a", scope: `freebuff::${MODEL}`, reason: "limited_ip", fitnessVersion: 7, until: expect.any(Number) } });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledTimes(1);
  });

  it("marks limited_ip once for the first chat response", async () => {
    fetchMock.mockImplementation((url, options) => url === SESSION_URL ? Promise.resolve(response({ status: "none" })) : url === RUN_URL ? Promise.resolve(response(JSON.parse(options.body).action === "START" ? { runId: "run-1" } : {})) : Promise.resolve(response({ error: "session_model_mismatch", message: "limited IP" }, 409)));
    await expect(new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials, proxyOptions: { proxyPoolId: "pool-a" } })).rejects.toMatchObject({ poolScoped: { fitnessVersion: 7 } });
    expect(fetchMock.mock.calls.filter(([url]) => url === CHAT_URL)).toHaveLength(1); expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledTimes(1);
  });

  it("marks limited_ip once at forced session then cached preflight neither fetches nor remarks", async () => {
    let sessions = 0;
    fetchMock.mockImplementation((url, options) => { if (url === SESSION_URL) return Promise.resolve(++sessions === 1 ? response({ status: "active", instanceId: "i", expiresAt: new Date(Date.now() + 60_000).toISOString() }) : response({ status: "session_model_mismatch", message: "limited IP" })); if (url === RUN_URL) return Promise.resolve(response(JSON.parse(options.body).action === "START" ? { runId: "run-1" } : {})); return Promise.resolve(response({}, 428)); });
    const request = { model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { ...credentials, accessToken: "forced-token" }, proxyOptions: { proxyPoolId: "pool-a" } };
    await expect(new FreebuffExecutor().execute(request)).rejects.toMatchObject({ poolScoped: { fitnessVersion: 7 } });
    expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledTimes(1); fetchMock.mockClear();
    await expect(new FreebuffExecutor().execute(request)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled(); expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledTimes(1);
  });

  it("evicts stale local limited-IP cooldown after an exact persisted clear and reaches network", async () => {
    fetchMock.mockResolvedValueOnce(response({ status: "session_model_mismatch", message: "limited IP" }));
    const request = { model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { ...credentials, accessToken: "tok-cleared" }, proxyOptions: { proxyPoolId: "pool-a", connectionProxyUrl: "http://proxy" } };
    await expect(new FreebuffExecutor().execute(request)).rejects.toMatchObject({ status: 409, poolScoped: { fitnessVersion: 7 } });
    fitnessMocks.observePoolFitnessVersion.mockResolvedValueOnce(0);
    fetchMock.mockImplementation((url, options) => url === SESSION_URL ? Promise.resolve(response({ status: "none" })) : url === RUN_URL ? Promise.resolve(response(JSON.parse(options.body).action === "START" ? { runId: "run-cleared" } : {})) : Promise.resolve(response({ choices: [] })));
    await expect(new FreebuffExecutor().execute(request)).resolves.toMatchObject({ response: { status: 200 } });
    expect(fetchMock).toHaveBeenCalled(); expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledTimes(1);
  });

  it("uses newer authoritative active version for local fail-fast without re-mark or network", async () => {
    fetchMock.mockResolvedValueOnce(response({ status: "session_model_mismatch", message: "limited IP" }));
    const request = { model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { ...credentials, accessToken: "tok-newer" }, proxyOptions: { proxyPoolId: "pool-a", connectionProxyUrl: "http://proxy" } };
    await expect(new FreebuffExecutor().execute(request)).rejects.toMatchObject({ status: 409, poolScoped: { fitnessVersion: 7 } });
    fetchMock.mockClear(); fitnessMocks.observePoolFitnessVersion.mockResolvedValueOnce(8);
    await expect(new FreebuffExecutor().execute(request)).rejects.toMatchObject({ poolScoped: { poolId: "pool-a", scope: `freebuff::${MODEL}`, fitnessVersion: 8 } });
    expect(fetchMock).not.toHaveBeenCalled(); expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledTimes(1);
  });

  it("conditionally clears only the selection-time exact fitness version after success", async () => {
    fetchMock.mockImplementation((url, options) => url === SESSION_URL ? Promise.resolve(response({ status: "none" })) : url === RUN_URL ? Promise.resolve(response(JSON.parse(options.body).action === "START" ? { runId: "run-clear" } : {})) : Promise.resolve(response({ choices: [] })));
    await new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { ...credentials, _observedPoolFitness: Object.freeze({ poolId: "pool-a", scope: `freebuff::${MODEL}`, version: 7 }) }, proxyOptions: { proxyPoolId: "pool-a" } });
    expect(fitnessMocks.clearPoolUnfit).toHaveBeenCalledWith("pool-a", `freebuff::${MODEL}`, 7);
  });

  it("marks connector and timeout session failures once after three attempts", async () => {
    for (const error of [Object.assign(new Error("connector"), { code: "ECONNREFUSED" }), Object.assign(new Error("timeout"), { name: "TimeoutError" })]) {
      __test__.resetSessionCache(); fetchMock.mockReset(); fitnessMocks.markPoolUnfit.mockClear(); fetchMock.mockRejectedValue(error);
      await expect(new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials, proxyOptions: { proxyPoolId: "pool-a" } })).rejects.toBe(error);
      expect(fetchMock).toHaveBeenCalledTimes(3); expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledTimes(1);
    }
  });

  it("distinguishes target 503 from trusted relay 503", async () => {
    const execute = (chat) => { fetchMock.mockImplementation((url, options) => url === SESSION_URL ? Promise.resolve(response({ status: "none" })) : url === RUN_URL ? Promise.resolve(response(JSON.parse(options.body).action === "START" ? { runId: "r" } : {})) : Promise.resolve(chat)); return new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials, proxyOptions: { proxyPoolId: "pool-a" } }); };
    await execute(response({ error: "same" }, 503)); expect(fitnessMocks.markPoolUnfit).not.toHaveBeenCalled();
    __test__.resetSessionCache(); fetchMock.mockReset(); await expect(execute({ ...response({ error: "same" }, 503), headers: new Headers({ "x-9router-relay-error": "proxy_connect" }) })).rejects.toMatchObject({ poolScoped: { scope: `freebuff::${MODEL}`, fitnessVersion: 7 } }); expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledTimes(1);
  });

  it("marks chat connector failure once after three pre-response attempts", async () => {
    let chats = 0; fetchMock.mockImplementation((url, options) => url === SESSION_URL ? Promise.resolve(response({ status: "none" })) : url === RUN_URL ? Promise.resolve(response(JSON.parse(options.body).action === "START" ? { runId: "r" } : {})) : (chats += 1, Promise.reject(new Error("tunnel reset"))));
    await expect(new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials, proxyOptions: { proxyPoolId: "pool-a" } })).rejects.toMatchObject({ poolScoped: { fitnessVersion: 7 } });
    expect(chats).toBe(3); expect(fitnessMocks.markPoolUnfit).toHaveBeenCalledTimes(1);
  });

  it("does not mark excluded target, quota, abort, no-pool, or null-pool cases", async () => {
    for (const status of [502, 503, 504, 429]) await markFreebuffPoolFailure({ model: MODEL, proxyOptions: { proxyPoolId: "pool-a" }, stage: "chat_submit", status, error: status === 429 ? "quota exceeded" : "target", provenance: "target_response" });
    await markFreebuffPoolFailure({ model: MODEL, proxyOptions: { proxyPoolId: "pool-a" }, stage: "chat_submit", error: new Error("abort"), signal: AbortSignal.abort() });
    await markFreebuffPoolFailure({ model: MODEL, proxyOptions: null, stage: "chat_submit", error: new Error("tunnel") }); await markFreebuffPoolFailure({ model: MODEL, proxyOptions: { proxyPoolId: null }, stage: "chat_submit", error: new Error("tunnel") });
    expect(fitnessMocks.markPoolUnfit).not.toHaveBeenCalled();
  });

  it("does not mark credential, model_locked, or stale-session recovery", async () => {
    for (const session of [response({}, 401), response({ status: "model_locked" })]) {
      __test__.resetSessionCache(); fetchMock.mockReset(); fetchMock.mockResolvedValue(session);
      try { await new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials, proxyOptions: { proxyPoolId: "pool-a" } }); } catch {}
    }
    expect(fitnessMocks.markPoolUnfit).not.toHaveBeenCalled();
  });

  it("never replays uncertain post-submit acceptance", async () => {
    let chats = 0; fetchMock.mockImplementation((url, options) => url === SESSION_URL ? Promise.resolve(response({ status: "none" })) : url === RUN_URL ? Promise.resolve(response(JSON.parse(options.body).action === "START" ? { runId: "r" } : {})) : (chats += 1, Promise.reject(Object.assign(new Error("body interrupted"), { responseStarted: true }))));
    await expect(new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials, proxyOptions: { proxyPoolId: "pool-a" } })).rejects.toThrow(/interrupted/);
    expect(chats).toBe(1); expect(fitnessMocks.markPoolUnfit).not.toHaveBeenCalled();
  });

  it("retries transient chat network failures twice while retaining one run id", async () => {
    let chatAttempts = 0;
    fetchMock.mockImplementation((url, options) => {
      if (url === SESSION_URL) return Promise.resolve(response({ status: "none" }));
      if (url === RUN_URL) return Promise.resolve(response(JSON.parse(options.body).action === "START" ? { runId: "run-1" } : {}));
      chatAttempts += 1;
      return chatAttempts < 3 ? Promise.reject(new Error("offline")) : Promise.resolve(response({ choices: [] }));
    });

    const result = await new FreebuffExecutor().execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials });

    expect(result.response.status).toBe(200);
    expect(chatAttempts).toBe(3);
    const chatBodies = fetchMock.mock.calls.filter(([url]) => url === CHAT_URL).map(([, options]) => JSON.parse(options.body));
    expect(new Set(chatBodies.map((body) => body.codebuff_metadata.run_id))).toEqual(new Set(["run-1"]));
  });

  it("maps an endpoint lookup 404 to a short retry window and falls back to base2-free", () => {
    const before = Date.now();
    const error = new FreebuffExecutor().parseError({ status: 404 }, "No endpoints found");

    expect(error.resetsAtMs).toBeGreaterThanOrEqual(before + 120_000);
    expect(error.resetsAtMs).toBeLessThanOrEqual(Date.now() + 120_000);
    expect(__test__.rootAgentIdForModel("unknown/model")).toBe("base2-free");
  });
});
