/**
 * Qoder 每日签到 / 活动领取 / Pro 福利包 客户端
 * （移植自 qoder2api-hub / qoder_tasks.py + qoder_accounts.py 的 campaign* 部分）。
 *
 * 上层是官方「活动平台」（/sash/api/v1/me/campaigns）：
 *   - 「每日领取 100 Credits」等限时活动都由它承载，双区域通用；
 *   - 取列表必须**两层同时正确**（缺一层服务端不报错、只静默少活动）：
 *       ① 桌面端请求头（cosy-clienttype=10 等）
 *       ② 服务端认可的**真实机器身份**（原生桥 runtime-info.exe 取，见 nativeIdentity.js）
 *   - 领取：POST …/campaigns/{id}/claim，官方幂等（已领返回 replayed）；
 *     服务端按「人」去重，同机多号会返回 SAME_PERSON_ALREADY_CLAIMED → 记冷却。
 *
 * 账号级状态（lastCheckin / campaignCodes / campaignBlockedUntil / plan）持久化在
 * providerConnections 的 JSON data 里，重启不丢。
 *
 * 本模块**仅供服务端**使用（API 路由 / 调度器）。
 * [qoder 权益 v0.6.0]
 */

import * as log from "@/sse/utils/logger.js";

import {
  QODER_CAMPAIGNS_TTL_MS,
  QODER_CAMPAIGN_BLOCKED_COOLDOWN_MS,
  QODER_CAMPAIGN_FAILURE_CN,
  QODER_CHECKIN_PROBE_TTL_MS,
  QODER_DESKTOP_CLIENT_TYPE,
  QODER_MACHINE_HOSTNAME,
  QODER_MACHINE_OS_DESKTOP,
  qoderCampaignClaimUrl,
  qoderCampaignRewardUrl,
  qoderCampaignsUrl,
  qoderCheckinClaimUrl,
  qoderCheckinStatusUrl,
  qoderDesktopVersion,
  qoderPlanUrl,
  qoderProClaimUrl,
  qoderProEligibilityUrl,
  qoderRegionOf,
  qoderWebsiteUrl,
} from "open-sse/shared/qoder/constants.js";
import {
  deriveMachineCode,
  deriveMachineId,
  deriveMachineToken,
  deriveMachineType,
  deriveSessionId,
  generateRequestId,
} from "open-sse/shared/qoder/fingerprint.js";
import { nativeMachineIdentity } from "open-sse/shared/qoder/nativeIdentity.js";

// ---------------------------------------------------------------------------
// 连接 → 协议字段
// ---------------------------------------------------------------------------
export function regionOf(conn) {
  return qoderRegionOf(conn?.provider);
}

/** 账号 UID：优先 providerSpecificData.userId（OAuth/PAT 入池时写入）。 */
export function uidOf(conn) {
  const psd = conn?.providerSpecificData || {};
  return String(psd.userId || psd.qoderUserId || "").trim() || String(conn?.id || "");
}

/** 可用的 Bearer 令牌：OAuth 用 accessToken，PAT 连接回退 apiKey。 */
export function tokenOf(conn) {
  return String(conn?.accessToken || conn?.apiKey || "").trim();
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function httpJson(url, { method = "GET", headers, body, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    return { ok: false, status: 0, json: null, text: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function baseHeaders(conn) {
  const region = regionOf(conn);
  const uid = uidOf(conn);
  const website = qoderWebsiteUrl(region);
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "User-Agent": "Go-http-client/2.0",
    Authorization: `Bearer ${tokenOf(conn)}`,
    "X-Request-ID": generateRequestId(uid),
    "X-Machine-ID": deriveMachineId(uid),
    "X-Session-ID": deriveSessionId(uid),
    Origin: website,
    Referer: `${website}/`,
  };
}

/**
 * 桌面端同款请求头（活动平台必需）。
 * 机器身份优先用官方原生桥真值，取不到回退稳定派生值。
 * @returns {{headers: Record<string,string>, identitySource: "runtime-info"|"derived"}}
 */
export function desktopHeaders(conn) {
  const region = regionOf(conn);
  const uid = uidOf(conn);
  const headers = baseHeaders(conn);
  headers["User-Agent"] = "Qoder";
  headers["cosy-clienttype"] = QODER_DESKTOP_CLIENT_TYPE;
  headers["cosy-version"] = qoderDesktopVersion();
  const ident = nativeMachineIdentity(region, uid);
  headers["cosy-machineid"] = deriveMachineId(uid);
  headers["cosy-machinetoken"] = ident.machineToken || deriveMachineToken(uid);
  headers["cosy-machinetype"] = ident.machineType || deriveMachineType(uid);
  headers["cosy-machinecode"] = ident.machineCode || deriveMachineCode(uid);
  headers["cosy-machineos"] = QODER_MACHINE_OS_DESKTOP;
  headers["cosy-machinehostname"] = QODER_MACHINE_HOSTNAME;
  return { headers, identitySource: ident.source || "derived" };
}

// ---------------------------------------------------------------------------
// 连接状态读写（持久化在 providerConnections.data）
// ---------------------------------------------------------------------------
async function persistConnection(connId, patch) {
  if (!connId) return;
  try {
    const { updateProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");
    await updateProviderConnection(connId, patch);
  } catch (err) {
    log.warn("QODER_REWARDS", "持久化账号状态失败（已忽略）", {
      id: connId,
      error: err?.message ?? String(err),
    });
  }
}

/** 最近一次签到时间（YYYY-MM-DD HH:mm:ss）。 */
export function lastCheckinOf(conn) {
  return String(conn?.lastCheckin || "");
}

/** 该账号今日是否还需要签到。 */
export function canCheckin(conn) {
  const cap = probeCapability(conn);
  if (cap === false) return false;
  const last = lastCheckinOf(conn);
  if (!last) return true;
  const today = new Date().toISOString().slice(0, 10);
  return !last.startsWith(today);
}

// 签到能力探测缓存：接口不存在（404/405/410）后 TTL 内跳过，到期自动重探
const _capabilityProbe = new Map(); // connId -> { at, capable }

function probeCapability(conn) {
  const hit = _capabilityProbe.get(conn?.id);
  if (!hit) return null;
  if (Date.now() - hit.at > QODER_CHECKIN_PROBE_TTL_MS) return null;
  return hit.capable;
}

function markCapability(conn, capable) {
  _capabilityProbe.set(conn.id, { at: Date.now(), capable });
}

// 活动列表短缓存（看板频繁切换视图时避免重复等上游）
const _campaignsCache = new Map(); // connId -> { at, data }

export function invalidateCampaignCache(connId) {
  if (connId) _campaignsCache.delete(connId);
  else _campaignsCache.clear();
}

// ---------------------------------------------------------------------------
// 活动列表
// ---------------------------------------------------------------------------
function parsePlacements(placements) {
  let titleZh = "";
  let titleEn = "";
  let descZh = "";
  let detail = "";
  let button = "";
  for (const pl of Array.isArray(placements) ? placements : []) {
    const cont = pl?.content;
    if (!cont || typeof cont !== "object") continue;
    const zh = cont.zh && typeof cont.zh === "object" ? cont.zh : {};
    const en = cont.en && typeof cont.en === "object" ? cont.en : {};
    titleZh = titleZh || String(zh.title || "");
    titleEn = titleEn || String(en.title || "");
    descZh = descZh || String(zh.description || "");
    detail = detail || String(zh.detailUrl || en.detailUrl || "");
    button = button || String(zh.buttonText || en.buttonText || "");
    if (titleZh && descZh && detail) break;
  }
  return { title_zh: titleZh, title_en: titleEn, desc_zh: descZh, detail_url: detail, button_text: button };
}

function normalizeCampaign(c) {
  const benefit = c?.benefit && typeof c.benefit === "object" ? c.benefit : {};
  return {
    ...parsePlacements(c?.placements),
    campaign_id: String(c?.campaignId || c?.campaign_id || ""),
    campaign_key: String(c?.campaignKey || c?.campaign_key || ""),
    action_type: String(c?.actionType || c?.action_type || ""),
    claim_status: String(c?.claimStatus || c?.claim_status || ""),
    benefit: { kind: String(benefit.kind || ""), amount: Math.trunc(Number(benefit.amount) || 0) },
    required_achievement_key: String(c?.requiredAchievementKey || ""),
    achievement_completed: !!c?.achievementCompleted,
    unavailable_reason: String(c?.unavailableReason || ""),
    placements: Array.isArray(c?.placements) ? c.placements : [],
  };
}

async function campaignsGet(conn) {
  const region = regionOf(conn);
  const url = qoderCampaignsUrl(region);
  const { headers, identitySource } = desktopHeaders(conn);
  let res = await httpJson(url, { headers, timeoutMs: 15000 });
  // 桌面端头被拒时退化为普通头，至少保留「能不能看到」的信息
  if (res.status === 401 || res.status === 403) {
    res = await httpJson(url, { headers: baseHeaders(conn), timeoutMs: 15000 });
  }
  return { res, identitySource };
}

/**
 * 拉活动列表。返回
 * { ok, available, show_campaign, claimable, campaign_url, campaigns, identity, error }
 */
export async function listCampaigns(conn, { force = false } = {}) {
  const now = Date.now();
  if (!force) {
    const hit = _campaignsCache.get(conn.id);
    if (hit && now - hit.at < QODER_CAMPAIGNS_TTL_MS) return hit.data;
  }

  let { res, identitySource } = await campaignsGet(conn);
  // showCampaign=false 通常意味着身份被判为非官方客户端：强制刷新身份重试一次
  if (res.ok && res.json?.showCampaign === false && identitySource === "runtime-info") {
    nativeMachineIdentity(regionOf(conn), uidOf(conn), { force: true });
    const retry = await campaignsGet(conn);
    if (retry.res.ok && retry.res.json?.showCampaign) {
      res = retry.res;
      identitySource = retry.identitySource;
    }
  }

  if (!res.ok || !res.json || typeof res.json !== "object") {
    return {
      ok: false,
      available: ![404, 405, 410].includes(res.status),
      error: `HTTP ${res.status} ${String(res.text || "").slice(0, 160)}`,
      campaigns: [],
      identity: identitySource,
    };
  }

  const raw = res.json.campaigns;
  const campaigns = (Array.isArray(raw) ? raw : []).filter((c) => c && typeof c === "object").map(normalizeCampaign);
  const data = {
    ok: true,
    available: true,
    show_campaign: !!res.json.showCampaign,
    claimable: !!res.json.claimable,
    campaign_url: String(res.json.campaignUrl || ""),
    campaigns,
    // derived 时设备定向活动可能被服务端静默过滤（列表偏少）
    identity: identitySource,
  };
  _campaignsCache.set(conn.id, { at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------------------
// 单活动领取
// ---------------------------------------------------------------------------
/**
 * 领取单个活动奖励。返回
 * { ok, status, replayed, blocked, failure_code, redemption_code, confirming, amount, message, error }
 */
export async function claimCampaign(conn, campaignId) {
  const region = regionOf(conn);
  const url = qoderCampaignClaimUrl(region, campaignId);
  const { headers } = desktopHeaders(conn);
  const res = await httpJson(url, { method: "POST", headers, body: "{}", timeoutMs: 20000 });

  if (!res.ok) {
    const failure = String(res.json?.errorCode || "").toUpperCase();
    if (res.status === 409 || failure === "ALREADY_CLAIMED" || failure === "REPLAYED") {
      return { ok: true, status: "CLAIMED", replayed: true, message: "今日已领取（上游幂等确认）" };
    }
    return { ok: false, error: `HTTP ${res.status} ${String(res.text || "").slice(0, 160)}` };
  }

  const body = res.json || {};
  const status = String(body.status || "").toUpperCase();
  const failure = String(body.failureCode || "").toUpperCase();

  if (failure === "SAME_PERSON_ALREADY_CLAIMED" || status === "BLOCKED") {
    return {
      ok: false,
      blocked: true,
      status: status || "BLOCKED",
      failure_code: failure || "BLOCKED",
      amount: Math.trunc(Number(body?.benefit?.amount) || 0),
      message: QODER_CAMPAIGN_FAILURE_CN.SAME_PERSON_ALREADY_CLAIMED,
    };
  }
  if (!status && body.success === false) {
    return { ok: false, error: String(body.error || res.text || "").slice(0, 160) };
  }

  // 兑换码类奖励：官方语义 = CLAIMED 且 redemptionCode 非空才算拿到
  const code = String(body.redemptionCode || "").trim();
  if (code) {
    const codes = { ...(conn.campaignCodes || {}) };
    codes[campaignId] = code;
    await persistConnection(conn.id, { campaignCodes: codes });
  }

  if (failure in QODER_CAMPAIGN_FAILURE_CN) {
    return {
      ok: false,
      status: status || "NOT_ELIGIBLE",
      failure_code: failure,
      redemption_code: code,
      message: QODER_CAMPAIGN_FAILURE_CN[failure],
    };
  }

  return {
    ok: ["CLAIMED", "GRANTED", "SUCCESS"].includes(status),
    status,
    replayed: !!body.replayed,
    failure_code: failure,
    redemption_code: code,
    confirming: status === "CLAIMED" && !code,
    amount: Math.trunc(Number(body?.benefit?.amount) || Number(body.amount) || 0),
    message: (body.replayed ? "已领取" : "领取成功")
      + (code ? `，兑换码：${code}` : status === "CLAIMED" ? "，兑换码发放确认中" : ""),
  };
}

/** 读取该活动的发放状态（幂等，只读）。 */
export async function campaignReward(conn, campaignId) {
  const region = regionOf(conn);
  const url = qoderCampaignRewardUrl(region, campaignId);
  const { headers } = desktopHeaders(conn);
  const res = await httpJson(url, { headers, timeoutMs: 20000 });
  return res.json || { error: `HTTP ${res.status}` };
}

// ---------------------------------------------------------------------------
// 活动平台签到（领取所有 CLAIMABLE 的 Credits 活动）
// ---------------------------------------------------------------------------
/**
 * @param {object} conn
 * @param {{onlyKinds?: string[]|null, gapMs?: number}} [opts]
 *   onlyKinds 传 ["", "CREDITS"] 时只做「每日签到领积分」，不碰兑换码/券类。
 * @returns {{ok, claimed, already, blocked, pending, locked, codes, earned, message, errors}}
 */
export async function campaignCheckin(conn, { onlyKinds = null, gapMs = 500 } = {}) {
  // 领取路径必须绕过缓存并强制刷新身份（身份会轮换，缓存过期会导致漏领）
  nativeMachineIdentity(regionOf(conn), uidOf(conn), { force: true });
  const st = await listCampaigns(conn, { force: true });
  if (!st.ok) {
    return {
      ok: false,
      error: st.error || "campaigns 查询失败",
      earned: 0,
      claimed: [],
      already: [],
      blocked: [],
      pending: [],
      locked: [],
      codes: [],
      errors: [st.error || "campaigns 查询失败"],
    };
  }

  const claimed = [];
  const already = [];
  const blocked = [];
  const pending = [];
  const locked = [];
  const codes = [];
  const errors = [];
  let earned = 0;

  const blockedUntil = { ...(conn.campaignBlockedUntil || {}) };

  for (const c of st.campaigns) {
    const kind = String(c.benefit?.kind || "").toUpperCase();
    if (Array.isArray(onlyKinds)) {
      if (!onlyKinds.includes(kind)) continue;
      if (!["", "CLAIM_BENEFIT"].includes(c.action_type)) continue;
    }

    if (c.claim_status === "CLAIMED") {
      if (c.action_type !== "VIEW_DETAILS") already.push(c);
      const saved = (conn.campaignCodes || {})[c.campaign_id];
      if (saved) codes.push({ campaign: campaignLabel(c), code: saved });
      continue;
    }
    if (c.claim_status !== "CLAIMABLE") {
      const reason = String(c.unavailable_reason || "").toUpperCase();
      if (reason === "REDEMPTION_CODE_OUT_OF_STOCK") pending.push(c);
      else if (reason === "ACHIEVEMENT_NOT_COMPLETED" || c.achievement_completed === false) locked.push(c);
      continue;
    }
    if (c.action_type && c.action_type !== "CLAIM_BENEFIT") continue; // VIEW_DETAILS 不能领
    if ((blockedUntil[c.campaign_id] || 0) > Date.now()) {
      blocked.push({ campaign: campaignLabel(c), failure_code: "SAME_PERSON_ALREADY_CLAIMED", cooldown: true });
      continue;
    }

    const res = await claimCampaign(conn, c.campaign_id);
    if (res.ok) {
      const amount = res.amount || c.benefit?.amount || 0;
      if (res.replayed) already.push(c);
      else {
        claimed.push(c);
        earned += Math.trunc(amount || 0);
      }
      if (res.redemption_code) codes.push({ campaign: campaignLabel(c), code: res.redemption_code });
      await sleep(gapMs);
    } else if (res.blocked) {
      // 服务端按「人」去重：同机多号共享每轮额度，记 6h 冷却避免每轮白试
      blockedUntil[c.campaign_id] = Date.now() + QODER_CAMPAIGN_BLOCKED_COOLDOWN_MS;
      blocked.push({ campaign: campaignLabel(c), failure_code: res.failure_code });
    } else if (res.failure_code && res.failure_code in QODER_CAMPAIGN_FAILURE_CN) {
      if (res.failure_code === "REDEMPTION_CODE_OUT_OF_STOCK") pending.push(c);
      else locked.push(c);
    } else {
      errors.push(`${c.campaign_key || c.campaign_id}: ${res.error}`);
    }
  }

  // 领取会改变活动状态：清缓存 + 落盘签到时间与冷却
  invalidateCampaignCache(conn.id);
  const patch = {
    lastCheckin: fmtNow(),
    campaignBlockedUntil: blockedUntil,
  };
  if (Object.keys(blockedUntil).length) patch.campaignBlockedUntil = blockedUntil;
  await persistConnection(conn.id, patch);

  return {
    ok: errors.length === 0,
    claimed,
    already,
    blocked,
    pending,
    locked,
    codes,
    earned,
    errors,
    message: summarizeCampaignOutcome({ claimed, already, blocked, pending, locked, errors, earned }),
  };
}

function summarizeCampaignOutcome({ claimed, already, blocked, pending, locked, errors, earned }) {
  if (claimed.length) {
    return `活动领取成功 +${earned} Credits（${claimed.map(campaignLabel).join("、")}）`;
  }
  if (blocked.length) {
    return `同人已领取：同一设备/身份下的其他账号本轮已领过（服务端按人去重）`;
  }
  if (already.length) return `今日活动奖励已领取（${already.map(campaignLabel).join("、")}）`;
  if (pending.length) return `名额已发完，次日 10:00 后可再领（${pending.map(campaignLabel).join("、")}）`;
  if (locked.length) {
    return `需先在官方桌面端完成新人任务后可领（${locked.map(campaignLabel).join("、")}）`;
  }
  if (errors.length) return `活动领取失败：${errors.join("; ").slice(0, 200)}`;
  return "当前账号暂无可领取的官方活动";
}

/** 活动显示名：官方中文标题优先，其次 key/说明。 */
export function campaignLabel(c) {
  return String(c?.title_zh || "").trim() || String(c?.campaign_key || c?.campaign_id || "");
}

// ---------------------------------------------------------------------------
// 旧 sash 签到接口（仅在国际版/老活动仍开放时兜底）
// ---------------------------------------------------------------------------
export async function checkinStatus(conn) {
  const url = qoderCheckinStatusUrl(regionOf(conn));
  const res = await httpJson(url, { headers: baseHeaders(conn), timeoutMs: 15000 });
  if ([404, 405, 410].includes(res.status)) {
    markCapability(conn, false);
    return { ok: false, unavailable: true, http: res.status, error: `HTTP ${res.status}` };
  }
  if (!res.ok || !res.json) {
    return { ok: false, unavailable: false, error: `HTTP ${res.status} ${String(res.text || "").slice(0, 160)}` };
  }
  markCapability(conn, true);
  const q = res.json;
  const status = String(q.status || "");
  return {
    ok: true,
    status,
    active: status === "CLAIMABLE" || status === "CLAIMED",
    today_checked_in: status === "CLAIMED",
    streak_days: Math.trunc(Number(q.currentStreakDays) || 0),
    total_claim_days: Math.trunc(Number(q.totalClaimDays) || 0),
    reward_credits: Math.trunc(Number(q.rewardCredits) || 0),
  };
}

export async function legacyCheckin(conn) {
  const st = await checkinStatus(conn);
  if (!st.ok) {
    if (st.unavailable) {
      return { ok: true, unavailable: true, msg: `本区域未开放 /sash/api/v1/me/daily-check-in 接口（HTTP ${st.http}）` };
    }
    return { ok: false, error: st.error };
  }
  if (st.today_checked_in) return { ok: true, already: true, msg: "今日已签到" };
  if (!st.active) {
    return { ok: true, disabled: true, msg: `官方签到活动未开放 (status=${st.status || "?"})` };
  }
  const url = qoderCheckinClaimUrl(regionOf(conn));
  const res = await httpJson(url, { method: "POST", headers: baseHeaders(conn), body: "{}", timeoutMs: 15000 });
  if (!res.ok) {
    if (res.status === 409 || String(res.text || "").includes("ALREADY_CLAIMED")) {
      return { ok: true, already: true, msg: "今日已签到" };
    }
    return { ok: false, error: `HTTP ${res.status} ${String(res.text || "").slice(0, 160)}` };
  }
  const reward = Math.trunc(Number(res.json?.rewardCredits) || 0);
  await persistConnection(conn.id, { lastCheckin: fmtNow() });
  return { ok: true, msg: `签到成功 +${reward} 积分`, reward_credits: reward };
}

// ---------------------------------------------------------------------------
// Pro 升级包（一次性 +1800）
// ---------------------------------------------------------------------------
export async function proEligibility(conn) {
  const url = qoderProEligibilityUrl(regionOf(conn));
  const res = await httpJson(url, { headers: baseHeaders(conn), timeoutMs: 15000 });
  // 端点不存在 / 活动已下线：查询成功，只是不可领取
  if ([404, 403, 410].includes(res.status)) return { ok: true, eligible: false };
  if (!res.ok || !res.json) return { ok: false, eligible: false, error: `HTTP ${res.status}` };
  return { ok: true, eligible: !!res.json.eligible };
}

export async function proClaim(conn) {
  const url = qoderProClaimUrl(regionOf(conn));
  const res = await httpJson(url, { method: "POST", headers: baseHeaders(conn), body: "{}", timeoutMs: 15000 });
  if (!res.ok) {
    if (res.status === 409 || String(res.text || "").includes("ALREADY")) {
      return { ok: true, already: true, msg: "Pro 升级包已领取过" };
    }
    return { ok: false, error: `HTTP ${res.status} ${String(res.text || "").slice(0, 160)}` };
  }
  if (res.json?.success === false) {
    return { ok: false, error: String(res.json.message || "").slice(0, 160) };
  }
  return { ok: true, msg: "Pro 升级包领取成功" };
}

/** 套餐名（Pro Trial 等），变化时落盘。 */
export async function fetchPlan(conn) {
  const url = qoderPlanUrl(regionOf(conn));
  const res = await httpJson(url, { headers: baseHeaders(conn), timeoutMs: 15000 });
  if (!res.ok || !res.json) return String(conn.plan || "");
  const name = String(res.json.plan_tier_name || res.json.user_type || "");
  if (name && name !== conn.plan) await persistConnection(conn.id, { plan: name });
  return name;
}

// ---------------------------------------------------------------------------
// 任务视图（看板渲染用）
// ---------------------------------------------------------------------------
function fmtNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
}

const REDEMPTION_KIND_LABEL = {
  REDEMPTION_CODE: "兑换码",
  REDEMPTION_COUPON: "兑换券",
  COUPON: "优惠券",
};

/** 每日签到行（只统计 Credits 类活动）。 */
function dailyCheckinRow(camp, region) {
  const jumpUrl = camp.campaign_url || `${qoderWebsiteUrl(region)}/activities`;
  const base = { task_code: "daily_checkin", name: "每日签到（每日领取 Credits）", jump_url: jumpUrl, target: 1 };
  if (!camp.ok) {
    return { ...base, description: camp.available ? `活动状态查询失败：${camp.error || "?"}` : "活动平台在本区域不可用", status: "not_accepted", current: 0, reward_credit: 0 };
  }
  const isDaily = (c) =>
    ["", "CLAIM_BENEFIT"].includes(c.action_type)
    && ["", "CREDITS"].includes(String(c.benefit?.kind || "").toUpperCase());
  const daily = camp.campaigns.filter(isDaily);
  const claimable = daily.filter((c) => c.claim_status === "CLAIMABLE");
  const claimed = daily.filter((c) => c.claim_status === "CLAIMED");
  const gated = daily.filter((c) => c.claim_status === "ACHIEVEMENT_NOT_COMPLETED");

  if (claimable.length) {
    const amount = claimable.reduce((s, c) => s + (c.benefit?.amount || 0), 0);
    return {
      ...base, status: "completed", current: 1, reward_credit: amount,
      description: `可领取 ${amount || "-"} Credits（${claimable.map(campaignLabel).join("、")}）—— 点「一键签到」自动领取`,
    };
  }
  if (claimed.length) {
    const amount = claimed.reduce((s, c) => s + (c.benefit?.amount || 0), 0);
    return {
      ...base, status: "claimed", current: 1, reward_credit: amount,
      description: `今日已领取${amount ? ` +${amount} Credits` : ""}（${claimed.map(campaignLabel).join("、")}），明日再来`,
    };
  }
  if (gated.length) {
    return {
      ...base, status: "not_accepted", current: 0, reward_credit: gated.reduce((s, c) => s + (c.benefit?.amount || 0), 0),
      description: `有活动但需先完成成就：${gated.map((c) => c.required_achievement_key || "?").join(", ")}（${gated.map(campaignLabel).join("、")}）`,
    };
  }
  return {
    ...base, status: "not_accepted", current: 0, reward_credit: 0,
    description: camp.show_campaign
      ? "活动进行中，当前账号暂无可领取项"
      : "当前账号暂无可参与的官方活动（每日 100 为定向下发：账号未在定向内 / 虚拟机环境 / 试用资格已用尽）",
  };
}

/** 非 Credits 奖励（兑换码/券）单独成行。 */
function extraCampaignRows(conn, camp) {
  const rows = [];
  for (const c of camp.ok ? camp.campaigns : []) {
    const kind = String(c.benefit?.kind || "").toUpperCase();
    if (kind === "" || kind === "CREDITS") continue;
    const label = REDEMPTION_KIND_LABEL[kind] || kind || "奖励";
    const rewardText = `${label} ×${c.benefit?.amount || 1}`;
    const code = (conn.campaignCodes || {})[c.campaign_id] || "";
    const reason = String(c.unavailable_reason || "").toUpperCase();
    let status = "not_accepted";
    let desc;
    if (c.claim_status === "CLAIMED") {
      status = "claimed";
      desc = `已领取：${rewardText}` + (code ? `，兑换码 ${code}` : "，兑换码发放确认中");
    } else if (c.claim_status === "CLAIMABLE") {
      status = "completed";
      desc = `可领取：${rewardText} —— 点「一键签到」自动领取`;
    } else if (reason === "REDEMPTION_CODE_OUT_OF_STOCK") {
      desc = `今日名额已发完（每日 10:00 刷新）：${rewardText}`;
    } else if (reason === "ACHIEVEMENT_NOT_COMPLETED" || c.achievement_completed === false) {
      desc = `需先在官方桌面端完成新人任务（成就 ${c.required_achievement_key || "?"}）：${rewardText}`;
    } else if (reason === "CAMPAIGN_NOT_ACTIVE") {
      desc = `活动已结束/未开始：${rewardText}`;
    } else {
      desc = `暂不可领取${reason ? `（${reason}）` : ""}：${rewardText}`;
    }
    rows.push({
      task_code: `campaign:${c.campaign_key || c.campaign_id}`,
      name: campaignLabel(c),
      description: c.desc_zh ? `${desc}（${c.desc_zh}）` : desc,
      jump_url: c.detail_url || camp.campaign_url || "",
      status,
      current: ["completed", "claimed"].includes(status) ? 1 : 0,
      target: 1,
      reward_credit: 0,
      reward_text: rewardText,
      code,
    });
  }
  return rows;
}

function proUpgradeRow(eligState) {
  if (!eligState.ok) {
    return {
      task_code: "pro_upgrade", name: "Pro 升级包", description: `资格查询失败：${eligState.error}`,
      status: "not_accepted", current: 0, target: 1, reward_credit: 1800,
    };
  }
  return {
    task_code: "pro_upgrade", name: "Pro 升级包",
    description: eligState.eligible ? "一次性 Pro 升级包，可领取 +1800 积分" : "已领取或当前不可领取",
    status: eligState.eligible ? "completed" : "claimed", current: 1, target: 1, reward_credit: 1800,
  };
}

/** 单账号任务视图（并行取回各上游状态，单个失败不影响其余）。 */
export async function fetchTaskView(conn) {
  const [camp, legacy, pro, planName] = await Promise.all([
    listCampaigns(conn).catch(() => ({ ok: false, available: true, error: "查询失败", campaigns: [] })),
    checkinStatus(conn).catch(() => ({ ok: false, error: "查询失败" })),
    proEligibility(conn).catch(() => ({ ok: false, error: "查询失败" })),
    fetchPlan(conn).catch(() => ""),
  ]);

  const tasks = [dailyCheckinRow(camp, regionOf(conn)), ...extraCampaignRows(conn, camp), proUpgradeRow(pro)];
  if (legacy.ok && legacy.active) {
    tasks.push({
      task_code: "daily_checkin_legacy",
      name: "每日签到（旧活动批次）",
      description: legacy.today_checked_in
        ? `今日已签到，明日再来（连续 ${legacy.streak_days} 天，累计 ${legacy.total_claim_days} 天）`
        : `可领取 ${legacy.reward_credits || 100} 积分（连续 ${legacy.streak_days} 天，累计 ${legacy.total_claim_days} 天）`,
      status: legacy.today_checked_in ? "claimed" : "completed",
      current: 1, target: 1, reward_credit: legacy.reward_credits || 100,
    });
  }

  const codes = Object.entries(conn.campaignCodes || {})
    .filter(([, code]) => !!code)
    .map(([campaign_id, code]) => ({ campaign: campaign_id, code }));

  return {
    tasks,
    summary: {
      plan: planName || conn.plan || "-",
      realm: regionOf(conn),
      credits: conn.credits || {},
      streak_days: legacy.ok ? legacy.streak_days || 0 : 0,
      codes,
      campaigns: {
        show: !!camp.show_campaign,
        claimable: !!camp.claimable,
        url: camp.campaign_url || "",
        identity: camp.identity || "derived",
      },
      travel: { state: pro.ok && pro.eligible ? "arrived" : "idle", reward_credit: 1800 },
    },
  };
}

// ---------------------------------------------------------------------------
// 批量执行（看板 / 调度器）
// ---------------------------------------------------------------------------
/** 批量每日签到。onlyDaily=true 时只领 Credits 类，不碰兑换码/券与 Pro 包。 */
export async function runBatchCheckin(conns, { onlyDaily = false, gapMs = 1000, interGapMs = 1200 } = {}) {
  const onlyKinds = onlyDaily ? ["", "CREDITS"] : null;
  const logs = [];
  let creditAdded = 0;
  let okCount = 0;
  for (let i = 0; i < conns.length; i++) {
    const conn = conns[i];
    const nick = conn.displayName || conn.email || conn.name || conn.id.slice(0, 8);
    logs.push(`====== 正在为账号 [${nick}] 执行每日签到 (${i + 1}/${conns.length}) ======`);
    const res = await campaignCheckin(conn, { onlyKinds, gapMs });
    if (res.ok) okCount++;
    creditAdded += res.earned || 0;
    logs.push(`  ${res.message}`);
    for (const item of res.codes || []) logs.push(`  🎟 ${item.campaign} 兑换码：${item.code}`);
    if (i < conns.length - 1) await sleep(interGapMs);
  }
  logs.push(`====== 全部 ${conns.length} 个账号签到完毕，累计新增积分: +${creditAdded} ======`);
  for (const line of logs) log.info("QODER_REWARDS", line);
  return { ok: okCount > 0, logs, credit_added: creditAdded, accounts_count: conns.length };
}

/** 批量领取 Pro 福利包。 */
export async function runBatchProClaim(conns, { interGapMs = 1200 } = {}) {
  const logs = [];
  let creditAdded = 0;
  for (let i = 0; i < conns.length; i++) {
    const conn = conns[i];
    const nick = conn.displayName || conn.email || conn.name || conn.id.slice(0, 8);
    const elig = await proEligibility(conn);
    if (!elig.ok) {
      logs.push(`! [${nick}] Pro 升级包资格查询失败：${elig.error}`);
    } else if (!elig.eligible) {
      logs.push(`— [${nick}] Pro 升级包不可领取（已领或活动未开放）`);
    } else {
      const res = await proClaim(conn);
      if (res.ok) {
        creditAdded += 1800;
        logs.push(`✓ [${nick}] ${res.msg}`);
      } else {
        logs.push(`! [${nick}] Pro 升级包领取失败：${res.error}`);
      }
    }
    if (i < conns.length - 1) await sleep(interGapMs);
  }
  for (const line of logs) log.info("QODER_REWARDS", line);
  return { ok: true, logs, credit_added: creditAdded, accounts_count: conns.length };
}

/**
 * 全部账号：按活动聚合（看板「全部账号」视图用），标注每账号资格。
 * @returns {{tasks, summary, accounts}}
 */
export async function fetchAllAccountsView(conns) {
  const merged = new Map();
  const codes = [];
  const accounts = conns.map((c) => ({
    uid: uidOf(c),
    id: c.id,
    nickname: c.displayName || c.email || c.name || c.id.slice(0, 8),
    realm: regionOf(c),
  }));

  for (const conn of conns) {
    const nick = conn.displayName || conn.email || conn.name || conn.id.slice(0, 8);
    for (const [campaign_id, code] of Object.entries(conn.campaignCodes || {})) {
      if (code) codes.push({ id: conn.id, nickname: nick, realm: regionOf(conn), campaign_id, code });
    }
    let camp;
    try {
      camp = await listCampaigns(conn);
    } catch {
      camp = { ok: false, campaigns: [] };
    }
    if (!camp.ok) continue;
    for (const c of camp.campaigns) {
      const key = c.campaign_key || c.campaign_id;
      if (!merged.has(key)) merged.set(key, { sample: c, by: {} });
      const slot = merged.get(key);
      const state = campaignStateCn(c);
      (slot.by[state] ||= []).push(nick);
    }
  }

  const STATE_LABEL = {
    claimable: "可领", claimed: "已领", out_of_stock: "名额发完",
    task_required: "需先完成任务", risk_blocked: "风控拦截", inactive: "活动已结束",
    ineligible: "暂不可领", no_eligibility: "无资格(不在定向)",
  };
  const ORDER = ["claimable", "claimed", "out_of_stock", "task_required", "risk_blocked", "inactive", "ineligible", "no_eligibility"];
  const allNames = accounts.map((a) => a.nickname);
  for (const [, slot] of merged) {
    const listed = Object.values(slot.by).flat();
    const missing = allNames.filter((n) => !listed.includes(n));
    if (missing.length) slot.by.no_eligibility = missing;
  }

  const tasks = [];
  for (const [, slot] of merged) {
    const c = slot.sample;
    const kind = String(c.benefit?.kind || "").toUpperCase();
    const isCredits = kind === "" || kind === "CREDITS";
    const parts = ORDER.filter((k) => slot.by[k]?.length)
      .map((k) => `${STATE_LABEL[k]} ${slot.by[k].length}/${accounts.length}：${slot.by[k].join("、")}`);
    const status = slot.by.claimable ? "completed" : slot.by.claimed ? "claimed" : "not_accepted";
    tasks.push({
      task_code: `campaign:${c.campaign_key || c.campaign_id}`,
      name: campaignLabel(c),
      description: parts.join("；"),
      jump_url: c.detail_url || "",
      status,
      current: ["completed", "claimed"].includes(status) ? 1 : 0,
      target: 1,
      reward_credit: isCredits ? c.benefit?.amount || 0 : 0,
      reward_text: isCredits ? "" : `${REDEMPTION_KIND_LABEL[kind] || kind} ×${c.benefit?.amount || 1}`,
      accounts_by_state: slot.by,
    });
  }
  tasks.sort((a, b) => (a.status !== "completed") - (b.status !== "completed") || a.name.localeCompare(b.name));

  return {
    tasks,
    summary: { mode: "all", accounts_total: accounts.length, codes, plan: "全部账号" },
    accounts,
  };
}

function campaignStateCn(c) {
  const st = String(c.claim_status || "").toUpperCase();
  const rs = String(c.unavailable_reason || "").toUpperCase();
  if (st === "CLAIMABLE") return "claimable";
  if (st === "CLAIMED") return "claimed";
  if (rs === "REDEMPTION_CODE_OUT_OF_STOCK") return "out_of_stock";
  if (rs === "CAMPAIGN_NOT_ACTIVE") return "inactive";
  if (rs === "RISK_BLOCKED") return "risk_blocked";
  if (rs === "ACHIEVEMENT_NOT_COMPLETED" || c.achievement_completed === false) return "task_required";
  return "ineligible";
}

// ---------------------------------------------------------------------------
// 连接解析（供 API 路由 / 调度器复用）
// ---------------------------------------------------------------------------
export const QODER_PROVIDER_IDS = ["qoder", "qoder-cn"];

/** 取指定 provider（或双区全部）的启用中 Qoder 连接（仅返回带令牌的）。 */
export async function listQoderConnections(providerFilter = null) {
  const { getProviderConnections } = await import("@/lib/db/repos/connectionsRepo.js");
  const providers = providerFilter ? [providerFilter] : QODER_PROVIDER_IDS;
  const out = [];
  for (const provider of providers) {
    const list = await getProviderConnections({ provider, isActive: true });
    for (const conn of list) {
      if (tokenOf(conn)) out.push(conn);
    }
  }
  return out;
}

/** 按连接 id 取单个 Qoder 连接（非 Qoder provider 返回 null）。 */
export async function getQoderConnection(connectionId) {
  const { getProviderConnectionById } = await import("@/lib/db/repos/connectionsRepo.js");
  const conn = await getProviderConnectionById(connectionId);
  if (!conn || !QODER_PROVIDER_IDS.includes(conn.provider)) return null;
  return conn;
}

/** 仅用于测试：清空模块内缓存。 */
export function _resetRewardsCaches() {
  _campaignsCache.clear();
  _capabilityProbe.clear();
}