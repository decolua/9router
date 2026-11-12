/**
 * 每日签到 API。
 *
 * ## 认证
 *
 * 路由挂在 `/api/checkin`（**不是** `/api/v1/*`），因此走 `dashboardGuard.js`
 * 的 deny-by-default 分支：需要 dashboard 会话或 CLI token。
 * ⚠️ 刻意不放到 `PUBLIC_PREFIXES`（`/api/v1`）下 —— 签到是**写操作**，绝不能
 * 因为落在 LLM 公开前缀里而变成免鉴权。
 *
 * ## 端点
 *
 * - `GET   /api/checkin`                → 当前状态（开关、今日是否已跑、上次逐渠道结果 + **每渠道可用账号数**）
 * - `GET   /api/checkin?probe=1`        → 只读实时查询上游签到状态（每账号一次请求，不领取）
 * - `POST  /api/checkin`                → 手动跑一轮（写操作；放行「今日已跑」判定）
 * - `POST  /api/checkin?dryRun=1`       → 只读探测（同 `probe=1`）
 * - `POST  /api/checkin?provider=<id>`  → **只跑指定渠道**（面板上每个渠道的单独按钮）
 * - `PATCH /api/checkin`                → 改开关 / 延迟 / 渠道选择
 */

import { NextResponse } from "next/server";
import { getSettings, updateSettings, getProviderConnections } from "@/lib/localDb";
import {
  getCheckinStatus,
  runCheckin,
  runCheckinNow,
  readState,
} from "@/shared/services/checkinScheduler";
import {
  checkinStatus,
  listCheckinProviders,
  isCheckinSupported,
  checkinLabel,
  resolveIanaTimezone,
} from "@/shared/services/checkinProviders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "Cache-Control": "no-store" };

/**
 * 每个支持签到的渠道各有多少个**已启用**账号。
 *
 * 面板必须拿到这个数：只有实现、没有账号的渠道点了也只会显示「没有可签到的账号」，
 * 属于无效操作。UI 用 `accounts` 决定是否禁用该渠道的按钮。
 */
async function accountCounts() {
  const connections = await getProviderConnections({ isActive: true });
  const counts = {};
  for (const p of listCheckinProviders()) counts[p.id] = 0;
  for (const c of connections) {
    if (c.isActive === false || c.isActive === 0) continue;
    if (Object.prototype.hasOwnProperty.call(counts, c.provider)) counts[c.provider] += 1;
  }
  return counts;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    // ?probe=1 实时查询上游签到状态（只读，每个账号一次请求）
    if (url.searchParams.get("probe") === "1") {
      return NextResponse.json(await probeAll(), { headers: HEADERS });
    }
    const status = await getCheckinStatus();
    const counts = await accountCounts();
    return NextResponse.json(
      {
        ...status,
        supported: listCheckinProviders().map((p) => ({ ...p, accounts: counts[p.id] || 0 })),
        totalAccounts: Object.values(counts).reduce((a, b) => a + b, 0),
      },
      { headers: HEADERS },
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: HEADERS });
  }
}

export async function POST(request) {
  try {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dryRun") === "1";
    // 只跑指定渠道（面板上每个渠道的单独按钮）。
    const provider = url.searchParams.get("provider");

    // 只读模式：查状态，绝不领取。
    if (dryRun) return NextResponse.json(await probeAll(), { headers: HEADERS });

    // 指定渠道时校验它确实有实现 —— 否则会静默返回「0 个账号」，让人以为跑了。
    if (provider && !isCheckinSupported(provider)) {
      return NextResponse.json(
        { ok: false, error: `${provider} has no check-in implementation` },
        { status: 400, headers: HEADERS },
      );
    }

    const result = await runCheckinNow(provider ? { only: [provider] } : {});
    if (!result.ok) {
      return NextResponse.json(result, { status: 500, headers: HEADERS });
    }
    return NextResponse.json({ ...result, provider: provider || null }, { headers: HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: HEADERS });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    // 开关与渠道选择：与 settings 的其余部分同一条原子读-改-写路径。
    const current = await getSettings();
    const prev = current.autoCheckin || {};
    const next = { ...prev };

    if (typeof body.enabled === "boolean") next.enabled = body.enabled;
    if (typeof body.delayMs === "number" && body.delayMs >= 0) next.delayMs = body.delayMs;
    if (body.providers && typeof body.providers === "object" && !Array.isArray(body.providers)) {
      // 只接受有签到实现的 provider id —— 静默丢弃未知项，避免脏配置沉淀。
      const clean = {};
      for (const [id, on] of Object.entries(body.providers)) {
        if (isCheckinSupported(id)) clean[id] = on === true;
      }
      next.providers = clean;
    }

    await updateSettings({ autoCheckin: next });

    // 改完立刻重配置调度器（开关一打开就开始计时，不用重启）。
    const { configureCheckinScheduler } = await import("@/shared/services/checkinScheduler");
    configureCheckinScheduler({ autoCheckin: next });

    const status = await getCheckinStatus();
    const counts = await accountCounts();
    return NextResponse.json(
      {
        ...status,
        supported: listCheckinProviders().map((p) => ({ ...p, accounts: counts[p.id] || 0 })),
        totalAccounts: Object.values(counts).reduce((a, b) => a + b, 0),
      },
      { headers: HEADERS },
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: HEADERS });
  }
}

/** 逐渠道、逐账号**只读**查询签到状态（不领取）。 */
async function probeAll() {
  const connections = await getProviderConnections({ isActive: true });
  const timezoneId = resolveIanaTimezone();
  const byProvider = new Map();

  for (const c of connections) {
    if (c.isActive === false || c.isActive === 0) continue;
    if (!isCheckinSupported(c.provider)) continue;
    if (!byProvider.has(c.provider)) byProvider.set(c.provider, []);
    byProvider.get(c.provider).push(c);
  }

  const channels = [];
  for (const [provider, pool] of byProvider) {
    const accounts = [];
    for (const conn of pool) {
      try {
        const result = await checkinStatus(provider, conn, { timezoneId });
        accounts.push({
          id: conn.id,
          name: conn.name || conn.id,
          ok: result.ok === true,
          todayCheckedIn: result.todayCheckedIn === true,
          message: result.ok ? undefined : result.message,
        });
      } catch (error) {
        accounts.push({ id: conn.id, name: conn.name || conn.id, ok: false, message: error.message });
      }
    }
    channels.push({ provider, label: checkinLabel(provider), accounts });
  }

  return { ok: true, readOnly: true, timezoneId, channels, state: readState() };
}
