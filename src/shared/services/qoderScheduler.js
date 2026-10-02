/**
 * Qoder 签到定时调度器（移植自 qoder2api-hub / qoder_scheduler.py）。
 *
 * 职责：每日 09:00 / 21:00 为所有 Qoder 账号自动签到领 Credits，并顺带刷新
 * 活动/福利状态快照。**不做 Token 保活** —— 那部分已由仓库既有的
 * backgroundTokenRefresh（30 分钟提前量，覆盖全部 OAuth 连接）承担，避免重复。
 *
 * 设计要点：
 *   - 整点命中即执行一次，执行后 65 秒内不再触发（避开同一分钟重复）；
 *   - 防重叠：上一轮未结束则跳过本轮；
 *   - Fail-open：任何异常只记日志，不杀掉 interval；
 *   - 状态/日志暴露给看板（status / triggerNow / setEnabled）。
 * [qoder 权益 v0.6.0]
 */

import * as log from "@/sse/utils/logger.js";

export const QODER_CHECKIN_HOURS = [9, 21];
const TICK_MS = 30 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;
const LOG_BUFFER = 60;

let started = false;
let intervalHandle = null;
let initialHandle = null;
let running = false;
let lastRunAt = null;
let nextRunAt = null;
let enabled = true;
let lastHourKey = "";
/** @type {string[]} */
let logs = [];

function isNonServerRuntime() {
  if (typeof window !== "undefined") return true;
  if (process.env.NEXT_RUNTIME === "edge") return true;
  const phase = process.env.NEXT_PHASE || "";
  return phase === "phase-production-build" || phase === "phase-export" || phase === "phase-static";
}

function pushLog(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  logs.push(`[${ts}] ${msg}`);
  if (logs.length > LOG_BUFFER) logs = logs.slice(-LOG_BUFFER);
  log.info("QODER_SCHEDULER", msg);
}

/** 签到时点文案（补零，如 "09:00 / 21:00"）。 */
function checkinHoursLabel() {
  return QODER_CHECKIN_HOURS.map((h) => `${String(h).padStart(2, "0")}:00`).join(" / ");
}

function fmtLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 计算下次整点排程时间（本地时区）。 */
function computeNextRun(now = new Date()) {
  for (const h of QODER_CHECKIN_HOURS) {
    const candidate = new Date(now);
    candidate.setHours(h, 0, 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(QODER_CHECKIN_HOURS[0], 0, 0, 0);
  return tomorrow;
}

/** 执行一轮签到巡检（供整点命中与手动触发共用）。 */
export async function runCheckinCycle(reason = "周期巡检") {
  if (running) {
    pushLog(`跳过本次巡检 (${reason})：上一轮仍在执行`);
    return { ok: false, skipped: true, msg: "上一轮仍在执行" };
  }
  running = true;
  lastRunAt = fmtLocal(new Date());
  pushLog(`开始执行任务 (${reason})...`);
  try {
    const { listQoderConnections, canCheckin, runBatchCheckin } = await import("@/lib/qoder/rewards.js");
    const conns = await listQoderConnections();
    if (conns.length === 0) {
      pushLog("暂无可用 Qoder 账号，跳过本次巡检");
      return { ok: true, accounts: 0, credit_added: 0 };
    }
    // 只补签今天还没签的账号（canCheckin 内部含能力探测缓存）
    const pending = conns.filter((c) => canCheckin(c));
    if (pending.length === 0) {
      pushLog("所有 Qoder 账号今日已签到");
      return { ok: true, accounts: 0, credit_added: 0 };
    }
    pushLog(`检测到 ${pending.length} 个账号需要签到，执行自动签到...`);
    const res = await runBatchCheckin(pending, { onlyDaily: false, gapMs: 1000, interGapMs: 1200 });
    pushLog(`巡检完成：签到 ${res.accounts_count} 个，本次新增积分 +${res.credit_added}`);
    return { ok: res.ok, accounts: res.accounts_count, credit_added: res.credit_added };
  } catch (err) {
    pushLog(`巡检异常（已忽略）：${err?.message ?? String(err)}`);
    return { ok: false, error: String(err?.message ?? err) };
  } finally {
    running = false;
  }
}

async function tick() {
  if (!enabled || running) return;
  const now = new Date();
  if (now.getMinutes() !== 0) return;
  if (!QODER_CHECKIN_HOURS.includes(now.getHours())) return;
  const hourKey = `${now.toDateString()} ${now.getHours()}`;
  if (hourKey === lastHourKey) return;
  lastHourKey = hourKey;
  await runCheckinCycle(`整点排程命中 (${now.getHours()}:00)`);
}

/** 启动调度器（可重复调用，已启动则 no-op）。 */
export function startQoderScheduler() {
  if (started) return false;
  if (isNonServerRuntime()) return false;
  if (String(process.env.DISABLE_QODER_SCHEDULER || "").trim().toLowerCase() === "1") return false;

  started = true;
  nextRunAt = fmtLocal(computeNextRun());
  initialHandle = setTimeout(() => {
    tick().catch((err) => log.warn("QODER_SCHEDULER", "首个 tick 失败（已忽略）", { error: String(err?.message ?? err) }));
  }, INITIAL_DELAY_MS);
  intervalHandle = setInterval(() => {
    tick().catch((err) => log.warn("QODER_SCHEDULER", "tick 失败（已忽略）", { error: String(err?.message ?? err) }));
  }, TICK_MS);
  if (initialHandle.unref) initialHandle.unref();
  if (intervalHandle.unref) intervalHandle.unref();
  pushLog(`Qoder 签到调度器已启动（${checkinHoursLabel()}）`);
  return true;
}

export function stopQoderScheduler() {
  if (initialHandle) { clearTimeout(initialHandle); initialHandle = null; }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  if (started) {
    started = false;
    pushLog("Qoder 签到调度器已暂停");
  }
}

/** 手动立即触发一次（不等待整点）。 */
export async function triggerQoderScheduler() {
  if (running) return { ok: false, msg: "已有巡检正在执行，请稍候再试" };
  // 不阻塞 HTTP 响应：后台跑
  runCheckinCycle("手动立即触发").catch(() => {});
  return { ok: true, msg: "已触发后台巡检" };
}

export function setQoderSchedulerEnabled(value) {
  enabled = !!value;
  pushLog(enabled ? "调度器已启用" : "调度器已停用（仅手动触发可用）");
  return enabled;
}

export function qoderSchedulerStatus() {
  return {
    started,
    enabled,
    running,
    mode: `整点排程 (${checkinHoursLabel()} 每日签到)`,
    last_run_time: lastRunAt || "尚未运行",
    next_run_time: nextRunAt || fmtLocal(computeNextRun()),
    logs: logs.slice(-20),
  };
}

/** 仅供测试：重置内部状态。 */
export function _resetQoderScheduler() {
  stopQoderScheduler();
  running = false;
  lastRunAt = null;
  nextRunAt = null;
  enabled = true;
  lastHourKey = "";
  logs = [];
}