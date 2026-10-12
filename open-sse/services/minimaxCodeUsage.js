// MiniMax Code account usage — credits balance, plan tier, and M Plan rate
// windows, read the way MiniMax Code itself reads them (its signed account
// API). Protocol from @magpie-community/opencode-minimax-auth 0.1.1
// (docs/minimax-code-proxy-plan.md §2 / P2).
//
// Signing (account API only — the chat and coding_plan/remains endpoints are
// plain Bearer): the request carries mcode query params, a `yy` md5 over
// path+query, body and now, and `x-signature` md5(ts + secret [+ body]).

import { createHash } from "node:crypto";

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
  const access = connection.accessToken;
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

    return {
      quotas,
      plan: m.hasTokenPlan ? (m.tier ? `M Plan ${m.tier}` : "M Plan") : "Free",
      ...(m.expiresAt > 0 ? { planExpiresAt: new Date(m.expiresAt < 1e12 ? m.expiresAt * 1000 : m.expiresAt).toISOString() } : {}),
      user: who?.email || who?.name || str(connection.providerSpecificData || {}, "realUserID") || userID || null,
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
