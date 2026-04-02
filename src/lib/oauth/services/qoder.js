import crypto from "crypto";
import open from "open";
import { QODER_CONFIG } from "../constants/oauth.js";
import { getServerCredentials } from "../config/index.js";
import { startLocalServer } from "../utils/server.js";
import { spinner as createSpinner } from "../utils/ui.js";

/**
 * Qoder OAuth Service
 * Uses Authorization Code flow with Basic Auth
 */
export class QoderService {
  constructor() {
    this.config = QODER_CONFIG;
  }

  /**
   * Build Qoder authorization URL
   */
  buildAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state: state,
    });

    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code, redirectUri) {
    const basicAuth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken) {
    const basicAuth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get user info from Qoder
   */
  async getUserInfo(accessToken) {
    const response = await fetch(
      `${this.config.userInfoUrl}?accessToken=${encodeURIComponent(accessToken)}`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error("Failed to get user info");
    }

    return result.data;
  }

  /**
   * Save Qoder tokens to server
   */
  async saveTokens(tokens, userInfo) {
    const { server, token, userId } = getServerCredentials();

    const response = await fetch(`${server}/api/cli/providers/qoder`, {
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
        apiKey: userInfo.apiKey,
        email: userInfo.email || userInfo.phone,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to save tokens");
    }

    return await response.json();
  }

  /**
   * Refresh and update tokens on server
   */
  async refreshAndSave(existingRefreshToken) {
    const spinner = createSpinner("Refreshing Qoder token...").start();

    try {
      const tokens = await this.refreshToken(existingRefreshToken);
      const userInfo = await this.getUserInfo(tokens.access_token);
      await this.saveTokens(tokens, userInfo);
      spinner.succeed("Qoder token refreshed successfully");
      return tokens;
    } catch (error) {
      spinner.fail(`Token refresh failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Complete Qoder OAuth flow
   */
  async connect() {
    const spinner = createSpinner("Starting Qoder OAuth...").start();

    try {
      spinner.text = "Starting local server...";

      let callbackParams = null;
      const { port, close } = await startLocalServer((params) => {
        callbackParams = params;
      });

      const redirectUri = `http://localhost:${port}/callback`;
      spinner.succeed(`Local server started on port ${port}`);

      const state = crypto.randomBytes(32).toString("base64url");
      const authUrl = this.buildAuthUrl(redirectUri, state);

      console.log("\nOpening browser for Qoder authentication...");
      console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

      await open(authUrl);

      spinner.start("Waiting for Qoder authorization...");

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
      const tokens = await this.exchangeCode(callbackParams.code, redirectUri);

      spinner.text = "Fetching user info...";
      const userInfo = await this.getUserInfo(tokens.access_token);

      spinner.text = "Saving tokens to server...";
      await this.saveTokens(tokens, userInfo);

      spinner.succeed(`Qoder connected successfully! (${userInfo.email || userInfo.phone})`);
      return true;
    } catch (error) {
      spinner.fail(`Failed: ${error.message}`);
      throw error;
    }
  }
}
