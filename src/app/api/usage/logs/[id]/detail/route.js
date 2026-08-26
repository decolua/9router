import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver";
import { parseJson } from "@/lib/db/helpers/jsonCol";
import { findRequestDetailRow, sanitizeTrafficLogDetail } from "@/lib/trafficLogDetail";

export { findRequestDetailRow } from "@/lib/trafficLogDetail";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const db = await getAdapter();
    const log = db.get("SELECT id, timestamp, provider, model, connectionId, status, meta FROM usageHistory WHERE id = ?", [id]);
    if (!log) return NextResponse.json({ error: "日志不存在" }, { status: 404 });
    if (["ok", "success", "200 ok"].includes(String(log.status || "").toLowerCase())) {
      return NextResponse.json({ error: "成功日志不提供错误详情" }, { status: 400 });
    }
    const meta = parseJson(log.meta, {}) || {};
    const detail = findRequestDetailRow(db, log, meta);
    return NextResponse.json({
      log: { id: log.id, timestamp: log.timestamp, provider: log.provider, model: log.model, status: log.status, meta },
      detail: sanitizeTrafficLogDetail(detail?.data),
    });
  } catch (error) {
    console.error("[API] Failed to get traffic log detail:", error);
    return NextResponse.json({ error: "获取日志详情失败" }, { status: 500 });
  }
}
