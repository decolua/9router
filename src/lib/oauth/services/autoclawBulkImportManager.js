import { randomUUID } from "crypto";
import {
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
} from "./kiroBulkImportManager.js";
import { runGoogleAccountAutomation } from "./googleAutomation.js";
import { proxyAwareFetch } from "../../../../open-sse/utils/proxyFetch.js";
import {
  AUTOCLAW_GOOGLE_OAUTH_URL,
  AUTOCLAW_REDIRECT_URI,
  AUTOCLAW_WALLET_URL,
  buildAutoClawAuthHeaders,
  normalizeAutoClawBearerToken,
} from "../../../../open-sse/shared/autoclaw.js";

const AUTOCLAW_PROVIDER_ID = "autoclaw";
const AUTOCLAW_LABEL = "AutoClaw";
const AUTOCLAW_POLL_TIMEOUT_MS = 3 * 60_000;
const AUTOCLAW_MANUAL_TIMEOUT_MS = 15 * 60_000;
const AUTOCLAW_OAUTH_REQUEST_MIN_INTERVAL_MS = 2500;
const AUTOCLAW_OAUTH_RATE_LIMIT_RETRIES = 5;
const AUTOCLAW_OAUTH_RATE_LIMIT_INITIAL_BACKOFF_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAutoClawRateLimitMessage(message) {
  return /请求频次太快|频次太快|稍等再试|too\s*fast|too\s*many|rate\s*limit|rate-limited|429/i.test(String(message || ""));
}

function makeAutoClawRateLimitError(message) {
  const error = new Error(message || "AutoClaw is rate limiting OAuth URL requests. Please wait and retry.");
  error.code = "AUTOCLAW_RATE_LIMIT";
  return error;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getDefaultOAuthRequestMinIntervalMs() {
  return parsePositiveInt(
    process.env.NINEROUTER_AUTOCLAW_OAUTH_REQUEST_MIN_INTERVAL_MS,
    AUTOCLAW_OAUTH_REQUEST_MIN_INTERVAL_MS
  );
}

function proxyOptionsFromUrl(proxyUrl) {
  if (!proxyUrl) return null;
  return {
    connectionProxyEnabled: true,
    connectionProxyUrl: proxyUrl,
    connectionNoProxy: "",
  };
}

function normalizeTokenData(payload = {}) {
  const data = payload?.data || payload || {};
  if (!data.access_token && !data.accessToken) return null;
  return {
    accessToken: data.access_token || data.accessToken,
    refreshToken: data.refresh_token || data.refreshToken || "",
    expiresIn: Number(data.expires_in || data.expiresIn) > 0
      ? Number(data.expires_in || data.expiresIn)
      : 24 * 60 * 60,
    rawResponse: payload,
  };
}

async function defaultSaveAutoClawConnection({ tokens, email, deviceId, balance }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    deviceId,
    loginEmail: email,
    balance,
    automation: "gsuite-bulk",
  };

  const connection = await createProviderConnection({
    provider: AUTOCLAW_PROVIDER_ID,
    authType: "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || "",
    email,
    displayName: email?.split?.("@")?.[0] || email,
    providerSpecificData,
    expiresAt: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null,
    testStatus: "active",
  });

  return { connection };
}

async function defaultBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "chromium",
    proxyUrl: job?.proxyUrl || undefined,
  });
}

async function requestAutoClawOAuthUrl(deviceId, proxyOptions = null) {
  const response = await proxyAwareFetch(AUTOCLAW_GOOGLE_OAUTH_URL, {
    method: "POST",
    headers: buildAutoClawAuthHeaders(),
    body: JSON.stringify({
      device_id: deviceId,
      source_id: "web",
      navigate_uri: AUTOCLAW_REDIRECT_URI,
      client_type: "web",
    }),
  }, proxyOptions);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 429 || isAutoClawRateLimitMessage(text)) {
      throw makeAutoClawRateLimitError(text || `AutoClaw OAuth URL request was rate limited (${response.status})`);
    }
    throw new Error(`AutoClaw OAuth URL request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = await response.json().catch(() => null);
  const oauthUrl = payload?.data?.oauth_url;
  if (payload?.code !== 0 || !oauthUrl) {
    const message = payload?.msg || payload?.message || "AutoClaw OAuth URL response did not include oauth_url";
    if (isAutoClawRateLimitMessage(message)) throw makeAutoClawRateLimitError(message);
    throw new Error(message);
  }

  return {
    oauthUrl,
    state: payload?.data?.state || null,
  };
}

async function fetchAutoClawBalance(accessToken, proxyOptions = null) {
  if (!accessToken) return null;
  try {
    const headers = buildAutoClawAuthHeaders();
    headers.authorization = normalizeAutoClawBearerToken(accessToken);
    const response = await proxyAwareFetch(AUTOCLAW_WALLET_URL, {
      method: "GET",
      headers,
    }, proxyOptions);
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (payload?.code !== 0) return null;
    const balance = Number(payload?.data?.total_balance);
    return Number.isFinite(balance) ? balance : null;
  } catch {
    return null;
  }
}

function createAutoClawTokenMonitor({ context, page, timeoutMs = AUTOCLAW_MANUAL_TIMEOUT_MS } = {}) {
  let settled = false;
  const cleanups = [];
  let rebind = () => {};

  const promise = new Promise((resolve, reject) => {
    const cleanup = () => {
      while (cleanups.length) {
        const fn = cleanups.pop();
        try { fn(); } catch {}
      }
    };

    const settle = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const bindPage = (trackedPage) => {
      if (!trackedPage?.on) return;
      const onResponse = async (response) => {
        try {
          const url = typeof response.url === "function" ? response.url() : response.url;
          if (!url) return;
          if (!url.includes("/userapi/v1/refresh") && !url.includes("/userapi/overseasv1/google-oauth-login")) return;
          const payload = await response.json();
          const tokens = normalizeTokenData(payload);
          if (tokens) settle({ tokens });
        } catch {
          // Ignore unrelated or unreadable browser responses.
        }
      };
      trackedPage.on("response", onResponse);
      cleanups.push(() => trackedPage.off?.("response", onResponse));
    };

    const bindContext = (trackedContext, initialPage) => {
      if (trackedContext?.on) {
        const onPage = (newPage) => bindPage(newPage);
        trackedContext.on("page", onPage);
        cleanups.push(() => trackedContext.off?.("page", onPage));
      }
      bindPage(initialPage);
    };

    bindContext(context, page);
    const timer = setTimeout(() => fail(new Error("Timed out waiting for AutoClaw tokens")), timeoutMs);
    cleanups.push(() => clearTimeout(timer));

    rebind = ({ context: nextContext, page: nextPage } = {}) => {
      if (settled) return;
      bindContext(nextContext, nextPage);
    };
  });
  promise.rebind = (args) => rebind(args);

  return promise;
}

export class AutoClawBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher = defaultBrowserLauncher,
    googleAutomation = runGoogleAccountAutomation,
    saveConnection = defaultSaveAutoClawConnection,
    storageName = "autoclaw-bulk-import",
    deviceIdFactory = randomUUID,
    oauthUrlRequest = requestAutoClawOAuthUrl,
    oauthRequestMinIntervalMs = getDefaultOAuthRequestMinIntervalMs(),
    oauthRateLimitRetries = AUTOCLAW_OAUTH_RATE_LIMIT_RETRIES,
    oauthRateLimitInitialBackoffMs = AUTOCLAW_OAUTH_RATE_LIMIT_INITIAL_BACKOFF_MS,
    sleepFn = sleep,
  } = {}) {
    super({
      browserLauncher,
      googleAutomation: null,
      socialExchange: null,
      storageName,
    });
    this.googleAutomation = googleAutomation;
    this.saveConnection = saveConnection;
    this.deviceIdFactory = deviceIdFactory;
    this.oauthUrlRequest = oauthUrlRequest;
    this.oauthRequestMinIntervalMs = oauthRequestMinIntervalMs;
    this.oauthRateLimitRetries = oauthRateLimitRetries;
    this.oauthRateLimitInitialBackoffMs = oauthRateLimitInitialBackoffMs;
    this.sleep = sleepFn;
    this.oauthRequestQueue = Promise.resolve();
    this.nextOAuthRequestAt = 0;
  }

  async waitForOAuthRequestSlot() {
    const waitMs = Math.max(0, this.nextOAuthRequestAt - Date.now());
    if (waitMs > 0) await this.sleep(waitMs);
    this.nextOAuthRequestAt = Date.now() + Math.max(0, this.oauthRequestMinIntervalMs || 0);
  }

  async requestOAuthUrlWithRetry(job, account, deviceId, proxyOptions) {
    let attempt = 0;
    while (true) {
      await this.waitForOAuthRequestSlot();
      try {
        return await this.oauthUrlRequest(deviceId, proxyOptions);
      } catch (error) {
        if (error?.code !== "AUTOCLAW_RATE_LIMIT" || attempt >= this.oauthRateLimitRetries) throw error;
        const delayMs = this.oauthRateLimitInitialBackoffMs * (attempt + 1);
        this.setAccountStep(
          account,
          "rate_limited",
          `AutoClaw rate-limited OAuth URL requests; retrying in ${Math.ceil(delayMs / 1000)}s`,
          "warning"
        );
        await this.persistJobSnapshot(job, { forcePreview: true });
        await this.sleep(delayMs);
        attempt += 1;
      }
    }
  }

  async queueOAuthUrlRequest(job, account, deviceId, proxyOptions) {
    const run = this.oauthRequestQueue
      .catch(() => null)
      .then(() => this.requestOAuthUrlWithRetry(job, account, deviceId, proxyOptions));
    this.oauthRequestQueue = run.catch(() => null);
    return run;
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested || !browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const deviceId = this.deviceIdFactory();
    const proxyUrl = browser.__ninerouterProxyUrl || job.proxyUrl || null;
    const proxyOptions = proxyOptionsFromUrl(proxyUrl);
    const { context, page } = await createFreshContext(browser);
    account.runtimeSession = { context, page, proxyUrl };

    let tokenPromise = null;
    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} preparing AutoClaw Google OAuth`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      const { oauthUrl } = await this.queueOAuthUrlRequest(job, account, deviceId, proxyOptions);
      tokenPromise = createAutoClawTokenMonitor({ context, page });

      const automationResult = await this.googleAutomation({
        page,
        authUrl: oauthUrl,
        email: account.email,
        password: account.password,
        successPromise: tokenPromise,
        shortTimeoutMs: AUTOCLAW_POLL_TIMEOUT_MS,
        serviceLabel: AUTOCLAW_LABEL,
        openingStep: "opening_autoclaw_google_oauth",
        openingMessage: "Opening AutoClaw Google OAuth page",
        successStep: "autoclaw_token_received",
        successMessage: "AutoClaw tokens received",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        await this.saveSuccessfulConnection(job, account, context, {
          tokens: automationResult.tokens || automationResult,
          deviceId,
          proxyOptions,
        });
        return;
      }

      if (automationResult.status === "needs_manual") {
        account.manualSession = {
          context,
          page,
          opened: false,
          openedAt: null,
          rebind: tokenPromise?.rebind,
          proxyUrl,
        };
        this.setAccountStep(account, "awaiting_manual", "Waiting for manual completion");
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
        await this.runAutoClawManualFollowup(job, account, context, tokenPromise, deviceId, proxyOptions);
        return;
      }

      const terminalStatus = automationResult.status?.startsWith("failed") ? automationResult.status : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "AutoClaw Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "AutoClaw Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected AutoClaw bulk import failure.",
        step: "failed",
        message: error.message || "Unexpected AutoClaw bulk import failure.",
      });
      account.runtimeSession = null;
      await context?.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }

  async saveSuccessfulConnection(job, account, context, { tokens, deviceId, proxyOptions }) {
    const normalized = tokens?.accessToken ? tokens : normalizeTokenData(tokens);
    if (!normalized?.accessToken) {
      throw new Error("AutoClaw token capture returned no access token");
    }

    this.setAccountStep(account, "checking_balance", "Checking AutoClaw balance");
    await this.persistJobSnapshot(job, { forcePreview: true });
    const balance = await fetchAutoClawBalance(normalized.accessToken, proxyOptions);

    this.setAccountStep(account, "saving_connection", "Saving AutoClaw connection");
    await this.persistJobSnapshot(job, { forcePreview: true });
    const { connection } = await this.saveConnection({
      tokens: normalized,
      email: account.email,
      deviceId,
      balance,
    });

    const balanceLabel = balance === null ? "" : ` (${balance} points)`;
    this.finalizeAccount(account, "success", {
      connectionId: connection.id,
      step: "connection_saved",
      message: `AutoClaw connection saved successfully${balanceLabel}`,
    });
    account.runtimeSession = null;
    await context.close().catch(() => null);
    await this.persistJobSnapshot(job, { forcePreview: true });
  }

  async runAutoClawManualFollowup(job, account, context, tokenPromise, deviceId, proxyOptions) {
    const followupPromise = (async () => {
      const closeManualResources = async () => {
        const ms = account.manualSession;
        const ctx = ms?.context || context;
        const headed = ms?.headedBrowser || null;
        if (ctx) await ctx.close().catch(() => null);
        if (headed) await headed.close().catch(() => null);
      };
      try {
        const result = await tokenPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        await this.saveSuccessfulConnection(job, account, context, {
          tokens: result.tokens || result,
          deviceId,
          proxyOptions,
        });
      } catch (error) {
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
        } else {
          this.finalizeAccount(account, "failed", {
            error: error.message || "Manual assist flow failed.",
            step: "failed",
            message: error.message || "Manual assist flow failed.",
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
}

function getSingletonStore() {
  if (!globalThis.__autoClawBulkImportSingleton) {
    globalThis.__autoClawBulkImportSingleton = {
      manager: new AutoClawBulkImportManager(),
    };
  }
  return globalThis.__autoClawBulkImportSingleton;
}

export function getAutoClawBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildAutoClawAuthHeaders,
  buildLookupResponse,
  parseKiroBulkAccounts as parseAutoClawBulkAccounts,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
};

export const __test__ = {
  createAutoClawTokenMonitor,
  requestAutoClawOAuthUrl,
  fetchAutoClawBalance,
  normalizeTokenData,
};
