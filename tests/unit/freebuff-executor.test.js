import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
vi.mock("../../open-sse/services/proxyPoolFitness.js", () => ({ markPoolUnfit: vi.fn(), clearPoolUnfit: vi.fn() }));

import { FreebuffExecutor, __test__ } from "../../open-sse/executors/freebuff.js";

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

  it("maps limited-IP session gates to a pool-scoped retry signal", async () => {
    fetchMock.mockResolvedValueOnce(response({ status: "session_model_mismatch", message: "limited IP" }));

    await expect(new FreebuffExecutor().execute({
      model: MODEL,
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
      proxyOptions: { proxyPoolId: "pool-a", connectionProxyUrl: "http://proxy" },
    })).rejects.toMatchObject({ status: 409, poolScoped: { poolId: "pool-a", scope: `freebuff::${MODEL}`, reason: "limited_ip" } });
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
