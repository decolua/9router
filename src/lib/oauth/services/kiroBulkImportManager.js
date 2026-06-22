import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import logger from "@/lib/logger";
import { DATA_DIR } from "../../dataDir.js";
import { KiroService } from "./kiro.js";
import {
  createKiroCallbackMonitor,
  runKiroGoogleAutomation,
} from "./kiroGoogleAutomation.js";
import {
  getOptimalWorkerCount,
  isAutoConcurrencyValue,
} from "../../systemSpecs.js";

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
  "skipped_duplicate",
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

function getJobFile(jobId, dir = KIRO_BULK_IMPORT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${jobId}.json`);
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    logger.warn("OAUTH", `Failed to read ${filePath}`, {
      error: error.message,
    });
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempFile = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tempFile, filePath);
}

function readPersistedLatestJobId(metaFile = KIRO_BULK_IMPORT_META_FILE) {
  return readJsonFile(metaFile)?.latestJobId || null;
}

function writePersistedLatestJobId(
  jobId,
  metaFile = KIRO_BULK_IMPORT_META_FILE,
) {
  writeJsonFile(metaFile, {
    latestJobId: jobId || null,
    updatedAt: nowIso(),
  });
}

function clampConcurrency(value) {
  // Support "auto" value for automatic worker count detection
  if (isAutoConcurrencyValue(value)) {
    return getOptimalWorkerCount();
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY;
  return Math.min(
    KIRO_BULK_IMPORT_MAX_CONCURRENCY,
    Math.max(KIRO_BULK_IMPORT_MIN_CONCURRENCY, parsed),
  );
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

    // Tab-separated format
    if (raw.includes("\t")) {
      const parts = raw.split("\t");
      email = parts[0] || "";
      password = parts.slice(1).join("\t");
    }
    // Colon separator (only when email part contains @)
    else if (raw.includes(":") && raw.split(":")[0].includes("@")) {
      const colonIdx = raw.indexOf(":");
      email = raw.slice(0, colonIdx);
      password = raw.slice(colonIdx + 1);
    }
    // Pipe separator (default)
    else if (raw.includes("|")) {
      const [emailPart = "", ...passwordParts] = raw.split("|");
      email = emailPart;
      password = passwordParts.join("|");
    }
    // No valid separator found
    else {
      invalidLines.push(index + 1);
      return;
    }

    const normalizedEmail = email.trim();
    const normalizedPassword = password.trim();

    if (!normalizedEmail || !normalizedPassword) {
      invalidLines.push(index + 1);
      return;
    }

    parsed.push({
      line: index + 1,
      email: normalizedEmail,
      password: normalizedPassword,
    });
  });

  return {
    parsed,
    invalidLines,
  };
}

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
  const s = {
    total: accounts.length,
    queued: 0,
    running: 0,
    success: 0,
    failed: 0,
    needs_manual: 0,
    skipped: 0,
  };
  for (const a of accounts) {
    if (a.status === "queued") s.queued++;
    else if (a.status === "running") s.running++;
    else if (a.status === "success") s.success++;
    else if (a.status === "needs_manual") s.needs_manual++;
    else if (a.status === "skipped_duplicate") s.skipped++;
    else if (
      TERMINAL_ACCOUNT_STATUSES.has(a.status) &&
      a.status !== "success" &&
      a.status !== "cancelled"
    )
      s.failed++;
  }
  return s;
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
    engine: job.engine || "chromium",
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

async function defaultBrowserLauncher(engine = "chromium") {
  const { launchBrowser } = await import("./bulkImportBrowserEngine.js");
  return await launchBrowser(engine, { headless: false });
}

async function defaultSocialExchange(args) {
  const { exchangeAndSaveKiroSocialConnection } =
    await import("./kiroConnections.js");
  return exchangeAndSaveKiroSocialConnection(args);
}

export async function createFreshContext(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

async function revealBrowserWindow(page) {
  if (!page) return false;

  try {
    const context = page.context?.();
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

async function defaultGetProviderConnections(filter) {
  const { getProviderConnections } = await import("../../../models/index.js");
  return getProviderConnections(filter);
}

export class KiroBulkImportManager {
  constructor({
    browserLauncher = defaultBrowserLauncher,
    googleAutomation = runKiroGoogleAutomation,
    socialExchange = defaultSocialExchange,
    kiroServiceFactory = () => new KiroService(),
    storageName = "kiro-bulk-import",
    getProviderConnections = defaultGetProviderConnections,
    providerId = "kiro",
  } = {}) {
    this.browserLauncher = browserLauncher;
    this.googleAutomation = googleAutomation;
    this.socialExchange = socialExchange;
    this.kiroServiceFactory = kiroServiceFactory;
    this.getProviderConnections = getProviderConnections;
    this.providerId = providerId;
    this.storageDir = path.join(DATA_DIR, storageName);
    this.metaFile = path.join(this.storageDir, "meta.json");
    this.jobs = new Map();
    this.latestJobId = readPersistedLatestJobId(this.metaFile);
  }

  async startJob({ accounts, concurrency, engine = "chromium" }) {
    const { parsed, invalidLines } = parseKiroBulkAccounts(accounts);
    if (!parsed.length) {
      const error =
        invalidLines.length > 0
          ? "Invalid account format. Use one account per line: email@gmail.com:password or email@gmail.com|password"
          : "At least one account entry is required";
      const response = { error };
      if (invalidLines.length > 0) response.invalidLines = invalidLines;
      throw Object.assign(new Error(error), response);
    }

    if (invalidLines.length > 0) {
      const error =
        "Invalid account format. Use one account per line: email@gmail.com:password or email@gmail.com|password";
      throw Object.assign(new Error(error), { error, invalidLines });
    }

    // Check for duplicate emails in existing connections
    const existingConnections = await this.getProviderConnections({
      provider: this.providerId,
      isActive: true,
    });
    logger.debug(
      "OAUTH",
      `Found ${existingConnections.length} existing ${this.providerId} connections`,
    );

    const existingEmails = new Set(
      existingConnections
        .filter((c) => c.authType === "oauth" && c.email)
        .map((c) => c.email.toLowerCase()),
    );
    logger.debug(
      "OAUTH",
      `${existingEmails.size} OAuth emails to check for duplicates`,
      { emails: Array.from(existingEmails) },
    );

    // Also check profileArn as fallback (since email extraction may fail)
    const existingProfileArns = new Set(
      existingConnections
        .filter(
          (c) => c.authType === "oauth" && c.providerSpecificData?.profileArn,
        )
        .map((c) => c.providerSpecificData.profileArn),
    );
    logger.debug(
      "OAUTH",
      `${existingProfileArns.size} profileArns found for fallback check`,
    );

    const jobId = randomUUID();
    const createdAt = nowIso();
    const job = {
      jobId,
      status: "running",
      concurrency: clampConcurrency(concurrency),
      engine,
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
      accounts: parsed.map((account) => {
        const normalizedEmail = account.email.toLowerCase();
        const isDuplicate = existingEmails.has(normalizedEmail);

        logger.debug("OAUTH", `Checking ${account.email}`, {
          normalized: normalizedEmail,
          isDuplicate,
        });

        if (isDuplicate) {
          logger.debug("OAUTH", `Skipping duplicate account: ${account.email}`);
          return {
            line: account.line,
            email: account.email,
            password: undefined,
            status: "skipped_duplicate",
            error: "Account already exists in connections",
            connectionId: null,
            workerId: null,
            manualSession: null,
            runtimeSession: null,
            currentStep: "skipped_duplicate",
            updatedAt: createdAt,
            logs: [
              createLogEntry(
                "skipped_duplicate",
                "Skipped: account already exists in connections",
              ),
            ],
          };
        }

        return {
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
          logs: [
            createLogEntry(
              "queued",
              "Queued and waiting for an available worker",
            ),
          ],
        };
      }),
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
    const preview = await this.capturePreview(job);
    job.lastPreview = preview || job.lastPreview || null;
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

    if (job.browser) {
      void job.browser.close().catch(() => null);
      job.browser = null;
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

    const opened = await revealBrowserWindow(account.manualSession.page);
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

  async persistJobSnapshot(job, { forcePreview = false } = {}) {
    if (!job) return;

    const runPersist = async () => {
      const shouldCapturePreview =
        forcePreview ||
        Date.now() - (job.lastPreviewCapturedAt || 0) >=
          PREVIEW_CAPTURE_INTERVAL_MS;
      if (shouldCapturePreview) {
        // Race capturePreview with a hard timeout to prevent hanging on slow page.evaluate
        let preview = null;
        try {
          preview = await Promise.race([
            this.capturePreview(job),
            new Promise((resolve) =>
              setTimeout(() => resolve(null), PREVIEW_CAPTURE_TIMEOUT_MS),
            ),
          ]);
        } catch {
          // Ignore capture errors, keep previous preview
        }
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
        // Ignore write failures, job state is still in memory
      }
    };

    job.persistPromise = Promise.resolve(job.persistPromise)
      .catch(() => null)
      .then(runPersist);
    await job.persistPromise;
  }

  capturePreviewAccount(job) {
    // Permissive fallback: find any account with a live page, not just running/needs_manual
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
        new Promise((resolve) =>
          setTimeout(() => resolve(null), PREVIEW_CAPTURE_TIMEOUT_MS),
        ),
      ]);
    } catch {
      // Return previous image data on failure instead of null to keep preview visible
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

  async runManualFollowup(
    job,
    account,
    workerId,
    context,
    callbackPromise,
    codeVerifier,
  ) {
    const followupPromise = (async () => {
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

        this.setAccountStep(
          account,
          "exchanging_tokens",
          "Exchanging Kiro callback for OAuth tokens",
        );
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.socialExchange({
          code: callback.code,
          codeVerifier,
          provider: "google",
          emailFallback: account.email,
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
            error:
              error.message ||
              "Manual assist flow failed during token exchange.",
            step: "exchange_failed",
            message:
              error.message ||
              "Manual assist flow failed during token exchange.",
          });
        }
        await this.persistJobSnapshot(job, { forcePreview: true });
      } finally {
        account.manualSession = null;
        account.runtimeSession = null;
        await context.close().catch(() => null);
        job.manualFollowups.delete(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: true });
      }
    })();

    job.manualFollowups.add(followupPromise);
  }

  async processAccount(job, account, workerId) {
    if (job.cancelRequested || !job.browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const password = account.password;
    account.password = undefined;

    const kiroService = this.kiroServiceFactory();
    const socialAuth = kiroService.createSocialAuthorization("google");
    const { context, page } = await createFreshContext(job.browser);
    const callbackPromise = createKiroCallbackMonitor(context, page);
    account.runtimeSession = { context, page };

    try {
      this.setAccountStep(
        account,
        "preparing_worker",
        `Worker ${workerId} is preparing a browser context`,
      );
      await this.persistJobSnapshot(job, { forcePreview: true });
      const automationResult = await this.googleAutomation({
        page,
        authUrl: socialAuth.authUrl,
        email: account.email,
        password,
        callbackPromise,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        this.setAccountStep(
          account,
          "exchanging_tokens",
          "Exchanging Kiro callback for OAuth tokens",
        );
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.socialExchange({
          code: automationResult.code,
          codeVerifier: socialAuth.codeVerifier,
          provider: "google",
          emailFallback: account.email,
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
        };
        this.setAccountStep(
          account,
          "awaiting_manual",
          "Waiting for manual completion in the browser session",
        );
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
          socialAuth.codeVerifier,
        );
        return;
      }

      const terminalStatus = TERMINAL_ACCOUNT_STATUSES.has(
        automationResult.status,
      )
        ? automationResult.status
        : "failed";
      callbackPromise.catch(() => null);
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "Kiro Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "Kiro Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      callbackPromise.catch(() => null);
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected Kiro bulk import failure.",
        step: "failed",
        message: error.message || "Unexpected Kiro bulk import failure.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
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
      // Launch browser with engine selection
      job.browser = await this.browserLauncher(job.engine || "chromium");
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
      job.finishedAt = nowIso();
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
  isRecentTerminalJob,
  buildLookupResponse,
};
