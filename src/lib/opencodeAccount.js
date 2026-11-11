import { getSettings, updateSettings } from "@/lib/localDb";

const CONSOLE_BASE = "https://opencode.ai/console";
const CLIENT_ID = "opencode-cli";
const SETTINGS_KEY = "opencodeAccount";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const EXPIRY_MARGIN_MS = 60_000;

function absolute(path) {
  if (!path) return CONSOLE_BASE;
  return path.startsWith("http") ? path : `https://opencode.ai${path}`;
}

async function consolePost(path, payload) {
  const res = await fetch(`${CONSOLE_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, data };
}

export async function startDeviceAuth() {
  const { status, data } = await consolePost("/auth/device/code", { client_id: CLIENT_ID });
  if (status !== 200 || !data.device_code) {
    throw new Error(data?.error_description || data?.error || `device code request failed (${status})`);
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: absolute(data.verification_uri),
    verificationUriComplete: absolute(data.verification_uri_complete),
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

async function fetchAccountWorkspace(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${CONSOLE_BASE}/api/user/workspaces`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0 && list[0]?.id) {
        return list[0].id;
      }
    }
    const resOrgs = await fetch(`${CONSOLE_BASE}/api/orgs`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (resOrgs.ok) {
      const orgs = await resOrgs.json();
      if (Array.isArray(orgs) && orgs.length > 0 && orgs[0]?.id) {
        return orgs[0].id;
      }
    }
  } catch {
    // network or timeout
  }
  return null;
}

async function persistTokens(data) {
  const expiresAt = Date.now() + Number(data.expires_in || 0) * 1000;
  const orgId = await fetchAccountWorkspace(data.access_token).catch(() => null);
  await updateSettings({
    [SETTINGS_KEY]: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      tokenType: data.token_type || "Bearer",
      expiresAt,
      orgId: orgId || null,
      connectedAt: new Date().toISOString(),
    },
  });
}

export async function pollDeviceAuth(deviceCode) {
  const { status, data } = await consolePost("/auth/device/token", {
    grant_type: DEVICE_GRANT,
    device_code: deviceCode,
    client_id: CLIENT_ID,
  });
  if (data.access_token) {
    await persistTokens(data);
    return { status: "connected", expiresIn: data.expires_in };
  }
  const error = data.error || "";
  if (error === "authorization_pending" || error === "slow_down") {
    return { status: "pending" };
  }
  return { status: "error", error: data.error_description || error || `poll failed (${status})` };
}

async function refreshTokens(refreshToken) {
  const { data } = await consolePost("/auth/device/token", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });
  if (!data.access_token) return null;
  await persistTokens(data);
  return data.access_token;
}

export async function getAccountInfo() {
  let account = null;
  try {
    const settings = await getSettings();
    account = settings?.[SETTINGS_KEY] || null;
  } catch {
    return null;
  }
  if (!account?.accessToken) return null;
  let token = account.accessToken;
  const expiring = !account.expiresAt || account.expiresAt - EXPIRY_MARGIN_MS < Date.now();
  if (expiring && account.refreshToken) {
    const refreshed = await refreshTokens(account.refreshToken).catch(() => null);
    if (refreshed) token = refreshed;
    else if (account.expiresAt && account.expiresAt <= Date.now()) return null;
  }
  let orgId = account.orgId || null;
  if (!orgId && token) {
    orgId = await fetchAccountWorkspace(token).catch(() => null);
    if (orgId) {
      account.orgId = orgId;
      await updateSettings({ [SETTINGS_KEY]: account }).catch(() => {});
    }
  }
  return { accessToken: token, orgId };
}

export async function getAccountToken() {
  const info = await getAccountInfo();
  return info?.accessToken || null;
}

export async function getAccountOrgId() {
  const info = await getAccountInfo();
  return info?.orgId || null;
}

export async function getAccountStatus() {
  const settings = await getSettings().catch(() => ({}));
  const account = settings?.[SETTINGS_KEY] || null;
  if (!account?.accessToken) return { connected: false };
  return {
    connected: true,
    orgId: account.orgId || null,
    expiresAt: account.expiresAt || null,
    connectedAt: account.connectedAt || null,
    expired: !!(account.expiresAt && account.expiresAt <= Date.now()),
  };
}

export async function clearAccount() {
  await updateSettings({ [SETTINGS_KEY]: null });
}
