import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  accounts: [],
  settings: {},
  assignments: [],
  attemptsByRequest: new Map(),
  activeByAccount: new Map(),
  maxObservedByAccount: new Map(),
  controls: [],
  controlsByRequest: new Map(),
  updateCalls: [],
  networkGuard: vi.fn(() => {
    throw new Error("Shadow load attempted forbidden network access");
  }),
}));

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(async () => true),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(async () => []),
}));

const chatCoreMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  })),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async () => ({
    provider: "codex",
    model: "gpt-5.6-sol",
  })),
  getComboModels: vi.fn(async () => null),
}));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("open-sse/handlers/chatCore.js", () => ({
  handleChatCore: chatCoreMock,
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({
  cacheClaudeHeaders: vi.fn(),
}));
vi.mock("@/lib/headroom/detect", () => ({
  DEFAULT_HEADROOM_URL: "http://127.0.0.1:8787",
}));
vi.mock("@/lib/pxpipe/loader.js", () => ({
  getTransform: vi.fn(async () => null),
}));
vi.mock("@/lib/pxpipe/events.js", () => ({
  appendPxpipeEvent: vi.fn(),
}));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(() => "masked"),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(async () => {}),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));
vi.mock("open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(async () => null),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const {
  __resetAccountAdmissionForTests,
  getAdmissionSnapshot,
  setProviderAdmissionConfig,
} = await import("../../src/sse/services/accountAdmission.js");

const encoder = new TextEncoder();
let consoleErrorSpy;

function makeAccounts(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `synthetic-account-${index + 1}`,
    name: `Synthetic ${index + 1}`,
    displayName: `Synthetic ${index + 1}`,
    accessToken: `synthetic-token-${index + 1}`,
    authType: "oauth",
    priority: index + 1,
    isActive: true,
    providerSpecificData: {},
  }));
}

function admissionSettings({
  accountLimit,
  maxQueueSize,
  queueTimeoutMs = 300000,
  strategy = "fill-first",
}) {
  return {
    requireApiKey: false,
    fallbackStrategy: strategy,
    stickyRoundRobinLimit: 1,
    providerStrategies: {
      codex: {
        fallbackStrategy: strategy,
        stickyRoundRobinLimit: 1,
        admission: {
          enabled: true,
          maxInFlightPerAccount: accountLimit,
          maxQueueSize,
          queueTimeoutMs,
        },
      },
    },
    rtkEnabled: false,
  };
}

function requestFor(shadowId, signal = undefined) {
  return new Request("http://127.0.0.1:20128/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "cx/gpt-5.6-sol",
      input: "Synthetic shadow request",
      shadowId,
    }),
    signal,
  });
}

function startObservedAttempt(requestId, accountId) {
  fixture.assignments.push({ requestId, accountId });
  const attempt = (fixture.attemptsByRequest.get(requestId) || 0) + 1;
  fixture.attemptsByRequest.set(requestId, attempt);

  const active = (fixture.activeByAccount.get(accountId) || 0) + 1;
  fixture.activeByAccount.set(accountId, active);
  fixture.maxObservedByAccount.set(
    accountId,
    Math.max(fixture.maxObservedByAccount.get(accountId) || 0, active),
  );

  let settled = false;
  return () => {
    if (settled) return false;
    settled = true;
    const current = fixture.activeByAccount.get(accountId) || 0;
    fixture.activeByAccount.set(accountId, Math.max(0, current - 1));
    return true;
  };
}

function controlledResponse(requestId, accountId, mode) {
  const settleObservedAttempt = startObservedAttempt(requestId, accountId);
  let releaseControl;
  const released = new Promise((resolve) => {
    releaseControl = resolve;
  });

  const control = {
    requestId,
    accountId,
    mode,
    released: false,
    settled: false,
    releasedPromise: released,
    release() {
      if (control.released) return false;
      control.released = true;
      releaseControl();
      return true;
    },
    settle() {
      if (control.settled) return false;
      control.settled = true;
      settleObservedAttempt();
      return true;
    },
  };
  fixture.controls.push(control);
  fixture.controlsByRequest.set(requestId, control);

  if (mode === "cancel") {
    return new Response(new ReadableStream({
      cancel() {
        control.settle();
      },
    }));
  }

  let delivered = false;
  return new Response(new ReadableStream({
    async pull(controller) {
      if (delivered) return;
      delivered = true;
      await released;
      if (mode === "stream_error") {
        control.settle();
        controller.error(new Error(`synthetic stream failure ${requestId}`));
        return;
      }
      controller.enqueue(encoder.encode(`ok-${requestId}`));
      controller.close();
      control.settle();
    },
    cancel() {
      control.settle();
    },
  }));
}

function successfulMode(requestId) {
  if (requestId % 11 === 0) return "cancel";
  if (requestId % 13 === 0) return "stream_error";
  return "eof";
}

function configureChatCore({ fallbackRequestId = null, mixedModes = false } = {}) {
  chatCoreMock.mockImplementation(async ({ body, credentials }) => {
    const requestId = body.shadowId;
    const accountId = credentials.connectionId;
    const previousAttempts = fixture.attemptsByRequest.get(requestId) || 0;

    if (requestId === fallbackRequestId && previousAttempts === 0) {
      const settle = startObservedAttempt(requestId, accountId);
      settle();
      return {
        success: false,
        status: 429,
        error: "synthetic upstream account limit",
        fallbackScope: "account",
        response: new Response("synthetic upstream failure", { status: 429 }),
      };
    }

    const mode = mixedModes ? successfulMode(requestId) : "eof";
    return {
      success: true,
      response: controlledResponse(requestId, accountId, mode),
    };
  });
}

async function executeRequest(shadowId, signal = undefined) {
  const response = await handleChat(requestFor(shadowId, signal));
  if (response.status !== 200) {
    return {
      shadowId,
      status: response.status,
      body: await response.json(),
      retryAfter: response.headers.get("retry-after"),
    };
  }

  const control = fixture.controlsByRequest.get(shadowId);
  if (!control) throw new Error(`Missing response control for request ${shadowId}`);

  if (control.mode === "cancel") {
    await control.releasedPromise;
    await response.body.cancel("synthetic downstream cancellation");
    return { shadowId, status: 200, outcome: "cancelled" };
  }

  try {
    const body = await response.text();
    return { shadowId, status: 200, outcome: "eof", body };
  } catch (error) {
    if (control.mode !== "stream_error") throw error;
    return {
      shadowId,
      status: 200,
      outcome: "stream_error",
      error: error.message,
    };
  }
}

async function spinUntil(predicate, label, limit = 50000) {
  for (let turn = 0; turn < limit; turn += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`Shadow fixture did not reach state: ${label}`);
}

function trackedJobs(count, requestFactory = (index) => executeRequest(index)) {
  const state = { settled: 0 };
  const jobs = Array.from({ length: count }, (_, index) => (
    requestFactory(index).finally(() => {
      state.settled += 1;
    })
  ));
  return { jobs, state };
}

async function drainControlledResponses(state, totalJobs) {
  while (state.settled < totalJobs) {
    await spinUntil(
      () => (
        fixture.controls.some((control) => !control.released) ||
        state.settled === totalJobs
      ),
      "a releasable response or complete settlement",
    );
    if (state.settled === totalJobs) break;

    const batch = fixture.controls.filter((control) => !control.released);
    for (const control of batch) control.release();
    await spinUntil(
      () => batch.every((control) => control.settled),
      "released response batch settlement",
    );
  }
}

function admissionConfig() {
  return fixture.settings.providerStrategies.codex.admission;
}

function assertNoCapacityLeak(accountLimit) {
  for (const account of fixture.accounts) {
    expect(fixture.maxObservedByAccount.get(account.id) || 0)
      .toBeLessThanOrEqual(accountLimit);
    expect(fixture.activeByAccount.get(account.id) || 0).toBe(0);
  }
  expect(getAdmissionSnapshot().providers.codex).toMatchObject({
    active: 0,
    queued: 0,
  });
  expect(vi.getTimerCount()).toBe(0);
}

function disableAndAssertEmpty() {
  setProviderAdmissionConfig("codex", {
    ...admissionConfig(),
    enabled: false,
  });
  expect(getAdmissionSnapshot()).toEqual({ providers: {} });
}

function accountLockWrites() {
  return fixture.updateCalls.filter(({ patch }) => (
    patch.testStatus === "unavailable" ||
    Object.keys(patch).some((key) => key.startsWith("modelLock_"))
  ));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-23T00:00:00.000Z"));
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fixture.networkGuard);
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  fixture.accounts = [];
  fixture.settings = {};
  fixture.assignments.length = 0;
  fixture.attemptsByRequest.clear();
  fixture.activeByAccount.clear();
  fixture.maxObservedByAccount.clear();
  fixture.controls.length = 0;
  fixture.controlsByRequest.clear();
  fixture.updateCalls.length = 0;

  dbMocks.getProviderConnections.mockImplementation(async () => (
    fixture.accounts
      .filter((account) => account.isActive !== false)
      .sort((left, right) => left.priority - right.priority)
  ));
  dbMocks.getSettings.mockImplementation(async () => fixture.settings);
  dbMocks.updateProviderConnection.mockImplementation(async (connectionId, patch) => {
    fixture.updateCalls.push({ connectionId, patch: { ...patch } });
    const account = fixture.accounts.find(({ id }) => id === connectionId);
    if (account) {
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete account[key];
        else account[key] = value;
      }
    }
  });
});

afterEach(async () => {
  for (const control of fixture.controls) control.release();
  await Promise.resolve();
  __resetAccountAdmissionForTests();
  consoleErrorSpy?.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Codex admission deterministic shadow load", () => {
  it("settles 200 mixed requests within per-account capacity and exercises fallback", async () => {
    const requestCount = 200;
    const accountLimit = 2;
    fixture.accounts = makeAccounts(4);
    fixture.settings = admissionSettings({
      accountLimit,
      maxQueueSize: requestCount,
    });
    configureChatCore({ fallbackRequestId: 197, mixedModes: true });

    const { jobs, state } = trackedJobs(requestCount);
    await spinUntil(
      () => {
        const snapshot = getAdmissionSnapshot().providers.codex;
        return (
          fixture.controls.length === fixture.accounts.length * accountLimit &&
          snapshot?.active === fixture.accounts.length * accountLimit &&
          snapshot?.queued === requestCount - fixture.accounts.length * accountLimit
        );
      },
      "initial bounded capacity with the remaining requests queued",
    );

    await drainControlledResponses(state, requestCount);
    const results = await Promise.all(jobs);

    expect(results).toHaveLength(requestCount);
    expect(results.every(({ status }) => status === 200)).toBe(true);
    expect(results.some(({ outcome }) => outcome === "cancelled")).toBe(true);
    expect(results.some(({ outcome }) => outcome === "stream_error")).toBe(true);
    expect(results.some(({ outcome }) => outcome === "eof")).toBe(true);

    const fallbackAssignments = fixture.assignments
      .filter(({ requestId }) => requestId === 197)
      .map(({ accountId }) => accountId);
    expect(fallbackAssignments).toHaveLength(2);
    expect(new Set(fallbackAssignments).size).toBe(2);
    expect(accountLockWrites()).toHaveLength(1);
    expect(fixture.networkGuard).not.toHaveBeenCalled();
    assertNoCapacityLeak(accountLimit);
    disableAndAssertEmpty();
  });

  it("returns an exact local 429 split when the bounded queue overflows", async () => {
    const requestCount = 30;
    const accountLimit = 1;
    const queueSize = 10;
    const expectedAccepted = 2 * accountLimit + queueSize;
    fixture.accounts = makeAccounts(2);
    fixture.settings = admissionSettings({
      accountLimit,
      maxQueueSize: queueSize,
    });
    configureChatCore();

    const { jobs, state } = trackedJobs(requestCount);
    await spinUntil(
      () => {
        const snapshot = getAdmissionSnapshot().providers.codex;
        return (
          fixture.controls.length === 2 &&
          snapshot?.queued === queueSize &&
          snapshot?.rejected === requestCount - expectedAccepted
        );
      },
      "full queue and exact overflow rejection count",
    );

    await drainControlledResponses(state, requestCount);
    const results = await Promise.all(jobs);
    const accepted = results.filter(({ status }) => status === 200);
    const rejected = results.filter(({ status }) => status === 429);

    expect(accepted).toHaveLength(expectedAccepted);
    expect(rejected).toHaveLength(requestCount - expectedAccepted);
    for (const result of rejected) {
      expect(result.body).toEqual({
        error: {
          message: "Local provider admission queue is full",
          type: "rate_limit_error",
          code: "local_admission_limit",
        },
      });
    }
    expect(accountLockWrites()).toHaveLength(0);
    expect(fixture.networkGuard).not.toHaveBeenCalled();
    assertNoCapacityLeak(accountLimit);
    disableAndAssertEmpty();
  });

  it("settles queue timeout and request abort while the only account is occupied", async () => {
    const accountLimit = 1;
    fixture.accounts = makeAccounts(1);
    fixture.settings = admissionSettings({
      accountLimit,
      maxQueueSize: 2,
      queueTimeoutMs: 1000,
    });
    configureChatCore();

    const activeJob = executeRequest(0);
    await spinUntil(
      () => getAdmissionSnapshot().providers.codex?.active === 1,
      "occupied account",
    );

    const abortController = new AbortController();
    const timeoutJob = executeRequest(1);
    const abortJob = executeRequest(2, abortController.signal);
    await spinUntil(
      () => getAdmissionSnapshot().providers.codex?.queued === 2,
      "timeout and abort waiters",
    );

    abortController.abort();
    const aborted = await abortJob;
    expect(aborted.status).toBe(499);

    await vi.advanceTimersByTimeAsync(1000);
    const timedOut = await timeoutJob;
    expect(timedOut).toMatchObject({
      status: 429,
      retryAfter: "1",
      body: {
        error: {
          code: "local_admission_limit",
        },
      },
    });

    fixture.controlsByRequest.get(0).release();
    await expect(activeJob).resolves.toMatchObject({
      status: 200,
      outcome: "eof",
    });

    expect(getAdmissionSnapshot().providers.codex).toMatchObject({
      active: 0,
      queued: 0,
      rejected: 1,
    });
    expect(accountLockWrites()).toHaveLength(0);
    expect(fixture.networkGuard).not.toHaveBeenCalled();
    assertNoCapacityLeak(accountLimit);
    disableAndAssertEmpty();
  });

  it("keeps sticky-1 round-robin assignments deterministically balanced", async () => {
    const requestCount = 80;
    const waveSize = 4;
    const accountLimit = 1;
    fixture.accounts = makeAccounts(4);
    fixture.settings = admissionSettings({
      accountLimit,
      maxQueueSize: requestCount,
      strategy: "round-robin",
    });
    configureChatCore();

    const results = [];
    for (let offset = 0; offset < requestCount; offset += waveSize) {
      const { jobs } = trackedJobs(
        waveSize,
        (index) => executeRequest(offset + index),
      );
      const waveNumber = offset / waveSize;
      await spinUntil(
        () => (
          fixture.controls.length === (waveNumber + 1) * waveSize &&
          getAdmissionSnapshot().providers.codex?.active === waveSize
        ),
        `round-robin wave ${waveNumber + 1} at equal synthetic duration`,
      );

      const controls = fixture.controls.slice(offset, offset + waveSize);
      for (const control of controls) control.release();
      results.push(...await Promise.all(jobs));
    }

    expect(results.every(({ status, outcome }) => (
      status === 200 && outcome === "eof"
    ))).toBe(true);

    const counts = fixture.accounts.map(({ id }) => (
      fixture.assignments.filter(({ accountId }) => accountId === id).length
    ));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(requestCount);
    expect(accountLockWrites()).toHaveLength(0);
    expect(fixture.networkGuard).not.toHaveBeenCalled();
    assertNoCapacityLeak(accountLimit);
    disableAndAssertEmpty();
  });
});
