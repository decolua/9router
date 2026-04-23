/**
 * Auto-recovery module for Antigravity accounts.
 *
 * When a refresh token becomes permanently invalid (e.g., revoked by user,
 * expired, or account disabled), this module attempts to re-authenticate
 * using stored encrypted credentials via the Puppeteer headless login engine.
 *
 * Flow:
 *   1. Decrypt stored email/password from providerSpecificData
 *   2. Launch stealth browser (puppeteer-extra + stealth plugin)
 *   3. Run headlessGoogleLogin to get authorization code
 *   4. Exchange code for tokens via OAuth
 *   5. Refresh access token, fetch projectId
 *   6. Update the connection in the database
 */

import { decryptCredentials } from "@/lib/crypto";
import { headlessGoogleLogin } from "@/lib/puppeteer/antigravityLogin";
import { generateAuthData, exchangeTokens } from "@/lib/oauth/providers";
import { ANTIGRAVITY_CONFIG } from "@/lib/oauth/constants/oauth";
import { updateProviderConnection } from "@/lib/localDb";

const REDIRECT_URI = "http://localhost:8080/callback";

/**
 * Launch a Puppeteer browser with stealth anti-detection.
 * Uses dynamic import to avoid CJS/ESM bundling issues in Next.js.
 */
async function launchStealthBrowser() {
  const puppeteerExtra = (await import("puppeteer-extra")).default;
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;

  puppeteerExtra.use(StealthPlugin());

  return puppeteerExtra.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,800",
    ],
  });
}

/**
 * Refresh access token using refresh token.
 */
async function refreshAccessToken(refreshToken) {
  const response = await fetch(ANTIGRAVITY_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTIGRAVITY_CONFIG.clientId,
      client_secret: ANTIGRAVITY_CONFIG.clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return await response.json();
}

/**
 * Load Code Assist to get project ID.
 */
async function loadCodeAssist(accessToken) {
  const response = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
      "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
      "Client-Metadata": ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata,
      "x-request-source": "local",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  let projectId = "";
  if (typeof data.cloudaicompanionProject === "string") {
    projectId = data.cloudaicompanionProject.trim();
  } else if (data.cloudaicompanionProject?.id) {
    projectId = data.cloudaicompanionProject.id.trim();
  }

  return projectId;
}

/**
 * Attempt to recover an Antigravity account using stored credentials.
 *
 * @param {object} connection - The provider connection object from localDb
 * @param {(msg: string) => void} onLog - Log callback
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function recoverAccount(connection, onLog = () => {}) {
  const encryptedCreds = connection.providerSpecificData?.encryptedCredentials;
  if (!encryptedCreds) {
    return { success: false, error: "No stored credentials" };
  }

  const creds = decryptCredentials(encryptedCreds);
  if (!creds || !creds.email || !creds.password) {
    return { success: false, error: "Failed to decrypt credentials" };
  }

  let browser = null;
  try {
    onLog("Launching stealth browser...");
    browser = await launchStealthBrowser();

    // Generate OAuth auth data
    const authData = generateAuthData("antigravity", REDIRECT_URI, {
      login_hint: creds.email,
    });

    onLog("Starting headless Google login...");
    const { code, state } = await headlessGoogleLogin(
      browser,
      creds.email,
      creds.password,
      authData.authUrl,
      REDIRECT_URI,
      (msg) => onLog(msg),
    );

    onLog("Exchanging tokens...");
    const tokenData = await exchangeTokens(
      "antigravity",
      code,
      REDIRECT_URI,
      authData.codeVerifier,
      state,
    );

    if (!tokenData?.refreshToken) {
      return { success: false, error: "OAuth did not return refresh token" };
    }

    // Refresh to get fresh access token
    onLog("Refreshing access token...");
    const tokens = await refreshAccessToken(tokenData.refreshToken);
    const accessToken = tokens.access_token;
    const newRefreshToken = tokens.refresh_token || tokenData.refreshToken;

    // Fetch project ID
    let projectId = connection.projectId || "";
    try {
      onLog("Loading Code Assist...");
      const fetchedProjectId = await loadCodeAssist(accessToken);
      if (fetchedProjectId) {
        projectId = fetchedProjectId;
      }
    } catch {
      // Keep existing projectId if fetch fails
    }

    // Update the connection with new tokens
    onLog("Updating connection...");
    await updateProviderConnection(connection.id, {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      projectId,
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      errorCode: null,
      backoffLevel: 0,
    });

    onLog("Recovery successful");
    return { success: true };
  } catch (err) {
    onLog(`Recovery failed: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
