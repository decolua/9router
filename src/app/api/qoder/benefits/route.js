import { NextResponse } from "next/server";

import {
  getQoderConnection,
  listQoderConnections,
  proEligibility,
  proClaim,
  runBatchProClaim,
} from "@/lib/qoder/rewards.js";

/**
 * POST /api/qoder/benefits
 * body: { connectionId?: "all"|<id>, provider?: "qoder"|"qoder-cn" }
 *
 * 领取一次性 Pro 升级包（+1800 积分）。官方幂等，重复领取按"已领"处理。
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const connectionId = body.connectionId || "all";
    const provider = body.provider || null;

    if (connectionId === "all") {
      const conns = await listQoderConnections(provider);
      if (conns.length === 0) {
        return NextResponse.json({ ok: false, logs: [], credit_added: 0, msg: "未找到可用 Qoder 账号" });
      }
      const res = await runBatchProClaim(conns, { interGapMs: 1200 });
      return NextResponse.json(res);
    }

    const conn = await getQoderConnection(connectionId);
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    const nick = conn.displayName || conn.email || conn.id.slice(0, 8);
    const elig = await proEligibility(conn);
    if (!elig.ok) {
      return NextResponse.json({ ok: false, logs: [`! [${nick}] Pro 升级包资格查询失败：${elig.error}`], credit_added: 0, accounts_count: 1 });
    }
    if (!elig.eligible) {
      return NextResponse.json({ ok: true, logs: [`— [${nick}] Pro 升级包不可领取（已领或活动未开放）`], credit_added: 0, accounts_count: 1 });
    }
    const res = await proClaim(conn);
    return NextResponse.json({
      ok: res.ok,
      logs: [res.ok ? `✓ [${nick}] ${res.msg}` : `! [${nick}] Pro 升级包领取失败：${res.error}`],
      credit_added: res.ok ? 1800 : 0,
      accounts_count: 1,
    });
  } catch (error) {
    console.error("[API] Qoder benefits claim failed:", error);
    return NextResponse.json({ error: "Qoder benefits claim failed" }, { status: 500 });
  }
}