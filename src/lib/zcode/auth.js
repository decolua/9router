import crypto from "node:crypto";
import config from "./config.js";
import { ZCODE_ZAI_DEFAULT_EXPIRES_IN } from "./constants.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(padding);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function isValidEmail(value) {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

function normalizeEmail(value) {
  if (!isValidEmail(value)) return undefined;
  return value.trim();
}

function extractEmailFromJwt(jwt) {
  const payload = decodeJwtPayload(jwt);
  if (!payload) return undefined;
  return normalizeEmail(payload.email || payload.preferred_username);
}

function extractZcodeUserId(jwt) {
  const payload = decodeJwtPayload(jwt);
  if (!payload) return undefined;
  const id = payload.user_id || payload.userId;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function extractEmailFromPollData(pollData) {
  if (!pollData || typeof pollData !== "object") return undefined;
  const zai = pollData.zai || {};
  const candidates = [
    pollData.email,
    pollData.user_email,
    pollData.userEmail,
    zai.email,
    zai.user_email,
    zai.userEmail,
    zai.account_email,
    pollData.user?.email,
    zai.user?.email,
  ];
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate);
    if (email) return email;
  }
  return undefined;
}

function extractEmailFromCustomerInfo(data) {
  if (!data || typeof data !== "object") return undefined;
  const candidates = [
    data.email,
    data.userEmail,
    data.user_email,
    data.customerEmail,
    data.accountEmail,
    data.loginEmail,
    data.mail,
    data.user?.email,
    data.customer?.email,
    data.profile?.email,
    data.accountInfo?.email,
  ];
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate);
    if (email) return email;
  }
  for (const org of data.organizations || []) {
    const email = normalizeEmail(org.email || org.ownerEmail || org.contactEmail);
    if (email) return email;
  }
  return undefined;
}

export class ZaiAuthFlow {
  constructor(apiBaseUrl = config.apiBaseUrl, pollToken = null) {
    this.apiBaseUrl = apiBaseUrl;
    this.pollToken = pollToken || crypto.randomBytes(32).toString("hex");
  }

  async init() {
    const url = `${this.apiBaseUrl}/oauth/cli/init`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.pollToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider: "zai" }),
    });

    if (!response.ok) {
      throw new Error(`Initialization failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const flowId = json.data?.flow_id;
    const authorizeUrl = json.data?.authorize_url;

    if (!flowId || !authorizeUrl) {
      throw new Error("Incomplete OAuth flow data in response");
    }

    return { flowId, authorizeUrl, pollToken: this.pollToken };
  }

  async poll(flowId) {
    const url = `${this.apiBaseUrl}/oauth/cli/poll/${encodeURIComponent(flowId)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.pollToken}` },
    });

    if (!response.ok) {
      throw new Error(`Polling failed: ${response.status}`);
    }

    const json = await response.json();
    return json.data;
  }

  async exchangeForConnection(accessToken, zcodeJwtToken, pollData = null) {
    const { bizToken, loginData } = await this._fetchBizToken(accessToken);
    const { orgId, projId, customerInfo } = await this._getOrgAndProject(bizToken);
    const fullKey = await this._getOrCreateApiKey(bizToken, orgId, projId);
    const zcodeUserId = extractZcodeUserId(zcodeJwtToken) || extractZcodeUserId(accessToken);

    const email =
      extractEmailFromPollData(pollData) ||
      extractEmailFromCustomerInfo(customerInfo) ||
      normalizeEmail(loginData.email || loginData.userEmail || loginData.user_email) ||
      extractEmailFromJwt(zcodeJwtToken) ||
      extractEmailFromJwt(accessToken) ||
      undefined;

    const zai = pollData?.zai || {};
    const refreshToken =
      typeof zai.refresh_token === "string" && zai.refresh_token.trim()
        ? zai.refresh_token.trim()
        : undefined;
    const expiresIn =
      typeof zai.expires_in === "number" && zai.expires_in > 0
        ? zai.expires_in
        : ZCODE_ZAI_DEFAULT_EXPIRES_IN;

    return {
      apiKey: fullKey,
      accessToken: zcodeJwtToken || undefined,
      ...(refreshToken ? { refreshToken } : {}),
      ...(refreshToken || zai.expires_in
        ? {
            expiresIn,
            expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          }
        : {}),
      email,
      name: email || undefined,
      providerSpecificData: {
        authMethod: "zcode_oauth",
        useCodingPlan: !!zcodeJwtToken,
        zcodeJwtToken: zcodeJwtToken || undefined,
        zaiAccessToken: accessToken,
        ...(refreshToken ? { zaiRefreshToken: refreshToken } : {}),
        ...(zcodeUserId ? { zcodeUserId } : {}),
      },
    };
  }

  async _fetchBizToken(accessToken) {
    const loginRes = await fetch("https://api.z.ai/api/auth/z/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: accessToken }),
    });
    if (!loginRes.ok) throw new Error("Failed to exchange business token");
    const loginJson = await loginRes.json();
    const bizToken = loginJson.data?.access_token || loginJson.data?.accessToken;
    if (!bizToken) throw new Error("Business credentials missing from response");
    return { bizToken, loginData: loginJson.data || {} };
  }

  async _getOrgAndProject(bizToken) {
    const infoRes = await fetch("https://api.z.ai/api/biz/customer/getCustomerInfo", {
      method: "GET",
      headers: { Authorization: `Bearer ${bizToken}` },
    });
    if (!infoRes.ok) throw new Error("Failed to fetch organization info");
    const infoJson = await infoRes.json();

    const orgs = infoJson.data?.organizations || [];
    const targetOrg = orgs.find((o) => o.organizationName?.includes("默认机构")) || orgs[0];
    if (!targetOrg) throw new Error("No available organization found");

    const projects = targetOrg.projects || [];
    const targetProj = projects.find((p) => p.projectName?.includes("默认项目")) || projects[0];
    if (!targetProj) throw new Error("No available project found");

    return {
      orgId: targetOrg.organizationId,
      projId: targetProj.projectId,
      customerInfo: infoJson.data || {},
    };
  }

  async _getOrCreateApiKey(bizToken, orgId, projId) {
    const keyUrl = `https://api.z.ai/api/biz/v1/organization/${orgId}/projects/${projId}/api_keys`;
    const keysRes = await fetch(keyUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${bizToken}` },
    });
    if (!keysRes.ok) throw new Error("Failed to fetch API Keys");
    const keysJson = await keysRes.json();
    const keys = keysJson.data || [];

    let keyObj = keys.find((k) => k.name === "zcode-api-key");
    if (!keyObj) {
      const createRes = await fetch(keyUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bizToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "zcode-api-key" }),
      });
      if (!createRes.ok) throw new Error("Failed to create API Key");
      const createJson = await createRes.json();
      keyObj = createJson.data;
    }

    const apiKey = keyObj?.apiKey;
    if (!apiKey) throw new Error("Failed to obtain API Key");

    const copyRes = await fetch(`${keyUrl}/copy/${encodeURIComponent(apiKey)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bizToken}` },
    });
    if (!copyRes.ok) throw new Error("Failed to fetch Secret Key");
    const copyJson = await copyRes.json();
    const secretKey = copyJson.data?.secretKey;
    if (!secretKey) throw new Error("Failed to decrypt Secret Key");

    return `${apiKey}.${secretKey}`;
  }
}