/**
 * Qoder PAT (Personal Access Token) → job-token exchange.
 *
 * Wire contract:
 *   A PAT (`pt-...`) cannot sign COSY requests — the signature scheme expects a
 *   device/job token plus a userId. The official qodercli flow therefore does:
 *
 *     1. POST {profile.jobTokenExchangeUrl}  (plain JSON, NOT cosy-signed)
 *          body: { "personal_token": "pt-..." }
 *          200 : { token: "jt-...", refresh_token?: string,
 *                  expires_at?: <date string>, expires_in?: <number> }
 *     2. GET  {profile.userInfoUrl}  with `Authorization: Bearer <jobToken>`
 *          200 : { id | userId | user_id }  → the uid COSY signing needs.
 *
 *   The job token is short-lived, so the pair is cached per-PAT and reused
 *   while more than PAT_REFRESH_BUFFER_MS remains before expiry.
 *
 * Both URLs come off the resolved Profile, so the same flow works for intl
 * (openapi.qoder.sh) and cn-work (openapi.qoder.com.cn).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { resolveProfile } from "./profile.js";

const PAT_PREFIX = "pt-";

/** Re-exchange once the cached job token is this close to expiry. */
const PAT_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Job token lifetime when the server reports neither expires_at nor expires_in. */
const PAT_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** @type {Map<string, { accessToken: string, userId: string, expiresAt: number }>} */
const patJobCache = new Map();

const PAT_USER_AGENT = "qodercli/1.0.0";

/**
 * @param {unknown} token
 * @returns {boolean} true for a Qoder personal access token (`pt-...`)
 */
export function isQoderPat(token) {
  return typeof token === "string" && token.startsWith(PAT_PREFIX);
}

/**
 * @param {string} pat
 * @param {import("./profile.js").QoderProfile} profile
 * @param {any} proxyOptions
 * @param {AbortSignal | null} signal
 */
async function exchangeJobToken(pat, profile, proxyOptions, signal) {
  const res = await proxyAwareFetch(
    profile.jobTokenExchangeUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": PAT_USER_AGENT,
        "Cosy-Version": profile.ideVersion,
        "Cosy-ClientType": profile.clientType,
      },
      body: JSON.stringify({ personal_token: pat }),
      signal,
    },
    proxyOptions,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`qoder PAT exchange failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error("qoder PAT exchange returned no job token");

  let expiresAt = Date.now() + PAT_DEFAULT_TTL_MS;
  if (data.expires_at) {
    const parsed = Date.parse(data.expires_at);
    if (!Number.isNaN(parsed)) expiresAt = parsed;
  } else if (typeof data.expires_in === "number" && data.expires_in > 0) {
    expiresAt = Date.now() + data.expires_in;
  }
  return { jobToken: data.token, jobRefreshToken: data.refresh_token || "", expiresAt };
}

/**
 * Resolve the uid a job token belongs to. Failure is tolerated (returns "")
 * because a stored providerSpecificData.userId may still cover signing.
 * @param {string} jobToken
 * @param {import("./profile.js").QoderProfile} profile
 * @param {any} proxyOptions
 * @param {AbortSignal | null} signal
 */
async function fetchUserIdForJobToken(jobToken, profile, proxyOptions, signal) {
  try {
    const res = await proxyAwareFetch(
      profile.userInfoUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jobToken}`,
          Accept: "application/json",
          "User-Agent": PAT_USER_AGENT,
        },
        signal,
      },
      proxyOptions,
    );
    if (!res.ok) return "";
    const info = await res.json().catch(() => ({}));
    return info.id || info.userId || info.user_id || "";
  } catch {
    return "";
  }
}

/**
 * Exchange a PAT for a job token + userId, caching until near-expiry so repeat
 * chat requests don't re-exchange.
 *
 * @param {string} pat
 * @param {object} [options]
 * @param {string | import("./profile.js").QoderProfile | null} [options.profile]
 * @param {any} [options.proxyOptions]
 * @param {AbortSignal | null} [options.signal]
 * @returns {Promise<{ accessToken: string, userId: string, expiresAt: number }>}
 */
export async function resolvePatCredential(pat, options = {}) {
  const profile = resolveProfile(options.profile);
  const proxyOptions = options.proxyOptions ?? null;
  const signal = options.signal ?? null;

  // Cache key includes the profile so the same PAT string never leaks a
  // cn-work job token into an intl connection (or vice versa).
  const cacheKey = `${profile.id}:${pat}`;
  const cached = patJobCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > PAT_REFRESH_BUFFER_MS) {
    return cached;
  }
  const { jobToken, expiresAt } = await exchangeJobToken(pat, profile, proxyOptions, signal);
  const userId = await fetchUserIdForJobToken(jobToken, profile, proxyOptions, signal);
  const entry = { accessToken: jobToken, userId, expiresAt };
  patJobCache.set(cacheKey, entry);
  return entry;
}

/** Test seam — drop cached job tokens. */
export function clearPatCache() {
  patJobCache.clear();
}
