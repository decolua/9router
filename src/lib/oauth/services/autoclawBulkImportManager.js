import crypto from "crypto";

import {
  BulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseBulkAccounts,
} from "./bulkImportManager.js";
import { runGoogleAccountAutomation } from "./googleAutomation.js";
import { AUTOCLOW_CONFIG } from "../constants/oauth.js";
import {
  startAutoClawProxy,
  registerAutoClawSession,
  getAutoClawSessionStatus,
  clearAutoClawSession,
  stopAutoClawProxy,
} from "../utils/server.js";

const AUTOCLOW_PROVIDER_ID = "autoclaw";
const AUTOCLOW_LABEL = "AutoClaw";
// Google OAuth Google-consent flow can stall; 3 min matches Qoder's ceiling.
const AUTOCLOW_TIMEOUT_MS = 3 * 60_000;

/**
 * Minimal AutoClaw API client for the bulk-import flow. We inline this rather
 * than reuse `./autoclaw.js` because the latter imports `../config/index.js`
 * (CLI-only getServerCredentials) which webpack cannot statically resolve in
 * the web bundle. The full AutoClawService stays available to the CLI.
 *
 * Exposes only the two calls the bulk worker needs:
 *   - requestOAuthUrl(deviceId) → { oauthUrl, state }
 *   - exchangeCode(code, state, deviceId) → { access_token, refresh_token, ... }
 *
 * All AutoClaw userapi calls require app-signing headers
 * (X-Auth-Appid / X-Auth-TimeStamp / X-Auth-Sign = md5(`${APP_ID}&${ts}&${APP_KEY}`)).
 */
class AutoClawApiClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.proxyUrl] Route API calls through this HTTP/HTTPS
   *   proxy so the client-connect IP AutoClaw sees matches the IP the browser
   *   worker uses. Without this, AutoClaw rejects with
   *   "client_connect_invalid_ip" because /google-oauth-url is called from the
   *   server IP but the browser navigates from the proxy IP.
   */
  constructor({ proxyUrl } = {}) {
    this.config = AUTOCLOW_CONFIG;
    this.proxyUrl = proxyUrl || null;
    this._dispatcher = null;
  }

  async getDispatcher() {
    if (!this.proxyUrl) return undefined;
    if (this._dispatcher) return this._dispatcher;
    const { ProxyAgent } = await import("undici");
    this._dispatcher = new ProxyAgent(this.proxyUrl);
    return this._dispatcher;
  }

  appHeaders() {
    const appId = this.config.appId;
    const appKey = this.config.appKey;
    const ts = String(Math.floor(Date.now() / 1000));
    const sign = crypto
      .createHash("md5")
      .update(`${appId}&${ts}&${appKey}`)
      .digest("hex");
    return {
      "X-Auth-Appid": appId,
      "X-Auth-TimeStamp": ts,
      "X-Auth-Sign": sign,
      "X-Product": "autoclaw",
      "X-Version": "1.9.1",
      "X-Tm": "win",
      "X-Trace-Id": crypto.randomUUID(),
      "Content-Type": "application/json",
    };
  }

  async requestOAuthUrl(deviceId) {
    const body = JSON.stringify({
      source_id: this.config.sourceId,
      device_id: deviceId,
      navigate_uri: this.config.redirectUri,
    });
    const dispatcher = await this.getDispatcher();
    console.log(
      `[autoclaw-bulk] requestOAuthUrl deviceId=${deviceId} proxy=${this.proxyUrl || "none"} url=${this.config.authorizeUrl}`,
    );
    const response = await fetch(this.config.authorizeUrl, {
      method: "POST",
      headers: this.appHeaders(),
      body,
      ...(dispatcher ? { dispatcher } : {}),
    });
    const text = await response.text();
    console.log(
      `[autoclaw-bulk] requestOAuthUrl response status=${response.status} body=${text.slice(0, 500)}`,
    );
    if (!response.ok) {
      throw new Error(
        `Failed to request AutoClaw OAuth URL: HTTP ${response.status} ${text}`,
      );
    }
    let resp;
    try {
      resp = JSON.parse(text);
    } catch {
      throw new Error(`AutoClaw OAuth URL non-JSON response: ${text}`);
    }
    if (resp.code != null && resp.code !== 0) {
      throw new Error(
        `AutoClaw OAuth URL error: code=${resp.code} msg=${resp.msg} full=${text}`,
      );
    }
    const data = resp.data || {};
    if (!data.oauth_url || !data.state) {
      throw new Error(
        `AutoClaw OAuth URL response missing oauth_url/state: ${JSON.stringify(data)}`,
      );
    }
    console.log(
      `[autoclaw-bulk] requestOAuthUrl success oauth_url=${data.oauth_url.slice(0, 80)}... state=${data.state.slice(0, 20)}...`,
    );
    return { oauthUrl: data.oauth_url, state: data.state };
  }

  async exchangeCode(code, state, deviceId) {
    const body = JSON.stringify({
      source_id: this.config.sourceId,
      device_id: deviceId,
      code,
      state,
      navigate_uri: this.config.redirectUri,
    });
    const dispatcher = await this.getDispatcher();
    console.log(
      `[autoclaw-bulk] exchangeCode deviceId=${deviceId} proxy=${this.proxyUrl || "none"} state=${state.slice(0, 20)}... code=${code.slice(0, 20)}...`,
    );
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: this.appHeaders(),
      body,
      ...(dispatcher ? { dispatcher } : {}),
    });
    const text = await response.text();
    console.log(
      `[autoclaw-bulk] exchangeCode response status=${response.status} body=${text.slice(0, 500)}`,
    );
    if (!response.ok) {
      throw new Error(
        `AutoClaw token exchange failed: HTTP ${response.status} ${text}`,
      );
    }
    let resp;
    try {
      resp = JSON.parse(text);
    } catch {
      throw new Error(`AutoClaw exchange non-JSON response: ${text}`);
    }
    if (resp.code != null && resp.code !== 0) {
      throw new Error(
        `AutoClaw login error: code=${resp.code} msg=${resp.msg} full=${text}`,
      );
    }
    const data = resp.data || {};
    if (!data.access_token) {
      throw new Error(
        `AutoClaw login response missing access_token: ${JSON.stringify(data)}`,
      );
    }
    return data;
  }
}

/**
 * Save AutoClaw connection to the 9router DB after a successful bulk login.
 * Mirrors AutoClawService.saveTokens() but writes via the local model layer
 * (we are already in-process — no need for the CLI HTTP round-trip).
 */
async function defaultSaveAutoClawConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");

  // JWT payload carries the authoritative device_id; prefer it over the
  // throwaway uuid we generated pre-login (refresh uses JWT's device_id).
  const jwtPayload = decodeJwt(tokens.accessToken);
  const deviceId = jwtPayload.device_id || tokens.deviceId;

  const connectionData = {
    provider: AUTOCLOW_PROVIDER_ID,
    authType: "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || "",
    email,
    providerSpecificData: {
      sourceId: "autoclaw",
      deviceId,
      automation: "gsuite-bulk",
    },
    // JWT exp is authoritative — convert to ISO for the DB.
    expiresAt: jwtPayload.exp
      ? new Date(jwtPayload.exp * 1000).toISOString()
      : null,
    testStatus: "active",
  };

  const connection = await createProviderConnection(connectionData);
  return { connection };
}

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const json = Buffer.from(
      payload + "=".repeat(-payload.length % 4),
      "base64url",
    ).toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * AutoClawBulkImportManager — Bulk Google OAuth login automation for AutoClaw.
 *
 * AutoClaw's Google client_id bakes the redirect URI to
 *   http://localhost:18432/auth/callback-google
 * which is a single fixed port — unlike Qoder's device-flow polling, AutoClaw
 * can't run parallel workers without port collisions. We therefore force
 * concurrency=1 here (one browser worker at a time).
 *
 * To avoid actually binding port 18432 (which would conflict with the desktop
 * app or another job), we intercept the redirect at the Playwright layer via
 * page.route(). When Google 302s to localhost:18432, the browser never makes
 * the real network call — we extract code/state from the URL and exchange
 * them via AutoClawService.exchangeCode(). This is identical on VPS and
 * local because the browser, route handler, and exchange call all live in the
 * same process.
 */
export class AutoClawBulkImportManager extends BulkImportManager {
  constructor({
    browserLauncher,
    saveConnection = defaultSaveAutoClawConnection,
    autoclawServiceFactory = (opts) => new AutoClawApiClient(opts),
    storageName = "autoclaw-bulk-import",
  } = {}) {
    super({ browserLauncher, storageName });
    this.saveConnection = saveConnection;
    this.autoclawServiceFactory = autoclawServiceFactory;
  }

  /**
   * Override startJob to hard-force concurrency=1. AutoClaw's Google OAuth
   * redirect is a single fixed port; parallel workers would collide.
   */
  async startJob({
    accounts,

    concurrency: _ignoredConcurrency,
    // AutoClaw selalu pakai camoufox (Firefox-based, anti-detect)
    engine: _ignoredEngine,
    proxyUrl,
    proxyPoolIds,
  }) {
    return super.startJob({
      accounts,
      // Always 1, regardless of caller value. AutoClaw's Google client_id
      // bakes the redirect port; concurrency > 1 would EADDRINUSE.
      concurrency: 1,
      engine: "camoufox",
      proxyUrl,
      proxyPoolIds,
    });
  }

  async processAccount(job, account, _workerId) {
    if (job.cancelRequested) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    // Pass the account's proxy URL to the AutoClaw API client. AutoClaw's
    // backend validates that the IP calling /google-oauth-url matches the IP
    // that visits the returned oauth_url — the browser worker uses proxyUrl,
    // so the API call must too, otherwise "client_connect_invalid_ip".
    const autoclawService = this.autoclawServiceFactory({
      proxyUrl: account.resolvedProxyUrl || null,
    });
    const deviceId = crypto.randomUUID();
    console.log(
      `[autoclaw-bulk] processAccount email=${account.email} proxy=${account.resolvedProxyUrl || "none"} deviceId=${deviceId}`,
    );

    // Placeholder rejector supaya cancelJob bisa dipanggil kapan saja,
    // bahkan sebelum successPromise dibuat.
    account._rejectTokens = () => {};

    // Step 1: ask AutoClaw for the Google consent URL + state.
    let oauthUrl;
    let state;
    try {
      this.setAccountStep(
        account,
        "requesting_oauth_url",
        "Requesting AutoClaw OAuth URL",
      );
      await this.persistJobSnapshot(job, { forcePreview: true });
      const urlResp = await autoclawService.requestOAuthUrl(deviceId);
      oauthUrl = urlResp.oauthUrl;
      state = urlResp.state;
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message,
        step: "request_oauth_url_failed",
        message: `AutoClaw OAuth URL request failed: ${error.message}`,
      });
      account.password = undefined;
      await this.persistJobSnapshot(job, { forcePreview: true });
      return;
    }

    // Step 2: start the real callback proxy on port 18432 + register session.
    // This is the SAME mechanism the manual Device OAuth flow uses (see
    // providers.js requestDeviceCode). The browser (camoufox) will navigate
    // to the Google consent URL; when Google 302s to localhost:18432, the
    // real HTTP proxy catches it and stashes {code, state} into the session.
    // We poll the session status in the background to detect the callback
    // and exchange the code for tokens.
    //
    // We previously tried page.route() to intercept the redirect at the
    // Playwright layer (no port binding), but camoufox/Playwright does not
    // reliably intercept navigations to localhost — the browser tries to
    // actually connect to port 18432, gets ECONNREFUSED (no server), and
    // AutoClaw's server-side IP validation rejects with
    // "client_connect_invalid_ip". Using the real proxy fixes this.
    try {
      registerAutoClawSession(state, deviceId);
      const proxyResult = await startAutoClawProxy();
      if (!proxyResult.success) {
        throw new Error(
          proxyResult.reason === "port_busy"
            ? "Port 18432 is already in use. Close the conflicting process (e.g. the AutoClaw desktop app) and retry."
            : `Failed to start callback proxy: ${proxyResult.reason}`,
        );
      }
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message,
        step: "proxy_start_failed",
        message: error.message,
      });
      account.password = undefined;
      await this.persistJobSnapshot(job, { forcePreview: true });
      return;
    }
    account._autoclawState = state;

    // Step 3: launch browser.
    const { launchBulkImportBrowser } =
      await import("./bulkImportBrowserEngine.js");
    let browser;
    let context;
    let page;
    try {
      browser = await launchBulkImportBrowser({
        engine: job.engine || "camoufox",
        proxyUrl: account.resolvedProxyUrl || undefined,
      });
      const fresh = await createFreshContext(browser);
      context = fresh.context;
      page = fresh.page;
    } catch (launchError) {
      stopAutoClawProxy();
      clearAutoClawSession(state);
      this.finalizeAccount(account, "failed", {
        error: launchError.message,
        step: "browser_launch_failed",
        message: `Browser launch failed: ${launchError.message}`,
      });
      account.password = undefined;
      await this.persistJobSnapshot(job, { forcePreview: true });
      return;
    }

    account.runtimeSession = { context, page, browser };

    // Step 4: successPromise + background poller.
    // The poller checks the proxy session for the callback code. When the
    // proxy catches Google's redirect, it sets session.status = "exchanging"
    // and session.code. We then exchange the code via AutoClaw's
    // google-oauth-login API and resolve successPromise with the tokens.
    let resolveTokens;
    let rejectTokens;
    const successPromise = new Promise((resolve, reject) => {
      resolveTokens = resolve;
      rejectTokens = reject;
    });
    account._rejectTokens = rejectTokens;

    const pollerPromise = (async () => {
      const deadline = Date.now() + AUTOCLOW_TIMEOUT_MS + 30_000;
      while (Date.now() < deadline) {
        if (job.cancelRequested) {
          rejectTokens(new Error("Job cancelled"));
          return;
        }
        const session = getAutoClawSessionStatus(state);
        if (!session) {
          // Session cleared externally — treat as error.
          rejectTokens(new Error("Callback session lost"));
          return;
        }
        if (session.status === "error") {
          clearAutoClawSession(state);
          rejectTokens(new Error(session.error || "Callback error"));
          return;
        }
        if (session.status === "exchanging" && session.code) {
          console.log(
            `[autoclaw-bulk] proxy caught callback for state=${state.slice(0, 20)}... code=${session.code.slice(0, 20)}...`,
          );
          // Proxy caught the redirect — exchange the code for tokens.
          try {
            const data = await autoclawService.exchangeCode(
              session.code,
              state,
              deviceId,
            );
            let accessToken = data.access_token || "";
            let refreshToken = data.refresh_token || "";
            if (accessToken.startsWith("Bearer "))
              accessToken = accessToken.slice(7);
            if (refreshToken.startsWith("Bearer "))
              refreshToken = refreshToken.slice(7);
            session.status = "done";
            session.tokens = { accessToken, refreshToken, deviceId };
            resolveTokens({
              accessToken,
              refreshToken,
              deviceId,
              userName: data.user_name,
              userId: data.user_id,
            });
            return;
          } catch (error) {
            session.status = "error";
            session.error = error.message;
            clearAutoClawSession(state);
            rejectTokens(error);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      rejectTokens(new Error("Callback timeout"));
    })();
    pollerPromise.catch(() => {});

    // Swallow dangling rejection when automation ends without success.
    successPromise.catch(() => {});

    try {
      this.setAccountStep(
        account,
        "opening_autoclaw_login",
        "Opening AutoClaw Google login page",
      );
      await this.persistJobSnapshot(job, { forcePreview: true });

      const automationResult = await runGoogleAccountAutomation({
        page,
        authUrl: oauthUrl,
        email: account.email,
        password: account.password,
        successPromise,
        shortTimeoutMs: AUTOCLOW_TIMEOUT_MS,
        serviceLabel: AUTOCLOW_LABEL,
        openingStep: "opening_autoclaw_login",
        openingMessage: "Opening AutoClaw Google login page",
        successStep: "autoclaw_token_received",
        successMessage: "AutoClaw tokens received",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: true });
        },
      });

      if (automationResult.status === "success") {
        const tokenData = automationResult;
        this.setAccountStep(
          account,
          "saving_connection",
          "Saving AutoClaw connection",
        );
        await this.persistJobSnapshot(job, { forcePreview: true });

        const { connection } = await this.saveConnection({
          tokens: tokenData,
          email: account.email,
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "AutoClaw connection saved successfully",
        });
      } else if (automationResult.status === "needs_manual") {
        account.manualSession = {
          context,
          page,
          browser,
          opened: false,
          openedAt: null,
        };
        this.setAccountStep(
          account,
          "awaiting_manual",
          "Waiting for manual completion",
        );
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });

        // Keep proxy alive for manual followup — don't stop it yet.
        await this.runAutoClawManualFollowup(job, account, successPromise);
        return;
      } else {
        const terminalStatus = automationResult.status?.startsWith("failed")
          ? automationResult.status
          : "failed";
        this.finalizeAccount(account, terminalStatus, {
          error: automationResult.error || "AutoClaw Google automation failed.",
          step: terminalStatus,
          message:
            automationResult.error || "AutoClaw Google automation failed.",
        });
      }
    } catch (error) {
      const isCancel = job.cancelRequested;
      this.finalizeAccount(account, isCancel ? "cancelled" : "failed", {
        error: isCancel
          ? "Job cancelled"
          : error.message || "Unexpected AutoClaw bulk failure.",
        step: isCancel ? "cancelled" : "failed",
        message: isCancel
          ? "Job cancelled while processing this account"
          : error.message || "Unexpected AutoClaw bulk failure.",
      });
    } finally {
      account.runtimeSession = null;
      account._rejectTokens = null;
      account._autoclawState = null;
      await context.close().catch(() => null);
      await browser.close().catch(() => null);
      stopAutoClawProxy();
      clearAutoClawSession(state);
      account.password = undefined;
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }

  /**
   * Override cancelJob to actively tear down in-flight browser sessions.
   *
   * The base implementation only sets a cancelRequested flag, which works for
   * providers whose processAccount polls in a loop. AutoClaw's processAccount
   * blocks inside runGoogleAccountAutomation (no cancel-aware polling), so a
   * cancel would otherwise not take effect until the 3-minute automation
   * timeout elapsed. Here we:
   *   1. Set the flag (base behavior).
   *   2. Reject each account's pending successPromise → unblocks the manual
   *      followup await and the automation race.
   *   3. Close the active browser/context → Playwright ops in
   *      runGoogleAccountAutomation throw, exiting the loop immediately.
   */
  async cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      // Job tidak di memory — kemungkinan instance berbeda (hot-reload dev
      // server) atau job sudah selesai. Base akan return persisted snapshot.
      // Untuk instance berbeda, worker di instance lama tidak bisa di-cancel
      // cross-process; restart server untuk clear.
      return super.cancelJob(jobId);
    }

    job.cancelRequested = true;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      job.accounts.forEach((account) => {
        if (account.status === "queued") account.status = "cancelled";
      });
    }

    // Tear down any in-flight sessions so blocked workers exit promptly.
    for (const account of job.accounts) {
      if (typeof account._rejectTokens === "function") {
        try {
          account._rejectTokens(new Error("Job cancelled"));
        } catch {
          // already settled
        }
        account._rejectTokens = null;
      }
      const session = account.runtimeSession || account.manualSession;
      if (session) {
        const { context, browser } = session;
        if (context) void context.close().catch(() => null);
        if (browser) void browser.close().catch(() => null);
      }
    }

    // Stop the callback proxy + clear sessions for any in-flight accounts.
    for (const account of job.accounts) {
      if (account._autoclawState) {
        clearAutoClawSession(account._autoclawState);
      }
    }
    stopAutoClawProxy();

    void this.persistJobSnapshot(job, { forcePreview: true });
    // getJob sanitizes the in-memory job into the serializable shape the API
    // expects (with preview, summary, etc.).
    return this.getJob(jobId);
  }

  /**
   * Wait for the dangling successPromise to resolve after a manual assist.
   * The real proxy on 18432 stays alive so a manual Google completion in the
   * headed browser still triggers the callback → poller → exchange → resolve.
   */
  async runAutoClawManualFollowup(job, account, successPromise) {
    const followupPromise = (async () => {
      const closeManualResources = async () => {
        const ms = account.manualSession;
        const ctx = ms?.context || null;
        const headed = ms?.headedBrowser || null;
        const baseBrowser = ms?.browser || null;
        if (ctx) await ctx.close().catch(() => null);
        if (headed) await headed.close().catch(() => null);
        if (baseBrowser && baseBrowser !== headed)
          await baseBrowser.close().catch(() => null);
        if (account._autoclawState) {
          clearAutoClawSession(account._autoclawState);
        }
        stopAutoClawProxy();
      };
      try {
        const tokenData = await successPromise;
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
          "Saving AutoClaw connection",
        );
        await this.persistJobSnapshot(job, { forcePreview: true });

        const { connection } = await this.saveConnection({
          tokens: tokenData,
          email: account.email,
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "AutoClaw connection saved successfully",
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
  if (!globalThis.__autoclawBulkImportSingleton) {
    globalThis.__autoclawBulkImportSingleton = {
      manager: new AutoClawBulkImportManager(),
    };
  }
  return globalThis.__autoclawBulkImportSingleton;
}

export function getAutoClawBulkImportManager() {
  return getSingletonStore().manager;
}

export { buildLookupResponse, parseBulkAccounts };
