import { beforeEach, describe, expect, it, vi } from "vitest";

const managerMock = {
  startJob: vi.fn(),
  getJob: vi.fn(),
  getJobWithPreview: vi.fn(),
  getLatestJobWithPreview: vi.fn(),
  cancelJob: vi.fn(),
  openManualSession: vi.fn(),
};

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/lib/oauth/services/kiroBulkImportManager", () => ({
  buildLookupResponse: vi.fn((job, extras = {}) => ({
    found: Boolean(job),
    stale: Boolean(extras.stale),
    recoverable: Boolean(job),
    job: job || null,
  })),
  parseKiroBulkAccounts: vi.fn((accounts) => ({
    parsed: (accounts || [])
      .filter(Boolean)
      .filter((line) => String(line).includes("|"))
      .map((line, index) => {
        const [email, password] = String(line).split("|");
        return { line: index + 1, email, password };
      }),
    invalidLines: (accounts || [])
      .map((line, index) => (!String(line).includes("|") ? index + 1 : null))
      .filter(Boolean),
  })),
  getKiroBulkImportManager: vi.fn(() => managerMock),
}));

vi.mock("@/lib/oauth/services/bulkImportProxyResolver", () => ({
  resolveBulkImportProxy: vi.fn(async () => ({
    proxyUrl: null,
    proxyUrls: [],
    proxyMode: "none",
    proxyPoolId: null,
    proxySource: null,
    error: null,
  })),
}));

describe("Kiro bulk import routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed account lines on start route", async () => {
    const { POST } = await import("../../src/app/api/oauth/kiro/bulk-import/route.js");
    const response = await POST({
      json: async () => ({
        accounts: ["user@gmail.com|pw", "broken"],
      }),
    });

    expect(response.status).toBe(400);
    expect(response.body.invalidLines).toEqual([2]);
    expect(managerMock.startJob).not.toHaveBeenCalled();
  });

  it("starts a bulk import job and returns the job payload", async () => {
    managerMock.startJob.mockResolvedValue({
      jobId: "job-1",
      status: "queued",
      summary: { total: 1, queued: 1, running: 0, success: 0, failed: 0, needs_manual: 0 },
      accounts: [],
      concurrency: 4,
      createdAt: "2026-06-08T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
    });

    const { POST } = await import("../../src/app/api/oauth/kiro/bulk-import/route.js");
    const response = await POST({
      json: async () => ({
        accounts: ["user@gmail.com|pw"],
        concurrency: 6,
      }),
    });

    expect(response.status).toBe(200);
    expect(managerMock.startJob).toHaveBeenCalledWith({
      accounts: ["user@gmail.com|pw"],
      concurrency: 6,
      engine: undefined,
      proxyUrl: null,
      proxyUrls: [],
      proxyMode: "none",
      proxyPoolId: null,
      proxySource: null,
    });
    expect(response.body.job.jobId).toBe("job-1");
  });

  it("returns 404 for unknown status job", async () => {
    managerMock.getJobWithPreview.mockResolvedValue(null);

    const { GET } = await import("../../src/app/api/oauth/kiro/bulk-import/[jobId]/route.js");
    const response = await GET({}, { params: { jobId: "missing" } });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Bulk import job not found");
    expect(response.body.found).toBe(false);
    expect(response.body.stale).toBe(true);
  });

  it("returns the latest bulk import job snapshot", async () => {
    managerMock.getLatestJobWithPreview.mockResolvedValue({
      jobId: "job-latest",
      status: "running",
      summary: { total: 2, queued: 1, running: 1, success: 0, failed: 0, needs_manual: 0 },
      accounts: [],
      activity: [],
      preview: null,
      concurrency: 2,
      createdAt: "2026-06-08T00:00:00.000Z",
      startedAt: "2026-06-08T00:00:01.000Z",
      finishedAt: null,
      error: null,
    });

    const { GET } = await import("../../src/app/api/oauth/kiro/bulk-import/latest/route.js");
    const response = await GET({ url: "http://localhost/api/oauth/kiro/bulk-import/latest" });

    expect(response.status).toBe(200);
    expect(managerMock.getLatestJobWithPreview).toHaveBeenCalledWith({ includeRecentTerminal: false });
    expect(response.body.job.jobId).toBe("job-latest");
    expect(response.body.found).toBe(true);
    expect(response.body.recoverable).toBe(true);
  });

  it("returns recoverable false when no latest job exists", async () => {
    managerMock.getLatestJobWithPreview.mockResolvedValue(null);

    const { GET } = await import("../../src/app/api/oauth/kiro/bulk-import/latest/route.js");
    const response = await GET({ url: "http://localhost/api/oauth/kiro/bulk-import/latest" });

    expect(response.status).toBe(404);
    expect(response.body.found).toBe(false);
    expect(response.body.recoverable).toBe(false);
  });

  it("can request the latest recent terminal job snapshot", async () => {
    managerMock.getLatestJobWithPreview.mockResolvedValue({
      jobId: "job-terminal",
      status: "failed",
      summary: { total: 1, queued: 0, running: 0, success: 0, failed: 1, needs_manual: 0 },
      accounts: [],
      activity: [],
      preview: null,
      concurrency: 1,
      createdAt: "2026-06-08T00:00:00.000Z",
      startedAt: "2026-06-08T00:00:01.000Z",
      finishedAt: "2026-06-08T00:05:00.000Z",
      error: "failed",
    });

    const { GET } = await import("../../src/app/api/oauth/kiro/bulk-import/latest/route.js");
    const response = await GET({ url: "http://localhost/api/oauth/kiro/bulk-import/latest?scope=recent" });

    expect(response.status).toBe(200);
    expect(managerMock.getLatestJobWithPreview).toHaveBeenCalledWith({ includeRecentTerminal: true });
    expect(response.body.job.jobId).toBe("job-terminal");
  });

  it("does not treat recoverable scope as recent terminal history", async () => {
    managerMock.getLatestJobWithPreview.mockResolvedValue(null);

    const { GET } = await import("../../src/app/api/oauth/kiro/bulk-import/latest/route.js");
    const response = await GET({ url: "http://localhost/api/oauth/kiro/bulk-import/latest?scope=recoverable" });

    expect(response.status).toBe(404);
    expect(managerMock.getLatestJobWithPreview).toHaveBeenCalledWith({ includeRecentTerminal: false });
    expect(response.body.recoverable).toBe(false);
  });

  it("cancels a known job", async () => {
    managerMock.cancelJob.mockReturnValue({
      jobId: "job-1",
      status: "cancelled",
      summary: { total: 1, queued: 0, running: 0, success: 0, failed: 0, needs_manual: 0 },
      accounts: [],
      concurrency: 4,
      createdAt: "2026-06-08T00:00:00.000Z",
      startedAt: "2026-06-08T00:00:01.000Z",
      finishedAt: "2026-06-08T00:00:02.000Z",
    });

    const { POST } = await import("../../src/app/api/oauth/kiro/bulk-import/[jobId]/cancel/route.js");
    const response = await POST({}, { params: { jobId: "job-1" } });

    expect(response.status).toBe(200);
    expect(managerMock.cancelJob).toHaveBeenCalledWith("job-1");
    expect(response.body.job.status).toBe("cancelled");
  });

  it("opens a manual session for a blocked worker", async () => {
    managerMock.openManualSession.mockResolvedValue({
      ok: true,
      job: {
        jobId: "job-1",
        status: "running",
        summary: { total: 1, queued: 0, running: 0, success: 0, failed: 0, needs_manual: 1 },
        accounts: [{
          email: "user@gmail.com",
          status: "needs_manual",
          error: "Manual assist required",
          workerId: 2,
          manualSessionAvailable: true,
          manualSessionOpened: true,
          line: 1,
        }],
        concurrency: 4,
        createdAt: "2026-06-08T00:00:00.000Z",
        startedAt: "2026-06-08T00:00:01.000Z",
        finishedAt: null,
      },
      account: {
        email: "user@gmail.com",
        status: "needs_manual",
        workerId: 2,
        manualSessionAvailable: true,
        manualSessionOpened: true,
        line: 1,
      },
    });

    const { POST } = await import("../../src/app/api/oauth/kiro/bulk-import/[jobId]/manual/[workerId]/route.js");
    const response = await POST({}, { params: { jobId: "job-1", workerId: "2" } });

    expect(response.status).toBe(200);
    expect(managerMock.openManualSession).toHaveBeenCalledWith("job-1", "2");
    expect(response.body.account.manualSessionOpened).toBe(true);
  });
});
