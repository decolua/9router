import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../dataDir.js";
import { getOptimalWorkerCount, isAutoConcurrencyValue } from "../../systemSpecs.js";
import { KiroService } from "./kiro.js";
import { createKiroCallbackMonitor, runKiroGoogleAutomation } from "./kiroGoogleAutomation.js";

export const KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY = 4;
export const KIRO_BULK_IMPORT_MIN_CONCURRENCY = 1;
export const KIRO_BULK_IMPORT_MAX_CONCURRENCY = 8;

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
const KIRO_BULK_IMPORT_DIR = path.join(DATA_DIR, "kiro-bulk-import");
const KIRO_BULK_IMPORT_META_FILE = path.join(KIRO_BULK_IMPORT_DIR, "meta.json");
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);

function nowIso() {
  return new Date().toISOString();
}

function ensurePersistenceDir(dir = KIRO_BULK_IMPORT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
}

function getJobFile(jobId, dir = KIRO_BULK_IMPORT_DIR) {
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

function readPersistedLatestJobId(metaFile = KIRO_BULK_IMPORT_META_FILE) {
  return readJsonFile(metaFile)?.latestJobId || null;
}

function writePersistedLatestJobId(jobId, metaFile = KIRO_BULK_IMPORT_META_FILE) {
  writeJsonFile(metaFile, {
    latestJobId: jobId || null,
    updatedAt: nowIso(),
  });
}

function clampConcurrency(value) {
  // "auto" (or boolean true) defers to system spec detection so users on
  // beefier machines automatically get more workers without editing the form.
  if (isAutoConcurrencyValue(value)) {
    const detected = getOptimalWorkerCount();
    const safeDetected = Number.isFinite(detected) ? detected : KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY;
    return Math.min(KIRO_BULK_IMPORT_MAX_CONCURRENCY, Math.max(KIRO_BULK_IMPORT_MIN_CONCURRENCY, safeDetected));
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY;
  return Math.min(KIRO_BULK_IMPORT_MAX_CONCURRENCY, Math.max(KIRO_BULK_IMPORT_MIN_CONCURRENCY, parsed));
}

export function parseKiroBulkAccounts(accounts = []) {
  const lines = Array.isArray(accounts) ? accounts : [];
  const parsed = [];
  const invalidLines = [];

  lines.forEach((line, index) => {
    const raw = String(line || "").trim();
    if (!raw) return;
    // Skip comment lines
    if (raw.startsWith("#")) return;

    let email = "";
    let password = "";

    if (raw.includes("|")) {
      // Pipe separator (original behavior) — password may contain |
      const [emailPart = "", ...passwordParts] = raw.split("|");
      email = emailPart.trim();
      password = passwordParts.join("|").trim();
    } else if (raw.includes("\t")) {
      // Tab separator (spreadsheet paste)
      const tabIdx = raw.indexOf("\t");
      email = raw.substring(0, tabIdx).trim();
      password = raw.substring(tabIdx + 1).trim();
    } else if (raw.includes(":")) {
      // Colon separator — only if part before first : looks like email
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

function getFailedCount(accounts) {
  return accounts.filter((account) => (
    account.status === "failed"
    || account.status === "failed_invalid_credentials"
    || account.status === "failed_exchange"
    || account.status === "failed_timeout"
  )).length;
}

function buildSummary(accounts) {
  return {
    total: accounts.length,
    queued: accounts.filter((account) => account.status === "queued").length,
    running: accounts.filter((account) => account.status === "running").length,
    success: accounts.filter((account) => account.status === "success").length,
    failed: getFailedCount(accounts),
    needs_manual: accounts.filter((account) => account.status === "needs_manual").length,
  };
}

function resolveFinishedJobStatus(accounts) {
  const summary = buildSummary(accounts);
  if (summary.needs_manual > 0) return "needs_manual";
  if (summary.success > 0) return "completed";
  if (summary.failed > 0) return "failed";
  return "completed";
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
    .flatMap((account) => (account.logs || []).map((entry) => ({
      ...entry,
      email: account.email,
      line: account.line,
      workerId: account.workerId || null,
      status: account.status,
    })))
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
    logs: (account.logs || []).slice(-8),
    manualSessionAvailable: Boolean(account.manualSession?.page) && account.status === "needs_manual",
    manualSessionOpened: Boolean(account.manualSession?.opened),
  };
}

function sanitizeJob(job, extras = {}) {
  return {
    jobId: job.jobId,
    status: job.status,
    summary: buildSummary(job.accounts),
    concurrency: job.concurrency,
    proxyMode: job.proxyMode || "none",
    proxyPoolId: job.proxyPoolId || null,
    proxySource: job.proxySource || null,
    proxyCount: Array.isArray(job.proxyUrls) ? job.proxyUrls.length : (job.proxyUrl ? 1 : 0),
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
  return (Date.now() - finishedAtMs) <= RECENT_TERMINAL_JOB_WINDOW_MS;
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
    recoverable: ACTIVE_JOB_STATUSES.has(job.status),
    job,
  };
}

async function defaultBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "chromium",
    proxyUrl: job?.proxyUrl || undefined,
    headless: false,
    args: ["--start-maximized"],
  });
}

function normalizeProxyUrls(proxyUrl, proxyUrls) {
  const values = Array.isArray(proxyUrls) ? proxyUrls : (proxyUrl ? [proxyUrl] : []);
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function resolveWorkerProxyUrl(job, workerId) {
  const proxyUrls = Array.isArray(job.proxyUrls) ? job.proxyUrls : [];
  if (proxyUrls.length > 1) return proxyUrls[(Math.max(1, workerId) - 1) % proxyUrls.length];
  return job.proxyUrl || proxyUrls[0] || null;
}

async function defaultSocialExchange(args) {
  const { exchangeAndSaveKiroSocialConnection } = await import("./kiroConnections.js");
  return exchangeAndSaveKiroSocialConnection(args);
}

export async function createFreshContext(browser, contextOptions = undefined) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  return { context, page };
}

function getBrowserHeadlessState(browser) {
  if (!browser) return "unknown";
  const opts = browser._options || browser._initializer || {};
  if (typeof opts.headless === "boolean") return opts.headless ? "headless" : "headed";
  return "unknown";
}

function isHeadlessBrowser(browser) {
  return getBrowserHeadlessState(browser) !== "headed";
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

  let newBrowser;
  try {
    const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
    newBrowser = await launchBulkImportBrowser({
      engine: "chromium",
      headless: false,
      args: ["--start-maximized"],
      proxyUrl: account?.manualSession?.proxyUrl || account?.runtimeSession?.proxyUrl || null,
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

  let newPage;
  try {
    newPage = await newContext.newPage();
    if (lastUrl) {
      try {
        await newPage.goto(lastUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      } catch {}
    }
  } catch {
    await newContext.close().catch(() => null);
    await newBrowser.close().catch(() => null);
    return false;
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

async function bringPageToFront(page) {
  if (typeof page?.bringToFront !== "function") return false;
  try {
    await page.bringToFront();
    return true;
  } catch {
    return false;
  }
}

async function revealBrowserWindow(page, { account, preferRelaunch = false } = {}) {
  if (!page) return false;

  let context = null;
  let browser = null;
  try {
    context = page.context?.() || null;
    browser = context?.browser?.() || null;
  } catch {
    context = null;
    browser = null;
  }
  const headlessState = getBrowserHeadlessState(browser);

  if (account && preferRelaunch) {
    if (!account.manualSession?.context) {
      return bringPageToFront(page);
    }
    try {
      const relaunched = await relaunchAsHeaded(account);
      if (relaunched) {
        return bringPageToFront(account.manualSession.page);
      }
    } catch {}

    return false;
  }

  const hasDedicatedManualWindow = Boolean(account?.manualSession?.headedBrowser);
  if (account && headlessState !== "headed" && !hasDedicatedManualWindow) {
    try {
      const relaunched = await relaunchAsHeaded(account);
      if (relaunched) {
        return bringPageToFront(account.manualSession.page);
      }
    } catch {}

    if (headlessState === "headless") {
      return false;
    }
  }

  let session = null;
  try {
    if (!context?.newCDPSession) {
      return bringPageToFront(page);
    }

    session = await context.newCDPSession(page);
    let windowId = null;
    let windowRestored = false;

    try {
      const targetInfo = await session.send("Target.getTargetInfo");
      const targetId = targetInfo?.targetInfo?.targetId;
      const windowInfo = await session.send("Browser.getWindowForTarget", targetId ? { targetId } : {});
      windowId = windowInfo?.windowId ?? null;
    } catch {
      windowId = null;
    }

    if (windowId != null) {
      try {
        await session.send("Browser.setWindowBounds", {
          windowId,
          bounds: {
            windowState: "normal",
            left: 80,
            top: 80,
            width: 1280,
            height: 960,
          },
        });
        windowRestored = true;
      } catch {
        windowRestored = false;
      }
    }

    const broughtToFront = await bringPageToFront(page);
    await session.detach?.().catch(() => null);
    return windowRestored || broughtToFront;
  } catch {
    await session?.detach?.().catch(() => null);
    return bringPageToFront(page);
  }
}

export class KiroBulkImportManager {
  constructor({
    browserLauncher = defaultBrowserLauncher,
    googleAutomation = runKiroGoogleAutomation,
    socialExchange = defaultSocialExchange,
    kiroServiceFactory = () => new KiroService(),
    storageName = "kiro-bulk-import",
  } = {}) {
    this.browserLauncher = browserLauncher;
    this.googleAutomation = googleAutomation;
    this.socialExchange = socialExchange;
    this.kiroServiceFactory = kiroServiceFactory;
    this.storageDir = path.join(DATA_DIR, storageName);
    this.metaFile = path.join(this.storageDir, "meta.json");
    this.jobs = new Map();
    this.latestJobId = readPersistedLatestJobId(this.metaFile);
  }

  async startJob({ accounts, concurrency, engine, proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, jobFields }) {
    const { parsed, invalidLines } = parseKiroBulkAccounts(accounts);
    if (!parsed.length) {
      const error = invalidLines.length > 0
        ? "Invalid account format. Use one account per line: gmail@example.com|password"
        : "At least one account entry is required";
      const response = { error };
      if (invalidLines.length > 0) response.invalidLines = invalidLines;
      throw Object.assign(new Error(error), response);
    }

    if (invalidLines.length > 0) {
      const error = "Invalid account format. Use one account per line: gmail@example.com|password";
      throw Object.assign(new Error(error), { error, invalidLines });
    }

    const jobId = randomUUID();
    const createdAt = nowIso();
    const { normalizeBulkImportEngine, DEFAULT_BULK_IMPORT_ENGINE } = await import("./bulkImportBrowserEngine.js");
    const resolvedEngine = engine ? normalizeBulkImportEngine(engine) : DEFAULT_BULK_IMPORT_ENGINE;
    const resolvedProxyUrls = normalizeProxyUrls(proxyUrl, proxyUrls);
    const job = {
      jobId,
      status: "running",
      concurrency: clampConcurrency(concurrency),
      engine: resolvedEngine,
      proxyUrl: resolvedProxyUrls[0] || null,
      proxyUrls: resolvedProxyUrls,
      proxyMode: proxyMode || (resolvedProxyUrls.length > 1 ? "round-robin" : (resolvedProxyUrls.length === 1 ? "single" : "none")),
      proxyPoolId: proxyPoolId || null,
      proxySource: proxySource || null,
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
      error: null,
      cancelRequested: false,
      browser: null,
      workerBrowsers: new Set(),
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
        currentStep: "queued",
        updatedAt: createdAt,
        logs: [createLogEntry("queued", "Queued and waiting for an available worker")],
      })),
      ...(jobFields || {}),
    };

    this.jobs.set(jobId, job);
    this.latestJobId = jobId;
    writePersistedLatestJobId(jobId, this.metaFile);
    await this.persistJobSnapshot(job, { forcePreview: false });
    void this.runJob(jobId);
    return sanitizeJob(job);
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
    const latestJobId = this.latestJobId || readPersistedLatestJobId(this.metaFile);
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

    if (job.browser) {
      void job.browser.close().catch(() => null);
      job.browser = null;
    }
    if (job.workerBrowsers) {
      for (const browser of job.workerBrowsers) {
        void browser.close().catch(() => null);
      }
      job.workerBrowsers.clear();
    }

    void this.persistJobSnapshot(job, { forcePreview: true });

    return sanitizeJob(job);
  }

  async openManualSession(jobId, workerId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const numericWorkerId = Number.parseInt(workerId, 10);
    const account = job.accounts.find((entry) => (
      entry.workerId === numericWorkerId
      && entry.status === "needs_manual"
      && entry.manualSession?.page
    ));

    if (!account) {
      return {
        ok: false,
        error: "Manual session not found for this worker",
        job: sanitizeJob(job),
      };
    }

    const opened = await revealBrowserWindow(account.manualSession.page, {
      account,
      preferRelaunch: !account.manualSession.opened || !account.manualSession.headedBrowser,
    });
    account.manualSession.opened = opened;
    account.manualSession.openedAt = opened
      ? (account.manualSession.openedAt || nowIso())
      : account.manualSession.openedAt || null;
    await this.persistJobSnapshot(job, { forcePreview: true });

    if (!opened) {
      return {
        ok: false,
        status: 409,
        error: "Could not open the manual browser window. Retry, or restart the bulk login job if the browser session was closed.",
        job: sanitizeJob(job),
        account: sanitizeAccount(account),
      };
    }

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
      appendAccountLog(account, "worker_assigned", `Worker ${workerId} picked up this account`);
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
        extras.message || extras.error || status.replaceAll("_", " ")
      );
    }
    return account;
  }

  setAccountStep(account, step, message, level = "info") {
    appendAccountLog(account, step, message, level);
  }

  async capturePreviewWithTimeout(job) {
    // Defence in depth. capturePreview already hard-caps page.screenshot, but
    // any caller (including subclasses or future overrides) must never be able
    // to freeze the worker or the frontend polling request. Two failure modes
    // are bug-equivalent: a hung page.screenshot, and a hung capturePreview
    // that someone monkey-patched. Both are bounded here.
    let preview = null;
    try {
      preview = await Promise.race([
        this.capturePreview(job),
        new Promise((resolve) => setTimeout(() => resolve(null), PREVIEW_CAPTURE_TIMEOUT_MS)),
      ]);
    } catch {
      preview = null;
    }
    return preview;
  }

  async persistJobSnapshot(job, { forcePreview = false } = {}) {
    if (!job) return;

    const runPersist = async () => {
      const shouldCapturePreview = forcePreview || (Date.now() - (job.lastPreviewCapturedAt || 0) >= PREVIEW_CAPTURE_INTERVAL_MS);
      if (shouldCapturePreview) {
        const preview = await this.capturePreviewWithTimeout(job);
        if (preview) {
          job.lastPreview = preview;
        }
        job.lastPreviewCapturedAt = Date.now();
      }

      try {
        writeJsonFile(getJobFile(job.jobId, this.storageDir), buildPersistedSnapshot(job));
      } catch {
        // Best-effort persistence; never break the worker over a write failure.
      }
    };

    job.persistPromise = Promise.resolve(job.persistPromise).catch(() => null).then(runPersist);
    await job.persistPromise;
  }

  capturePreviewAccount(job) {
    return job.accounts.find((account) => account.status === "running" && account.runtimeSession?.page)
      || job.accounts.find((account) => account.status === "needs_manual" && account.manualSession?.page)
      || job.accounts.find((account) => account.runtimeSession?.page)
      || job.accounts.find((account) => account.manualSession?.page)
      || null;
  }

  async capturePreview(job) {
    const previewAccount = this.capturePreviewAccount(job);
    if (!previewAccount) return null;

    const page = previewAccount.runtimeSession?.page || previewAccount.manualSession?.page;
    if (!page) return null;

    const meta = {
      email: previewAccount.email,
      workerId: previewAccount.workerId || null,
      status: previewAccount.status,
      step: previewAccount.currentStep || null,
      updatedAt: previewAccount.updatedAt || nowIso(),
    };

    // Hard cap the screenshot. page.screenshot has NO default timeout on
    // Playwright unless setDefaultTimeout was called; a concurrent page.evaluate
    // (Qoder fetches /api/v1/me/userplan while status is still 'running') can
    // stall the screenshot indefinitely. Without this race, BOTH
    // persistJobSnapshot AND getJobWithPreview (frontend's 2s polling path)
    // freeze and the Live Browser Preview modal sticks on a stale image.
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
        new Promise((resolve) => setTimeout(() => resolve(null), PREVIEW_CAPTURE_TIMEOUT_MS)),
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

  async runManualFollowup(job, account, workerId, context, callbackPromise, codeVerifier) {
    const followupPromise = (async () => {
      const closeManualResources = async () => {
        const ms = account.manualSession;
        const ctx = ms?.context || context;
        const headed = ms?.headedBrowser || null;
        if (ctx) await ctx.close().catch(() => null);
        if (headed) await headed.close().catch(() => null);
      };
      try {
        const callback = await callbackPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        this.setAccountStep(account, "exchanging_tokens", "Exchanging Kiro callback for OAuth tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.socialExchange({
          code: callback.code,
          codeVerifier,
          provider: "google",
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Kiro connection saved successfully",
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
      } catch (error) {
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
        } else {
          this.finalizeAccount(account, "failed_exchange", {
            error: error.message || "Manual assist flow failed during token exchange.",
            step: "exchange_failed",
            message: error.message || "Manual assist flow failed during token exchange.",
          });
        }
        await this.persistJobSnapshot(job, { forcePreview: true });
      } finally {
        await closeManualResources();
        account.manualSession = null;
        account.runtimeSession = null;
        job.manualFollowups.delete(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: true });
      }
    })();

    job.manualFollowups.add(followupPromise);
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested || !browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    let context = null;
    try {
      const kiroService = this.kiroServiceFactory();
      const socialAuth = kiroService.createSocialAuthorization("google");
      const freshContext = await createFreshContext(browser);
      context = freshContext.context;
      const page = freshContext.page;
      const callbackPromise = createKiroCallbackMonitor(context, page);
      account.runtimeSession = { context, page, proxyUrl: browser.__ninerouterProxyUrl || job.proxyUrl || null };

      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} is preparing a browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });
      const automationResult = await this.googleAutomation({
        page,
        authUrl: socialAuth.authUrl,
        email: account.email,
        password: account.password,
        callbackPromise,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        this.setAccountStep(account, "exchanging_tokens", "Exchanging Kiro callback for OAuth tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.socialExchange({
          code: automationResult.code,
          codeVerifier: socialAuth.codeVerifier,
          provider: "google",
        });
        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Kiro connection saved successfully",
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      if (automationResult.status === "needs_manual") {
        account.manualSession = {
          context,
          page,
          opened: false,
          openedAt: null,
          rebind: typeof callbackPromise?.rebind === "function" ? callbackPromise.rebind : null,
          proxyUrl: account.runtimeSession?.proxyUrl || browser.__ninerouterProxyUrl || job.proxyUrl || null,
        };
        this.setAccountStep(account, "awaiting_manual", "Waiting for manual completion in the browser session");
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
        await this.runManualFollowup(
          job,
          account,
          workerId,
          context,
          callbackPromise,
          socialAuth.codeVerifier
        );
        return;
      }

      const terminalStatus = TERMINAL_ACCOUNT_STATUSES.has(automationResult.status)
        ? automationResult.status
        : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "Kiro Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "Kiro Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected Kiro bulk import failure.",
        step: "failed",
        message: error.message || "Unexpected Kiro bulk import failure.",
      });
      account.runtimeSession = null;
      await context?.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }

  async runWorker(job, workerId, browser = job.browser) {
    let workerBrowser = browser;
    const ownsBrowser = !workerBrowser;
    try {
      if (!workerBrowser) {
        const proxyUrl = resolveWorkerProxyUrl(job, workerId);
        workerBrowser = await this.browserLauncher({ ...job, proxyUrl });
        workerBrowser.__ninerouterProxyUrl = proxyUrl || null;
        job.workerBrowsers.add(workerBrowser);
      }

      while (!job.cancelRequested) {
        const account = this.dequeueAccount(job, workerId);
        if (!account) return;
        await this.processAccount(job, account, workerId, workerBrowser);
      }
    } finally {
      if (ownsBrowser && workerBrowser && job.cancelRequested) {
        job.workerBrowsers.delete(workerBrowser);
        await workerBrowser.close().catch(() => null);
      }
    }
  }

  async runJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      const useWorkerBrowsers = Array.isArray(job.proxyUrls) && job.proxyUrls.length > 1;
      if (!useWorkerBrowsers) {
        job.browser = await this.browserLauncher(job);
        job.browser.__ninerouterProxyUrl = job.proxyUrl || null;
      }
      job.accounts.forEach((account) => {
        if (account.status === "queued" && (account.logs || []).length === 1) {
          this.setAccountStep(account, "waiting_for_worker", "Waiting for a free worker");
        }
      });
      await this.persistJobSnapshot(job, { forcePreview: false });
      const workerCount = Math.min(job.concurrency, Math.max(job.accounts.length, 1));
      const workers = Array.from({ length: workerCount }, (_, index) => this.runWorker(
        job,
        index + 1,
        useWorkerBrowsers ? null : job.browser
      ));

      const workerResults = await Promise.allSettled(workers);
      const workerErrors = workerResults
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message || String(result.reason || "Worker failed"));
      if (workerErrors.length > 0) {
        const workerErrorMessage = workerErrors.join("; ");
        job.error = workerErrorMessage;
        job.accounts.forEach((account) => {
          if (account.status === "queued" || account.status === "running") {
            this.finalizeAccount(account, "failed", {
              error: workerErrorMessage,
              step: "failed",
              message: `Worker failed: ${workerErrorMessage}`,
            });
            account.password = undefined;
          }
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
      }

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
        job.status = resolveFinishedJobStatus(job.accounts);
        if (job.status === "failed") {
          job.error = job.error || "All accounts failed.";
        }
      }
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      job.status = "failed";
      job.error = error.message || "Failed to start Kiro bulk import job.";
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
      if (job.browser) {
        await job.browser.close().catch(() => null);
        job.browser = null;
      }
      if (job.workerBrowsers) {
        await Promise.allSettled([...job.workerBrowsers].map((browser) => browser.close().catch(() => null)));
        job.workerBrowsers.clear();
      }
      job.finishedAt = job.status === "needs_manual" ? null : nowIso();
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__kiroBulkImportSingleton) {
    globalThis.__kiroBulkImportSingleton = {
      manager: new KiroBulkImportManager(),
    };
  }
  return globalThis.__kiroBulkImportSingleton;
}

export function getKiroBulkImportManager() {
  return getSingletonStore().manager;
}

export const __test__ = {
  clampConcurrency,
  parseKiroBulkAccounts,
  sanitizeJob,
  buildSummary,
  resolveFinishedJobStatus,
  isRecentTerminalJob,
  buildLookupResponse,
};
