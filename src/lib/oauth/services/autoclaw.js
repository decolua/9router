import crypto from "crypto";
import http from "http";
import { URL } from "url";
import open from "open";
import { AUTOCLOW_CONFIG } from "../constants/oauth.js";
import { getServerCredentials } from "../config/index.js";
import { spinner as createSpinner } from "../utils/ui.js";

/**
 * AutoClaw OAuth Service — Google OAuth via AutoClaw's overseas endpoint.
 *
 * Flow (verified against production backend):
 *  1. POST /userapi/overseasv1/google-oauth-url { source_id, device_id, navigate_uri }
 *     → { oauth_url, state }  (oauth_url is a Google consent screen)
 *  2. User opens oauth_url, logs into Google, browser redirects to
 *     http://localhost:18432/auth/callback-google?code=...&state=...
 *  3. POST /userapi/overseasv1/google-oauth-login { source_id, device_id, code, state, navigate_uri }
 *     → { access_token: "Bearer eyJ…", refresh_token: "Bearer eyJ…", user_id, user_name, first_login }
 *
 * All AutoClaw userapi calls require app-signing headers (X-Auth-Appid /
 * X-Auth-TimeStamp / X-Auth-Sign = md5(`${APP_ID}&${ts}&${APP_KEY}`)).
 *
 * device_id is generated client-side (uuid4) and persisted; the JWT payload's
 * device_id is the authoritative value used for subsequent refreshes.
 */
export class AutoClawService {
  constructor() {
    this.config = AUTOCLOW_CONFIG;
  }

  /** App-signing headers for AutoClaw userapi calls. */
  appHeaders() {
    const appId = this.config.appId;
    const appKey = this.config.appKey;
    const ts = String(Math.floor(Date.now() / 1000));
    const sign = crypto.createHash("md5").update(`${appId}&${ts}&${appKey}`).digest("hex");
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

  /** Decode JWT payload (no verification). */
  decodeJwt(token) {
    try {
      const payload = token.split(".")[1];
      if (!payload) return {};
      const json = Buffer.from(payload + "=".repeat(-payload.length % 4), "base64url").toString("utf8");
      return JSON.parse(json);
    } catch {
      return {};
    }
  }

  /**
   * Start a local HTTP server on the fixed redirect port (18432) listening for
   * /auth/callback-google. The redirect URI is hardcoded by AutoClaw's Google
   * OAuth client, so we must bind this exact port + path.
   */
  startCallbackServer(onCallback) {
    return new Promise((resolve, reject) => {
      const port = this.config.fixedPort;
      const callbackPath = this.config.callbackPath;
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === callbackPath) {
          const params = Object.fromEntries(url.searchParams);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>AutoClaw Login</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.ok{color:#22c55e;font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="ok">&#10003;</div><h1>AutoClaw Authentication Successful</h1><p>Closing in <span id="cd">3</span>s...</p>
<script>let n=3;const c=document.getElementById("cd");const t=setInterval(()=>{n--;c.textContent=n;if(n<=0){clearInterval(t);window.close();}},1000);</script>
</div></body></html>`);
          onCallback(params);
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      server.listen(port, "127.0.0.1", () => {
        resolve({ server, port, close: () => server.close() });
      });

      server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(`Port ${port} is already in use. Close other applications using this port (e.g. the AutoClaw desktop app).`));
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Step 1: request the Google OAuth URL from AutoClaw.
   * Returns { oauth_url, state }.
   */
  async requestOAuthUrl(deviceId) {
    const body = JSON.stringify({
      source_id: this.config.sourceId,
      device_id: deviceId,
      navigate_uri: this.config.redirectUri,
    });
    const response = await fetch(this.config.authorizeUrl, {
      method: "POST",
      headers: this.appHeaders(),
      body,
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to request AutoClaw OAuth URL: ${error}`);
    }
    const resp = await response.json();
    // { code, msg, data } envelope
    if (resp.code != null && resp.code !== 0) {
      throw new Error(`AutoClaw OAuth URL error: code=${resp.code} msg=${resp.msg}`);
    }
    const data = resp.data || {};
    if (!data.oauth_url || !data.state) {
      throw new Error(`AutoClaw OAuth URL response missing oauth_url/state: ${JSON.stringify(data)}`);
    }
    return { oauthUrl: data.oauth_url, state: data.state };
  }

  /**
   * Step 2: exchange the Google callback code for AutoClaw tokens.
   * Returns { access_token, refresh_token, user_id, user_name, first_login }.
   */
  async exchangeCode(code, state, deviceId) {
    const body = JSON.stringify({
      source_id: this.config.sourceId,
      device_id: deviceId,
      code,
      state,
      navigate_uri: this.config.redirectUri,
    });
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: this.appHeaders(),
      body,
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AutoClaw token exchange failed: ${error}`);
    }
    const resp = await response.json();
    if (resp.code != null && resp.code !== 0) {
      throw new Error(`AutoClaw login error: code=${resp.code} msg=${resp.msg}`);
    }
    const data = resp.data || {};
    if (!data.access_token) {
      throw new Error(`AutoClaw login response missing access_token: ${JSON.stringify(data)}`);
    }
    return data;
  }

  /**
   * Save AutoClaw tokens to the 9router server.
   */
  async saveTokens(tokens, deviceId) {
    const { server, token, userId } = getServerCredentials();

    const response = await fetch(`${server}/api/cli/providers/autoclaw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-User-Id": userId,
      },
      body: JSON.stringify({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        providerSpecificData: {
          sourceId: this.config.sourceId,
          deviceId,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to save AutoClaw tokens");
    }

    return await response.json();
  }

  /**
   * Complete AutoClaw Google OAuth flow.
   */
  async connect() {
    const spinner = createSpinner("Starting AutoClaw OAuth...").start();

    try {
      // device_id: fresh uuid per device. Persisted server-side via saveTokens.
      const deviceId = crypto.randomUUID();

      spinner.text = "Requesting AutoClaw OAuth URL...";

      // Step 1: get the Google consent URL + state from AutoClaw.
      const { oauthUrl } = await this.requestOAuthUrl(deviceId);

      spinner.succeed("AutoClaw OAuth URL obtained");
      console.log("\nOpening browser for AutoClaw (Google) authentication...");
      console.log(`If browser doesn't open, visit:\n${oauthUrl}\n`);

      // Start local callback server on the fixed port 18432.
      spinner.start("Waiting for AutoClaw authorization...");
      let callbackParams = null;
      const { close } = await this.startCallbackServer((params) => {
        callbackParams = params;
      });

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

      spinner.start("Exchanging code for AutoClaw tokens...");

      // Step 2: exchange the Google code for AutoClaw tokens.
      const data = await this.exchangeCode(callbackParams.code, callbackParams.state, deviceId);

      // Normalize: strip "Bearer " prefix if present.
      let accessToken = data.access_token || "";
      let refreshToken = data.refresh_token || "";
      if (accessToken.startsWith("Bearer ")) accessToken = accessToken.slice(7);
      if (refreshToken.startsWith("Bearer ")) refreshToken = refreshToken.slice(7);

      // The JWT payload's device_id is authoritative for refresh — prefer it.
      const jwtPayload = this.decodeJwt(accessToken);
      const authoritativeDeviceId = jwtPayload.device_id || deviceId;

      spinner.text = "Saving AutoClaw tokens to server...";

      await this.saveTokens(
        { access_token: accessToken, refresh_token: refreshToken },
        authoritativeDeviceId
      );

      spinner.succeed(`AutoClaw connected successfully! (user: ${data.user_name || data.user_id || "unknown"})`);
      return true;
    } catch (error) {
      spinner.fail(`Failed: ${error.message}`);
      throw error;
    }
  }
}
