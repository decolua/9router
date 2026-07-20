import {
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
} from "./kiroBulkImportManager.js";
import {
  createOAuthCallbackMonitor,
  runGoogleAccountAutomation,
} from "./googleAutomation.js";
import { generateAuthData } from "../providers.js";
import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth.js";

const ANTIGRAVITY_PROVIDER_ID = "antigravity";
const ANTIGRAVITY_LABEL = "Antigravity";
const ANTIGRAVITY_CALLBACK_TIMEOUT_MS = 8 * 60_000;
const ANTIGRAVITY_SHORT_TIMEOUT_MS = 3 * 60_000;
const ANTIGRAVITY_DASHBOARD_CALLBACK_PORT = process.env.PORT || "20128";

function buildLoopbackRedirectUri() {
  return `http://localhost:${ANTIGRAVITY_DASHBOARD_CALLBACK_PORT}/callback`;
}

function isLoopbackCallbackForState(rawUrl, expectedState) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:") return false;
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return false;
    if (url.pathname !== "/callback") return false;
    if (!url.searchParams.has("code") && !url.searchParams.has("error")) return false;
    return !expectedState || url.searchParams.get("state") === expectedState;
  } catch {
    return false;
  }
}

function createAntigravityAuthUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_CONFIG.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: ANTIGRAVITY_CONFIG.scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return `${ANTIGRAVITY_CONFIG.authorizeUrl}?${params.toString()}`;
}

async function buildDashboardAntigravityAuthData(redirectUri) {
  const appPort = ANTIGRAVITY_DASHBOARD_CALLBACK_PORT;
  const authorizeUrl = new URL(`http://localhost:${appPort}/api/oauth/${ANTIGRAVITY_PROVIDER_ID}/authorize`);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);

  try {
    const response = await fetch(authorizeUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Dashboard authorize failed: HTTP ${response.status}`);
    const data = await response.json();
    if (!data?.authUrl || !data?.state) throw new Error("Dashboard authorize response missing authUrl/state");
    return data;
  } catch {
    return generateAuthData(ANTIGRAVITY_PROVIDER_ID, redirectUri);
  }
}

async function defaultAntigravityBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "chromium",
    proxyUrl: job?.proxyUrl || undefined,
    headless: false,
    args: ["--start-maximized"],
  });
}

async function exchangeAntigravityCode(code, redirectUri) {
  const response = await fetch(ANTIGRAVITY_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: ANTIGRAVITY_CONFIG.clientId,
      client_secret: ANTIGRAVITY_CONFIG.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

async function fetchAntigravityUserInfo(accessToken) {
  const response = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "x-request-source": "local",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get user info: ${error}`);
  }

  return response.json();
}

function getAntigravityApiHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
    "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
    "Client-Metadata": ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata,
    "x-request-source": "local",
  };
}

async function loadAntigravityCodeAssist(accessToken) {
  const response = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
    method: "POST",
    headers: getAntigravityApiHeaders(accessToken),
    body: JSON.stringify({ metadata: getOAuthClientMetadata() }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load code assist: ${errorText}`);
  }

  const data = await response.json();
  let projectId = data.cloudaicompanionProject;
  if (typeof projectId === "object" && projectId !== null && projectId.id) {
    projectId = projectId.id;
  }

  let tierId = "legacy-tier";
  if (Array.isArray(data.allowedTiers)) {
    for (const tier of data.allowedTiers) {
      if (tier.isDefault && tier.id) {
        tierId = tier.id.trim();
        break;
      }
    }
  }

  return { projectId, tierId, raw: data };
}

async function onboardAntigravityUser(accessToken, projectId, tierId, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i += 1) {
    const response = await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
      method: "POST",
      headers: getAntigravityApiHeaders(accessToken),
      body: JSON.stringify({ tierId, metadata: getOAuthClientMetadata() }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to onboard user: ${errorText}`);
    }

    const result = await response.json();
    if (result.done === true) {
      let finalProjectId = projectId;
      if (result.response?.cloudaicompanionProject) {
        const responseProject = result.response.cloudaicompanionProject;
        if (typeof responseProject === "string") {
          finalProjectId = responseProject.trim();
        } else if (responseProject.id) {
          finalProjectId = responseProject.id.trim();
        }
      }
      return { success: true, projectId: finalProjectId };
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error("Antigravity onboarding timeout - please try again");
}

async function defaultSaveAntigravityConnection({ tokens, email, projectId, userInfo }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    loginEmail: email,
    automation: "gsuite-bulk",
    ...(userInfo?.id ? { googleUserId: userInfo.id } : {}),
    ...(userInfo?.verified_email !== undefined ? { verifiedEmail: Boolean(userInfo.verified_email) } : {}),
  };

  const connectionData = {
    provider: ANTIGRAVITY_PROVIDER_ID,
    authType: "oauth",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    email: userInfo?.email || email,
    displayName: userInfo?.name || userInfo?.email || email,
    projectId,
    providerSpecificData,
    expiresAt: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
    testStatus: "active",
  };

  const connection = await createProviderConnection(connectionData);
  return { connection };
}

async function exchangeAndSaveAntigravityConnection({
  callback,
  redirectUri,
  email,
  saveConnection,
  onStep,
}) {
  if (callback?.error) {
    throw new Error(callback.errorDescription || callback.error || "Antigravity OAuth failed");
  }
  if (!callback?.code) {
    throw new Error("Antigravity callback did not include an authorization code");
  }

  onStep?.("exchanging_antigravity_tokens", "Exchanging Antigravity OAuth code");
  const tokens = await exchangeAntigravityCode(callback.code, redirectUri);

  onStep?.("fetching_antigravity_profile", "Fetching Google account profile");
  const userInfo = await fetchAntigravityUserInfo(tokens.access_token);

  onStep?.("loading_antigravity_code_assist", "Loading Antigravity Code Assist project");
  let projectId = "";
  let tierId = "legacy-tier";
  try {
    const codeAssist = await loadAntigravityCodeAssist(tokens.access_token);
    projectId = codeAssist.projectId || "";
    tierId = codeAssist.tierId || tierId;
  } catch {
    projectId = "";
  }
  let finalProjectId = projectId || "";
  if (projectId) {
    onStep?.("onboarding_antigravity", "Onboarding Antigravity Code Assist");
    try {
      const onboardResult = await onboardAntigravityUser(tokens.access_token, projectId, tierId);
      finalProjectId = onboardResult.projectId || projectId;
    } catch {
      finalProjectId = projectId;
    }
  } else {
    onStep?.("saving_connection", "Saving Antigravity connection without project ID");
  }

  onStep?.("saving_connection", "Saving Antigravity connection");
  return saveConnection({
    tokens,
    email,
    userInfo,
    projectId: finalProjectId,
  });
}

export class AntigravityBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher = defaultAntigravityBrowserLauncher,
    googleAutomation = runGoogleAccountAutomation,
    saveConnection = defaultSaveAntigravityConnection,
    storageName = "antigravity-bulk-import",
  } = {}) {
    super({
      browserLauncher,
      googleAutomation,
      socialExchange: null,
      storageName,
    });
    this.saveConnection = saveConnection;
  }

  async runManualFollowup(job, account, workerId, context, callbackPromise, redirectUri) {
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

        const { connection } = await exchangeAndSaveAntigravityConnection({
          callback,
          redirectUri,
          email: account.email,
          saveConnection: this.saveConnection,
          onStep: (step, message) => {
            this.setAccountStep(account, step, message);
            void this.persistJobSnapshot(job, { forcePreview: false });
          },
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Antigravity connection saved successfully",
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

    const redirectUri = buildLoopbackRedirectUri();
    const authData = await buildDashboardAntigravityAuthData(redirectUri);
    const state = authData.state;
    const authUrl = authData.authUrl;
    const { context, page } = await createFreshContext(browser);
    const callbackPromise = createOAuthCallbackMonitor(context, page, {
      timeoutMs: ANTIGRAVITY_CALLBACK_TIMEOUT_MS,
      timeoutMessage: "Timed out waiting for Antigravity callback",
      predicate: (rawUrl) => isLoopbackCallbackForState(rawUrl, state),
    });
    account.runtimeSession = { context, page, proxyUrl: browser.__ninerouterProxyUrl || job.proxyUrl || null };

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} is preparing an Antigravity browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      const automationResult = await this.googleAutomation({
        page,
        authUrl,
        email: account.email,
        password: account.password,
        successPromise: callbackPromise,
        shortTimeoutMs: ANTIGRAVITY_SHORT_TIMEOUT_MS,
        serviceLabel: ANTIGRAVITY_LABEL,
        openingStep: "opening_antigravity_oauth",
        openingMessage: "Opening Antigravity Google OAuth page",
        successStep: "antigravity_callback_received",
        successMessage: "Antigravity OAuth callback received",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        const { connection } = await exchangeAndSaveAntigravityConnection({
          callback: automationResult,
          redirectUri,
          email: account.email,
          saveConnection: this.saveConnection,
          onStep: (step, message) => {
            this.setAccountStep(account, step, message);
            void this.persistJobSnapshot(job, { forcePreview: false });
          },
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Antigravity connection saved successfully",
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
        await this.runManualFollowup(job, account, workerId, context, callbackPromise, redirectUri);
        return;
      }

      const terminalStatus = automationResult.status?.startsWith("failed") ? automationResult.status : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "Antigravity Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "Antigravity Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: "Job cancelled while Antigravity automation was running",
        });
      } else {
        this.finalizeAccount(account, error.status || "failed", {
          error: error.message || "Unexpected Antigravity bulk import failure.",
          step: error.step || "failed",
          message: error.message || "Unexpected Antigravity bulk import failure.",
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
  if (!globalThis.__antigravityBulkImportSingleton) {
    globalThis.__antigravityBulkImportSingleton = {
      manager: new AntigravityBulkImportManager(),
    };
  }
  return globalThis.__antigravityBulkImportSingleton;
}

export function getAntigravityBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  buildDashboardAntigravityAuthData,
  defaultAntigravityBrowserLauncher,
  exchangeAndSaveAntigravityConnection,
  buildLoopbackRedirectUri,
  createAntigravityAuthUrl,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
};
