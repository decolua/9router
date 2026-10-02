import { NextResponse } from "next/server";

import {
  fetchAllAccountsView,
  fetchTaskView,
  getQoderConnection,
  listQoderConnections,
} from "@/lib/qoder/rewards.js";

/**
 * GET /api/qoder/tasks
 * 签到与福利中心的读路径（受全局中间件保护）。
 *
 * 查询参数：
 *   connectionId=all|<连接id>   默认 all（全部账号按活动聚合）
 *   provider=qoder|qoder-cn      可选，仅 all 模式生效
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId") || "all";
    const provider = searchParams.get("provider") || null;

    if (connectionId === "all") {
      const conns = await listQoderConnections(provider);
      if (conns.length === 0) {
        return NextResponse.json({
          tasks: [],
          summary: {},
          accounts: [],
          msg: "未找到可用 Qoder 账号（账号已禁用、缺少凭证或不属于该区域）",
        });
      }
      const view = await fetchAllAccountsView(conns);
      return NextResponse.json(view);
    }

    const conn = await getQoderConnection(connectionId);
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    const view = await fetchTaskView(conn);
    return NextResponse.json({
      ...view,
      connectionId: conn.id,
      provider: conn.provider,
      account: {
        id: conn.id,
        nickname: conn.displayName || conn.email || conn.name || conn.id.slice(0, 8),
      },
    });
  } catch (error) {
    console.error("[API] Failed to fetch Qoder tasks:", error);
    return NextResponse.json({ error: "Failed to fetch Qoder tasks" }, { status: 500 });
  }
}