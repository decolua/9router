import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
} from "./kiroBulkImportManager.js";
import { runGoogleAccountAutomation } from "./kiroGoogleAutomation.js";
import { QoderService } from "./qoder.js";

const QODER_PROVIDER_ID = "qoder";
const QODER_LABEL = "Qoder";
const QODER_POLL_TIMEOUT_MS = 5 * 60_000;
const QODER_POLL_INTERVAL_MS = 2_000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultSaveQoderConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");

  const providerSpecificData = {
    authMethod: "device",
    userId: tokens._qoderUserId || "",
    machineId: tokens._qoderMachineId || "",
    organizationId: tokens._qoderOrganizationId || "",
    planTier: tokens._qoderPlanTier || "free",
    automation: "gsuite-bulk",
  };

  const minSeconds = 24 * 60 * 60;
  const remainingSeconds = Math.floor((tokens.expireTime - Date.now()) / 1000);
  const expiresIn = Math.max(minSeconds, remainingSeconds);

  const rawEmail = (tokens._qoderEmail || "").trim();
  const displayName = (tokens._qoderName || "").trim() || null;
  const userId = tokens._qoderUserId || "";
  const resolvedEmail = rawEmail || (userId ? `qoder-user-${userId}` : email);

  const connection = await createProviderConnection({
    provider: QODER_PROVIDER_ID,
    authType: "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || null,
    expiresIn,
    email: resolvedEmail,
    displayName,
    providerSpecificData,
    testStatus: "active",
  });

  return { connection };
}

function createQoderPollPromise({
  nonce,
  codeVerifier,
  onStep,
  timeoutMs = QODER_POLL_TIMEOUT_MS,
  pollIntervalMs = QODER_POLL_INTERVAL_MS,
}) {
  const svc = new QoderService();

  return (async () => {
    const startedAt = Date.now();
    let lastStepAt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (Date.now() - lastStepAt > pollIntervalMs - 100) {
        onStep?.("polling_qoder_token", "Waiting for Qoder device token");
        lastStepAt = Date.now();
      }

      let result;
      try {
        result = await svc.pollDeviceToken({ nonce, codeVerifier });
      } catch (err) {
        throw new Error(`Qoder device token poll failed: ${err.message}`);
      }

      if (result.status === "ok") {
        const userInfo = await svc.fetchUserInfo(result.accessToken);
        const userPlan = await svc.fetchUserPlan(result.accessToken);
        return {
          tokens: {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expireTime: result.expireTime,
            _qoderUserId: result.userId,
            _qoderName: userInfo.name,
            _qoderEmail: userInfo.email,
            _qoderOrganizationId: userInfo.organizationId,
            _qoderPlanTier: userPlan.planTier,
          },
        };
      }

      await wait(pollIntervalMs);
    }

    throw new Error("Timed out waiting for Qoder device token");
  })();
}

export class QoderBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher,
    googleAutomation = runGoogleAccountAutomation,
    saveConnection = defaultSaveQoderConnection,
  } = {}) {
    super({
      browserLauncher,
      googleAutomation,
      storageName: "qoder-bulk-import",
      providerId: "qoder",
    });
    this.saveConnection = saveConnection;
  }

  async processAccount(job, account, workerId) {
    if (job.cancelRequested || !job.browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const { context, page } = await createFreshContext(job.browser);
    account.runtimeSession = { context, page };

    try {
      this.setAccountStep(
        account,
        "preparing_worker",
        `Worker ${workerId} is preparing a browser context`,
      );
      await this.persistJobSnapshot(job, { forcePreview: true });

      this.setAccountStep(
        account,
        "initiating_device_flow",
        "Initiating Qoder device flow",
      );
      const qoderService = new QoderService();
      const flow = qoderService.initiateDeviceFlow();

      const authUrl = flow.verificationUriComplete;
      if (!authUrl) {
        throw new Error("Qoder did not return a device login URL");
      }

      const successPromise = createQoderPollPromise({
        nonce: flow.nonce,
        codeVerifier: flow.codeVerifier,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      const automationResult = await this.googleAutomation({
        page,
        authUrl,
        email: account.email,
        password: account.password,
        successPromise,
        serviceLabel: QODER_LABEL,
        openingStep: "opening_qoder_device_page",
        openingMessage: "Opening Qoder device login page",
        successStep: "qoder_token_received",
        successMessage: "Qoder device token received",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        const tokenData = automationResult.tokenData || automationResult;
        let displayName = "";
        let organizationId = "";
        let planTier = "";

        this.setAccountStep(
          account,
          "fetching_profile",
          "Fetching Qoder profile",
        );
        await this.persistJobSnapshot(job, { forcePreview: true });
        try {
          const userInfo = await qoderService.fetchUserInfo(
            tokenData.accessToken,
          );
          displayName = userInfo.name || userInfo.email || "";
          organizationId = userInfo.organizationId || "";
        } catch {}

        this.setAccountStep(
          account,
          "checking_plan",
          "Checking plan & activating trial via browser session",
        );
        await this.persistJobSnapshot(job, { forcePreview: true });
        try {
          const plan = await Promise.race([
            page.evaluate(async () => {
              try {
                const r = await fetch("https://qoder.com/api/v1/me/userplan", {
                  credentials: "include",
                  headers: { accept: "application/json" },
                });
                if (!r.ok) return null;
                return r.json();
              } catch {
                return null;
              }
            }),
            new Promise((resolve) => setTimeout(() => resolve(null), 10_000)),
          ]);
          planTier = plan?.plan_tier || plan?.plan_tier_name || "";
          const planStatus = plan?.status || "";
          this.setAccountStep(
            account,
            "plan_checked",
            `Plan: ${planTier || "unknown"} (${planStatus || "unknown"})`,
          );
          await this.persistJobSnapshot(job, { forcePreview: false });
        } catch {}

        this.setAccountStep(
          account,
          "saving_connection",
          "Saving Qoder connection to database",
        );
        await this.persistJobSnapshot(job, { forcePreview: true });

        const { connection } = await this.saveConnection({
          tokens: {
            ...tokenData,
            _qoderName: displayName,
            _qoderOrganizationId: organizationId,
            planTier,
          },
          email: account.email,
        });

        const planLabel = planTier ? ` (${planTier})` : "";
        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: `Qoder connection saved successfully${planLabel}`,
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

        const followupPromise = (async () => {
          try {
            const result = await successPromise;
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
              "saving_connection",
              "Saving Qoder connection",
            );
            await this.persistJobSnapshot(job, { forcePreview: true });

            const { connection } = await this.saveConnection({
              tokens: result.tokens,
              email: account.email,
            });

            this.finalizeAccount(account, "success", {
              connectionId: connection.id,
              step: "connection_saved",
              message: "Qoder connection saved successfully",
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
                  "Manual assist flow failed during token polling.",
                step: "exchange_failed",
                message:
                  error.message ||
                  "Manual assist flow failed during token polling.",
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
        return;
      }

      successPromise.catch(() => null);
      this.finalizeAccount(account, automationResult.status || "failed", {
        error: automationResult.error || "Qoder Google automation failed.",
        step: automationResult.status || "failed",
        message: automationResult.error || "Qoder Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      successPromise.catch(() => null);
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: "Job cancelled while Qoder automation was running",
        });
      } else {
        this.finalizeAccount(account, "failed", {
          error: error.message || "Unexpected Qoder bulk import failure.",
          step: "failed",
          message: error.message || "Unexpected Qoder bulk import failure.",
        });
      }
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__qoderBulkImportSingleton) {
    globalThis.__qoderBulkImportSingleton = {
      manager: new QoderBulkImportManager(),
    };
  }
  return globalThis.__qoderBulkImportSingleton;
}

export function getQoderBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as QODER_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as QODER_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as QODER_BULK_IMPORT_MIN_CONCURRENCY,
  parseKiroBulkAccounts as parseQoderBulkAccounts,
};
