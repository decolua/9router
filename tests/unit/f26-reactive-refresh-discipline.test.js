// F26 / RH3 — reactive-401 refresh discipline.
//
// Findings docs/orchestration/findings/T1.1.md §H3 + T1.3.md F-13:
//  1. chatCore's reactive 401 path called executor.refreshCredentials directly,
//     bypassing withCredentialRefreshLock + dedupRefresh → N concurrent 401s
//     produced up to N×3 POSTs with the same (already-rotated) refresh_token.
//  2. DefaultExecutor swallowed 400 invalid_grant as `null` (indistinguishable
//     from a transient failure) → refreshWithRetry replayed the dead RT 3× in
//     ~3s — replay/abuse evidence for rotating-RT IdPs (family revocation risk).
//  3. dedupRefresh cached the `null` failure result for 10s (outage amplifier).
//
// These tests count actual POSTs against a mocked IdP fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One shared executor handle: chatCore (via open-sse/executors/index.js) and the
// usage route both get the same mock object, tests just reprogram the fns.
const { executeMock, refreshMock, updateMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  refreshMock: vi.fn(),
  updateMock: vi.fn(async () => ({})),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: false,
    execute: executeMock,
    refreshCredentials: refreshMock,
    needsRefresh: () => true,
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

// usage/[connectionId] route imports (kept off-disk; mirrors f24a-b precedent)
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(async () => null),
  updateProviderConnection: (...args) => updateMock(...args),
}));
vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: vi.fn(async () => ({ message: "unused" })),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(() => ({})),
}));
vi.mock("@/shared/constants/providers", () => ({
  USAGE_APIKEY_PROVIDERS: [],
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function okResponse() {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-f26",
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: { message: "invalid_token" } }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

// Deterministic upstream: 401 while the request's credentials still hold the
// stale token, 200 once they carry the refreshed one. Independent of call order.
function stale401FreshOk() {
  executeMock.mockImplementation(async ({ credentials }) => ({
    response: credentials?.accessToken === "AT-fresh" ? okResponse() : unauthorizedResponse(),
    url: "https://idp.test/f26/v1/chat/completions",
    headers: {},
    transformedBody: null,
  }));
}

function chatArgs(credentials, connectionId) {
  return {
    body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hi" }] },
    modelInfo: { provider: "f26test", model: "gpt-4o" },
    credentials,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    connectionId,
    rtkEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
  };
}

describe("A — chatCore reactive 401 shares one refresh per credential (RH3.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stale401FreshOk();
  });

  it("3 concurrent 401s for the same credential trigger ONE IdP refresh", async () => {
    let posts = 0;
    refreshMock.mockImplementation(async () => {
      posts++;
      await sleep(5); // hold the refresh "in flight" so callers overlap
      return { accessToken: "AT-fresh", refreshToken: "RT2", expiresIn: 3600 };
    });

    const creds = [
      { accessToken: "AT-stale", refreshToken: "RT1", connectionId: "conn-shared" },
      { accessToken: "AT-stale", refreshToken: "RT1", connectionId: "conn-shared" },
      { accessToken: "AT-stale", refreshToken: "RT1", connectionId: "conn-shared" },
    ];
    const results = await Promise.all(creds.map((c) => handleChatCore(chatArgs(c, "conn-shared"))));

    expect(posts).toBe(1); // RED: 3 (no lock/dedup on the reactive path)
    for (const r of results) expect(r.success).toBe(true);
    // every joined caller retries with the refreshed token
    for (const c of creds) expect(c.accessToken).toBe("AT-fresh");
  });

  it("3 concurrent 401s with invalid_grant trigger ONE refresh total, no replay", async () => {
    let posts = 0;
    refreshMock.mockImplementation(async () => {
      posts++;
      await sleep(5);
      // sentinel shape produced by DefaultExecutor after F26.2 (400 invalid_grant)
      return { error: "invalid_grant", unrecoverable: true, status: 400 };
    });

    const creds = [
      { accessToken: "AT-stale", refreshToken: "RT1", connectionId: "conn-bad" },
      { accessToken: "AT-stale", refreshToken: "RT1", connectionId: "conn-bad" },
      { accessToken: "AT-stale", refreshToken: "RT1", connectionId: "conn-bad" },
    ];
    const results = await Promise.all(creds.map((c) => handleChatCore(chatArgs(c, "conn-bad"))));

    expect(posts).toBe(1); // RED: 3
    for (const r of results) {
      expect(r.success).toBe(false);
      expect(r.status).toBe(401); // upstream 401 propagates honestly (no silent success)
    }
  });

  it("different connections are NOT over-deduplicated: each refreshes once", async () => {
    let posts = 0;
    refreshMock.mockImplementation(async () => {
      posts++;
      await sleep(5);
      return { accessToken: "AT-fresh", refreshToken: "RT2", expiresIn: 3600 };
    });

    const creds = [
      { accessToken: "AT-stale", refreshToken: "RT1", connectionId: "conn-x" },
      { accessToken: "AT-stale", refreshToken: "RT1", connectionId: "conn-y" },
    ];
    const results = await Promise.all(creds.map((c) => handleChatCore(chatArgs(c, c.connectionId))));

    expect(posts).toBe(2);
    for (const r of results) expect(r.success).toBe(true);
  });
});

describe("B — refreshWithRetry/DefaultExecutor: invalid_grant is NOT retried (RH3.2)", () => {
  const originalFetch = global.fetch;
  let fetchCalls;

  function idpResponses(...specs) {
    let i = 0;
    fetchCalls = 0;
    global.fetch = vi.fn(async () => {
      fetchCalls++;
      const s = specs[Math.min(i++, specs.length - 1)];
      return {
        ok: s.ok,
        status: s.status,
        text: async () => s.text,
        json: async () => JSON.parse(s.text),
      };
    });
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function loadExecutorStack() {
    // proxyFetch snapshots globalThis.fetch at module load → mock must be in
    // place before the (re-)import (same trick codex-refresh-token.test.js uses).
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { refreshWithRetry, isUnrecoverableRefreshError } = await import("../../open-sse/services/tokenRefresh.js");
    return { executor: new DefaultExecutor("claude"), refreshWithRetry, isUnrecoverableRefreshError };
  }

  it("400 invalid_grant → sentinel result, exactly ONE POST (RED: 3 POSTs in ~3s)", async () => {
    idpResponses({ ok: false, status: 400, text: '{"error":"invalid_grant","error_description":"token expired"}' });
    const { executor, refreshWithRetry, isUnrecoverableRefreshError } = await loadExecutorStack();

    const result = await refreshWithRetry(
      () => executor.refreshCredentials({ refreshToken: "RT-consumed" }, null),
      3,
      null
    );

    expect(fetchCalls).toBe(1); // RED: 3 — replaying a rotated RT is the bug
    expect(result).toBeTruthy(); // RED: null — the cause was indistinguishable
    expect(isUnrecoverableRefreshError(result)).toBe(true);
    expect(result.error).toBe("invalid_grant");
  });

  it("transient 503/500 keeps retrying and succeeds on attempt 3 (unchanged)", async () => {
    idpResponses(
      { ok: false, status: 503, text: "upstream busy" },
      { ok: false, status: 500, text: "boom" },
      { ok: true, status: 200, text: '{"access_token":"AT-new","refresh_token":"RT-new","expires_in":3600}' }
    );
    const { executor, refreshWithRetry } = await loadExecutorStack();

    const result = await refreshWithRetry(() => executor.refreshCredentials({ refreshToken: "RT" }, null), 3, null);

    expect(fetchCalls).toBe(3);
    expect(result?.accessToken).toBe("AT-new");
  });

  it("400 WITHOUT invalid_grant stays null+retried (other paths unchanged)", async () => {
    idpResponses({ ok: false, status: 400, text: "Bad Request: malformed payload (proxy blip)" });
    const { executor, refreshWithRetry } = await loadExecutorStack();

    const result = await refreshWithRetry(() => executor.refreshCredentials({ refreshToken: "RT" }, null), 3, null);

    expect(fetchCalls).toBe(3);
    expect(result).toBeNull();
  });
});

describe("C — dedupRefresh caches in-flight/success, never null-failures (RH3.3/F-13)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("a null failure result is NOT cached: retry may run immediately", async () => {
    const { dedupRefresh } = await import("../../open-sse/services/tokenRefresh/dedup.js");
    const fn1 = vi.fn(async () => null);
    expect(await dedupRefresh("f26", "tok-null", fn1)).toBeNull();

    const fn2 = vi.fn(async () => ({ accessToken: "AT" }));
    const second = await dedupRefresh("f26", "tok-null", fn2);
    expect(fn2).toHaveBeenCalledTimes(1); // RED: 0 — null poisoned the cache for 10s
    expect(second?.accessToken).toBe("AT");
  });

  it("success results are still cached within the TTL window", async () => {
    const { dedupRefresh } = await import("../../open-sse/services/tokenRefresh/dedup.js");
    const fn = vi.fn(async () => ({ accessToken: "AT-cached" }));
    await dedupRefresh("f26", "tok-ok", fn);
    const fn2 = vi.fn(async () => ({ accessToken: "OTHER" }));
    const r = await dedupRefresh("f26", "tok-ok", fn2);
    expect(fn2).not.toHaveBeenCalled();
    expect(r.accessToken).toBe("AT-cached");
  });

  it("unrecoverable sentinel is cached (deterministic per dead token)", async () => {
    const { dedupRefresh } = await import("../../open-sse/services/tokenRefresh/dedup.js");
    const fn = vi.fn(async () => ({ error: "invalid_grant", unrecoverable: true }));
    await dedupRefresh("f26", "tok-dead", fn);
    const fn2 = vi.fn(async () => ({ accessToken: "should-not-run" }));
    const r = await dedupRefresh("f26", "tok-dead", fn2);
    expect(fn2).not.toHaveBeenCalled();
    expect(r.error).toBe("invalid_grant");
  });

  it("concurrent refreshes of the same token share one in-flight execution", async () => {
    const { dedupRefresh } = await import("../../open-sse/services/tokenRefresh/dedup.js");
    const fn = vi.fn(async () => {
      await sleep(10);
      return { accessToken: "AT" };
    });
    const [a, b] = await Promise.all([
      dedupRefresh("f26", "tok-inflight", fn),
      dedupRefresh("f26", "tok-inflight", fn),
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a.accessToken).toBe("AT");
    expect(b.accessToken).toBe("AT");
  });
});

describe("D — withCredentialRefreshLock is safe for nested + concurrent holders", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("nested same-key lock (self-locking executor inside the reactive holder) resolves, not deadlocks", async () => {
    const { withCredentialRefreshLock } = await import("../../open-sse/services/oauthCredentialManager.js");
    const credentials = { connectionId: "conn-nested", refreshToken: "RT" };

    const outcome = await Promise.race([
      withCredentialRefreshLock("f26nest", credentials, async () => {
        // grok-cli-style executors call refreshProviderCredentials →
        // withCredentialRefreshLock with the SAME key from inside the reactive fn.
        return withCredentialRefreshLock("f26nest", credentials, async () => "inner-ok");
      }),
      sleep(1500).then(() => "HUNG"),
    ]);

    expect(outcome).toBe("inner-ok"); // RED: "HUNG" (awaiting own pending = self-deadlock)
  });

  it("a concurrent non-nested holder of the same key JOINS the in-flight refresh", async () => {
    const { withCredentialRefreshLock, refreshProviderCredentials } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    const credentials = { connectionId: "conn-join", refreshToken: "RT-join" };

    const outer = withCredentialRefreshLock("f26join", credentials, async () => {
      await sleep(20);
      return { accessToken: "AT-outer" };
    });
    // separate async root (e.g. proactive path): must join, not start a 2nd refresh
    const joiner = refreshProviderCredentials("f26join", { ...credentials }, null);

    const [a, b] = await Promise.all([outer, joiner]);
    expect(a.accessToken).toBe("AT-outer");
    expect(b).toBe(a); // joined the same in-flight promise value
  });
});

describe("E — usage route treats the invalid_grant sentinel as a refresh failure", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("sentinel from executor.refreshCredentials does not masquerade as a successful refresh", async () => {
    refreshMock.mockResolvedValue({ error: "invalid_grant", unrecoverable: true, status: 400 });

    const { refreshAndUpdateCredentials } = await import("@/app/api/usage/[connectionId]/route.js");
    const connection = {
      id: "conn-e1",
      provider: "grok-cli",
      authType: "oauth",
      accessToken: "AT-existing",
      refreshToken: "RT-dead",
    };

    const result = await refreshAndUpdateCredentials(connection, true, null);

    // RED: refreshed===true and updateProviderConnection called with {updatedAt}
    // because the truthy sentinel slipped past `if (!refreshResult)`.
    expect(result.refreshed).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
