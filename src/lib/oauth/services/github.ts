import { OAuthService } from "./oauth";
import { GITHUB_CONFIG } from "../constants/oauth";
import { spinner as createSpinner } from "../utils/ui";

/**
 * GitHub Copilot OAuth Service
 * Uses Device Code Flow for authentication
 */
export class GitHubService extends OAuthService {
  constructor() {
    super(GITHUB_CONFIG);
  }

  /**
   * Get device code for GitHub authentication
   */
  async getDeviceCode() {
    const scopes = Array.isArray(GITHUB_CONFIG.scopes) ? GITHUB_CONFIG.scopes : [GITHUB_CONFIG.scopes];
    const response = await fetch(`${GITHUB_CONFIG.deviceCodeUrl}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: GITHUB_CONFIG.clientId,
        scope: scopes.join(" "),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get device code: ${error}`);
    }

    return await response.json();
  }

  /**
   * Poll for access token using device code
   */
  async pollAccessToken(deviceCode: string, verificationUri: string, userCode: string, interval = 5000) {
    const spinner = createSpinner("Waiting for GitHub authorization...").start();
    
    // Show user code and verification URL
    console.log(`\nPlease visit: ${verificationUri}`);
    console.log(`Enter code: ${userCode}\n`);

    const maxAttempts = 60; // 5 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, interval));

      const response = await fetch(GITHUB_CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: GITHUB_CONFIG.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data = await response.json();

      if (response.ok) {
        spinner.succeed("GitHub authorized!");
        return data;
      }

      if (data.error === "authorization_pending") {
        continue;
      }

      if (data.error === "slow_down") {
        interval += 5000;
        continue;
      }

      spinner.fail(`Auth failed: ${data.error_description || data.error}`);
      throw new Error(data.error_description || data.error);
    }

    spinner.fail("Authentication timed out");
    throw new Error("Authentication timeout");
  }

  /**
   * Get Copilot token using GitHub access token
   */
  async getCopilotToken(githubAccessToken: string) {
    const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get Copilot token: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get user info from GitHub
   */
  async getUserInfo(accessToken: string) {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    return await response.json();
  }

  /**
   * Complete GitHub Copilot authentication flow
   */
  async authenticate(): Promise<any> {
    try {
      // Get device code
      const deviceResponse = await this.getDeviceCode();
      
      // Poll for access token
      const tokenResponse = await this.pollAccessToken(
        deviceResponse.device_code, 
        deviceResponse.verification_uri, 
        deviceResponse.user_code
      );
      
      // Get Copilot token
      const copilotToken = await this.getCopilotToken(tokenResponse.access_token);
      
      // Get user info
      const userInfo = await this.getUserInfo(tokenResponse.access_token);
      
      console.log(`\n✅ Successfully authenticated as ${userInfo.login}`);
      
      return {
        accessToken: tokenResponse.access_token,
        copilotToken: copilotToken.token,
        refreshToken: null, // GitHub device flow doesn't return refresh token
        expiresIn: copilotToken.expires_at,
        userInfo: {
          id: userInfo.id,
          login: userInfo.login,
          name: userInfo.name,
          email: userInfo.email,
        },
        copilotTokenInfo: copilotToken,
      };
    } catch (error: any) {
      throw new Error(`GitHub authentication failed: ${error.message}`);
    }
  }

  /**
   * Connect to server with GitHub credentials
   */
  async connect() {
    try {
      // Authenticate with GitHub
      const authResult = await this.authenticate();
      
      // Send credentials to server
      const { getServerCredentials } = await import("../config/index");
      const { server, token, userId } = getServerCredentials();
      const { spinner } = await import("../utils/ui");
      const s = spinner("Connecting to server...").start();
      
      const response = await fetch(`${server}/api/cli/providers/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-User-Id": userId,
        },
        body: JSON.stringify({
          accessToken: authResult.accessToken,
          copilotToken: authResult.copilotToken,
          userInfo: authResult.userInfo,
          copilotTokenInfo: authResult.copilotTokenInfo,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to connect to server");
      }
      
      s.succeed("GitHub Copilot connected successfully!");
      console.log(`\nConnected as: ${authResult.userInfo.login}`);
    } catch (error: any) {
      const { error: showError } = await import("../utils/ui");
      showError(`GitHub connection failed: ${error.message}`);
      throw error;
    }
  }
}
