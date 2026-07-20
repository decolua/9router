import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  AutoClawBulkImportManager,
  buildAutoClawAuthHeaders,
} from "../../src/lib/oauth/services/autoclawBulkImportManager.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createFakeBrowser() {
  return {
    __ninerouterProxyUrl: null,
    async newContext() {
      const handlers = new Map();
      const page = {
        on(event, handler) {
          handlers.set(event, handler);
        },
        off(event) {
          handlers.delete(event);
        },
        async goto() {},
        async waitForTimeout() {},
        async evaluate() {
          return "";
        },
        async screenshot() {
          return Buffer.from("fake");
        },
        url() {
          return "about:blank";
        },
        context() {
          return context;
        },
        async emitResponse(url, payload) {
          const handler = handlers.get("response");
          if (handler) {
            await handler({
              url: () => url,
              json: async () => payload,
            });
          }
        },
      };
      const context = {
        async newPage() {
          return page;
        },
        on() {},
        off() {},
        async close() {},
      };
      return context;
    },
    async close() {},
  };
}

async function waitFor(fn, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

describe("AutoClaw bulk import helpers", () => {
  it("builds AutoClaw signed auth headers for OAuth URL and wallet calls", () => {
    const headers = buildAutoClawAuthHeaders({
      timestamp: "1780000000",
      traceId: "trace-1",
    });

    expect(headers).toMatchObject({
      "content-type": "application/json",
      origin: "https://autoclaw.z.ai",
      referer: "https://autoclaw.z.ai/",
      "x-auth-appid": "100003",
      "x-auth-timestamp": "1780000000",
      "x-auth-sign": "067746997ac4852556893a3c4490768a",
      "x-product": "autoclaw",
      "x-version": "1.10.0",
      "x-client-type": "web",
      "x-trace-id": "trace-1",
    });
  });
});

describe("AutoClawBulkImportManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxyAwareFetch.mockReset();
  });

  it("processes Gmail accounts, captures tokens, checks balance, and saves connections", async () => {
    const saved = [];
    const browser = createFakeBrowser();

    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          oauth_url: "https://accounts.google.com/o/oauth2/auth?state=state-1",
          state: "state-1",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          total_balance: 2000,
        },
      }));

    const manager = new AutoClawBulkImportManager({
      browserLauncher: async () => browser,
      storageName: `autoclaw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      saveConnection: async ({ tokens, email, deviceId, balance }) => {
        saved.push({ tokens, email, deviceId, balance });
        return { connection: { id: `conn-${email}` } };
      },
      googleAutomation: async ({ page, successPromise }) => {
        await page.emitResponse("https://autoglm-api.autoglm.ai/userapi/overseasv1/google-oauth-login", {
          code: 0,
          data: {
            access_token: "Bearer access-1",
            refresh_token: "refresh-1",
          },
        });
        return {
          status: "success",
          ...(await successPromise),
        };
      },
      deviceIdFactory: () => "device-1",
      oauthRequestMinIntervalMs: 0,
    });

    const started = await manager.startJob({
      accounts: ["user@gmail.com|pw"],
      concurrency: 1,
    });

    const finished = await waitFor(() => {
      const job = manager.getJob(started.jobId);
      return job?.status === "completed" ? job : null;
    });

    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://autoglm-api.autoglm.ai/userapi/overseasv1/google-oauth-url");
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body)).toMatchObject({
      device_id: "device-1",
      source_id: "web",
      navigate_uri: "https://autoglm-api.autoglm.ai/userapi/oauth/google/callback",
      client_type: "web",
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      email: "user@gmail.com",
      deviceId: "device-1",
      balance: 2000,
      tokens: {
        accessToken: "Bearer access-1",
        refreshToken: "refresh-1",
      },
    });
    expect(finished.summary.success).toBe(1);
    expect(finished.accounts[0].connectionId).toBe("conn-user@gmail.com");
  });

  it("launches workers with round-robin proxy URLs", async () => {
    const launchedProxyUrls = [];
    const manager = new AutoClawBulkImportManager({
      browserLauncher: async (job) => {
        launchedProxyUrls.push(job.proxyUrl || null);
        return createFakeBrowser();
      },
      storageName: `autoclaw-proxy-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      saveConnection: async ({ email }) => ({ connection: { id: `conn-${email}` } }),
      googleAutomation: async ({ page, successPromise }) => {
        await page.emitResponse("https://autoglm-api.autoglm.ai/userapi/overseasv1/google-oauth-login", {
          code: 0,
          data: {
            access_token: "Bearer access",
            refresh_token: "refresh",
          },
        });
        return {
          status: "success",
          ...(await successPromise),
        };
      },
      deviceIdFactory: (() => {
        let n = 0;
        return () => `device-${++n}`;
      })(),
      oauthRequestMinIntervalMs: 0,
    });

    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { oauth_url: "https://accounts.google.com/a", state: "a" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { total_balance: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { oauth_url: "https://accounts.google.com/b", state: "b" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { total_balance: 1 } }));

    const started = await manager.startJob({
      accounts: ["one@gmail.com|pw", "two@gmail.com|pw"],
      concurrency: 2,
      proxyUrls: ["http://proxy-one:8080", "http://proxy-two:8080"],
      proxyMode: "round-robin",
    });

    await waitFor(() => {
      const job = manager.getJob(started.jobId);
      return job?.status === "completed" ? job : null;
    });

    expect(launchedProxyUrls.sort()).toEqual(["http://proxy-one:8080", "http://proxy-two:8080"]);
  });

  it("cancels queued work", async () => {
    const manager = new AutoClawBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      storageName: `autoclaw-cancel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      googleAutomation: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { status: "success", tokens: { accessToken: "a", refreshToken: "r" } };
      },
      saveConnection: async ({ email }) => ({ connection: { id: `conn-${email}` } }),
      oauthRequestMinIntervalMs: 0,
    });

    proxyAwareFetch.mockResolvedValue(jsonResponse({
      code: 0,
      data: { oauth_url: "https://accounts.google.com/o/oauth2/auth", state: "s" },
    }));

    const started = await manager.startJob({
      accounts: ["one@gmail.com|pw", "two@gmail.com|pw", "three@gmail.com|pw"],
      concurrency: 1,
    });

    manager.cancelJob(started.jobId);
    const finished = await waitFor(() => {
      const job = manager.getJob(started.jobId);
      return job?.status === "cancelled" ? job : null;
    });

    expect(finished.accounts.some((account) => account.status === "cancelled")).toBe(true);
  });

  it("retries AutoClaw OAuth URL requests after provider rate-limit responses", async () => {
    const saved = [];
    const sleepFn = vi.fn(() => Promise.resolve());
    const manager = new AutoClawBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      storageName: `autoclaw-rate-limit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      saveConnection: async ({ tokens, email }) => {
        saved.push({ tokens, email });
        return { connection: { id: `conn-${email}` } };
      },
      googleAutomation: async ({ page, successPromise }) => {
        await page.emitResponse("https://autoglm-api.autoglm.ai/userapi/overseasv1/google-oauth-login", {
          code: 0,
          data: {
            access_token: "Bearer access-after-retry",
            refresh_token: "refresh-after-retry",
          },
        });
        return {
          status: "success",
          ...(await successPromise),
        };
      },
      oauthRequestMinIntervalMs: 0,
      oauthRateLimitInitialBackoffMs: 123,
      sleepFn,
    });

    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ code: 1001, msg: "请求频次太快了,请稍等再试" }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { oauth_url: "https://accounts.google.com/retry", state: "retry" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { total_balance: 9 } }));

    const started = await manager.startJob({
      accounts: ["limited@gmail.com|pw"],
      concurrency: 1,
    });

    const finished = await waitFor(() => {
      const job = manager.getJob(started.jobId);
      return job?.status === "completed" ? job : null;
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledWith(123);
    expect(saved).toHaveLength(1);
    expect(finished.summary.success).toBe(1);
    expect(finished.activity.some((entry) => entry.step === "rate_limited")).toBe(true);
  });
});

describe("AutoClaw bulk import routes", () => {
  const managerMock = {
    startJob: vi.fn(),
    getJobWithPreview: vi.fn(),
    getLatestJobWithPreview: vi.fn(),
    cancelJob: vi.fn(),
    openManualSession: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rejects malformed account lines on start route", async () => {
    vi.doMock("next/server", () => ({
      NextResponse: {
        json: vi.fn((body, init) => ({
          status: init?.status || 200,
          body,
          json: async () => body,
        })),
      },
    }));
    vi.doMock("@/lib/oauth/services/autoclawBulkImportManager", () => ({
      parseAutoClawBulkAccounts: vi.fn((accounts) => ({
        parsed: (accounts || []).filter((line) => String(line).includes("|")),
        invalidLines: (accounts || [])
          .map((line, index) => (!String(line).includes("|") ? index + 1 : null))
          .filter(Boolean),
      })),
      getAutoClawBulkImportManager: vi.fn(() => managerMock),
    }));
    vi.doMock("@/lib/oauth/services/bulkImportProxyResolver", () => ({
      resolveBulkImportProxy: vi.fn(async () => ({
        proxyUrl: null,
        proxyUrls: [],
        proxyMode: "none",
        proxyPoolId: null,
        proxySource: null,
        error: null,
      })),
    }));

    const { POST } = await import("../../src/app/api/oauth/autoclaw/bulk-import/route.js");
    const response = await POST({
      json: async () => ({
        accounts: ["user@gmail.com|pw", "broken"],
      }),
    });

    expect(response.status).toBe(400);
    expect(response.body.invalidLines).toEqual([2]);
    expect(managerMock.startJob).not.toHaveBeenCalled();
  });

  it("starts a bulk import job and passes proxy resolution through", async () => {
    managerMock.startJob.mockResolvedValue({ jobId: "job-1", status: "running" });
    vi.doMock("next/server", () => ({
      NextResponse: {
        json: vi.fn((body, init) => ({
          status: init?.status || 200,
          body,
          json: async () => body,
        })),
      },
    }));
    vi.doMock("@/lib/oauth/services/autoclawBulkImportManager", () => ({
      parseAutoClawBulkAccounts: vi.fn((accounts) => ({
        parsed: accounts,
        invalidLines: [],
      })),
      getAutoClawBulkImportManager: vi.fn(() => managerMock),
    }));
    vi.doMock("@/lib/oauth/services/bulkImportProxyResolver", () => ({
      resolveBulkImportProxy: vi.fn(async () => ({
        proxyUrl: "http://proxy-one:8080",
        proxyUrls: ["http://proxy-one:8080"],
        proxyMode: "single",
        proxyPoolId: "pool-1",
        proxySource: "pool",
        error: null,
      })),
    }));

    const { POST } = await import("../../src/app/api/oauth/autoclaw/bulk-import/route.js");
    const response = await POST({
      json: async () => ({
        accounts: ["user@gmail.com|pw"],
        concurrency: 3,
        engine: "chromium",
        proxyPoolId: "pool-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(managerMock.startJob).toHaveBeenCalledWith({
      accounts: ["user@gmail.com|pw"],
      concurrency: 3,
      engine: "chromium",
      proxyUrl: "http://proxy-one:8080",
      proxyUrls: ["http://proxy-one:8080"],
      proxyMode: "single",
      proxyPoolId: "pool-1",
      proxySource: "pool",
    });
    expect(response.body.job.jobId).toBe("job-1");
  });
});
