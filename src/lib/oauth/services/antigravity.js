import crypto from "crypto";
import open from "open";
import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth.js";
import { getServerCredentials } from "../config/index.js";
import { startLocalServer } from "../utils/server.js";
import { spinner as createSpinner } from "../utils/ui.js";

/**
 * Antigravity OAuth Service
 * Uses standard OAuth2 Authorization Code flow (similar to Gemini)
 */
export class AntigravityService {
  constructor() {
    this.config = ANTIGRAVITY_CONFIG;
  }

  /**
   * Build Antigravity authorization URL
   */
  buildAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
    });

    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code, redirectUri) {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get user info from Google
   */
  async getUserInfo(accessToken) {
    const response = await fetch(`${this.config.userInfoUrl}?alt=json`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get common headers for Antigravity API calls
   */
  getApiHeaders(accessToken) {
    return {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "antigravity",
    };
  }

  /**
   * Get metadata object for loadCodeAssist / onboardUser API calls.
   */
  getMetadata() {
    return { ideType: "ANTIGRAVITY" };
  }

  /**
   * Fetch Project ID and Tier from loadCodeAssist API
   */
  async loadCodeAssist(accessToken) {
    const endpoint = "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({ metadata: this.getMetadata() }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to load code assist: ${errorText}`);
    }

    const data = await response.json();

    // Check for verification requirement on ineligible tiers
    if (Array.isArray(data.ineligibleTiers)) {
      for (const tier of data.ineligibleTiers) {
        if (tier.validationUrl) {
          console.warn(`[Antigravity] Account verification required: ${tier.validationUrl}`);
        }
      }
    }

    // Extract project ID
    let projectId = "";
    if (typeof data.cloudaicompanionProject === "string") {
      projectId = data.cloudaicompanionProject.trim();
    } else if (data.cloudaicompanionProject && typeof data.cloudaicompanionProject === "object" && data.cloudaicompanionProject.id) {
      projectId = data.cloudaicompanionProject.id.trim();
    }

    const hasCurrentTier = Boolean(data.currentTier);
    return { projectId, hasCurrentTier, raw: data };
  }

  /**
   * Onboard user to enable Gemini Code Assist for the project
   */
  async onboardUser(accessToken, tierId = "free-tier") {
    const endpoint = "https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({ tierId, metadata: this.getMetadata() }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to onboard user: ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Poll operation until done
   */
  async pollOperation(accessToken, operationName, timeoutMs = 30000) {
    const startTime = Date.now();
    const opPath = operationName.startsWith("v1internal/")
      ? operationName.slice("v1internal/".length)
      : (operationName.startsWith("/") ? operationName.slice(1) : operationName);
    const endpoint = `https://daily-cloudcode-pa.googleapis.com/v1internal/${opPath}`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: this.getApiHeaders(accessToken),
        });
        if (response.ok) {
          const op = await response.json();
          if (op.done === true) {
            return op;
          }
        }
      } catch (_) {
        // ignore intermittent network errors during poll
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Operation ${operationName} timed out after ${timeoutMs}ms`);
  }

  /**
   * Complete onboarding flow with retry and polling
   */
  async completeOnboarding(accessToken) {
    const initial = await this.loadCodeAssist(accessToken);
    if (initial.hasCurrentTier && initial.projectId) {
      return { success: true, projectId: initial.projectId };
    }

    const onboardResult = await this.onboardUser(accessToken, "free-tier");
    if (onboardResult.done === true) {
      const refreshed = await this.loadCodeAssist(accessToken);
      const pid = refreshed.projectId || (typeof onboardResult.response?.cloudaicompanionProject === "string" ? onboardResult.response.cloudaicompanionProject.trim() : onboardResult.response?.cloudaicompanionProject?.id?.trim());
      return { success: true, projectId: pid || initial.projectId };
    }

    if (onboardResult.name) {
      await this.pollOperation(accessToken, onboardResult.name, 30000);
      const refreshed = await this.loadCodeAssist(accessToken);
      return { success: true, projectId: refreshed.projectId || initial.projectId };
    }

    return { success: true, projectId: initial.projectId };
  }

  /**
   * Fetch Project ID from loadCodeAssist API (legacy method for compatibility)
   */
  async fetchProjectId(accessToken) {
    const { projectId } = await this.loadCodeAssist(accessToken);
    if (!projectId) {
      throw new Error("No cloudaicompanionProject found in response");
    }
    return projectId;
  }

  /**
   * Save Antigravity tokens to server
   */
  async saveTokens(tokens, userInfo, projectId) {
    const { server, token, userId } = getServerCredentials();

    const response = await fetch(`${server}/api/cli/providers/antigravity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-User-Id": userId,
      },
      body: JSON.stringify({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        email: userInfo.email,
        projectId: projectId, // Send projectId to server
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to save tokens");
    }

    return await response.json();
  }

  /**
   * Complete Antigravity OAuth flow
   */
  async connect() {
    const spinner = createSpinner("Starting Antigravity OAuth...").start();

    try {
      spinner.text = "Starting local server...";

      // Start local server for callback
      let callbackParams = null;
      const { port, close } = await startLocalServer((params) => {
        callbackParams = params;
      });

      const redirectUri = `http://localhost:${port}/callback`;
      spinner.succeed(`Local server started on port ${port}`);

      // Generate state
      const state = crypto.randomBytes(32).toString("base64url");

      // Build authorization URL
      const authUrl = this.buildAuthUrl(redirectUri, state);

      console.log("\nOpening browser for Antigravity authentication...");
      console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

      // Open browser
      await open(authUrl);

      // Wait for callback
      spinner.start("Waiting for Antigravity authorization...");

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Authentication timeout (5 minutes)"));
        }, 300000);

        const checkInterval = setInterval(() => {
          if (callbackParams) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });

      close();

      if (callbackParams.error) {
        throw new Error(callbackParams.error_description || callbackParams.error);
      }

      if (!callbackParams.code) {
        throw new Error("No authorization code received");
      }

      spinner.start("Exchanging code for tokens...");

      // Exchange code for tokens
      const tokens = await this.exchangeCode(callbackParams.code, redirectUri);

      spinner.text = "Fetching user info...";

      // Get user info
      const userInfo = await this.getUserInfo(tokens.access_token);

      spinner.text = "Loading Code Assist configuration & provisioning project...";

      // Complete onboarding if needed and acquire provisioned project ID
      const onboardResult = await this.completeOnboarding(tokens.access_token);
      const finalProjectId = onboardResult.projectId;

      if (!finalProjectId) {
        throw new Error("No Google Cloud Project found or provisioned. Please ensure your Google account is eligible.");
      }
      spinner.text = "Saving tokens to server...";

      // Save tokens to server
      await this.saveTokens(tokens, userInfo, finalProjectId);

      spinner.succeed(`Antigravity connected successfully! (${userInfo.email}, Project: ${finalProjectId})`);
      return true;
    } catch (error) {
      spinner.fail(`Failed: ${error.message}`);
      throw error;
    }
  }
}

