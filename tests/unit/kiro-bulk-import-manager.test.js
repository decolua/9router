import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  __test__,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
} from "../../src/lib/oauth/services/kiroBulkImportManager.js";

function createFakeBrowser() {
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
    async newContext() {
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

async function waitFor(fn, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

describe("kiro bulk import manager helpers", () => {
  it("parses gmail|password lines and reports invalid lines", () => {
    const { parsed, invalidLines } = __test__.parseKiroBulkAccounts([
      "user1@gmail.com|pw1",
      "broken-line",
      "user2@gmail.com|pw2",
      "",
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].email).toBe("user1@gmail.com");
    expect(parsed[1].password).toBe("pw2");
    expect(invalidLines).toEqual([2]);
  });

  it("clamps concurrency to configured min/max with default fallback", () => {
    expect(__test__.clampConcurrency(undefined)).toBe(KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY);
    expect(__test__.clampConcurrency("0")).toBe(KIRO_BULK_IMPORT_MIN_CONCURRENCY);
    expect(__test__.clampConcurrency("999")).toBe(KIRO_BULK_IMPORT_MAX_CONCURRENCY);
    expect(__test__.clampConcurrency("3")).toBe(3);
  });
});

describe("KiroBulkImportManager", () => {
  it("processes accounts once and completes with saved connections", async () => {
    const processed = [];
    const manager = new KiroBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      kiroServiceFactory: () => ({
        createSocialAuthorization() {
          return {
            authUrl: "https://example.com",
            codeVerifier: "verifier",
          };
        },
      }),
      googleAutomation: async ({ email }) => {
        processed.push(email);
        return {
          status: "success",
          code: `code-${email}`,
        };
      },
      socialExchange: async ({ code }) => ({
        connection: {
          id: `conn-${code}`,
        },
      }),
    });

    const startedJob = await manager.startJob({
      accounts: [
        "user1@gmail.com|pw1",
        "user2@gmail.com|pw2",
      ],
      concurrency: 4,
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "completed" ? job : null;
    });

    expect(processed.sort()).toEqual(["user1@gmail.com", "user2@gmail.com"]);
    expect(finishedJob.summary.success).toBe(2);
    expect(finishedJob.summary.failed).toBe(0);
    expect(finishedJob.accounts.every((account) => account.connectionId)).toBe(true);
  });

  it("launches worker browsers with round-robin proxy URLs", async () => {
    const launchedProxyUrls = [];
    const manager = new KiroBulkImportManager({
      browserLauncher: async (job) => {
        launchedProxyUrls.push(job.proxyUrl || null);
        return createFakeBrowser();
      },
      kiroServiceFactory: () => ({
        createSocialAuthorization() {
          return {
            authUrl: "https://example.com",
            codeVerifier: "verifier",
          };
        },
      }),
      googleAutomation: async ({ email }) => ({
        status: "success",
        code: `code-${email}`,
      }),
      socialExchange: async ({ code }) => ({
        connection: {
          id: `conn-${code}`,
        },
      }),
    });

    const startedJob = await manager.startJob({
      accounts: [
        "user1@gmail.com|pw1",
        "user2@gmail.com|pw2",
      ],
      concurrency: 2,
      proxyUrls: ["http://proxy-one:8080", "http://proxy-two:8080"],
      proxyMode: "round-robin",
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "completed" ? job : null;
    });

    expect(launchedProxyUrls.sort()).toEqual(["http://proxy-one:8080", "http://proxy-two:8080"]);
    expect(finishedJob.proxyMode).toBe("round-robin");
    expect(finishedJob.proxyCount).toBe(2);
    expect(finishedJob.summary.success).toBe(2);
  });

  it("cancels queued work and marks the job cancelled", async () => {
    const manager = new KiroBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      kiroServiceFactory: () => ({
        createSocialAuthorization() {
          return {
            authUrl: "https://example.com",
            codeVerifier: "verifier",
          };
        },
      }),
      googleAutomation: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          status: "success",
          code: "code",
        };
      },
      socialExchange: async () => ({
        connection: { id: "conn-1" },
      }),
    });

    const startedJob = await manager.startJob({
      accounts: [
        "user1@gmail.com|pw1",
        "user2@gmail.com|pw2",
        "user3@gmail.com|pw3",
      ],
      concurrency: 1,
    });

    manager.cancelJob(startedJob.jobId);

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "cancelled" ? job : null;
    });

    expect(finishedJob.status).toBe("cancelled");
    expect(
      finishedJob.accounts.some((account) => account.status === "cancelled")
    ).toBe(true);
  });

  it("opens a manual session for a blocked worker", async () => {
    const manager = new KiroBulkImportManager();
    const manualPage = {
      bringToFront: async () => null,
      context() {
        return {};
      },
    };

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
        manualSession: {
          page: manualPage,
          opened: false,
          openedAt: null,
        },
      }],
    });

    const result = await manager.openManualSession("job-manual", 1);

    expect(result.ok).toBe(true);
    expect(result.account.manualSessionAvailable).toBe(true);
    expect(result.account.manualSessionOpened).toBe(true);
  });

  it("restores only active latest jobs by default", async () => {
    const manager = new KiroBulkImportManager();

    manager.latestJobId = "job-terminal";
    manager.jobs.set("job-terminal", {
      jobId: "job-terminal",
      status: "failed",
      concurrency: 1,
      createdAt: "2026-06-08T00:00:00.000Z",
      startedAt: "2026-06-08T00:00:01.000Z",
      finishedAt: new Date().toISOString(),
      error: "failed",
      lastPreview: null,
      lastPreviewCapturedAt: 0,
      accounts: [],
      persistPromise: Promise.resolve(),
    });

    const activeOnly = await manager.getLatestJobWithPreview();
    const withRecentTerminal = await manager.getLatestJobWithPreview({ includeRecentTerminal: true });

    expect(activeOnly).toBeNull();
    expect(withRecentTerminal?.jobId).toBe("job-terminal");
  });

  it("marks terminal jobs as found but not recoverable", async () => {
    const terminalJob = {
      jobId: "job-terminal",
      status: "failed",
      finishedAt: new Date().toISOString(),
    };

    const response = buildLookupResponse(terminalJob);

    expect(response.found).toBe(true);
    expect(response.recoverable).toBe(false);
    expect(response.job).toBe(terminalJob);
  });

  it("does not let a hung capturePreview block persistJobSnapshot", async () => {
    const manager = new KiroBulkImportManager();
    manager.capturePreview = () => new Promise(() => {});
    manager.storageDir = path.join(os.tmpdir(), `kiro-bulk-test-${Date.now()}`);

    const job = {
      jobId: "job-hung",
      status: "running",
      concurrency: 1,
      engine: "chromium",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      cancelRequested: false,
      browser: null,
      nextIndex: 0,
      manualFollowups: new Set(),
      persistPromise: Promise.resolve(),
      lastPreview: { email: "old@test.com", imageData: "data:image/jpeg;base64,OLD" },
      lastPreviewCapturedAt: 0,
      accounts: [],
    };

    const start = Date.now();
    await manager.persistJobSnapshot(job, { forcePreview: true });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(4000);
    expect(job.lastPreview?.imageData).toBe("data:image/jpeg;base64,OLD");

    const expectedFile = path.join(manager.storageDir, "job-hung.json");
    expect(fs.existsSync(expectedFile)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
    expect(persisted.preview?.imageData).toBe("data:image/jpeg;base64,OLD");

    fs.rmSync(manager.storageDir, { recursive: true, force: true });
  });

  it("does not let a hung page.screenshot freeze getJobWithPreview (frontend polling path)", async () => {
    // Regression for Qoder bulk Live Browser Preview freeze.
    // Frontend polls /api/oauth/{provider}/bulk-import/[jobId] every 2s, which calls
    // manager.getJobWithPreview(). That used to await this.capturePreview() WITHOUT
    // a timeout, so a hung page.screenshot (caused by Qoder's concurrent
    // page.evaluate against /api/v1/me/userplan) would hang the HTTP request and
    // freeze the modal. The fix centralises the screenshot timeout inside
    // capturePreview so EVERY caller (persistJobSnapshot AND getJobWithPreview)
    // is protected.
    const manager = new KiroBulkImportManager();
    manager.storageDir = path.join(os.tmpdir(), `kiro-bulk-test-getjob-${Date.now()}`);

    // Simulate a page whose screenshot hangs forever -- mirrors the Qoder
    // page.evaluate-stalls-screenshot scenario.
    const hangingPage = {
      screenshot: () => new Promise(() => {}),
    };

    const job = {
      jobId: "job-hung-getjob",
      status: "running",
      concurrency: 1,
      engine: "chromium",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      cancelRequested: false,
      browser: null,
      nextIndex: 0,
      manualFollowups: new Set(),
      persistPromise: Promise.resolve(),
      lastPreview: {
        email: "old@test.com",
        workerId: 1,
        status: "running",
        step: "checking_plan",
        updatedAt: new Date().toISOString(),
        imageData: "data:image/jpeg;base64,OLD",
      },
      lastPreviewCapturedAt: 0,
      accounts: [{
        line: 1,
        email: "user@test.com",
        status: "running",
        workerId: 1,
        currentStep: "checking_plan",
        updatedAt: new Date().toISOString(),
        runtimeSession: { page: hangingPage },
        manualSession: null,
        logs: [],
      }],
    };
    manager.jobs.set(job.jobId, job);

    const start = Date.now();
    const sanitized = await manager.getJobWithPreview(job.jobId);
    const elapsed = Date.now() - start;

    // Frontend polls every 2s; the previous bug let a single hung screenshot
    // hold the request open until Next.js timeout. Allow 4s total budget.
    expect(elapsed).toBeLessThan(4000);
    expect(sanitized).toBeTruthy();
    // Previous preview must be preserved -- modal continues to render the last
    // good frame instead of going blank.
    expect(sanitized.preview?.imageData).toBe("data:image/jpeg;base64,OLD");

    fs.rmSync(manager.storageDir, { recursive: true, force: true });
  });

  it("returns a freshly captured preview when page.screenshot resolves quickly", async () => {
    // Happy-path regression: the timeout guard must not regress the normal
    // case -- a working screenshot should replace the previous image.
    const manager = new KiroBulkImportManager();
    manager.storageDir = path.join(os.tmpdir(), `kiro-bulk-test-fresh-${Date.now()}`);

    const fastPage = {
      screenshot: async () => Buffer.from("FRESHIMAGE"),
    };

    const job = {
      jobId: "job-fresh",
      status: "running",
      concurrency: 1,
      engine: "chromium",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      cancelRequested: false,
      browser: null,
      nextIndex: 0,
      manualFollowups: new Set(),
      persistPromise: Promise.resolve(),
      lastPreview: {
        email: "old@test.com",
        imageData: "data:image/jpeg;base64,OLD",
      },
      lastPreviewCapturedAt: 0,
      accounts: [{
        line: 1,
        email: "user@test.com",
        status: "running",
        workerId: 1,
        currentStep: "checking_plan",
        updatedAt: new Date().toISOString(),
        runtimeSession: { page: fastPage },
        manualSession: null,
        logs: [],
      }],
    };
    manager.jobs.set(job.jobId, job);

    const sanitized = await manager.getJobWithPreview(job.jobId);

    expect(sanitized.preview?.imageData).toBe(
      `data:image/jpeg;base64,${Buffer.from("FRESHIMAGE").toString("base64")}`
    );

    fs.rmSync(manager.storageDir, { recursive: true, force: true });
  });

  it("marks worker preflight errors as failed instead of leaving queued accounts completed", async () => {
    const googleAutomation = vi.fn();
    const manager = new KiroBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      kiroServiceFactory: () => ({}),
      googleAutomation,
    });

    const startedJob = await manager.startJob({
      accounts: [
        "user1@gmail.com|pw1",
        "user2@gmail.com|pw2",
      ],
      concurrency: 1,
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status !== "running" ? job : null;
    });

    expect(finishedJob.status).toBe("failed");
    expect(finishedJob.summary.failed).toBe(2);
    expect(finishedJob.summary.queued).toBe(0);
    expect(finishedJob.accounts[0].error).toMatch(/createSocialAuthorization/);
    expect(googleAutomation).not.toHaveBeenCalled();
  });

  it("marks queued accounts failed when all worker browser launches fail", async () => {
    const manager = new KiroBulkImportManager({
      browserLauncher: async () => {
        throw new Error("browser launch unavailable");
      },
      kiroServiceFactory: () => ({
        createSocialAuthorization() {
          return {
            authUrl: "https://example.com",
            codeVerifier: "verifier",
          };
        },
      }),
      googleAutomation: vi.fn(),
    });

    const startedJob = await manager.startJob({
      accounts: [
        "user1@gmail.com|pw1",
        "user2@gmail.com|pw2",
      ],
      concurrency: 2,
      proxyUrls: ["http://proxy-one:8080", "http://proxy-two:8080"],
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status !== "running" ? job : null;
    });

    expect(finishedJob.status).toBe("failed");
    expect(finishedJob.summary.failed).toBe(2);
    expect(finishedJob.summary.queued).toBe(0);
    expect(finishedJob.error).toMatch(/browser launch unavailable/);
  });
});
