import { GITHUB_COPILOT } from "../config/appConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const TOKEN_EXCHANGE_URL = "https://api.github.com/copilot_internal/v2/token";
const COMPLETIONS_URL = "https://api.githubcopilot.com/chat/completions";
const MODELS_URL = "https://api.githubcopilot.com/models";
export const COPILOT_STATUS_PROBE_MODEL = "claude-opus-4.7";
const PREFERRED_PROBE_MODELS = [
  "claude-opus-4.7",
  "claude-sonnet-4.6",
  "claude-opus-4.6",
  "gpt-5.4-mini",
  "claude-haiku-4.5",
];

const FREE_SKUS = new Set(["free_limited_copilot"]);
const BANNED_NOTIFICATION_IDS = new Set(["spammy_user", "suspended_user", "flagged_user"]);
const DEFAULT_ACCOUNT_LOCK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MS = 10 * 60 * 1000;
const DEFAULT_WEEKLY_RATE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

const SKU_TIERS = {
  free_limited_copilot: "free",
  monthly_subscriber_quota: "pro",
  yearly_subscriber_quota: "pro",
  plus_monthly_subscriber_quota: "pro+",
  plus_yearly_subscriber_quota: "pro+",
  copilot_enterprise_seat_quota: "enterprise",
  copilot_business_seat_quota: "business",
};

function getHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  if (typeof headers.entries === "function") {
    const lower = name.toLowerCase();
    for (const [k, v] of headers.entries()) {
      if (String(k).toLowerCase() === lower) return Array.isArray(v) ? v[0] : String(v);
    }
  }
  return "";
}

function parseJsonMaybe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function nowPlus(ms) {
  return new Date(Date.now() + ms).toISOString();
}

export function parseCopilotRuntimeToken(runtimeToken = "") {
  const meta = {};
  for (const field of String(runtimeToken).split(";")) {
    const [key, ...rest] = field.trim().split("=");
    if (key && rest.length) meta[key] = rest.join("=");
  }
  const sku = meta.sku || "";
  return {
    sku,
    tier: SKU_TIERS[sku] || (sku ? sku : "?"),
    proxyEndpoint: meta["proxy-ep"] || "",
  };
}

export function classifyCopilotTokenExchange(status, bodyText = "") {
  const body = parseJsonMaybe(bodyText);
  const errorDetails = body?.error_details || {};
  const notificationId = errorDetails.notification_id || "";
  const message = body?.message || body?.error_description || body?.error || bodyText || `http_${status}`;
  const lower = String(message).toLowerCase();

  if (status === 401) {
    return { status: "dead", valid: false, error: "token_invalid", lockUntil: nowPlus(DEFAULT_ACCOUNT_LOCK_MS) };
  }
  if (status === 403) {
    if (BANNED_NOTIFICATION_IDS.has(notificationId) || (!notificationId && (lower.includes("not accessible") || lower.includes("scraping")))) {
      return { status: "banned", valid: false, error: notificationId || String(message).slice(0, 120), lockUntil: nowPlus(DEFAULT_ACCOUNT_LOCK_MS) };
    }
    return { status: "forbidden", valid: false, error: notificationId || String(message).slice(0, 120), lockUntil: nowPlus(DEFAULT_ACCOUNT_LOCK_MS) };
  }
  return { status: "error", valid: false, error: String(message).slice(0, 120), lockUntil: nowPlus(DEFAULT_RATE_LIMIT_MS) };
}

async function resolveProbeModel(runtimeToken, proxyOptions, requestedModel) {
  if (requestedModel) return requestedModel;
  try {
    const response = await proxyAwareFetch(MODELS_URL, {
      headers: buildCopilotHeaders(runtimeToken, true),
    }, proxyOptions);
    if (!response.ok) return COPILOT_STATUS_PROBE_MODEL;
    const data = await response.json();
    const enabled = new Set((Array.isArray(data?.data) ? data.data : [])
      .filter((m) => m?.capabilities?.type === "chat" && (!m.policy || m.policy.state === "enabled"))
      .map((m) => m.id));
    return PREFERRED_PROBE_MODELS.find((model) => enabled.has(model)) || enabled.values().next().value || COPILOT_STATUS_PROBE_MODEL;
  } catch {
    return COPILOT_STATUS_PROBE_MODEL;
  }
}

function buildCopilotHeaders(token, bearer = true) {
  const authValue = bearer ? `Bearer ${token}` : `token ${token}`;
  return {
    Authorization: authValue,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Copilot-Integration-Id": "vscode-chat",
    "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
    "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
    "User-Agent": GITHUB_COPILOT.USER_AGENT,
    "X-GitHub-Api-Version": GITHUB_COPILOT.API_VERSION,
  };
}

export async function exchangeCopilotRuntimeToken(accessToken, proxyOptions = null) {
  if (!accessToken) return { valid: false, status: "dead", error: "No GitHub access token", lockUntil: nowPlus(DEFAULT_ACCOUNT_LOCK_MS) };

  const response = await proxyAwareFetch(TOKEN_EXCHANGE_URL, {
    headers: buildCopilotHeaders(accessToken, false),
  }, proxyOptions);
  const text = await response.text();

  if (!response.ok) {
    return {
      ...classifyCopilotTokenExchange(response.status, text),
      httpStatus: response.status,
    };
  }

  const payload = parseJsonMaybe(text);
  const runtimeToken = payload?.token || "";
  const tokenExpiresAt = payload?.expires_at || null;
  const meta = parseCopilotRuntimeToken(runtimeToken);

  if (!runtimeToken) {
    return { valid: false, status: "error", error: "Copilot token exchange returned no runtime token", lockUntil: nowPlus(DEFAULT_RATE_LIMIT_MS) };
  }

  if (FREE_SKUS.has(meta.sku)) {
    return {
      valid: false,
      status: "free",
      error: "free_limited_copilot",
      runtimeToken,
      tokenExpiresAt,
      ...meta,
      lockUntil: nowPlus(DEFAULT_ACCOUNT_LOCK_MS),
    };
  }

  return {
    valid: true,
    status: "exchange_ok",
    runtimeToken,
    tokenExpiresAt,
    ...meta,
  };
}

function classifyCompletionRateLimit(response, bodyText, model) {
  const retryAfterRaw = getHeader(response.headers, "retry-after") || getHeader(response.headers, "x-ratelimit-timeremaining");
  const retryAfterSeconds = Number.parseInt(retryAfterRaw || "0", 10);
  const retryMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : 0;
  const rateLimitType = getHeader(response.headers, "x-ratelimit-type").toLowerCase();
  const bodyLower = String(bodyText || "").toLowerCase();

  let status = "ratelimit";
  let lockUntil = nowPlus(retryMs || DEFAULT_RATE_LIMIT_MS);
  let modelLockUntil = null;

  if (rateLimitType.includes("byweek") || bodyLower.includes("weekly rate limit") || bodyLower.includes("weekly_rate_limit")) {
    status = "weekly_ratelimit";
    lockUntil = nowPlus(retryMs || DEFAULT_WEEKLY_RATE_LIMIT_MS);
  } else if (rateLimitType.includes("global") || bodyLower.includes("global")) {
    status = "global_ratelimit";
    lockUntil = nowPlus(retryMs || DEFAULT_RATE_LIMIT_MS);
  } else if (rateLimitType.includes("byday") || rateLimitType.includes("bymodelby")) {
    status = "daily_ratelimit";
    modelLockUntil = nowPlus(retryMs || DEFAULT_RATE_LIMIT_MS);
    lockUntil = null;
  }

  return {
    valid: false,
    status,
    error: [rateLimitType || "429", retryAfterSeconds ? `retry-after=${retryAfterSeconds}s` : ""].filter(Boolean).join(" "),
    lockUntil,
    modelLock: modelLockUntil ? { model, until: modelLockUntil } : null,
    retryAfterSeconds: retryAfterSeconds || null,
  };
}

export async function probeCopilotCompletion(runtimeToken, options = {}) {
  const model = await resolveProbeModel(runtimeToken, options.proxyOptions || null, options.model);
  const response = await proxyAwareFetch(COMPLETIONS_URL, {
    method: "POST",
    headers: buildCopilotHeaders(runtimeToken, true),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
      stream: false,
    }),
  }, options.proxyOptions || null);

  const text = await response.text();
  if (response.ok) return { valid: true, status: "active", error: null, probeModel: model };
  if (response.status === 429) return { ...classifyCompletionRateLimit(response, text, model), probeModel: model };

  const parsed = parseJsonMaybe(text);
  const message = parsed?.error?.message || parsed?.message || text || `http_${response.status}`;
  return {
    valid: false,
    status: response.status === 401 ? "dead" : response.status === 403 ? "forbidden" : "error",
    error: String(message).slice(0, 160),
    lockUntil: nowPlus(response.status === 401 || response.status === 403 ? DEFAULT_ACCOUNT_LOCK_MS : DEFAULT_RATE_LIMIT_MS),
    probeModel: model,
  };
}

export async function checkCopilotProfileStatus(accessToken, options = {}) {
  const exchanged = await exchangeCopilotRuntimeToken(accessToken, options.proxyOptions || null);
  if (!exchanged.valid) return exchanged;
  if (!options.probeCompletion) return { ...exchanged, status: "active" };

  const probed = await probeCopilotCompletion(exchanged.runtimeToken, {
    proxyOptions: options.proxyOptions || null,
    model: options.model,
  });

  return {
    ...exchanged,
    ...probed,
    runtimeToken: exchanged.runtimeToken,
    tokenExpiresAt: exchanged.tokenExpiresAt,
    sku: exchanged.sku,
    tier: exchanged.tier,
    proxyEndpoint: exchanged.proxyEndpoint,
  };
}
