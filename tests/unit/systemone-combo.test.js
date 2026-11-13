import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getComboByName: vi.fn(),
  getModelAliases: vi.fn(),
  getProviderNodes: vi.fn(),
  saveRequestUsage: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getComboByName: mocks.getComboByName,
  getModelAliases: mocks.getModelAliases,
  getProviderNodes: mocks.getProviderNodes,
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: mocks.saveRequestUsage,
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));

vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(() => "masked"),
}));

import { handleSystemone } from "@/sse/handlers/systemone.js";
import { resetComboRotation } from "open-sse/services/combo.js";
// The real classifier is deliberately NOT mocked: markAccountUnavailable must
// decide fallback the same way production does, otherwise the request-level-400
// case would pass for the wrong reason (a mocked always-true would keep going).
import { checkFallbackError } from "open-sse/services/accountFallback.js";

const STATE = "A payment failed";
const QUESTIONS = { is_urgent: { type: "noul", instructions: "Is it urgent?" } };

function call(model) {
  return handleSystemone(new Request("http://localhost/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, state: STATE, questions: QUESTIONS }),
  }));
}

function postRaw(payload) {
  return handleSystemone(new Request("http://localhost/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

function okResponse(model) {
  return new Response(JSON.stringify({
    model,
    answers: { is_urgent: { type: "noul", noul: 0.99 } },
    usage: { input_tokens: 12, output_tokens: 2 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function rateLimitedResponse() {
  return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });
}

function credentials(provider, connectionId) {
  return {
    apiKey: `${provider}-key`,
    connectionId,
    connectionName: `${provider} account`,
    providerSpecificData: {},
    _connection: { testStatus: "active", lastError: null },
  };
}

/**
 * Credential selector mirroring `getProviderCredentials`: each provider rotates
 * through its account ids and returns null once every id is excluded, so a handler
 * without exclusion awareness would loop forever instead of failing the test loudly.
 */
function accounts(map) {
  return vi.fn(async (provider, excludeConnectionIds) => {
    const ids = map[provider] || [];
    const excluded = excludeConnectionIds instanceof Set
      ? excludeConnectionIds
      : new Set(excludeConnectionIds ? [excludeConnectionIds] : []);
    const id = ids.find((candidate) => !excluded.has(candidate));
    return id ? credentials(provider, id) : null;
  });
}

let upstreamCalls = [];

function installFetch(handlers = {}) {
  upstreamCalls = [];
  global.fetch = vi.fn(async (url, init) => {
    const target = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    upstreamCalls.push({ target, body });
    const handler = handlers[target] || handlers.default;
    if (handler) return handler(body, target);
    return target.includes("v1m.ir") ? okResponse(body.model) : okResponse(body.model);
  });
}

describe("System One combos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetComboRotation();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      comboStrategies: {},
      comboStickyRoundRobinLimit: 1,
    });
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.saveRequestUsage.mockResolvedValue(undefined);
    // Mirror markAccountUnavailable's decision through the real production classifier,
    // so request-scoped 400s stop the loop exactly like the live server does.
    mocks.markAccountUnavailable.mockImplementation(async (_id, status, errorText, provider, model) => {
      const { shouldFallback, cooldownMs } = checkFallbackError(status, errorText, 0, provider);
      return { shouldFallback, cooldownMs: shouldFallback ? cooldownMs : 0, model };
    });
    mocks.clearAccountError.mockResolvedValue(undefined);
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, creds) => creds);
    mocks.getProviderCredentials.mockImplementation(accounts({
      v1m: ["conn-v1m"],
      "opencode-zen": ["conn-zen"],
      opencode: ["conn-oc"],
    }));
    installFetch({
      "http://127.0.0.1/v1m": (body) => okResponse(body.model),
      "http://127.0.0.1/zen": (body) => okResponse(body.model),
    });
  });

  it("routes a System One combo: first provider fails, second answers with the native payload", async () => {
    mocks.getComboByName.mockResolvedValue({
      name: "systemone-test",
      kind: "systemone",
      models: ["v1m/rev-latest", "ocz/jev-1.13"],
    });
    installFetch({
      "https://v1m.ir/v1/systemone": () => rateLimitedResponse(),
      "https://opencode.ai/zen/v1/systemone": (body) => okResponse(body.model),
    });

    const response = await call("systemone-test");
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.answers).toEqual({ is_urgent: { type: "noul", noul: 0.99 } });
    expect(json.usage).toEqual({ input_tokens: 12, output_tokens: 2 });

    // Payload stays native: model swapped to the upstream id, state/questions untouched.
    expect(upstreamCalls.map((c) => c.body.model)).toEqual(["rev-latest", "jev-1.13"]);
    for (const request of upstreamCalls) {
      expect(request.body.state).toBe(STATE);
      expect(request.body.questions).toEqual(QUESTIONS);
    }
    expect(upstreamCalls[0].target).toContain("v1m.ir");
    expect(upstreamCalls[1].target).toContain("opencode.ai/zen/v1/systemone");

    // Usage is recorded once, for the provider that actually answered.
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage.mock.calls[0][0]).toMatchObject({
      provider: "opencode-zen",
      model: "jev-1.13",
    });
  });

  it("keeps account failover inside a member before moving to the next provider", async () => {
    mocks.getComboByName.mockResolvedValue({
      name: "systemone-test",
      kind: "systemone",
      models: ["v1m/rev-latest", "ocz/jev-1.13"],
    });
    mocks.getProviderCredentials.mockImplementation(accounts({
      v1m: ["conn-v1m-a", "conn-v1m-b"],
      "opencode-zen": ["conn-zen"],
    }));
    let served = 0;
    installFetch({
      "https://v1m.ir/v1/systemone": (body) => (++served === 1 ? rateLimitedResponse() : okResponse(body.model)),
      "https://opencode.ai/zen/v1/systemone": (body) => okResponse(body.model),
    });

    const response = await call("systemone-test");

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(2);
    expect(upstreamCalls.every((c) => c.target.includes("v1m.ir"))).toBe(true);
    expect(mocks.getProviderCredentials.mock.calls.every(([provider]) => provider === "v1m")).toBe(true);
  });

  it("rotates members when the combo opts into round-robin", async () => {
    mocks.getComboByName.mockResolvedValue({
      name: "systemone-test",
      kind: "systemone",
      models: ["v1m/rev-latest", "ocz/jev-1.13"],
    });
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      comboStrategies: { "systemone-test": { fallbackStrategy: "round-robin" } },
      comboStickyRoundRobinLimit: 1,
    });
    installFetch({ default: (body) => okResponse(body.model) });

    const first = await (await call("systemone-test")).json();
    const second = await (await call("systemone-test")).json();
    const third = await (await call("systemone-test")).json();

    expect([first.model, second.model, third.model]).toEqual(["rev-latest", "jev-1.13", "rev-latest"]);
    expect(upstreamCalls.map((c) => c.target.includes("v1m.ir"))).toEqual([true, false, true]);
  });

  it("falls through a member with no credentials and reports 503 when every member is empty", async () => {
    mocks.getComboByName.mockResolvedValue({
      name: "systemone-test",
      kind: "systemone",
      models: ["v1m/rev-latest", "ocz/jev-1.13"],
    });
    mocks.getProviderCredentials.mockImplementation(accounts({ "opencode-zen": ["conn-zen"] }));
    installFetch({ default: (body) => okResponse(body.model) });

    const recovered = await call("systemone-test");
    expect(recovered.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);

    upstreamCalls = [];
    mocks.getProviderCredentials.mockImplementation(accounts({}));
    const exhausted = await call("systemone-test");
    expect(exhausted.status).toBe(503);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("stops at a request-level provider error instead of trying the next member", async () => {
    mocks.getComboByName.mockResolvedValue({
      name: "systemone-test",
      kind: "systemone",
      models: ["v1m/rev-latest", "ocz/jev-1.13"],
    });
    installFetch({
      default: () => new Response(JSON.stringify({ error: { message: "Unsupported question type" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    });

    const response = await call("systemone-test");

    expect(response.status).toBe(400);
    expect(upstreamCalls).toHaveLength(1);
    // The loop stopped because the production classifier says a request-scoped 400
    // is not account-related — not because credentials happened to run out.
    expect(checkFallbackError(400, "Unsupported question type", 0, "v1m").shouldFallback).toBe(false);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledTimes(1);
    expect(mocks.markAccountUnavailable.mock.calls[0][1]).toBe(400);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalledWith(
      "opencode-zen",
      expect.anything(),
      expect.anything(),
    );
  });

  it("honors the sticky round-robin limit before switching members", async () => {
    mocks.getComboByName.mockResolvedValue({
      name: "systemone-test",
      kind: "systemone",
      models: ["v1m/rev-latest", "ocz/jev-1.13"],
    });
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      comboStrategies: { "systemone-test": { fallbackStrategy: "round-robin" } },
      comboStickyRoundRobinLimit: 2,
    });
    installFetch({ default: (body) => okResponse(body.model) });

    const served = [];
    for (let i = 0; i < 3; i += 1) served.push((await (await call("systemone-test")).json()).model);

    expect(served).toEqual(["rev-latest", "rev-latest", "jev-1.13"]);
  });

  it("reports the earliest retryAfter when every member is locked", async () => {
    mocks.getComboByName.mockResolvedValue({
      name: "systemone-test",
      kind: "systemone",
      models: ["v1m/rev-latest", "ocz/jev-1.13"],
    });
    const retryAfter = {
      v1m: new Date(Date.now() + 5 * 60_000).toISOString(),
      "opencode-zen": new Date(Date.now() + 60_000).toISOString(),
    };
    mocks.getProviderCredentials.mockImplementation(async (provider) => ({
      allRateLimited: true,
      retryAfter: retryAfter[provider],
      retryAfterHuman: provider === "v1m" ? "reset after 5m" : "reset after 1m",
      lastError: `${provider} quota exceeded`,
      lastErrorCode: 429,
    }));

    const response = await call("systemone-test");
    const json = await response.json();

    expect(response.status).toBe(429);
    // The shorter of the two cooldowns wins, so the caller retries when the first
    // member recovers rather than when the slowest one does.
    expect(json.error.message).toContain("opencode-zen quota exceeded");
    expect(json.error.message).toContain("reset after 1m");
    // The aggregated response must carry the earliest cooldown (60s), proving the
    // member retryAfter survived into handleComboChat's aggregation.
    const retryAfterHeader = Number(response.headers.get("retry-after"));
    expect(retryAfterHeader).toBeGreaterThan(0);
    expect(retryAfterHeader).toBeLessThanOrEqual(61);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("rejects non-System-One and empty combos, and keeps single-model requests working", async () => {
    mocks.getComboByName.mockResolvedValue({ name: "chat-combo", kind: "llm", models: ["v1m/rev-latest"] });
    const wrongKind = await call("chat-combo");
    expect(wrongKind.status).toBe(400);
    expect(JSON.stringify(await wrongKind.json())).toContain("Combo does not support System One");

    mocks.getComboByName.mockResolvedValue({ name: "empty-combo", kind: "systemone", models: [] });
    const empty = await call("empty-combo");
    expect(empty.status).toBe(400);
    expect(JSON.stringify(await empty.json())).toContain("System One combo has no models");

    mocks.getComboByName.mockResolvedValue({ name: "chatty", kind: "systemone", models: ["openai/gpt-5"] });
    const nonNative = await call("chatty");
    expect(nonNative.status).toBe(400);
    expect(JSON.stringify(await nonNative.json())).toContain("does not support System One");
    expect(upstreamCalls).toHaveLength(0);

    // A member that names another combo must not expand recursively.
    mocks.getComboByName.mockResolvedValue({ name: "nested", kind: "systemone", models: ["chat-combo"] });
    const nested = await call("nested");
    expect(nested.status).toBe(400);
    expect(upstreamCalls).toHaveLength(0);

    // Non-array/blank member lists are rejected before the shared service runs.
    mocks.getComboByName.mockResolvedValue({ name: "broken", kind: "systemone", models: "v1m/rev-latest" });
    const broken = await call("broken");
    expect(broken.status).toBe(400);
    mocks.getComboByName.mockResolvedValue({ name: "blank", kind: "systemone", models: [""] });
    const blank = await call("blank");
    expect(blank.status).toBe(400);
    mocks.getComboByName.mockResolvedValue({ name: "spaces", kind: "systemone", models: ["   "] });
    const spaces = await call("spaces");
    expect(spaces.status).toBe(400);
    expect(upstreamCalls).toHaveLength(0);

    mocks.getComboByName.mockResolvedValue(null);
    installFetch({ default: (body) => okResponse(body.model) });
    const single = await call("v1m/rev-latest");
    expect(single.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].body.model).toBe("rev-latest");
    expect(upstreamCalls[0].body.state).toBe(STATE);
  });

  it("resolves a model alias to the native endpoint", async () => {
    mocks.getModelAliases.mockResolvedValue({ "my-decision": "v1m/rev-latest" });
    installFetch({ default: (body) => okResponse(body.model) });

    const response = await call("my-decision");

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].body.model).toBe("rev-latest");
  });

  it("does not reach providers for invalid auth or malformed native payloads", async () => {
    mocks.getSettings.mockResolvedValue({
      requireApiKey: true,
      comboStrategy: "fallback",
      comboStrategies: {},
      comboStickyRoundRobinLimit: 1,
    });
    mocks.isValidApiKey.mockResolvedValue(false);
    mocks.getComboByName.mockResolvedValue({
      name: "systemone-test",
      kind: "systemone",
      models: ["v1m/rev-latest"],
    });

    const unauthorized = await call("systemone-test");
    expect(unauthorized.status).toBe(401);

    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      comboStrategies: {},
      comboStickyRoundRobinLimit: 1,
    });
    const malformed = await postRaw({ model: "systemone-test", state: "x" });
    expect(malformed.status).toBe(400);

    const numericModel = await postRaw({ model: 42, state: STATE, questions: QUESTIONS });
    expect(numericModel.status).toBe(400);

    const emptyModel = await postRaw({ model: "", state: STATE, questions: QUESTIONS });
    expect(emptyModel.status).toBe(400);

    expect(upstreamCalls).toHaveLength(0);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
});
