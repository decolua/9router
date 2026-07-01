import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../dataDir.js";
import {
  getOptimalWorkerCount,
  isAutoConcurrencyValue,
} from "../../systemSpecs.js";

export const BULK_IMPORT_DEFAULT_CONCURRENCY = 4;
export const BULK_IMPORT_MIN_CONCURRENCY = 1;
export const BULK_IMPORT_MAX_CONCURRENCY = 8;

const TERMINAL_ACCOUNT_STATUSES = new Set([
  "success",
  "failed",
  "failed_invalid_credentials",
  "failed_exchange",
  "failed_timeout",
  "cancelled",
]);

const MAX_ACCOUNT_LOG_ENTRIES = 40;
const MAX_JOB_ACTIVITY_ENTRIES = 80;
const PREVIEW_CAPTURE_INTERVAL_MS = 1500;
const PREVIEW_CAPTURE_TIMEOUT_MS = 2500;
const RECENT_TERMINAL_JOB_WINDOW_MS = 30 * 60_000;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);

const RELAY_POOL_TYPES = new Set(["vercel", "cloudflare", "deno"]);

function nowIso() {
  return new Date().toISOString();
}

function ensurePersistenceDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getJobFile(jobId, dir) {
  ensurePersistenceDir(dir);
  return path.join(dir, `${jobId}.json`);
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  ensurePersistenceDir(path.dirname(filePath));
  const tempFile = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tempFile, filePath);
}

function readPersistedLatestJobId(metaFile) {
  return readJsonFile(metaFile)?.latestJobId || null;
}

function writePersistedLatestJobId(jobId, metaFile) {
  writeJsonFile(metaFile, {
    latestJobId: jobId || null,
    updatedAt: nowIso(),
  });
}

function clampConcurrency(value) {
  if (isAutoConcurrencyValue(value)) {
    const detected = getOptimalWorkerCount();
    const safeDetected = Number.isFinite(detected)
      ? detected
      : BULK_IMPORT_DEFAULT_CONCURRENCY;
    return Math.min(
      BULK_IMPORT_MAX_CONCURRENCY,
      Math.max(BULK_IMPORT_MIN_CONCURRENCY, safeDetected),
    );
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return BULK_IMPORT_DEFAULT_CONCURRENCY;
  return Math.min(
    BULK_IMPORT_MAX_CONCURRENCY,
    Math.max(BULK_IMPORT_MIN_CONCURRENCY, parsed),
  );
}

export function parseBulkAccounts(accounts = []) {
  const lines = Array.isArray(accounts) ? accounts : [];
  const parsed = [];
  const invalidLines = [];

  lines.forEach((line, index) => {
    const raw = String(line || "").trim();
    if (!raw) return;
    if (raw.startsWith("#")) return;

    let email = "";
    let password = "";

    if (raw.includes("|")) {
      const [emailPart = "", ...passwordParts] = raw.split("|");
      email = emailPart.trim();
      password = passwordParts.join("|").trim();
    } else if (raw.includes("\t")) {
      const tabIdx = raw.indexOf("\t");
      email = raw.substring(0, tabIdx).trim();
      password = raw.substring(tabIdx + 1).trim();
    } else if (raw.includes(":")) {
      const colonIdx = raw.indexOf(":");
      const beforeColon = raw.substring(0, colonIdx).trim();
      if (beforeColon.includes("@")) {
        email = beforeColon;
        password = raw.substring(colonIdx + 1).trim();
      }
    }

    if (!email || !password) {
      invalidLines.push(index + 1);
      return;
    }

    parsed.push({
      line: index + 1,
      email,
      password,
    });
  });

  return {
    parsed,
    invalidLines,
  };
}

// Backward-compat alias for code ported from WYx0 fork.
export const parseKiroBulkAccounts = parseBulkAccounts;

function getFailedCount(accounts) {
  return accounts.filter(
    (account) =>
      account.status === "failed" ||
      account.status === "failed_invalid_credentials" ||
      account.status === "failed_exchange" ||
      account.status === "failed_timeout",
  ).length;
}

function buildSummary(accounts) {
  return {
    total: accounts.length,
    queued: accounts.filter((account) => account.status === "queued").length,
    running: accounts.filter((account) => account.status === "running").length,
    success: accounts.filter((account) => account.status === "success").length,
    failed: getFailedCount(accounts),
    needs_manual: accounts.filter(
      (account) => account.status === "needs_manual",
    ).length,
  };
}

function createLogEntry(step, message, level = "info") {
  return {
    id: randomUUID(),
    at: nowIso(),
    step,
    message,
    level,
  };
}

function appendAccountLog(account, step, message, level = "info") {
  const entry = createLogEntry(step, message, level);
  account.currentStep = step;
  account.updatedAt = entry.at;
  account.logs = account.logs || [];
  account.logs.push(entry);
  if (account.logs.length > MAX_ACCOUNT_LOG_ENTRIES) {
    account.logs.splice(0, account.logs.length - MAX_ACCOUNT_LOG_ENTRIES);
  }
  return entry;
}

function buildJobActivity(accounts) {
  return accounts
    .flatMap((account) =>
      (account.logs || []).map((entry) => ({
        ...entry,
        email: account.email,
        line: account.line,
        workerId: account.workerId || null,
        status: account.status,
      })),
    )
    .sort((left, right) => String(left.at).localeCompare(String(right.at)))
    .slice(-MAX_JOB_ACTIVITY_ENTRIES);
}

function sanitizeAccount(account) {
  return {
    email: account.email,
    status: account.status,
    error: account.error || null,
    connectionId: account.connectionId || null,
    workerId: account.workerId || null,
    line: account.line,
    currentStep: account.currentStep || null,
    updatedAt: account.updatedAt || null,
    resolvedProxyUrl: account.resolvedProxyUrl || null,
    logs: (account.logs || []).slice(-8),
    manualSessionAvailable:
      Boolean(account.manualSession?.page) && account.status === "needs_manual",
    manualSessionOpened: Boolean(account.manualSession?.opened),
  };
}

function sanitizeJob(job, extras = {}) {
  return {
    jobId: job.jobId,
    status: job.status,
    summary: buildSummary(job.accounts),
    concurrency: job.concurrency,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    accounts: job.accounts.map(sanitizeAccount),
    activity: buildJobActivity(job.accounts),
    error: job.error || null,
    preview: extras.preview || null,
  };
}

function buildPersistedSnapshot(job) {
  return sanitizeJob(job, {
    preview: job.lastPreview || null,
  });
}

function isRecentTerminalJob(job) {
  if (!job || ACTIVE_JOB_STATUSES.has(job.status)) return false;
  const finishedAtMs = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
  if (!Number.isFinite(finishedAtMs)) return false;
  return Date.now() - finishedAtMs <= RECENT_TERMINAL_JOB_WINDOW_MS;
}

export function buildLookupResponse(job, extras = {}) {
  if (!job) {
    return {
      found: false,
      stale: Boolean(extras.stale),
      recoverable: false,
      job: null,
    };
  }

  return {
    found: true,
    stale: false,
    recoverable:
      ACTIVE_JOB_STATUSES.has(job.status) || isRecentTerminalJob(job),
    job,
  };
}

async function defaultBrowserLauncher(job) {
  const { launchBulkImportBrowser } =
    await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "chromium",
    proxyUrl: job?.proxyUrl || undefined,
  });
}

export async function createFreshContext(browser, options = {}) {
  const contextOptions = { ...options };

  // Camoufox (Firefox-based) rejects viewport.isMobile via CDP
  // setDefaultViewport. Passing viewport: null disables it.
  contextOptions.viewport = null;
  contextOptions.locale = "en-US";

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  return { context, page };
}

function isHeadlessBrowser(browser) {
  if (!browser) return true;
  const opts = browser._options || browser._initializer || {};
  if (typeof opts.headless === "boolean") return opts.headless;
  return true;
}

async function relaunchAsHeaded(account) {
  if (!account?.manualSession?.context) return false;
  const oldContext = account.manualSession.context;
  const oldPage = account.manualSession.page;
  const oldBrowser = oldContext.browser?.();

  let storageState = null;
  let lastUrl = "";
  try {
    storageState = await oldContext.storageState();
  } catch {
    storageState = null;
  }
  try {
    lastUrl = oldPage?.url?.() || "";
  } catch {
    lastUrl = "";
  }

  const { chromium } = await import("playwright");
  let newBrowser;
  try {
    newBrowser = await chromium.launch({
      headless: false,
      args: ["--start-maximized"],
    });
  } catch {
    return false;
  }

  let newContext;
  try {
    newContext = await newBrowser.newContext({
      viewport: null,
      ...(storageState ? { storageState } : {}),
    });
  } catch {
    await newBrowser.close().catch(() => null);
    return false;
  }

  const newPage = await newContext.newPage();
  if (lastUrl) {
    try {
      await newPage.goto(lastUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
    } catch {}
  }

  const rebind = account.manualSession.rebind;
  account.manualSession.context = newContext;
  account.manualSession.page = newPage;
  account.manualSession.headedBrowser = newBrowser;

  if (typeof rebind === "function") {
    try {
      await rebind({ context: newContext, page: newPage });
    } catch {}
  }

  void oldContext.close().catch(() => null);
  if (oldBrowser && oldBrowser !== newBrowser) {
    void oldBrowser.close().catch(() => null);
  }

  return true;
}

async function revealBrowserWindow(page, { account } = {}) {
  if (!page) return false;

  try {
    const context = page.context?.();
    const browser = context?.browser?.();

    if (account && isHeadlessBrowser(browser)) {
      const relaunched = await relaunchAsHeaded(account);
      if (relaunched) {
        await account.manualSession.page.bringToFront?.().catch(() => null);
        return true;
      }
    }

    if (!context?.newCDPSession) {
      await page.bringToFront?.().catch(() => null);
      return true;
    }

    const session = await context.newCDPSession(page);
    let windowId = null;

    try {
      const targetInfo = await session.send("Target.getTargetInfo");
      const targetId = targetInfo?.targetInfo?.targetId;
      const windowInfo = await session.send(
        "Browser.getWindowForTarget",
        targetId ? { targetId } : {},
      );
      windowId = windowInfo?.windowId ?? null;
    } catch {
      windowId = null;
    }

    if (windowId != null) {
      await session
        .send("Browser.setWindowBounds", {
          windowId,
          bounds: {
            windowState: "normal",
            left: 80,
            top: 80,
            width: 1280,
            height: 960,
          },
        })
        .catch(() => null);
    }

    await page.bringToFront?.().catch(() => null);
    await session.detach?.().catch(() => null);
    return true;
  } catch {
    await page.bringToFront?.().catch(() => null);
    return true;
  }
}

// Backward-compat aliases used by WYx0-ported subclasses.
export const KiroBulkImportManager = class BulkImportManager {};
export const KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY =
  BULK_IMPORT_DEFAULT_CONCURRENCY;
export const KIRO_BULK_IMPORT_MAX_CONCURRENCY = BULK_IMPORT_MAX_CONCURRENCY;
export const KIRO_BULK_IMPORT_MIN_CONCURRENCY = BULK_IMPORT_MIN_CONCURRENCY;

/**
 * Generic bulk-import manager. Subclass and override processAccount(job, account, workerId).
 *
 * Proxy rotation: when `proxyPoolIds` is a non-empty array, each account gets
 * a proxy URL assigned via round-robin from the resolved pool list. When only
 * `proxyUrl` is set, all accounts share that single proxy. When neither is
 * set, accounts run without a proxy.
 */
export class BulkImportManager {
  constructor({
    browserLauncher = defaultBrowserLauncher,
    storageName = "bulk-import",
  } = {}) {
    this.browserLauncher = browserLauncher;
    this.storageDir = path.join(DATA_DIR, storageName);
    this.metaFile = path.join(this.storageDir, "meta.json");
    this.jobs = new Map();
    this.latestJobId = readPersistedLatestJobId(this.metaFile);
  }

  async startJob({ accounts, concurrency, engine, proxyUrl, proxyPoolIds }) {
    const { parsed, invalidLines } = parseBulkAccounts(accounts);
    if (!parsed.length) {
      const error =
        invalidLines.length > 0
          ? "Invalid account format. Use one account per line: gmail@example.com|password"
          : "At least one account entry is required";
      const response = { error };
      if (invalidLines.length > 0) response.invalidLines = invalidLines;
      throw Object.assign(new Error(error), response);
    }

    if (invalidLines.length > 0) {
      const error =
        "Invalid account format. Use one account per line: gmail@example.com|password";
      throw Object.assign(new Error(error), { error, invalidLines });
    }

    const jobId = randomUUID();
    const createdAt = nowIso();
    const { normalizeBulkImportEngine, DEFAULT_BULK_IMPORT_ENGINE } =
      await import("./bulkImportBrowserEngine.js");
    const resolvedEngine = engine
      ? normalizeBulkImportEngine(engine)
      : DEFAULT_BULK_IMPORT_ENGINE;

    // Resolve proxy pool URLs upfront so workers can round-robin without
    // hitting the DB inside the hot loop.
    const resolvedProxyUrls = await this.resolveProxyUrls(
      proxyPoolIds,
      proxyUrl,
    );

    const job = {
      jobId,
      status: "running",
      concurrency: clampConcurrency(concurrency),
      engine: resolvedEngine,
      proxyUrl: proxyUrl || null,
      proxyPoolIds: Array.isArray(proxyPoolIds) ? proxyPoolIds : [],
      resolvedProxyUrls,
      proxyRotationIndex: 0,
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
      error: null,
      cancelRequested: false,
      browser: null,
      nextIndex: 0,
      manualFollowups: new Set(),
      persistPromise: Promise.resolve(),
      lastPreview: null,
      lastPreviewCapturedAt: 0,
      accounts: parsed.map((account) => ({
        line: account.line,
        email: account.email,
        password: account.password,
        status: "queued",
        error: null,
        connectionId: null,
        workerId: null,
        manualSession: null,
        runtimeSession: null,
        resolvedProxyUrl: null,
        currentStep: "queued",
        updatedAt: createdAt,
        logs: [
          createLogEntry(
            "queued",
            "Queued and waiting for an available worker",
          ),
        ],
      })),
    };

    this.jobs.set(jobId, job);
    this.latestJobId = jobId;
    writePersistedLatestJobId(jobId, this.metaFile);
    await this.persistJobSnapshot(job, { forcePreview: false });
    void this.runJob(jobId);
    return sanitizeJob(job);
  }

  /**
   * Resolve an array of proxy URLs from the given pool IDs (round-robin source).
   * Falls back to [proxyUrl] when no pool IDs are supplied.
   */
  async resolveProxyUrls(proxyPoolIds, proxyUrlFallback) {
    if (Array.isArray(proxyPoolIds) && proxyPoolIds.length > 0) {
      const { getProxyPoolById } = await import("../../../models/index.js");
      const urls = [];
      for (const poolId of proxyPoolIds) {
        try {
          const pool = await getProxyPoolById(poolId);
          if (!pool || !pool.isActive) continue;
          if (RELAY_POOL_TYPES.has(pool.type)) continue;
          if (pool.proxyUrl) urls.push(pool.proxyUrl);
        } catch {
          // skip broken pool
        }
      }
      if (urls.length > 0) return urls;
    }
    return proxyUrlFallback ? [proxyUrlFallback] : [];
  }

  /**
   * Assign the next proxy URL to an account using round-robin rotation.
   * Called when an account is dequeued.
   */
  assignProxyToAccount(job, account) {
    if (!job.resolvedProxyUrls || job.resolvedProxyUrls.length === 0) {
      account.resolvedProxyUrl = null;
      return;
    }
    const url =
      job.resolvedProxyUrls[
        job.proxyRotationIndex % job.resolvedProxyUrls.length
      ];
    job.proxyRotationIndex += 1;
    account.resolvedProxyUrl = url;
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) return sanitizeJob(job, { preview: job.lastPreview || null });
    return readJsonFile(getJobFile(jobId, this.storageDir));
  }

  async getJobWithPreview(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return readJsonFile(getJobFile(jobId, this.storageDir));
    const preview = await this.capturePreviewWithTimeout(job);
    if (preview) job.lastPreview = preview;
    job.lastPreviewCapturedAt = Date.now();
    await this.persistJobSnapshot(job, { forcePreview: false });
    return sanitizeJob(job, { preview: job.lastPreview || null });
  }

  async getLatestJobWithPreview({ includeRecentTerminal = false } = {}) {
    const latestJobId =
      this.latestJobId || readPersistedLatestJobId(this.metaFile);
    if (!latestJobId) return null;
    const job = await this.getJobWithPreview(latestJobId);
    if (!job) return null;
    if (ACTIVE_JOB_STATUSES.has(job.status)) {
      return job;
    }
    if (includeRecentTerminal && isRecentTerminalJob(job)) {
      return job;
    }
    return null;
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return readJsonFile(getJobFile(jobId, this.storageDir));

    job.cancelRequested = true;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finishedAt = nowIso();
      job.accounts.forEach((account) => {
        if (account.status === "queued") account.status = "cancelled";
      });
    }

    void this.persistJobSnapshot(job, { forcePreview: true });

    return sanitizeJob(job);
  }

  async openManualSession(jobId, workerId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const numericWorkerId = Number.parseInt(workerId, 10);
    const account = job.accounts.find(
      (entry) =>
        entry.workerId === numericWorkerId &&
        entry.status === "needs_manual" &&
        entry.manualSession?.page,
    );

    if (!account) {
      return {
        ok: false,
        error: "Manual session not found for this worker",
        job: sanitizeJob(job),
      };
    }

    const opened = await revealBrowserWindow(account.manualSession.page, {
      account,
    });
    account.manualSession.opened = opened;
    account.manualSession.openedAt = opened
      ? account.manualSession.openedAt || nowIso()
      : account.manualSession.openedAt || null;
    await this.persistJobSnapshot(job, { forcePreview: true });

    return {
      ok: true,
      job: sanitizeJob(job),
      account: sanitizeAccount(account),
    };
  }

  dequeueAccount(job, workerId) {
    while (job.nextIndex < job.accounts.length) {
      const account = job.accounts[job.nextIndex];
      job.nextIndex += 1;
      if (account.status !== "queued") continue;
      account.status = "running";
      account.workerId = workerId;
      account.error = null;
      this.assignProxyToAccount(job, account);
      appendAccountLog(
        account,
        "worker_assigned",
        `Worker ${workerId} picked up this account`,
      );
      void this.persistJobSnapshot(job, { forcePreview: false });
      return account;
    }
    return null;
  }

  finalizeAccount(account, status, extras = {}) {
    account.status = status;
    account.error = extras.error || null;
    account.connectionId = extras.connectionId || null;
    if (extras.step || extras.message) {
      appendAccountLog(
        account,
        extras.step || status,
        extras.message || extras.error || status.replaceAll("_", " "),
      );
    }
    return account;
  }

  setAccountStep(account, step, message, level = "info") {
    appendAccountLog(account, step, message, level);
  }

  async capturePreviewWithTimeout(job) {
    let preview = null;
    try {
      preview = await Promise.race([
        this.capturePreview(job),
        new Promise((resolve) =>
          setTimeout(() => resolve(null), PREVIEW_CAPTURE_TIMEOUT_MS),
        ),
      ]);
    } catch {
      preview = null;
    }
    return preview;
  }

  async persistJobSnapshot(job, { forcePreview = false } = {}) {
    if (!job) return;

    const runPersist = async () => {
      const shouldCapturePreview =
        forcePreview ||
        Date.now() - (job.lastPreviewCapturedAt || 0) >=
          PREVIEW_CAPTURE_INTERVAL_MS;
      if (shouldCapturePreview) {
        const preview = await this.capturePreviewWithTimeout(job);
        if (preview) {
          job.lastPreview = preview;
        }
        job.lastPreviewCapturedAt = Date.now();
      }

      try {
        writeJsonFile(
          getJobFile(job.jobId, this.storageDir),
          buildPersistedSnapshot(job),
        );
      } catch {
        // Best-effort persistence; never break the worker over a write failure.
      }
    };

    job.persistPromise = Promise.resolve(job.persistPromise)
      .catch(() => null)
      .then(runPersist);
    await job.persistPromise;
  }

  capturePreviewAccount(job) {
    return (
      job.accounts.find(
        (account) =>
          account.status === "running" && account.runtimeSession?.page,
      ) ||
      job.accounts.find(
        (account) =>
          account.status === "needs_manual" && account.manualSession?.page,
      ) ||
      job.accounts.find((account) => account.runtimeSession?.page) ||
      job.accounts.find((account) => account.manualSession?.page) ||
      null
    );
  }

  async capturePreview(job) {
    const previewAccount = this.capturePreviewAccount(job);
    if (!previewAccount) return null;

    const page =
      previewAccount.runtimeSession?.page || previewAccount.manualSession?.page;
    if (!page) return null;

    const meta = {
      email: previewAccount.email,
      workerId: previewAccount.workerId || null,
      status: previewAccount.status,
      step: previewAccount.currentStep || null,
      updatedAt: previewAccount.updatedAt || nowIso(),
    };

    const previousImage = job.lastPreview?.imageData || null;
    let screenshot;
    try {
      screenshot = await Promise.race([
        page.screenshot({
          type: "jpeg",
          quality: 55,
          fullPage: false,
          animations: "disabled",
          caret: "hide",
          timeout: PREVIEW_CAPTURE_TIMEOUT_MS,
        }),
        new Promise((resolve) =>
          setTimeout(() => resolve(null), PREVIEW_CAPTURE_TIMEOUT_MS),
        ),
      ]);
    } catch {
      return { ...meta, imageData: previousImage };
    }

    if (!screenshot) {
      return { ...meta, imageData: previousImage };
    }

    return {
      ...meta,
      imageData: `data:image/jpeg;base64,${screenshot.toString("base64")}`,
    };
  }

  /**
   * Subclasses MUST override this.
   */
  async processAccount(_job, _account, _workerId) {
    throw new Error("processAccount must be implemented by subclass");
  }

  async runWorker(job, workerId) {
    while (!job.cancelRequested) {
      const account = this.dequeueAccount(job, workerId);
      if (!account) return;
      await this.processAccount(job, account, workerId);
    }
  }

  async runJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      job.accounts.forEach((account) => {
        if (account.status === "queued" && (account.logs || []).length === 1) {
          this.setAccountStep(
            account,
            "waiting_for_worker",
            "Waiting for a free worker",
          );
        }
      });
      await this.persistJobSnapshot(job, { forcePreview: false });
      const workerCount = Math.min(
        job.concurrency,
        Math.max(job.accounts.length, 1),
      );
      const workers = Array.from({ length: workerCount }, (_, index) =>
        this.runWorker(job, index + 1),
      );

      await Promise.allSettled(workers);

      if (job.manualFollowups.size > 0) {
        await Promise.allSettled([...job.manualFollowups]);
      }

      if (job.cancelRequested) {
        job.status = "cancelled";
        job.accounts.forEach((account) => {
          if (account.status === "queued" || account.status === "running") {
            this.finalizeAccount(account, "cancelled", {
              error: "Job cancelled",
              step: "cancelled",
              message: "Job cancelled before completion",
            });
          }
        });
      } else {
        job.status = "completed";
      }
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      job.status = "failed";
      job.error = error.message || "Failed to start bulk import job.";
      job.accounts.forEach((account) => {
        if (account.status === "queued" || account.status === "running") {
          this.finalizeAccount(account, "failed", {
            error: job.error,
            step: "failed",
            message: job.error,
          });
          account.password = undefined;
        }
      });
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      job.finishedAt = nowIso();
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }
}

export const __test__ = {
  clampConcurrency,
  parseBulkAccounts,
  sanitizeJob,
  buildSummary,
  isRecentTerminalJob,
  buildLookupResponse,
};
