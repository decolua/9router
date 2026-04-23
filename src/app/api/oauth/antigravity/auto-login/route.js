import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { ANTIGRAVITY_CONFIG } from "@/lib/oauth/constants/oauth";
import { generateAuthData, exchangeTokens } from "@/lib/oauth/providers";
import { headlessGoogleLogin } from "@/lib/puppeteer/antigravityLogin";
import { encryptCredentials } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * Auto-Login API for Antigravity Provider
 * 
 * Accepts a list of account:refreshToken pairs, automatically:
 * 1. Refreshes the access token using the refresh token
 * 2. Fetches user info (email)
 * 3. Runs loadCodeAssist to get project ID and tier
 * 4. Runs onboardUser to bypass the welcome/onboarding flow
 * 5. Creates provider connections in the database
 * 
 * POST /api/oauth/antigravity/auto-login
 * Body: { accounts: ["email:refreshToken", ...] }
 * 
 * Or with JSON array:
 * Body: { accounts: [{ email: "...", refreshToken: "..." }, ...] }
 */

const LOAD_HEADERS_BASE = {
  "Content-Type": "application/json",
  "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
  "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
  "Client-Metadata": ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata,
  "x-request-source": "local",
};

const METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
};

function isLikelyRefreshToken(value) {
  return typeof value === "string" && value.trim().startsWith("1//");
}

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
 * Perform headless Google OAuth login and return a refresh token.
 * Uses Puppeteer + Stealth with full interstitial/challenge handling.
 */
async function exchangeRefreshTokenFromCredentials(browser, email, password, onLog = () => {}) {
  const redirectUri = "http://localhost:8080/callback";
  const authData = generateAuthData("antigravity", redirectUri, { login_hint: email });

  const { code, state } = await headlessGoogleLogin(
    browser,
    email,
    password,
    authData.authUrl,
    redirectUri,
    onLog,
  );

  const tokenData = await exchangeTokens(
    "antigravity",
    code,
    redirectUri,
    authData.codeVerifier,
    state,
  );

  if (!tokenData?.refreshToken) {
    throw new Error("Google OAuth did not return refresh token");
  }

  return tokenData.refreshToken;
}

/**
 * Refresh access token using refresh token
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
 * Fetch user info from Google
 */
async function fetchUserInfo(accessToken) {
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

  return await response.json();
}

/**
 * Load Code Assist to get project ID and tier
 */
async function loadCodeAssist(accessToken) {
  const response = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
    method: "POST",
    headers: {
      ...LOAD_HEADERS_BASE,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ metadata: METADATA }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`loadCodeAssist failed: ${errorText}`);
  }

  const data = await response.json();

  // Extract project ID
  let projectId = "";
  if (typeof data.cloudaicompanionProject === "string") {
    projectId = data.cloudaicompanionProject.trim();
  } else if (data.cloudaicompanionProject?.id) {
    projectId = data.cloudaicompanionProject.id.trim();
  }

  // Extract tier ID
  let tierId = "legacy-tier";
  if (Array.isArray(data.allowedTiers)) {
    for (const tier of data.allowedTiers) {
      if (tier.isDefault && tier.id) {
        tierId = tier.id.trim();
        break;
      }
    }
  }

  return { projectId, tierId };
}

/**
 * Onboard user (bypass welcome message) - polls until done
 */
async function onboardUser(accessToken, tierId, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
      method: "POST",
      headers: {
        ...LOAD_HEADERS_BASE,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ tierId, metadata: METADATA }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`onboardUser failed: ${errorText}`);
    }

    const result = await response.json();

    if (result.done === true) {
      // Extract final project ID from onboard response
      let finalProjectId = "";
      const project = result.response?.cloudaicompanionProject;
      if (typeof project === "string") {
        finalProjectId = project.trim();
      } else if (project?.id) {
        finalProjectId = project.id.trim();
      }
      return { success: true, projectId: finalProjectId };
    }

    // Wait 2 seconds before retry
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return { success: false, projectId: "" };
}

/**
 * Parse accounts input - supports both string format and object format
 */
function parseAccounts(accounts) {
  if (!Array.isArray(accounts)) {
    throw new Error("accounts must be an array");
  }

  return accounts.map((account, index) => {
    // String format: "email:refreshToken" or just "refreshToken"
    if (typeof account === "string") {
      const trimmed = account.trim();
      if (!trimmed) return null;

      // Split on first colon only (refresh tokens may contain colons)
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) {
        return { refreshToken: trimmed, email: null, index };
      }

      const left = trimmed.substring(0, colonIndex).trim();
      const right = trimmed.substring(colonIndex + 1).trim();

      // Detect if left part looks like an email
      if (left.includes("@")) {
        if (isLikelyRefreshToken(right)) {
          return { email: left, refreshToken: right, password: null, index };
        }
        return { email: left, refreshToken: null, password: right, index };
      }

      // Otherwise treat the whole thing as refreshToken
      return { refreshToken: trimmed, email: null, index };
    }

    // Object format: { email: "...", refreshToken: "..." }
    if (typeof account === "object" && account !== null) {
      return {
        email: account.email || null,
        refreshToken: account.refreshToken || account.refresh_token,
        password: account.password || null,
        index,
      };
    }

    return null;
  }).filter(Boolean);
}

function getParallelCount(value, total) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.max(1, Math.min(parsed, 5, total || 1));
}

async function processAccount(account, workerId, browser, onLog = () => {}) {
  const startedAt = Date.now();
  const result = {
    index: account.index,
    workerId,
    email: account.email || "unknown",
    status: "pending",
    error: null,
  };

  try {
    let refreshToken = account.refreshToken;
    if (!refreshToken) {
      if (!account.email || !account.password) {
        throw new Error("Missing refresh token (or email:password for headless login)");
      }
      if (!browser) {
        throw new Error("Browser session is not available for password login");
      }
      onLog(account.index, account.email, "Starting headless login...");
      refreshToken = await exchangeRefreshTokenFromCredentials(browser, account.email, account.password, (msg) => {
        onLog(account.index, account.email, msg);
      });
    }
    if (account.email && !isLikelyRefreshToken(refreshToken)) {
      throw new Error("Invalid refresh token format");
    }

    onLog(account.index, account.email || "unknown", "Refreshing access token...");
    const tokens = await refreshAccessToken(refreshToken);
    const accessToken = tokens.access_token;
    const newRefreshToken = tokens.refresh_token || refreshToken;

    let email = account.email;
    try {
      const userInfo = await fetchUserInfo(accessToken);
      email = userInfo.email || email;
    } catch (e) {
      console.log(`[AutoLogin] Failed to fetch user info for account ${account.index}: ${e.message}`);
    }

    result.email = email || "unknown";
    onLog(account.index, result.email, "Loading Code Assist...");

    let projectId = "";
    let tierId = "legacy-tier";
    try {
      const codeAssist = await loadCodeAssist(accessToken);
      projectId = codeAssist.projectId;
      tierId = codeAssist.tierId;
    } catch (e) {
      console.log(`[AutoLogin] loadCodeAssist failed for ${email}: ${e.message}`);
    }

    if (projectId) {
      onLog(account.index, result.email, "Onboarding user...");
      try {
        const onboardResult = await onboardUser(accessToken, tierId);
        if (onboardResult.success && onboardResult.projectId) {
          projectId = onboardResult.projectId;
        }
      } catch (e) {
        console.log(`[AutoLogin] onboardUser failed for ${email}: ${e.message}`);
      }
    }

    onLog(account.index, result.email, "Creating provider connection...");

    // Store encrypted credentials for auto-recovery if password was used
    const providerSpecificData = {};
    if (account.password) {
      providerSpecificData.encryptedCredentials = encryptCredentials({
        email,
        password: account.password,
      });
    }

    const connection = await createProviderConnection({
      provider: "antigravity",
      authType: "oauth",
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: tokens.expires_in,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      scope: tokens.scope,
      email,
      projectId,
      testStatus: "active",
      providerSpecificData,
    });

    result.status = "success";
    result.connectionId = connection.id;
    result.projectId = projectId || null;
  } catch (e) {
    result.status = "error";
    result.error = e.message;
    console.log(`[AutoLogin] Failed for account ${account.index}: ${e.message}`);
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { accounts, parallel } = body;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json(
        { error: "Missing or empty accounts array. Provide accounts as ['email:refreshToken', ...] or [{email, refreshToken}, ...]" },
        { status: 400 }
      );
    }

    const parsed = parseAccounts(accounts);
    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "No valid accounts found in input" },
        { status: 400 }
      );
    }

    const results = Array(parsed.length).fill(null);
    const parallelCount = getParallelCount(parallel, parsed.length);
    const needsHeadlessLogin = parsed.some((account) => !account.refreshToken && account.email && account.password);

    // Stream NDJSON: each line is a JSON object with type "log", "account_done", or "done"
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          } catch { /* stream closed */ }
        };

        const onLog = (index, email, message) => {
          send({ type: "log", index, email, message, ts: Date.now() });
        };

        let browser = null;
        if (needsHeadlessLogin) {
          send({ type: "log", index: -1, email: "", message: "Launching stealth browser..." });
          browser = await launchStealthBrowser();
          send({ type: "log", index: -1, email: "", message: "Browser ready" });
        }

        try {
          let nextIndex = 0;
          const workers = Array.from({ length: parallelCount }, (_, i) => i + 1).map((workerId) => (async () => {
            while (true) {
              const current = nextIndex;
              nextIndex += 1;
              if (current >= parsed.length) break;
              const result = await processAccount(parsed[current], workerId, browser, onLog);
              results[current] = result;
              send({ type: "account_done", index: current, result });
            }
          })());

          await Promise.all(workers);
        } finally {
          if (browser) {
            await browser.close().catch(() => {});
          }
        }

        const summary = {
          total: results.length,
          success: results.filter((r) => r?.status === "success").length,
          failed: results.filter((r) => r?.status === "error").length,
          parallel: parallelCount,
        };

        send({ type: "done", success: true, summary, results });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.log("[AutoLogin] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
