import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
} from "./kiroBulkImportManager.js";
import { FiveSimClient } from "./fiveSimClient.js";
import {
  createCodeBuddyCnApiKey,
  generateCodeBuddyCnKeyName,
  runCodeBuddyCnPhoneLogin,
} from "./codebuddyCnPhoneAutomation.js";

const PROVIDER_ID = "codebuddy-cn";
const DEFAULT_COUNT = 1;
const MAX_COUNT = 8;
const OTP_POLL_TIMEOUT_MS = 150_000;
const OTP_POLL_INTERVAL_MS = 5_000;
const MAX_PHONE_NUMBER_ATTEMPTS = 5;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableOtpError(error) {
  if (/Timed out waiting for 5sim OTP code|5sim returned no OTP code/i.test(error?.message || "")) return true;
  const status = Number(error?.status || 0);
  if (!status || status === 408 || status === 425 || status === 429 || status >= 500) return true;
  return false;
}

function isFiveSimCooldownError(error) {
  return error?.code === "FIVE_SIM_COOLDOWN" || Number(error?.status || 0) === 444;
}

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, parsed));
}

async function defaultSaveConnection({ apiKey, keyMeta, label, phone }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const connection = await createProviderConnection({
    provider: PROVIDER_ID,
    authType: "apikey",
    name: keyMeta?.name || label,
    apiKey,
    email: label,
    providerSpecificData: {
      automation: "5sim-phone",
      phone,
      codebuddyApiKeyId: keyMeta?.id || null,
      codebuddyApiKeyName: keyMeta?.name || null,
      codebuddyApiKeyExpiresAt: keyMeta?.expiresAt || null,
    },
    testStatus: "active",
  });
  return { connection };
}

export class CodeBuddyCnPhoneImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher,
    fiveSimClientFactory = (options) => new FiveSimClient(options),
    phoneLoginFn = runCodeBuddyCnPhoneLogin,
    createApiKeyFn = createCodeBuddyCnApiKey,
    saveConnection = defaultSaveConnection,
  } = {}) {
    super({
      browserLauncher,
      storageName: "codebuddy-cn-phone-import",
    });
    this.fiveSimClientFactory = fiveSimClientFactory;
    this.phoneLogin = phoneLoginFn;
    this.createApiKey = createApiKeyFn;
    this.saveConnection = saveConnection;
  }

  async startJob({ fiveSimToken, count, concurrency, engine, proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, country, operator, product }) {
    const token = String(fiveSimToken || "").trim();
    if (!token) throw new Error("5sim API token is required");
    const total = clampCount(count);
    const accounts = Array.from({ length: total }, (_, index) => `codebuddy-cn-${index + 1}@5sim.local|${token}`);
    const job = await super.startJob({
      accounts,
      concurrency,
      engine,
      proxyUrl,
      proxyUrls,
      proxyMode,
      proxyPoolId,
      proxySource,
      jobFields: {
        fiveSim: {
          country: country || "hongkong",
          operator: operator || "any",
          product: product || "codebuddy",
        },
      },
    });
    return job;
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested || !browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const fresh = await createFreshContext(browser);
    const { context } = fresh;
    let page = fresh.page;
    const workerProxyUrl = browser.__ninerouterProxyUrl || job.proxyUrl || null;
    account.runtimeSession = { context, page, proxyUrl: workerProxyUrl };
    const fiveSim = this.fiveSimClientFactory({ token: account.password, proxyUrl: workerProxyUrl });
    let order = null;

    try {
      const fiveSimConfig = job.fiveSim || {};
      const country = fiveSimConfig.country || "hongkong";
      const operator = fiveSimConfig.operator || "any";
      const product = fiveSimConfig.product || "codebuddy";
      let loginResult = null;
      let attempt = 1;
      while (!job.cancelRequested && attempt <= MAX_PHONE_NUMBER_ATTEMPTS) {
        try {
          this.setAccountStep(
            account,
            "buying_5sim_number",
            `Buying 5sim ${product} number in ${country} (${operator === "any" ? "any operator" : operator})${attempt > 1 ? `, attempt ${attempt}` : ""}`
          );
          await this.persistJobSnapshot(job, { forcePreview: true });
          order = await fiveSim.buyActivation(fiveSimConfig);
          account.email = order.phone || account.email;

          loginResult = await this.phoneLogin({
            page,
            phone: order.phone,
            codeProvider: () => fiveSim.waitForCode(order.id, {
              timeoutMs: OTP_POLL_TIMEOUT_MS,
              pollIntervalMs: OTP_POLL_INTERVAL_MS,
            }),
            onStep: (step, message) => {
              this.setAccountStep(account, step, message);
              void this.persistJobSnapshot(job, { forcePreview: false });
            },
          });
          break;
        } catch (error) {
          if (error.status === "needs_manual") throw error;
          if (order?.id) await fiveSim.cancelOrder(order.id).catch(() => null);
          order = null;
          if (!workerProxyUrl && isFiveSimCooldownError(error)) {
            error.step = "five_sim_cooldown";
            error.message = error.message || "5sim temporarily banned this IP/API key; wait 10 minutes before retrying.";
            throw error;
          }
          if (!isRetryableOtpError(error) || attempt >= MAX_PHONE_NUMBER_ATTEMPTS) throw error;
          this.setAccountStep(
            account,
            workerProxyUrl ? "retrying_5sim_proxy_route" : "retrying_5sim_number",
            workerProxyUrl
              ? `Automation failed through the configured rotating proxy; retrying with a fresh browser page (${attempt + 1}/${MAX_PHONE_NUMBER_ATTEMPTS})`
              : `OTP did not arrive, buying a fresh 5sim number (${attempt + 1}/${MAX_PHONE_NUMBER_ATTEMPTS})`
          );
          await page.close?.().catch(() => null);
          page = await context.newPage();
          account.runtimeSession = { context, page, proxyUrl: workerProxyUrl };
          attempt += 1;
        }
      }

      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: "Job cancelled while retrying CodeBuddy CN phone automation",
        });
        return;
      }

      if (!loginResult) throw new Error("CodeBuddy CN phone login did not complete");

      const keyMeta = await this.createApiKey(page, (step, message) => {
        this.setAccountStep(account, step, message);
        void this.persistJobSnapshot(job, { forcePreview: false });
      });

      this.setAccountStep(account, "saving_connection", "Saving CodeBuddy CN generated API key");
      const label = loginResult.webEmail || `phone:${order.phone}`;
      const { connection } = await this.saveConnection({
        apiKey: keyMeta.key,
        keyMeta,
        label,
        phone: order.phone,
      });

      await fiveSim.finishOrder(order.id).catch(() => null);
      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: "CodeBuddy CN connection saved with generated API key",
      });
    } catch (error) {
      if (order?.id) await fiveSim.cancelOrder(order.id).catch(() => null);
      if (error.status === "needs_manual") {
        account.manualSession = {
          context,
          page,
          opened: false,
          openedAt: null,
          proxyUrl: workerProxyUrl,
        };
      }
      const terminalStatus = typeof error.status === "string" ? error.status : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: error.message || "CodeBuddy CN phone automation failed",
        step: error.step || "failed",
        message: error.message || "CodeBuddy CN phone automation failed",
      });
      if (error.status === "needs_manual") {
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }
    } finally {
      account.password = undefined;
      if (account.status !== "needs_manual") {
        account.runtimeSession = null;
        await context.close().catch(() => null);
      }
      await this.persistJobSnapshot(job, { forcePreview: true });
      await wait(10);
    }
  }

  async runJob(jobId) {
    await super.runJob(jobId);
    const job = this.jobs.get(jobId);
    if (!job || job.cancelRequested) return;
    if (job.accounts.some((account) => account.status === "needs_manual")) {
      job.status = "needs_manual";
      job.finishedAt = null;
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__codeBuddyCnPhoneImportSingleton) {
    globalThis.__codeBuddyCnPhoneImportSingleton = {
      manager: new CodeBuddyCnPhoneImportManager(),
    };
  }
  return globalThis.__codeBuddyCnPhoneImportSingleton;
}

export function getCodeBuddyCnPhoneImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  generateCodeBuddyCnKeyName,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as CODEBUDDY_CN_PHONE_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as CODEBUDDY_CN_PHONE_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as CODEBUDDY_CN_PHONE_IMPORT_MIN_CONCURRENCY,
};
