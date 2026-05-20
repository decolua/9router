const CODEX_AUTH_CLAIM = "https://api.openai.com/auth";
const CODEX_PROFILE_CLAIM = "https://api.openai.com/profile";

function base64UrlDecode(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const missingPadding = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + "=".repeat(missingPadding), "base64").toString("utf8");
}

export function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

export function extractCodexAccountInfo(idToken) {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return {};

  const auth = payload[CODEX_AUTH_CLAIM] || {};
  const profile = payload[CODEX_PROFILE_CLAIM] || {};
  const chatgptAccountId = auth.chatgpt_account_id || auth.account_id || payload.chatgpt_account_id;
  return {
    email: payload.email || profile.email,
    chatgptAccountId,
    chatgptPlanType: auth.chatgpt_plan_type,
    chatgptUserId: auth.chatgpt_user_id || auth.user_id,
    chatgptAccountIsFedramp: auth.chatgpt_account_is_fedramp === true,
  };
}

export function buildCodexProviderSpecificData(tokens = {}) {
  const info = extractCodexAccountInfo(tokens.id_token);
  const accountId = tokens.account_id || info.chatgptAccountId;
  const data = {};

  if (accountId) data.chatgptAccountId = accountId;
  if (info.chatgptPlanType) data.chatgptPlanType = info.chatgptPlanType;
  if (info.chatgptUserId) data.chatgptUserId = info.chatgptUserId;
  if (info.chatgptAccountIsFedramp) data.chatgptAccountIsFedramp = true;

  return Object.keys(data).length > 0 ? data : null;
}

export function getCodexWorkspaceId(connection = {}) {
  const data = connection.providerSpecificData || connection;
  return data.chatgptAccountId || data.chatgptWorkspaceId || data.accountId || null;
}
