// MiniMax Code account usage — credits balance, plan tier, and M Plan rate
// windows, read the way MiniMax Code itself reads them (its signed account
// API). Protocol from @magpie-community/opencode-minimax-auth 0.1.1
// (docs/minimax-code-proxy-plan.md §2 / P2).
//
// Signing (account API only — the chat and coding_plan/remains endpoints are
// plain Bearer): the request carries mcode query params, a `yy` md5 over
// path+query, body and now, and `x-signature` md5(ts + secret [+ body]).
//
// Reset cards ("Full reset") live at the bottom of this file: international
// only (minimax-code-global), plain Bearer against the platform host.

import { createHash } from "node:crypto";
import { getLeaseToken, isLeaseConnection } from "./minimaxCodeLease.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const SIGN_SECRET = "I*7Cf%WZ#S&%1RlZJ&C2";

// CN quirk: the chat host is agent.minimax.cn but the account API lives on
// agent.minimaxi.com (plugin SITES table).
const SITES = {
  "minimax-code": { agent: "https://agent.minimaxi.com", platform: "https://www.minimaxi.com", lang: "zh" },
  "minimax-code-global": { agent: "https://agent.minimax.io", platform: "https://platform.minimax.io", lang: "en" },
};

const md5 = (s) => createHash("md5").update(s).digest("hex");
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : undefined);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (o, k) => (typeof o?.[k] === "string" && o[k].trim() ? o[k].trim() : undefined);

/**
 * Build a signed request of MiniMax Code's account API, as mcode signs one:
 * `yy` over the encoded path+query, the JSON body ("{}" for a GET) and md5(now);
 * `x-signature` over ts (and the body of a POST).
 */
export function signedAccountRequest(site, path, { access, userID, body, now = Date.now(), tzOffsetSec = new Date().getTimezoneOffset() * -60 } = {}) {
  const url = new URL(path, site.agent);
  url.search = new URLSearchParams({
    device_platform: "mcode", biz_id: "3", app_id: "3001", version_code: "22201",
    unix: String(now), timezone_offset: String(tzOffsetSec), sys_language: site.lang, lang: site.lang,
    device_id: "0", os_name: process.platform, browser_name: "mcode", user_id: String(userID ?? "").trim() || "0", client: "mcode",
  }).toString();
  const at = url.pathname + url.search;
  const ts = Math.floor(now / 1000);
  const json = body === undefined ? undefined : JSON.stringify(body);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "MiniMaxCode",
    Authorization: `Bearer ${access}`,
    yy: json === undefined
      ? md5(`${encodeURIComponent(at)}_{}${md5(String(now))}ooui`)
      : md5(`${encodeURIComponent(at)}_${json}${md5(String(now))}ooui`),
    "x-timestamp": String(ts),
    "x-signature": json === undefined ? md5(`${ts}${SIGN_SECRET}`) : md5(`${ts}${SIGN_SECRET}${json}`),
  };
  return { url: url.toString(), init: { method: json === undefined ? "GET" : "POST", headers, ...(json === undefined ? {} : { body: json }) } };
}

class AccountRefused extends Error {}

function checked(env, what) {
  const si = obj(env?.statusInfo);
  if (typeof si?.code === "number" && si.code !== 0) {
    if (si.code === 1000048) throw new AccountRefused(`${what}: the sign-in was refused`);
    throw new Error(`${what}: ${str(si, "message") ?? str(si, "msg") ?? "status " + si.code}`);
  }
  const br = obj(env?.base_resp);
  if (typeof br?.status_code === "number" && br.status_code !== 0) {
    throw new Error(`${what}: ${str(br, "status_msg") ?? "status " + br.status_code}`);
  }
  return env;
}

async function accountCall(site, path, opts, what) {
  const { url, init } = signedAccountRequest(site, path, opts);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403) throw new AccountRefused(`${what}: the sign-in was refused (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
  let env;
  try {
    env = obj(JSON.parse(await res.text()));
  } catch {}
  if (!env) throw new Error(`${what}: not JSON`);
  return checked(env, what);
}

/** Who the account is: realUserID, email, name (best-effort). */
export async function getMiniMaxCodeIdentity(site, access) {
  const env = await accountCall(site, "/v1/api/user/info", { access }, "account");
  const d = obj(env.data);
  const u = obj(d?.userInfo) ?? obj(d?.user_info) ?? obj(env.userInfo) ?? obj(env.user_info);
  const id = str(u, "realUserID") ?? str(u, "real_user_id");
  if (!id) throw new Error("account: no user id in the reply");
  const first = (...ks) => ks.map((k) => str(u, k)).find(Boolean);
  return { realUserID: id, email: first("userEmail", "email", "userMail", "user_email"), name: first("name", "userName", "user_name") };
}

/** Read a membership answer (or workspace entry) as mcode does. */
export function parseMembership(e) {
  const d = obj(e?.data);
  const pick = (k) => e?.[k] ?? d?.[k];
  const s = (k) => (typeof pick(k) === "string" && pick(k).trim() ? pick(k).trim() : undefined);
  const has = typeof pick("has_token_plan") === "boolean" ? pick("has_token_plan") : undefined;
  const ends = num(pick("token_plan_expires_at"));
  const sum = obj(e?.op_credit_summary) ?? obj(d?.op_credit_summary);
  const bal = str(sum, "total_remaining_amount") ?? (() => {
    const v = pick("opcredit_balance");
    return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;
  })();
  return {
    ...(has !== undefined ? { hasTokenPlan: has } : {}),
    ...(s("op_group_id") ? { opGroupId: s("op_group_id") } : {}),
    ...(s("token_plan_tier") ? { tier: s("token_plan_tier") } : {}),
    ...(ends > 0 ? { expiresAt: ends } : {}),
    ...(bal !== undefined ? { balance: bal } : {}),
  };
}

/** The account's plan and credits: its own workspace (type 0), then the membership API. */
export async function getMiniMaxCodeMembership(site, access, userID) {
  let ws;
  try {
    const env = await accountCall(site, "/matrix/api/v1/user/get_user_extra_info", { access, userID, body: {} }, "workspace");
    const list = Array.isArray(env.workspaces) ? env.workspaces : Array.isArray(env.data?.workspaces) ? env.data.workspaces : [];
    for (const w of list) {
      if (num(w?.workspace_type) !== 0) continue;
      const id = typeof w.workspace_id === "number" && w.workspace_id >= 0 ? w.workspace_id : str(w, "workspace_id");
      if (id !== undefined) {
        ws = { id, m: parseMembership(w) };
        break;
      }
    }
  } catch (e) {
    if (e instanceof AccountRefused) throw e;
    return parseMembership(await accountCall(site, "/matrix/api/v1/commerce/get_membership_info", { access, userID, body: {} }, "membership"));
  }
  if (!ws) return {};
  try {
    const m = parseMembership(await accountCall(site, "/matrix/api/v1/commerce/get_membership_info", { access, userID, body: { workspace_id: ws.id } }, "membership"));
    const has = ws.m.hasTokenPlan === true || m.hasTokenPlan === true ? true : ws.m.hasTokenPlan === false || m.hasTokenPlan === false ? false : undefined;
    return { ...ws.m, ...m, ...(has !== undefined ? { hasTokenPlan: has } : {}), ...(ws.m.opGroupId || m.opGroupId ? { opGroupId: ws.m.opGroupId ?? m.opGroupId } : {}) };
  } catch (e) {
    if (e instanceof AccountRefused) throw e;
    return ws.m;
  }
}

/** Read the M Plan's rate windows from coding_plan/remains (plain Bearer). */
export async function getMiniMaxPlanWindows(site, access, group) {
  const res = await fetch(`${site.platform}/v1/api/openplatform/coding_plan/remains`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${access}`, ...(group ? { "X-Group-Id": group } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`M Plan: HTTP ${res.status}`);
  return parsePlanWindows(await res.json().catch(() => null));
}

/** Parse coding_plan/remains into {name, used%, remaining%, resetAt} windows. */
export function parsePlanWindows(body) {
  const br = obj(body?.base_resp);
  if (br && typeof br.status_code === "number" && br.status_code !== 0) {
    throw new Error(str(br, "status_msg") ?? `MiniMax said ${br.status_code}`);
  }
  if (!br && !Array.isArray(body?.model_remains)) throw new Error("no plan in the reply");
  const ms = (n) => (n < 1e12 ? n * 1000 : n);
  const zero = (v) => num(v) === 0;
  const out = [];
  for (const k of Array.isArray(body.model_remains) ? body.model_remains : []) {
    const name = String(k?.model_name ?? "").trim();
    if (!name || (num(k.current_interval_status) === 3 && num(k.current_weekly_status) === 3 && zero(k.current_interval_total_count) && zero(k.current_weekly_total_count))) continue;
    const general = name.toLowerCase() === "general";
    for (const x of [
      { left: num(k.current_interval_remaining_percent), status: num(k.current_interval_status) ?? 0, start: num(k.start_time) ?? 0, end: num(k.end_time) ?? 0, week: false },
      { left: num(k.current_weekly_remaining_percent), status: num(k.current_weekly_status) ?? 0, start: num(k.weekly_start_time) ?? 0, end: num(k.weekly_end_time) ?? 0, week: true },
    ]) {
      if (x.status === 3 || (x.left === undefined && x.status !== 2)) continue;
      const left = x.status === 2 ? 0 : Math.max(0, Math.min(100, x.left));
      let span = 0;
      if (x.start > 0 && x.end > x.start) span = ms(x.end) - ms(x.start);
      else if (x.week) span = 7 * 86400_000;
      const label = x.week ? "7 days"
        : span > 86400_000 && span % 86400_000 === 0 ? `${span / 86400_000} days`
        : span >= 3600_000 && span % 3600_000 === 0 ? `${span / 3600_000} hours`
        : span > 0 ? `${Math.floor(span / 60_000)} minutes`
        : "Allowance";
      const windowName = general ? label : `${name[0].toUpperCase() + name.slice(1)} · ${label}`;
      out.push({
        name: windowName,
        used: 100 - left,
        total: 100,
        remaining: left,
        remainingPercentage: left,
        resetAt: x.end > 0 ? new Date(ms(x.end)).toISOString() : null,
      });
    }
  }
  return out;
}

/**
 * Usage handler (USAGE_HANDLERS shape): credits balance, plan, and M Plan
 * windows for one connection. Returns { quotas, user } for the dashboard's
 * parseQuotaData; a refused sign-in becomes an auth-expired message so the
 * route force-refreshes and retries once.
 */
export async function getMiniMaxCodeUsage(connection) {
  const site = SITES[connection.provider];
  // Lease connections store no token — borrow one from the desktop broker;
  // if the app isn't running, usage falls back to the plain "not implemented"
  // message below instead of surfacing a broker error.
  let access = connection.accessToken;
  if (!access && isLeaseConnection(connection)) {
    try {
      access = (await getLeaseToken(connection)).accessToken;
    } catch {
      access = null;
    }
  }
  if (!site || !access) return { message: `Usage API not implemented for ${connection.provider}` };

  try {
    let userID = str(connection.providerSpecificData || {}, "realUserID");
    let who = null;
    if (!userID) {
      who = await getMiniMaxCodeIdentity(site, access);
      userID = who.realUserID;
    }
    const m = await getMiniMaxCodeMembership(site, access, userID);

    const quotas = {};
    if (m.balance !== undefined) {
      const n = Number(m.balance);
      quotas["Credits"] = {
        used: 0,
        total: Number.isFinite(n) ? n : 0,
        isCreditBalance: true,
        currency: "credits",
      };
    }
    if (m.hasTokenPlan && m.opGroupId) {
      try {
        for (const w of await getMiniMaxPlanWindows(site, access, m.opGroupId)) {
          quotas[w.name] = w;
        }
      } catch (e) {
        quotas["M Plan windows"] = { name: "M Plan windows", used: 0, total: 0, resetAt: null, message: e?.message ?? String(e) };
      }
    }
    if (Object.keys(quotas).length === 0) {
      quotas["Plan"] = { name: "Plan", used: 0, total: 0, resetAt: null, message: m.hasTokenPlan === false ? "Free account (no M Plan)" : "No usage data returned" };
    }

    // Reset-card inventory rides along best-effort (international OAuth
    // only): failure omits the key; quotas never depend on it.
    let resetCards;
    if (connection.provider === RESET_CARD_PROVIDER && connection.authType === "oauth") {
      try {
        const inventory = await getMiniMaxResetCards(access, connection.provider, connection.proxyOptions);
        resetCards = { availableCount: inventory.availableCount, cards: inventory.cards.map(({ cardId, type, expiresAt, createdAt }) => ({ cardId, type, expiresAt, createdAt })) };
      } catch { /* best-effort by design */ }
    }

    return {
      quotas,
      plan: m.hasTokenPlan ? (m.tier ? `M Plan ${m.tier}` : "M Plan") : "Free",
      ...(m.expiresAt > 0 ? { planExpiresAt: new Date(m.expiresAt < 1e12 ? m.expiresAt * 1000 : m.expiresAt).toISOString() } : {}),
      user: who?.email || who?.name || str(connection.providerSpecificData || {}, "realUserID") || userID || null,
      ...(resetCards ? { resetCards } : {}),
    };
  } catch (e) {
    if (e instanceof AccountRefused) {
      // Wording matches the route's isAuthExpiredMessage patterns so the
      // OAuth path force-refreshes the token and retries once.
      return { message: `MiniMax Code sign-in expired — unauthorized, please re-authorize (${e.message})` };
    }
    return { message: e?.message ?? String(e) };
  }
}

// Reset cards use plain Bearer OAuth, not account signing. The CN host is unverified.

const RESET_CARD_PROVIDER = "minimax-code-global";
const RESET_AUTH_CODES = new Set([1004, 1011, 1024]);
const RESET_PAGE_SIZE = 5;
// ponytail: 500 cards/events per read; raise the cap or use keyset pagination for larger inventories.
const RESET_MAX_PAGES = 100;
const RESET_TOTAL_MAX = 10000;
const RESET_FLOWS_WINDOW_MS = 30 * 86400000;
const RESET_PAGE_TIMEOUT_MS = 15000; // per page (and the single redemption POST)
const RESET_READ_TIMEOUT_MS = 30000; // entire paginated read, not per page
// ECMAScript date range is |ms| <= 8.64e15; beyond it Date.toISOString throws.
const MAX_EPOCH_MS = 8_640_000_000_000_000;
const RESET_OUTCOMES = new Set(["SUCCESS", "REPLAYED", "EXPIRED", "NOT_FOUND", "RETRYABLE_FAIL", "LOCK_BUSY"]);
const RESET_OUTCOME_MESSAGES = {
  SUCCESS: "Rate limits were reset.",
  REPLAYED: "This reset card was already used.",
  EXPIRED: "The reset card has expired — refresh the inventory.",
  NOT_FOUND: "The reset card no longer exists — refresh the inventory.",
  RETRYABLE_FAIL: "MiniMax refused the reset; try again later.",
  LOCK_BUSY: "MiniMax is busy; try again shortly.",
};

function resetCardError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const resetCardHeaders = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

function resetCardSite(provider, accessToken, action) {
  if (!accessToken) throw resetCardError(`No MiniMax access token available for ${action}; please re-authorize the connection.`, 401);
  if (provider !== RESET_CARD_PROVIDER) {
    throw resetCardError(`MiniMax reset cards are only available for the international (${RESET_CARD_PROVIDER}) connection.`, 400);
  }
  return SITES[RESET_CARD_PROVIDER];
}

/** `status_code` must be exactly the number 0; missing, boolean, or string
 * status codes are invalid. Auth codes 1004/1011/1024 map to 401. */
function readResetEnvelope(payload, action) {
  const br = obj(payload?.base_resp);
  if (!br || typeof br.status_code !== "number") throw resetCardError(`MiniMax ${action} response was invalid (missing status).`, 502);
  if (br.status_code === 0) return payload;
  if (RESET_AUTH_CODES.has(br.status_code)) throw resetCardError(`MiniMax sign-in expired; sign in again (${action}, code ${br.status_code}).`, 401);
  throw resetCardError(`MiniMax rejected the ${action} request (code ${br.status_code}).`, 502);
}

/** Per-page 15s inside the whole-read deadline. AbortSignal.any when the
 * runtime has it (Node 22+); otherwise the shared deadline alone. */
const pageSignal = (deadline) => (
  typeof AbortSignal.any === "function"
    ? AbortSignal.any([deadline, AbortSignal.timeout(RESET_PAGE_TIMEOUT_MS)])
    : deadline
);

/** One strictly validated GET page. Any failure throws a read error. The
 * `deadline` signal spans the entire paginated read that owns this page. */
async function resetCardReadPage(site, path, query, accessToken, proxyOptions, action, deadline) {
  const url = `${site.platform}${path}?${new URLSearchParams(query).toString()}`;
  let response;
  try {
    response = await proxyAwareFetch(url, {
      method: "GET",
      headers: resetCardHeaders(accessToken),
      // Reads must not fall back either: a TLS-retried or redirect-followed
      // response could be a forged inventory whose card identities are then
      // POSTed verbatim.
      strictTls: true,
      redirect: "error",
      signal: pageSignal(deadline),
    }, proxyOptions);
  } catch {
    throw resetCardError(`MiniMax ${action} request failed (network).`, 502);
  }
  if (response.status === 401 || response.status === 403) {
    throw resetCardError(`MiniMax sign-in was refused for ${action} (HTTP ${response.status}).`, response.status);
  }
  if (response.status >= 400 && response.status < 500) {
    // Preserve upstream 4xx verbatim for the route layer.
    throw resetCardError(`MiniMax ${action} request failed (HTTP ${response.status}).`, response.status);
  }
  if (!response.ok) throw resetCardError(`MiniMax ${action} upstream error (HTTP ${response.status}).`, 502);
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw resetCardError(`MiniMax ${action} response was not JSON.`, 502);
  }
  if (!obj(payload)) throw resetCardError(`MiniMax ${action} response was invalid.`, 502);
  return readResetEnvelope(payload, action);
}

/** card_id/source_type/out_biz_no must be non-blank strings (values are
 * server identities and are preserved verbatim — trim is a blank check
 * only); expire_time must be a positive integer epoch-ms within the
 * representable Date range. create_time is not validated — it only feeds the
 * display-only createdAt. */
function validResetCardEntry(card) {
  return obj(card)
    && ["card_id", "source_type", "out_biz_no"].every((k) => typeof card[k] === "string" && card[k].trim())
    && Number.isInteger(card.expire_time)
    && card.expire_time > 0
    && card.expire_time <= MAX_EPOCH_MS;
}

/** ISO string for a positive representable epoch-ms number, else null. */
const isoOrNull = (v) => {
  const t = num(v);
  return t > 0 && t <= MAX_EPOCH_MS ? new Date(t).toISOString() : null;
};

const validResetTotal = (total) => Number.isInteger(total) && total >= 0 && total <= RESET_TOTAL_MAX;

/** Available cards, earliest expiry first; incomplete pagination fails closed. */
export async function getMiniMaxResetCards(accessToken, provider, proxyOptions = null) {
  const site = resetCardSite(provider, accessToken, "reset cards");
  const deadline = AbortSignal.timeout(RESET_READ_TIMEOUT_MS);
  const byId = new Map();
  let page = 1;
  for (;;) {
    const payload = await resetCardReadPage(
      site, "/backend/account/reset_card/list",
      { page, size: RESET_PAGE_SIZE }, accessToken, proxyOptions, "reset cards", deadline,
    );
    const entries = "cards" in payload ? payload.cards : [];
    if (!validResetTotal(payload.total) || !Array.isArray(entries)) {
      throw resetCardError("MiniMax reset-card list was invalid.", 502);
    }
    const before = byId.size;
    for (const card of entries) {
      if (!validResetCardEntry(card)) throw resetCardError("MiniMax reset-card list was invalid.", 502);
      byId.set(card.card_id, card);
    }
    if (byId.size >= payload.total) break;
    if (!entries.length || byId.size === before || page >= RESET_MAX_PAGES) {
      throw resetCardError("MiniMax reset-card list was incomplete; refresh again.", 502);
    }
    page += 1;
  }
  const now = Date.now();
  const cards = [...byId.values()]
    .filter((c) => c.expire_time > now)
    .sort((a, b) => a.expire_time - b.expire_time)
    .map((c) => ({
      cardId: c.card_id,
      source_type: c.source_type,
      out_biz_no: c.out_biz_no,
      type: "FULL",
      expiresAt: new Date(c.expire_time).toISOString(),
      createdAt: isoOrNull(c.create_time),
    }));
  return { availableCount: cards.length, cards };
}

/** Unknown outcomes remain uncertain; the caller must reconcile before an explicit retry. */
export async function redeemMiniMaxResetCard(accessToken, provider, card, proxyOptions = null) {
  const site = resetCardSite(provider, accessToken, "reset redemption");
  const identity = (k) => (typeof card?.[k] === "string" && card[k].trim() ? card[k] : null);
  const sourceType = identity("source_type");
  const outBizNo = identity("out_biz_no");
  const cardId = identity("cardId") || identity("card_id");
  const expiryMs = num(card?.expire_time) ?? (typeof card?.expiresAt === "string" ? Date.parse(card.expiresAt) : NaN);
  if (!cardId || !sourceType || !outBizNo || !Number.isInteger(expiryMs) || expiryMs <= 0 || expiryMs > MAX_EPOCH_MS) {
    return { ok: false, alreadyUsed: false, uncertain: false, attempted: false, status: 400, code: "invalid_card", message: "Invalid reset card identity or expiry." };
  }
  if (expiryMs <= Date.now()) {
    return { ok: false, alreadyUsed: false, uncertain: false, attempted: false, status: 409, code: "EXPIRED", message: RESET_OUTCOME_MESSAGES.EXPIRED };
  }

  let response = null;
  let text = null;
  try {
    response = await proxyAwareFetch(`${site.platform}/backend/account/reset_card/use`, {
      method: "POST",
      headers: resetCardHeaders(accessToken),
      body: JSON.stringify({ source_type: sourceType, out_biz_no: outBizNo }),
      signal: AbortSignal.timeout(RESET_PAGE_TIMEOUT_MS),
      strictTls: true,
      forceFreshSocket: true,
      redirect: "error",
    }, { ...(proxyOptions || {}), strictProxy: true });
    text = await response.text();
  } catch {
    // One attempt only — timeout, redirect, TLS, or proxy refusal included.
    return { ok: false, alreadyUsed: false, uncertain: true, status: 502, code: null, message: "Reset outcome is not confirmed (network failure)." };
  }

  const unconfirmed = (message) => ({ ok: false, alreadyUsed: false, uncertain: true, status: 502, code: null, message });
  if (response.status === 401 || response.status === 403) {
    // No auto-refresh replay from here; the route may re-call explicitly
    // after a forced refresh and reconcile via flows.
    return unconfirmed(`Reset outcome is not confirmed (sign-in refused, HTTP ${response.status}).`);
  }
  if (!response.ok) return unconfirmed(`Reset outcome is not confirmed (HTTP ${response.status}).`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return unconfirmed("Reset outcome is not confirmed (invalid response).");
  }
  const br = obj(payload?.base_resp);
  if (!br || typeof br.status_code !== "number" || br.status_code !== 0) {
    return unconfirmed(br && typeof br.status_code === "number"
      ? `Reset outcome is not confirmed (code ${br.status_code}).`
      : "Reset outcome is not confirmed (invalid status).");
  }
  const outcome = payload.outcome;
  if (typeof outcome !== "string" || !RESET_OUTCOMES.has(outcome)) {
    return unconfirmed("Reset outcome is not confirmed.");
  }
  return {
    ok: outcome === "SUCCESS",
    alreadyUsed: outcome === "REPLAYED",
    uncertain: outcome === "LOCK_BUSY",
    status: outcome === "LOCK_BUSY" ? 502 : outcome === "SUCCESS" || outcome === "REPLAYED" ? 200 : 409,
    code: outcome,
    message: outcome === "LOCK_BUSY" ? "Reset is being processed; refresh to check history before retrying the same card." : RESET_OUTCOME_MESSAGES[outcome],
  };
}

/** Last 30 days of card events; only an exact cardId/USE match confirms redemption. */
export async function getMiniMaxResetCardFlows(accessToken, provider, proxyOptions = null) {
  const site = resetCardSite(provider, accessToken, "reset history");
  const since = Date.now() - RESET_FLOWS_WINDOW_MS; // one cutoff for every page
  const deadline = AbortSignal.timeout(RESET_READ_TIMEOUT_MS);
  const flows = [];
  const seen = new Set();
  let page = 1;
  for (;;) {
    const payload = await resetCardReadPage(
      site, "/backend/account/reset_card/flows",
      { page, size: RESET_PAGE_SIZE, create_time: since },
      accessToken, proxyOptions, "reset history", deadline,
    );
    const entries = "flows" in payload ? payload.flows : [];
    if (!validResetTotal(payload.total) || !Array.isArray(entries)) {
      throw resetCardError("MiniMax reset history was invalid.", 502);
    }
    const before = seen.size;
    for (const flow of entries) {
      if (!obj(flow)) throw resetCardError("MiniMax reset history was invalid.", 502);
      seen.add(`${flow.card_id}\u0000${flow.event_type}\u0000${num(flow.create_time)}`);
      flows.push({
        cardId: typeof flow.card_id === "string" ? flow.card_id : null,
        eventType: typeof flow.event_type === "string" ? flow.event_type : null,
        createdAt: isoOrNull(flow.create_time),
      });
    }
    if (flows.length >= payload.total) break;
    if (!entries.length || seen.size === before) {
      throw resetCardError("MiniMax reset history was incomplete.", 502);
    }
    if (page >= RESET_MAX_PAGES) throw resetCardError("MiniMax reset history was too large.", 502);
    page += 1;
  }
  return flows;
}
