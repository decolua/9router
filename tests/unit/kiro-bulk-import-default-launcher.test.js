import { beforeEach, describe, it, expect, vi } from "vitest";

const launchBulkImportBrowserMock = vi.fn();

vi.mock("../../src/lib/oauth/services/bulkImportBrowserEngine.js", () => ({
  DEFAULT_BULK_IMPORT_ENGINE: "chromium",
  normalizeBulkImportEngine(value) {
    return value === "cloakbrowser" ? "cloakbrowser" : "chromium";
  },
  launchBulkImportBrowser: launchBulkImportBrowserMock,
}));

function createFakeBrowser(contextOptions = []) {
  const fakePage = {
    on() {},
    off() {},
    url() {
      return "about:blank";
    },
    bringToFront: async () => null,
    context() {
      return {};
    },
  };

  return {
    async newContext(options) {
      contextOptions.push(options);
      return {
        async newPage() {
          return fakePage;
        },
        on() {},
        off() {},
        async close() {
          return null;
        },
      };
    },
    async close() {
      return null;
    },
  };
}

function createManualBrowserSession({
  headless = false,
  storageState = { cookies: [], origins: [] },
  pageUrl = "https://example.com/manual",
} = {}) {
  const oldBrowser = {
    _options: { headless },
    close: vi.fn(async () => null),
  };
  const oldContext = {
    browser: vi.fn(() => oldBrowser),
    storageState: vi.fn(async () => storageState),
    close: vi.fn(async () => null),
  };
  const oldPage = {
    bringToFront: vi.fn(async () => null),
    context: vi.fn(() => oldContext),
    url: vi.fn(() => pageUrl),
  };

  let newContext;
  const newBrowser = {
    _options: { headless: false },
    close: vi.fn(async () => null),
    newContext: vi.fn(async () => newContext),
  };
  const newPage = {
    bringToFront: vi.fn(async () => null),
    context: vi.fn(() => newContext),
    goto: vi.fn(async () => null),
    url: vi.fn(() => pageUrl),
  };
  newContext = {
    browser: vi.fn(() => newBrowser),
    close: vi.fn(async () => null),
    newPage: vi.fn(async () => newPage),
  };

  return {
    newBrowser,
    newContext,
    newPage,
    oldBrowser,
    oldContext,
    oldPage,
    storageState,
  };
}

function addManualJob(manager, accountOverrides = {}) {
  manager.jobs.set("job-manual", {
    jobId: "job-manual",
    status: "running",
    concurrency: 1,
    createdAt: "2026-06-08T00:00:00.000Z",
    startedAt: "2026-06-08T00:00:01.000Z",
    finishedAt: null,
    error: null,
    accounts: [{
      line: 1,
      email: "user@gmail.com",
      status: "needs_manual",
      error: "Manual assist required",
      connectionId: null,
      workerId: 1,
      ...accountOverrides,
    }],
  });
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

describe("Kiro bulk import default launcher", () => {
  beforeEach(() => {
    launchBulkImportBrowserMock.mockReset();
  });

  it("starts Kiro social automation with a headed browser", async () => {
    launchBulkImportBrowserMock.mockResolvedValue(createFakeBrowser());
    const { KiroBulkImportManager } = await import("../../src/lib/oauth/services/kiroBulkImportManager.js");
    const manager = new KiroBulkImportManager({
      kiroServiceFactory: () => ({
        createSocialAuthorization() {
          return {
            authUrl: "https://example.com",
            codeVerifier: "verifier",
          };
        },
      }),
      googleAutomation: async () => ({ status: "success", code: "code-1" }),
      socialExchange: async () => ({ connection: { id: "conn-1" } }),
    });

    const startedJob = await manager.startJob({
      accounts: ["user@gmail.com|pw1"],
      concurrency: 1,
      proxyUrl: "http://proxy:8080",
    });

    await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job?.status === "completed" ? job : null;
    });

    expect(launchBulkImportBrowserMock).toHaveBeenCalledWith({
      engine: "chromium",
      proxyUrl: "http://proxy:8080",
      headless: false,
      args: ["--start-maximized"],
    });
  });

  it("starts CodeBuddy automation with a desktop anti-detection browser context", async () => {
    const contextOptions = [];
    launchBulkImportBrowserMock.mockResolvedValue(createFakeBrowser(contextOptions));
    const { CodeBuddyBulkImportManager } = await import("../../src/lib/oauth/services/codebuddyBulkImportManager.js");
    const manager = new CodeBuddyBulkImportManager({
      requestDeviceCodeFn: async () => ({
        device_code: "state-1",
        verification_uri: "https://www.codebuddy.ai/login?platform=CLI&state=state-1",
      }),
      pollToken: async () => ({
        success: true,
        tokens: {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          expiresIn: 86400,
        },
      }),
      googleAutomation: async ({ successPromise }) => ({
        status: "success",
        ...(await successPromise),
      }),
      saveConnection: async () => ({
        connection: { id: "conn-codebuddy" },
      }),
      createApiKeyFn: async () => ({
        key: "cb-key-user",
        id: "key-id-user",
        name: "9router-user",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
      findExistingApiKeyFn: async () => null,
      fetchLoginAccountFn: async () => null,
      pollIntervalMs: 10,
    });

    const startedJob = await manager.startJob({
      accounts: ["user@gmail.com|pw1"],
      concurrency: 1,
      proxyUrl: "http://proxy:8080",
    });

    await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job?.status === "completed" ? job : null;
    });

    expect(launchBulkImportBrowserMock).toHaveBeenCalledWith({
      engine: "chromium",
      proxyUrl: "http://proxy:8080",
      headless: false,
      args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
    });
    expect(contextOptions[0]).toEqual({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "zh-CN",
    });
  });

  it("opens the first manual session in a dedicated headed browser window", async () => {
    const manualSession = createManualBrowserSession({ headless: false });
    launchBulkImportBrowserMock.mockResolvedValue(manualSession.newBrowser);
    const { KiroBulkImportManager } = await import("../../src/lib/oauth/services/kiroBulkImportManager.js");
    const manager = new KiroBulkImportManager();

    addManualJob(manager, {
      runtimeSession: { proxyUrl: "http://proxy:8080" },
      manualSession: {
        context: manualSession.oldContext,
        page: manualSession.oldPage,
        opened: false,
        openedAt: null,
      },
    });

    const result = await manager.openManualSession("job-manual", 1);

    expect(result.ok).toBe(true);
    expect(result.account.manualSessionOpened).toBe(true);
    expect(launchBulkImportBrowserMock).toHaveBeenCalledWith({
      engine: "chromium",
      headless: false,
      args: ["--start-maximized"],
      proxyUrl: "http://proxy:8080",
    });
    expect(manualSession.newBrowser.newContext).toHaveBeenCalledWith({
      viewport: null,
      storageState: manualSession.storageState,
    });
    expect(manualSession.newPage.goto).toHaveBeenCalledWith(
      "https://example.com/manual",
      { waitUntil: "domcontentloaded", timeout: 20_000 }
    );
    expect(manualSession.newPage.bringToFront).toHaveBeenCalled();
  });

  it("does not mark a manual session opened when no browser window can be surfaced", async () => {
    const { KiroBulkImportManager } = await import("../../src/lib/oauth/services/kiroBulkImportManager.js");
    const manager = new KiroBulkImportManager();

    addManualJob(manager, {
      manualSession: {
        page: {
          context: () => ({}),
          url: () => "about:blank",
        },
        opened: false,
        openedAt: null,
      },
    });

    const result = await manager.openManualSession("job-manual", 1);

    expect(result.ok).toBe(false);
    expect(result.account.manualSessionOpened).toBe(false);
    expect(result.error).toMatch(/could not open/i);
  });

  it("does not treat old page focus as a successful first manual open", async () => {
    launchBulkImportBrowserMock.mockRejectedValue(new Error("No display"));
    const manualSession = createManualBrowserSession({ headless: false });
    const { KiroBulkImportManager } = await import("../../src/lib/oauth/services/kiroBulkImportManager.js");
    const manager = new KiroBulkImportManager();

    addManualJob(manager, {
      runtimeSession: { proxyUrl: "http://proxy:8080" },
      manualSession: {
        context: manualSession.oldContext,
        page: manualSession.oldPage,
        opened: false,
        openedAt: null,
      },
    });

    const result = await manager.openManualSession("job-manual", 1);

    expect(result.ok).toBe(false);
    expect(result.account.manualSessionOpened).toBe(false);
    expect(manualSession.oldPage.bringToFront).not.toHaveBeenCalled();
    expect(result.error).toMatch(/could not open/i);
  });

  it("repairs a stale opened flag by launching a dedicated manual window", async () => {
    const manualSession = createManualBrowserSession({ headless: false });
    launchBulkImportBrowserMock.mockResolvedValue(manualSession.newBrowser);
    const { KiroBulkImportManager } = await import("../../src/lib/oauth/services/kiroBulkImportManager.js");
    const manager = new KiroBulkImportManager();

    addManualJob(manager, {
      runtimeSession: { proxyUrl: "http://proxy:8080" },
      manualSession: {
        context: manualSession.oldContext,
        page: manualSession.oldPage,
        opened: true,
        openedAt: "2026-06-08T00:00:02.000Z",
      },
    });

    const result = await manager.openManualSession("job-manual", 1);

    expect(result.ok).toBe(true);
    expect(result.account.manualSessionOpened).toBe(true);
    expect(launchBulkImportBrowserMock).toHaveBeenCalled();
    expect(manualSession.newPage.bringToFront).toHaveBeenCalled();
  });
});
