import { NextResponse } from "next/server";

import {
  campaignCheckin,
  getQoderConnection,
  listQoderConnections,
  runBatchCheckin,
} from "@/lib/qoder/rewards.js";

/** 每日签到只领 Credits 类活动（不碰兑换码/券与 Pro 包）。 */
const DAILY_ONLY_KINDS = ["", "CREDITS"];

/**
 * POST /api/qoder/checkin
 * body: { connectionId?: "all"|<id>, provider?: "qoder"|"qoder-cn", onlyDaily?: boolean }
 *
 * 领取路径写操作；活动列表缓存由 rewards 内部在领取后失效。
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const connectionId = body.connectionId || "all";
    const provider = body.provider || null;
    const onlyDaily = body.onlyDaily !== false;

    if (connectionId === "all") {
      const conns = await listQoderConnections(provider);
      if (conns.length === 0) {
        return NextResponse.json({ ok: false, logs: [], credit_added: 0, msg: "未找到可用 Qoder 账号" });
      }
      const res = await runBatchCheckin(conns, { onlyDaily, gapMs: 1000, interGapMs: 1200 });
      return NextResponse.json(res);
    }

    const conn = await getQoderConnection(connectionId);
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    const res = await campaignCheckin(conn, { onlyKinds: onlyDaily ? DAILY_ONLY_KINDS : null });
    const logs = [res.message, ...(res.codes || []).map((c) => `🎟 ${c.campaign} 兑换码：${c.code}`)];
    return NextResponse.json({
      ok: res.ok,
      logs,
      credit_added: res.earned || 0,
      accounts_count: 1,
      detail: res,
    });
  } catch (error) {
    console.error("[API] Qoder checkin failed:", error);
    return NextResponse.json({ error: "Qoder checkin failed" }, { status: 500 });
  }
}