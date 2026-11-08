// ZCode (Z.ai / BigModel) plan resolution + coding-plan credential minting.
// Mirrors the desktop client's own chain: subscription list -> project key ->
// project access token, with the start-plan lane using the zcode JWT directly.

const ZCODE_CLIENT_VERSION = "3.17.1";
// The start-plan gateway (zcode.z.ai) currently only admits the 3.16.3 client
// fingerprint; newer declared versions get HTTP 405 code 3012 "unusual activity".
export const ZCODE_START_CLIENT_VERSION = "3.16.3";
const ZCODE_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 4 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const FAMILY_ORIGIN = {
  zai: "https://api.z.ai",
  bigmodel: "https://open.bigmodel.cn",
};

const INDIVIDUAL_BASE = {
  zai: "https://api.z.ai/api/anthropic",
  bigmodel: "https://open.bigmodel.cn/api/anthropic",
};

export const ZCODE_START_BASE = "https://zcode.z.ai/api/v1/zcode-plan/anthropic";
export const ZCODE_START_MODELS = ["GLM-5.3-Flash", "GLM-5.2", "GLM-5-Turbo"];
export const ZCODE_CODING_PLAN_MODELS = ["GLM-5.3", "GLM-5.3-Flash"];

const resolveCache = new Map();

function normalizeFamily(family) {
  return family === "bigmodel" ? "bigmodel" : "zai";
}

function bearer(token) {
  return `Bearer ${String(token || "").replace(/^Bearer\s+/i, "").trim()}`;
}

function businessAuth(family, token) {
  // Personal key listing takes Z.ai as Bearer and BigModel as the raw token.
  return family === "zai" ? bearer(token) : String(token || "").trim();
}

function cacheGet(key) {
  const entry = resolveCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    resolveCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs = CACHE_TTL_MS) {
  if (resolveCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = resolveCache.keys().next().value;
    if (oldest !== undefined) resolveCache.delete(oldest);
  }
  resolveCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearZcodePlanCache(connectionId = null) {
  if (!connectionId) {
    resolveCache.clear();
    return;
  }
  for (const key of resolveCache.keys()) {
    if (key.startsWith(`${connectionId}:`)) resolveCache.delete(key);
  }
}

async function requestJson(url, { method = "GET", headers = {}, body = null, log = null } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(ZCODE_TIMEOUT_MS),
    });
  } catch (error) {
    log?.warn?.("ZCODE", `${method} ${new URL(url).pathname} failed: ${error?.message || error}`);
    throw new Error(`ZCode request failed: ${error?.message || error}`);
  }

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON upstream error page.
  }

  const envelopeOk =
    json &&
    json.success !== false &&
    (json.code === undefined || json.code === 0 || json.code === 200);

  if (!response.ok || !envelopeOk) {
    const message =
      json?.msg || json?.message || json?.error_description || text.slice(0, 200) || `HTTP ${response.status}`;
    log?.warn?.("ZCODE", `${method} ${new URL(url).pathname} ${response.status}: ${String(message).slice(0, 200)}`);
    throw new Error(`ZCode ${method} ${new URL(url).pathname} ${response.status}: ${message}`);
  }

  return json?.data ?? json;
}

// Refreshes the zcode JWT (the start-plan model credential) from the Z.AI
// business access token, mirroring the desktop client's /api/auth/z/login call.
export async function refreshZcodeJwt(businessAccessToken, { log = null } = {}) {
  const token = String(businessAccessToken || "").trim();
  if (!token) return null;
  const data = await requestJson("https://api.z.ai/api/auth/z/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { token },
    log,
  });
  const zcodeJwtToken = String(data?.token || data?.access_token || data?.accessToken || "").trim();
  if (!zcodeJwtToken) return null;
  return { zcodeJwtToken };
}

// Personal subscriptions are an array of products; an active entry must both
// belong to a coding plan and be inside its current billing period.
export function hasActiveCodingPlan(subscriptions) {
  if (!Array.isArray(subscriptions)) return false;
  return subscriptions.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const product = `${entry.productId || ""} ${entry.productName || ""}`.toLowerCase();
    return (
      product.includes("coding") &&
      String(entry.status || "").toUpperCase() === "VALID" &&
      entry.inCurrentPeriod === true
    );
  });
}

// Team plan subscriptions use a different shape; any EFFECTIVE entry with a
// valid member grant means the selected project is entitled.
export function isTeamPlanEntitled(entry) {
  if (!entry || typeof entry !== "object") return false;
  return (
    entry.hasSubscription === true &&
    String(entry.status || "").toUpperCase() === "EFFECTIVE" &&
    String(entry.memberGrantStatus || "").toUpperCase() === "VALID"
  );
}

// The desktop client filters out projectType "2" for personal projects and
// prefers the default organization/project names.
export function selectDefaultProject(organizations, team = null) {
  const list = Array.isArray(organizations) ? organizations : [];
  if (team?.organizationId && team?.projectId) {
    const org = list.find((item) => String(item?.organizationId || "").trim() === team.organizationId.trim());
    const project = (org?.projects || []).find((item) => String(item?.projectId || "").trim() === team.projectId.trim());
    if (!org || !project) throw new Error("ZCode team project not found on this account");
    return { organizationId: org.organizationId, projectId: project.projectId };
  }

  const personalOrgs = list
    .map((org) => ({
      ...org,
      projects: (org?.projects || []).filter((project) => String(project?.projectType ?? "").trim() !== "2"),
    }))
    .filter((org) => org.organizationId && org.projects.length > 0);

  const org =
    personalOrgs.find((item) => String(item.organizationName || "").includes("默认机构")) || personalOrgs[0];
  const project =
    org?.projects.find((item) => String(item.projectName || "").includes("默认项目")) || org?.projects[0];

  if (!org?.organizationId || !project?.projectId) {
    throw new Error("ZCode account has no usable organization/project");
  }
  return { organizationId: org.organizationId, projectId: project.projectId };
}

function apiKeysUrl(origin, { organizationId, projectId }) {
  return `${origin}/api/biz/v1/organization/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/api_keys`;
}

async function resolveProjectMaterial({ family, businessToken, team, log }) {
  const origin = FAMILY_ORIGIN[family];
  const info = await requestJson(`${origin}/api/biz/customer/getCustomerInfo`, {
    headers: { Authorization: bearer(businessToken), "Content-Type": "application/json" },
    log,
  });
  const { organizationId, projectId } = selectDefaultProject(info?.organizations, team);

  const keyName = team ? "zcode-team-api-key" : "zcode-api-key";
  const keyListHeaders = {
    Authorization: team ? String(businessToken).trim() : businessAuth(family, businessToken),
    "Content-Type": "application/json",
    ...(team
      ? {
          "bigmodel-organization": organizationId,
          "bigmodel-project": projectId,
        }
      : {}),
  };
  const keysUrl = apiKeysUrl(origin, { organizationId, projectId });

  let keys = await requestJson(keysUrl, { headers: keyListHeaders, log });
  if (!Array.isArray(keys)) keys = [];

  let key = keys.find((item) => {
    if (!item || item.name !== keyName) return false;
    return team ? item.keyType === 2 : true;
  });

  if (!key) {
    key = await requestJson(keysUrl, {
      method: "POST",
      headers: keyListHeaders,
      body: {
        name: keyName,
        ...(team ? { keyType: 2 } : {}),
        usageScene: 1,
      },
      log,
    });
  }

  const apiKeyId = key?.apiKey;
  if (!apiKeyId) throw new Error("ZCode project API key is unavailable");

  const minted = await requestJson(
    `${keysUrl}/${encodeURIComponent(apiKeyId)}/access_tokens`,
    {
      method: "POST",
      headers: { Authorization: bearer(businessToken), "Content-Type": "application/json" },
      body: { clientType: "zcode", clientVersion: ZCODE_CLIENT_VERSION },
      log,
    }
  );

  if (!minted?.enabled || !minted?.accessToken) {
    throw new Error("ZCode project access token is disabled or missing");
  }

  const expiresAt = Number(minted.expiresAt);
  return {
    apiKey: minted.accessToken,
    apiKeyId,
    organizationId,
    projectId,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt * 1000 : Date.now() + CACHE_TTL_MS,
  };
}

function persistedPlan(credentials, family, requestedPlan) {
  const psd = credentials?.providerSpecificData || {};
  if (psd.zcodeFamily && psd.zcodeFamily !== family) return null;
  const resolved = psd.zcodePlan;
  if (!resolved) return null;
  if (requestedPlan !== "auto" && requestedPlan !== resolved) return null;

  if (resolved === "start-plan") {
    // Only explicit start-plan selection keeps this without revalidation; in
    // auto mode the subscription list is re-read (memoized for a few minutes)
    // so an account that later buys a coding plan moves to the project lane.
    if (requestedPlan !== "start-plan" || !psd.zcodeJwtToken) return null;
    return {
      planKind: "start-plan",
      lane: "start",
      clientVersion: ZCODE_START_CLIENT_VERSION,
      family,
      baseUrl: psd.zcodeBaseUrl || ZCODE_START_BASE,
      apiKey: psd.zcodeJwtToken,
      headers: {},
      models: psd.zcodePlanModels || ZCODE_START_MODELS,
      expiresAt: Date.now() + CACHE_TTL_MS,
      persist: {},
    };
  }

  if (resolved === "individual-coding-plan" || resolved === "team-coding-plan") {
    const expiresAt = Date.parse(psd.zcodeProjectTokenExpiresAt || "");
    if (!psd.zcodeProjectToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 120000) return null;
    return {
      planKind: resolved,
      lane: "project",
      clientVersion: ZCODE_CLIENT_VERSION,
      family,
      baseUrl: psd.zcodeBaseUrl || INDIVIDUAL_BASE[family],
      apiKey: psd.zcodeProjectToken,
      headers:
        resolved === "team-coding-plan" && psd.zcodeOrganizationId && psd.zcodeProjectId
          ? {
              "Bigmodel-Organization": psd.zcodeOrganizationId,
              "Bigmodel-Project": psd.zcodeProjectId,
            }
          : {},
      models: psd.zcodePlanModels || ZCODE_CODING_PLAN_MODELS,
      expiresAt,
      persist: {},
    };
  }

  return null;
}

function startPlanResult(family, zcodeJwtToken) {
  return {
    planKind: "start-plan",
    lane: "start",
    clientVersion: ZCODE_START_CLIENT_VERSION,
    family,
    baseUrl: ZCODE_START_BASE,
    apiKey: zcodeJwtToken,
    headers: {},
    models: ZCODE_START_MODELS,
    expiresAt: Date.now() + CACHE_TTL_MS,
    persist: {
      zcodePlan: "start-plan",
      zcodeFamily: family,
      zcodeBaseUrl: ZCODE_START_BASE,
      zcodePlanModels: ZCODE_START_MODELS,
    },
  };
}

function codingPlanResult(family, material, team) {
  const planKind = team ? "team-coding-plan" : "individual-coding-plan";
  return {
    planKind,
    lane: "project",
    clientVersion: ZCODE_CLIENT_VERSION,
    family,
    baseUrl: INDIVIDUAL_BASE[family],
    apiKey: material.apiKey,
    headers: team
      ? {
          "Bigmodel-Organization": material.organizationId,
          "Bigmodel-Project": material.projectId,
        }
      : {},
    models: ZCODE_CODING_PLAN_MODELS,
    expiresAt: material.expiresAt,
    persist: {
      zcodePlan: planKind,
      zcodeFamily: family,
      zcodeBaseUrl: INDIVIDUAL_BASE[family],
      zcodePlanModels: ZCODE_CODING_PLAN_MODELS,
      zcodeProjectToken: material.apiKey,
      zcodeProjectTokenExpiresAt: new Date(material.expiresAt).toISOString(),
      zcodeOrganizationId: material.organizationId,
      zcodeProjectId: material.projectId,
      zcodeApiKeyId: material.apiKeyId,
    },
  };
}

/**
 * Resolve the coding-plan lane and a ready-to-use model API key.
 * credentials: { accessToken (business token), providerSpecificData }
 */
export async function resolveZcodeAuth(credentials, { log = null, force = false } = {}) {
  const psd = credentials?.providerSpecificData || {};
  const family = normalizeFamily(psd.family);
  const requestedPlan = ["start-plan", "individual-coding-plan", "team-coding-plan"].includes(psd.planKind)
    ? psd.planKind
    : "auto";
  const businessToken = String(credentials?.accessToken || "").trim();
  const zcodeJwtToken = String(psd.zcodeJwtToken || "").trim();

  if (!force) {
    const persisted = persistedPlan(credentials, family, requestedPlan);
    if (persisted) return persisted;

    const cacheKey = `${credentials?.connectionId || "anon"}:${family}:${requestedPlan}:${businessToken.slice(-24)}:${zcodeJwtToken.slice(-24)}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const cacheKey = `${credentials?.connectionId || "anon"}:${family}:${requestedPlan}:${businessToken.slice(-24)}:${zcodeJwtToken.slice(-24)}`;
  const team = psd.zcodeTeam && typeof psd.zcodeTeam === "object" ? psd.zcodeTeam : null;
  const wantsTeam = requestedPlan === "team-coding-plan";
  const wantsStart = requestedPlan === "start-plan";
  const wantsIndividual = requestedPlan === "individual-coding-plan";

  let result;
  if (wantsStart) {
    if (!zcodeJwtToken) throw new Error("ZCode start plan requires an OAuth reconnect");
    result = startPlanResult(family, zcodeJwtToken);
  } else if (wantsTeam || wantsIndividual) {
    if (!businessToken) throw new Error("ZCode business token is missing; reconnect the account");
    if (wantsTeam && !team?.organizationId) throw new Error("ZCode team plan requires organizationId/projectId");
    const material = await resolveProjectMaterial({
      family,
      businessToken,
      team: wantsTeam ? team : null,
      log,
    });
    result = codingPlanResult(family, material, wantsTeam);
  } else {
    // Auto: an active personal coding subscription selects the project-token
    // lane; otherwise the account falls back to its start-plan JWT.
    let individual = false;
    if (businessToken) {
      try {
        const subscriptions = await requestJson(`${FAMILY_ORIGIN[family]}/api/biz/subscription/list`, {
          headers: { Authorization: bearer(businessToken), "Content-Type": "application/json" },
          log,
        });
        individual = hasActiveCodingPlan(subscriptions);
      } catch (error) {
        log?.debug?.("ZCODE", `subscription lookup failed: ${error?.message || error}`);
      }
    }

    if (individual || team) {
      try {
        const material = await resolveProjectMaterial({
          family,
          businessToken,
          team: team || null,
          log,
        });
        result = codingPlanResult(family, material, Boolean(team));
      } catch (error) {
        if (!zcodeJwtToken) throw error;
        log?.warn?.("ZCODE", `project token unavailable, using start plan: ${error?.message || error}`);
        result = startPlanResult(family, zcodeJwtToken);
      }
    } else if (zcodeJwtToken) {
      result = startPlanResult(family, zcodeJwtToken);
    } else {
      throw new Error("ZCode plan cannot be resolved: no coding subscription and no zcode JWT");
    }
  }

  cacheSet(cacheKey, result);
  return result;
}
