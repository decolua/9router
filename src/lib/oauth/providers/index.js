// Ensure outbound fetch respects HTTP(S)_PROXY/ALL_PROXY in Node runtime
import "open-sse/index.js";

import { generatePKCE } from "../utils/pkce.js";
import { extractCodexAccountInfo, fetchKiroProfileArn } from "../providerHelpers.js";

import claude from "./claude.js";
import codex from "./codex.js";
import xai from "./xai.js";
import grokCli from "./grok-cli.js";
import geminiCli from "./gemini-cli.js";
import antigravity from "./antigravity.js";
import iflow from "./iflow.js";
import qoder from "./qoder.js";
import github from "./github.js";
import kiro from "./kiro.js";
import cursor from "./cursor.js";
import kimi from "./kimi.js";
import kilocode from "./kilocode.js";
import cline from "./cline.js";
import clinepass from "./clinepass.js";
import gitlab from "./gitlab.js";
import codebuddyCn from "./codebuddy-cn.js";
import codebuddyIntl from "./codebuddy-intl.js";
import kimchi from "./kimchi.js";
import trae from "./trae.js";
import windsurf from "./windsurf.js";
import zed from "./zed.js";
import freebuff from "./freebuff.js";

// Provider configurations
const PROVIDERS = {
  claude,
  codex,
  xai,
  "grok-cli": grokCli,
  "gemini-cli": geminiCli,
  antigravity,
  iflow,
  qoder,
  github,
  kiro,
  cursor,
  kimi,
  kilocode,
  cline,
  clinepass,
  gitlab,
  "codebuddy-cn": codebuddyCn,
  "codebuddy-intl": codebuddyIntl,
  kimchi,
  trae,
  windsurf,
  zed,
  freebuff,
};

export { PROVIDERS };

// Re-export helpers that other files import from this path
export { extractCodexAccountInfo, fetchKiroProfileArn };

/**
 * Get provider handler
 */
export function getProvider(name) {
  // Legacy kimi-coding → kimi (dual-auth merge)
  const key = name === "kimi-coding" ? "kimi" : name;
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

/**
 * Get all provider names
 */
export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

/**
 * Generate auth data for a provider
 * @param {object} [meta] - Provider-specific metadata (e.g. gitlab clientId/baseUrl)
 */
export async function generateAuthData(providerName, redirectUri, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;
  const { codeVerifier: pkceVerifier, codeChallenge, state: pkceState } = generatePKCE(provider.pkceVerifierBytes);
  // Trae uses loginTraceID (set by prepareConfig) as the callback matcher, not PKCE state.
  const state = config.loginTraceID || pkceState;
  // Zed: codeVerifier carries the encoded RSA private key (from prepareConfig), not a PKCE verifier.
  const codeVerifier = config.privateKeyVerifier || pkceVerifier;

  let authUrl;
  if (provider.flowType === "device_code") {
    // Device code flow doesn't have auth URL upfront
    authUrl = null;
  } else if (provider.flowType === "authorization_code_pkce") {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, codeChallenge, meta || {});
  } else {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, undefined, meta || {});
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback",
  };
}

/**
 * Exchange code for tokens
 * @param {object} [meta] - Provider-specific metadata (e.g. gitlab clientId/baseUrl)
 */
export async function exchangeTokens(providerName, code, redirectUri, codeVerifier, state, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;

  const tokens = await provider.exchangeToken(config, code, redirectUri, codeVerifier, state, meta || {});

  let extra = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

/**
 * Request device code (for device_code flow)
 */
export async function requestDeviceCode(providerName, codeChallenge, options) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  return await provider.requestDeviceCode(provider.config, codeChallenge, options || {});
}

/**
 * Poll for token (for device_code flow)
 * @param {string} providerName - Provider name
 * @param {string} deviceCode - Device code from requestDeviceCode
 * @param {string} codeVerifier - PKCE code verifier (optional for some providers)
 * @param {object} extraData - Extra data from device code response (e.g. clientId/clientSecret for Kiro)
 */
export async function pollForToken(providerName, deviceCode, codeVerifier, extraData) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }

  const result = await provider.pollToken(provider.config, deviceCode, codeVerifier, extraData);

  if (result.ok) {
    // For device code flows, success is only when we have an access token
    if (result.data.access_token) {
      // Call postExchange to get additional data (copilotToken, userInfo, etc.)
      let extra = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data);
      }
      const tokens = provider.mapTokens(result.data, extra);
      // Kiro IDC/Builder-ID tokens lack profileArn; resolve it to avoid 403
      if (providerName === "kiro" && !tokens.providerSpecificData?.profileArn) {
        const profileArn = await fetchKiroProfileArn(tokens.accessToken);
        if (profileArn) tokens.providerSpecificData.profileArn = profileArn;
      }
      return { success: true, tokens };
    } else {
      // Check if it's still pending authorization
      if (result.data.error === 'authorization_pending' || result.data.error === 'slow_down') {
        // This is not a failure, just still waiting
        return {
          success: false,
          error: result.data.error,
          errorDescription: result.data.error_description || result.data.message,
          pending: result.data.error === 'authorization_pending'
        };
      } else {
        // Actual error
        return {
          success: false,
          error: result.data.error || 'no_access_token',
          errorDescription: result.data.error_description || result.data.message || 'No access token received'
        };
      }
    }
  }

  return { success: false, error: result.data.error, errorDescription: result.data.error_description };
}

// Run-once guard across the process lifetime
let codexBackfillDone = false;

// Backfill email + chatgpt account info for existing codex OAuth connections missing them
export async function backfillCodexEmails() {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb");
    const connections = await getProviderConnections();
    const targets = connections.filter((c) => {
      if (c.provider !== "codex" || c.authType !== "oauth" || !c.idToken) return false;
      const hasEmail = !!c.email;
      const hasAccountInfo = !!c.providerSpecificData?.chatgptAccountId;
      return !hasEmail || !hasAccountInfo;
    });
    for (const conn of targets) {
      const info = extractCodexAccountInfo(conn.idToken);
      if (!info.email && !info.chatgptAccountId) continue;
      const patch = {};
      if (!conn.email && info.email) patch.email = info.email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        patch.providerSpecificData = {
          ...(conn.providerSpecificData || {}),
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType,
        };
      }
      if (Object.keys(patch).length) {
        await updateProviderConnection(conn.id, patch);
      }
    }
  } catch (err) {
    codexBackfillDone = false;
    console.log("backfillCodexEmails failed:", err?.message || err);
  }
}
