import { ANTHROPIC_API_VERSION } from "open-sse/providers/shared.js";

const BASE64_BLOCK_SIZE = 4;

function validateXaiOAuthEndpoint(rawUrl, field) {
  const value = String(rawUrl || "").trim();
  if (!value) throw new Error(`xai discovery ${field} is empty`);
  let parsed;
  try { parsed = new URL(value); } catch (err) {
    throw new Error(`xai discovery ${field} is invalid: ${err.message}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`xai discovery ${field} must use https: ${value}`);
  const host = parsed.hostname.toLowerCase().trim();
  if (host !== "x.ai" && !host.endsWith(".x.ai")) {
    throw new Error(`xai discovery ${field} host ${host} is not on x.ai`);
  }
  return value;
}

function decodeXaiIdTokenEmail(idToken) {
  if (!idToken || typeof idToken !== "string") return undefined;
  const parts = idToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const json = Buffer.from(base64 + "=".repeat(padding), "base64").toString("utf8");
    const payload = JSON.parse(json);
    return payload.email || payload.preferred_username || payload.sub || undefined;
  } catch {
    return undefined;
  }
}

function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const missingPadding = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const padded = base64 + "=".repeat(missingPadding);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractEmailFromAccessToken(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return undefined;
  return payload.email || payload.preferred_username || payload.sub || undefined;
}

export async function fetchKiroProfileArn(accessToken) {
  if (!accessToken) return null;
  try {
    const response = await fetch("https://codewhisperer.us-east-1.amazonaws.com/ListAvailableProfiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ maxResults: 10 }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.profiles?.find((p) => p.arn?.trim())?.arn?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Claude OAuth profile (account email + org plan tier).
 * Best-effort: a missing/failed profile must never fail the OAuth connect.
 */
export async function fetchClaudeProfile(accessToken, profileUrl) {
  if (!accessToken || !profileUrl) return null;
  try {
    const response = await fetch(profileUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Connection fields derived from a Claude OAuth profile reply.
 * Returns {} for a missing/unusable profile so callers can spread it blindly.
 */
export function claudeProfileFields(profile) {
  const account = profile?.account;
  const org = profile?.organization;
  if (!account && !org) return {};
  const fields = {};
  if (account?.email) fields.email = account.email;
  const displayName = account?.display_name || account?.full_name;
  if (displayName) fields.displayName = displayName;
  const providerSpecificData = {};
  if (account?.uuid) providerSpecificData.claudeAccountUuid = account.uuid;
  if (typeof account?.has_claude_max === "boolean") providerSpecificData.claudeHasMax = account.has_claude_max;
  if (typeof account?.has_claude_pro === "boolean") providerSpecificData.claudeHasPro = account.has_claude_pro;
  if (org?.uuid) providerSpecificData.claudeOrgUuid = org.uuid;
  if (org?.name) providerSpecificData.claudeOrgName = org.name;
  if (org?.organization_type) providerSpecificData.claudeOrgType = org.organization_type;
  if (org?.rate_limit_tier) providerSpecificData.claudeRateLimitTier = org.rate_limit_tier;
  if (Object.keys(providerSpecificData).length) fields.providerSpecificData = providerSpecificData;
  return fields;
}

export function extractCodexAccountInfo(idToken) {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return {};
  const chatgpt = payload["https://api.openai.com/auth"] || {};
  return {
    email: payload.email,
    chatgptAccountId: chatgpt.chatgpt_account_id || payload.account_id,
    chatgptPlanType: chatgpt.chatgpt_plan_type || payload.plan_type,
  };
}

export {
  BASE64_BLOCK_SIZE,
  validateXaiOAuthEndpoint,
  decodeXaiIdTokenEmail,
  decodeJwtPayload,
  extractEmailFromAccessToken,
};
