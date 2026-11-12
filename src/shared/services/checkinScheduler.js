/**
 * 每日自动签到调度器。
 *
 * ## 为什么是「新写一个文件」而不是改现有模块
 *
 * 上游 9router v0.5.99 全仓**没有任何签到实现**（无路由、无 service、CHANGELOG 零
 * 提及；唯一的 `签到` 字样是测试 fixture 里的上游错误串）。因此本功能是纯新增，
 * 接入方式刻意对齐仓库里已有的 `quotaAutoPing.js`（同一类「opt-in 的后台调度」），
 * 而不是发明新范式 —— 这样它对上游的侵入面只有 3 个文件的小改动。
 *
 * ## 设计取舍（逐条对应实测踩过的坑）
 *
 * 1. **默认关闭。** 签到是**代用户打上游的写操作**。默认开（用户明确
 *    要求），但 9router 是多用户网关，默认开启会在用户没同意的情况下消耗上游
 *    配额并触发风控。故默认 `enabled: false`，由用户在面板/API 显式打开。
 *
 * 2. **每日只跑一次，判据是「今天是否已被处理」，不是「有没有成功」。**
 *    判定口径：只有至少一条结果能**证明今天已被处理**
 *    （`claimed` 或 `already-claimed`）才记日期。整轮全失败 ⇒ **不记**，
 *    下次启动重试。否则一次上游抖动会让用户当天彻底漏签。
 *
 * 3. **逐渠道、逐账号串行，绝不并发。** 一轮签到是「渠道数 × 账号数」次串行上游
 *    请求（反风控口径）。这条纪律在实现里反复强调。
 *
 * 4. **不维护第二份能力名单。** 「谁能签到」的权威是 `checkinProviders.js` 的实现
 *    表。本模块只问「有没有实现」，不去复制 provider 列表 —— 两份名单必然漂移。
 *
 * 5. **启动后延迟跑，不跟启动抢资源**，且**等凭据续期先跑一轮**（过期凭据会让
 *    整轮变成失败）。延迟可用 `NINEROUTER_CHECKIN_DELAY_MS` 覆盖，`0` 合法。
 *
 * 6. **只处理已启用的连接**：跳过 `isActive: false`。
 *    （这里把停用视为用户主动排除，因此不参与签到。）
 *
 * 7. **单账号失败不中断整轮** —— 每个账号包在自己的 try 里，异常转成 failed。
 *
 * ## 调度是怎么起来的（**踩过的真实坑**）
 *
 * 调度由 `src/instrumentation.js` 的 `register()` 启动 —— **不是**只由
 * `initializeApp.js` 启动。
 *
 * ⚠️ 原因：`initializeApp.js` 的可达路径是
 * `src/app/layout.js → bootstrap.js → initializeApp()`，而 `layout.js` 只在
 * **渲染页面**时执行。实测：只打 `/api/health`、`/api/version` 这类
 * API 请求，`[Checkin] 调度器已启动` **永远不出现** —— 也就是说，一个「只跑
 * API、没人开面板」的网关会**静默地从不签到**。
 *
 * `register()` 是 Next 的 Node-runtime 服务端钩子，**启动即执行一次**，与是否
 * 有流量无关，这才是「每日调度」需要的保证。故 `instrumentation.js` 是主路径，
 * `initializeApp.js` 里那条保留为**冗余保险**（幂等，重复调用无害）。
 *
 * ## 补充：调度起来之后怎么保证一天只跑一次
 *
 * 启动后延迟跑一轮，此后每 30 分钟 tick 一次（跨天补跑，长期运行的容器不必
 * 等到重启才签第二天的到）。tick 会重新读 settings 与状态文件：
 * - 今天已成功记过 ⇒ 直接返回；
 * - 开关被关掉 ⇒ 停掉调度器。
 *
 * ## 状态文件
 *
 * `DATA_DIR/checkin-state.json`，原子写（tmp + rename）。独立文件而不是塞进
 * settings：它是**运行状态**不是用户配置，混进 settings 会让「导出/导入配置」
 * 顺带搬走或覆盖签到进度。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { getSettings, getProviderConnections } from "@/lib/localDb";
import {
  claimCheckin,
  checkinLabel,
  describeOutcome,
  resolveIanaTimezone,
  utc8DateString,
} from "./checkinProviders.js";

/** 状态文件名（放 DATA_DIR 根，与 jwt-secret / machine-id 同级）。 */
export const CHECKIN_STATE_FILE = "checkin-state.json";

/** 环境变量：启动后延迟多久再跑自动签到（毫秒）。 */
export const CHECKIN_DELAY_ENV = "NINEROUTER_CHECKIN_DELAY_MS";
/** 默认延迟 30 秒（理由见模块头第 5 条）。 */
export const DEFAULT_CHECKIN_DELAY_MS = 30_000;

const DEFAULT_STATE = {
  /** 上次**完成**自动签到的 UTC+8 日期（`YYYY-MM-DD`）；空串 = 从未跑过。 */
  lastDate: "",
  /** 上次跑完的时刻（毫秒）；0 = 从未跑过。 */
  lastAt: 0,
  /** 上次整轮是否被记入当日（false ⇒ 下次启动会重试）。 */
  lastMarked: false,
  /** 上次结果摘要（给人看的短句）。 */
  lastSummary: "",
  /** 逐渠道结果（顺序即遍历顺序）。 */
  channels: [],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 逐渠道条目的上限（渠道数是有限的，脏数据不该撑大文件）。 */
const MAX_CHANNEL_ENTRIES = 64;

function statePath() {
  return join(DATA_DIR, CHECKIN_STATE_FILE);
}

/**
 * 日志出口：**必须走 process.stdout 而不是 console.log**。
 *
 * ⚠️ `src/lib/consoleLogBuffer.js` 的 `initConsoleLogCapture()` 会把
 * `console.log/info/warn/error/debug` 全部替换成写进**内存环形缓冲**的实现
 *（供面板的日志视图读），因此 console 系输出在 `docker logs` 里**看不见**。
 * 调试调度问题时会让人误以为「调度没跑」—— 实测就踩了这个坑。
 */
function logLine(message) {
  try {
    process.stdout.write(`[Checkin] ${message}\n`);
  } catch {
    /* stdout 关闭时忽略 */
  }
}

/** 归一化状态文档：非法值一律回落默认值（**不抛错**）。 */
export function sanitizeState(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_STATE };
  const ms = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const channels = Array.isArray(raw.channels)
    ? raw.channels
        .filter((c) => typeof c === "object" && c !== null && typeof c.provider === "string")
        .slice(0, MAX_CHANNEL_ENTRIES)
        .map((c) => ({
          provider: String(c.provider),
          label: typeof c.label === "string" ? c.label : String(c.provider),
          accounts: typeof c.accounts === "number" ? c.accounts : 0,
          claimed: typeof c.claimed === "number" ? c.claimed : 0,
          alreadyClaimed: typeof c.alreadyClaimed === "number" ? c.alreadyClaimed : 0,
          failed: typeof c.failed === "number" ? c.failed : 0,
          credit: typeof c.credit === "number" ? c.credit : 0,
          text: typeof c.text === "string" ? c.text.slice(0, 160) : "",
        }))
    : [];
  return {
    lastDate: typeof raw.lastDate === "string" && DATE_RE.test(raw.lastDate) ? raw.lastDate : "",
    lastAt: ms(raw.lastAt),
    lastMarked: raw.lastMarked === true,
    lastSummary: typeof raw.lastSummary === "string" ? raw.lastSummary.slice(0, 240) : "",
    channels,
  };
}

export function readState() {
  try {
    if (!existsSync(statePath())) return { ...DEFAULT_STATE };
    return sanitizeState(JSON.parse(readFileSync(statePath(), "utf8")));
  } catch {
    // 脏数据按默认处理：读状态失败不该让网关起不来。
    return { ...DEFAULT_STATE };
  }
}

function writeState(state) {
  const file = statePath();
  mkdirSync(dirname(file), { recursive: true });
  // 原子写：先写 tmp 再 rename，避免进程在写一半时被杀留下半个 JSON。
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, file);
}

/** 读延迟配置。⚠️ 不能写 `Number(env.X) || 默认` —— `0` 是合法值且是 falsy。 */
export function checkinDelayMs(env = process.env) {
  const raw = env[CHECKIN_DELAY_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_CHECKIN_DELAY_MS;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CHECKIN_DELAY_MS;
}

/** 本次运行是否被记入当日（即「今天已被处理」）。 */
export function shouldMarkToday(totals) {
  return totals.claimed + totals.alreadyClaimed > 0;
}

/**
 * 跑一轮签到。
 *
 * @param {{ force?: boolean, only?: string[], now?: number, listConnections?: Function }} [options]
 *   `force` 跳过「今天已跑过」判定（手动触发用）。
 * @returns 逐渠道结果 + 汇总。
 */
export async function runCheckin({ force = false, only = null, now = Date.now(), listConnections } = {}) {
  const settings = await getSettings();
  const config = settings.autoCheckin || {};

  // 用户显式选择的渠道（空/缺省 = 全部有实现的渠道）。
  const configured = config.providers && typeof config.providers === "object" ? config.providers : {};
  const optedIn = Object.entries(configured).filter(([, on]) => on === true).map(([p]) => p);

  // 拉账号池：失败就把整轮如实报错（而不是静默当成「没有账号」）。
  let connections;
  try {
    connections = listConnections ? await listConnections() : await getProviderConnections({ isActive: true });
  } catch (error) {
    return {
      ok: false,
      // 英文：这条 message 会经 API 原样进 UI（i18n 只翻英文原文）。
      message: `Failed to read the account pool: ${error instanceof Error ? error.message : String(error)}`,
      channels: [],
      totals: { accounts: 0, claimed: 0, alreadyClaimed: 0, failed: 0, inactive: 0, credit: 0 },
    };
  }

  // 渠道 => 该渠道的启用连接（顺序即 priority 顺序，仓库已排好）。
  const byProvider = new Map();
  for (const conn of connections) {
    if (conn.isActive === false || conn.isActive === 0) continue;
    if (only && !only.includes(conn.provider)) continue;
    if (!byProvider.has(conn.provider)) byProvider.set(conn.provider, []);
    byProvider.get(conn.provider).push(conn);
  }

  // 只保留「有签到实现」的渠道 —— 权威来自 checkinProviders，不另抄名单。
  const timezoneId = resolveIanaTimezone();
  const channels = [];
  const totals = { accounts: 0, claimed: 0, alreadyClaimed: 0, failed: 0, inactive: 0, credit: 0 };
  const today = utc8DateString(now);

  for (const [provider, pool] of byProvider) {
    // 若用户显式配置了渠道集合，则只跑被勾选的那些 —— **但 `only` 例外**。
    //
    // ⚠️ `only` 代表用户**刚刚在面板上点了这个渠道的「立即签到」**，是显式操作，
    // 必须放行（与 `force` 放行「今日已跑」同一口径）。不加这个例外，
    // 「配置里只勾了 A、却去点 B 的按钮」会被静默过滤成 0 个账号，
    // 界面显示「没有可签到的账号」—— 看起来像没账号，其实是配置挡住了。
    const explicitlyRequested = Array.isArray(only) && only.includes(provider);
    if (!explicitlyRequested && optedIn.length > 0 && !optedIn.includes(provider)) continue;

    const channel = {
      provider,
      label: checkinLabel(provider),
      accounts: pool.length,
      claimed: 0,
      alreadyClaimed: 0,
      failed: 0,
      inactive: 0,
      credit: 0,
      text: "",
    };
    const notes = [];

    for (const conn of pool) {
      totals.accounts += 1;
      try {
        const outcome = await claimCheckin(provider, conn, { timezoneId });
        switch (outcome.kind) {
          case "claimed":
            channel.claimed += 1;
            channel.credit += typeof outcome.credit === "number" ? outcome.credit : 0;
            totals.claimed += 1;
            totals.credit += typeof outcome.credit === "number" ? outcome.credit : 0;
            break;
          case "already-claimed":
            channel.alreadyClaimed += 1;
            totals.alreadyClaimed += 1;
            break;
          case "inactive":
            channel.inactive += 1;
            totals.inactive += 1;
            break;
          default:
            channel.failed += 1;
            totals.failed += 1;
            notes.push(`${conn.name || conn.id}: ${describeOutcome(outcome)}`);
        }
      } catch (error) {
        // 单账号异常绝不能中断整轮。
        channel.failed += 1;
        totals.failed += 1;
        notes.push(`${conn.name || conn.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const parts = [];
    if (channel.claimed > 0) parts.push(`${channel.claimed} claimed`);
    if (channel.credit > 0) parts.push(`+${channel.credit}`);
    if (channel.alreadyClaimed > 0) parts.push(`${channel.alreadyClaimed} already done`);
    if (channel.inactive > 0) parts.push(`${channel.inactive} no activity`);
    if (channel.failed > 0) parts.push(`${channel.failed} failed`);
    channel.text = parts.join(", ") || "Nothing to do";
    if (notes.length > 0) channel.text += ` (${notes.slice(0, 3).join("; ")})`;

    channels.push(channel);
  }

  const marked = shouldMarkToday(totals);
  return {
    ok: true,
    date: today,
    marked,
    channels,
    totals,
    summary: buildSummary(totals, channels),
  };
}

/**
 * 整轮汇总。
 *
 * ⚠️ 输出是**英文**：这段文字会直接进 `docker logs`、API 响应与状态文件，
 * 而运行时 i18n 只翻译「英文原文」（src/i18n/runtime.js），中文永远不会被翻译。
 * 维护者向的说明仍写中文注释（渲染不到）。
 */
function buildSummary(totals, channels) {
  if (totals.accounts === 0) return "No accounts to check in";
  const parts = [`${channels.length} provider(s) / ${totals.accounts} account(s)`];
  if (totals.claimed > 0) parts.push(`${totals.claimed} claimed`);
  if (totals.credit > 0) parts.push(`+${totals.credit}`);
  if (totals.alreadyClaimed > 0) parts.push(`${totals.alreadyClaimed} already done`);
  if (totals.inactive > 0) parts.push(`${totals.inactive} no activity`);
  if (totals.failed > 0) parts.push(`${totals.failed} failed`);
  return parts.join(", ");
}

/** 供 UI 读的当前状态（含「今天是否已跑」）。 */
export async function getCheckinStatus(now = Date.now()) {
  const settings = await getSettings();
  const config = settings.autoCheckin || {};
  const state = readState();
  const today = utc8DateString(now);
  return {
    enabled: config.enabled === true,
    delayMs: typeof config.delayMs === "number" ? config.delayMs : checkinDelayMs(),
    providers: config.providers && typeof config.providers === "object" ? config.providers : {},
    ranToday: state.lastDate === today,
    state,
  };
}

/** 手动跑一轮（用户显式操作，永远放行「今日已跑」判定）。 */
export async function runCheckinNow(options = {}) {
  const result = await runCheckin({ ...options, force: true });
  if (result.ok) {
    const previous = readState();
    const next = {
      lastDate: result.marked ? result.date : previous.lastDate,
      lastAt: Date.now(),
      lastMarked: result.marked,
      // 英文：`lastSummary` 会写进状态文件并经 API 返回（i18n 只翻英文原文）。
      lastSummary: `${result.marked ? "" : "NOT RECORDED · "}${result.summary}`,
      channels: result.channels.map((c) => ({ ...c })),
    };
    try {
      writeState(next);
    } catch {
      // 写状态失败不该让结果丢失：调用方仍拿到本轮结果。
    }
    result.state = next;
  }
  return result;
}

// ── 调度（对齐 quotaAutoPing 的形状：global 单例 + 可重配置） ─────────────────

/** 用 global 顶住 Next 的模块热重载，保证一个进程只有一个调度器。 */
const g = (global.__checkinScheduler ??= {
  timer: null,
  interval: null,
  startedAt: 0,
  running: false,
  lastRunAt: 0,
});

/** 停止调度器。 */
export function stopCheckinScheduler() {
  if (g.timer) {
    clearTimeout(g.timer);
    g.timer = null;
  }
  if (g.interval) {
    clearInterval(g.interval);
    g.interval = null;
  }
}

/**
 * 启动/重配置调度器。
 *
 * 启动时延迟一段跑一轮；此后每 30 分钟检查一次（跨天时补跑，这样长期运行的
 * 容器不必等到重启才签第二天的到）。
 *
 * 幂等：已有定时器就直接返回（`instrumentation.js` 与 `initializeApp.js` 会各调一次）。
 */
export function configureCheckinScheduler(settings) {
  const config = settings?.autoCheckin;
  if (config?.enabled !== true) {
    stopCheckinScheduler();
    logLine("开关未打开，未启动调度器");
    return;
  }

  // 已有定时器就不重复起（但每 tick 会重新读 settings，所以改配置会自然生效）。
  if (g.timer || g.interval) {
    logLine("调度器已在运行，跳过重复启动");
    return;
  }

  const delay = typeof config.delayMs === "number" && config.delayMs >= 0
    ? config.delayMs
    : checkinDelayMs();

  const tick = async () => {
    if (g.running) return;
    g.running = true;
    try {
      const now = Date.now();
      const state = readState();
      const today = utc8DateString(now);

      // 今天已经成功记过 ⇒ 什么都不做。
      if (state.lastDate === today && state.lastMarked) return;

      const current = await getSettings();
      if (current.autoCheckin?.enabled !== true) {
        stopCheckinScheduler();
        return;
      }

      const result = await runCheckin({ now });
      if (!result.ok) {
        logLine(`本轮未完成：${result.message}`);
        return;
      }

      const next = {
        lastDate: result.marked ? result.date : state.lastDate,
        lastAt: now,
        lastMarked: result.marked,
        lastSummary: result.summary,
        channels: result.channels.map((c) => ({ ...c })),
      };
      writeState(next);
      g.lastRunAt = now;
      logLine(`${result.date} ${result.marked ? "" : "(未记入当日，下次重试) "}${result.summary}`);
    } catch (error) {
      // fail-open：一轮出错绝不能杀掉调度循环。
      logLine(`调度异常: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      g.running = false;
    }
  };

  g.startedAt = Date.now();
  g.timer = setTimeout(() => {
    g.timer = null;
    tick().catch(() => {});
    // 跨天补跑：30 分钟粒度足以在日界后不久补上。
    const EVERY_MS = 30 * 60 * 1000;
    g.interval = setInterval(() => { tick().catch(() => {}); }, EVERY_MS);
    if (g.interval.unref) g.interval.unref();
  }, delay);
  if (g.timer.unref) g.timer.unref();

  logLine(`调度器已启动（延迟 ${delay}ms）`);
}

/** 仅供测试：清空调度器状态。 */
export function resetCheckinScheduler() {
  stopCheckinScheduler();
  g.running = false;
  g.lastRunAt = 0;
  g.startedAt = 0;
}
