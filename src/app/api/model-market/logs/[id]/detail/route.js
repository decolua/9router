import { NextResponse } from "next/server";
import { getApiKeyByValue } from "@/lib/localDb";
import { getAdapter } from "@/lib/db/driver";
import { parseJson } from "@/lib/db/helpers/jsonCol";
import { extractModelMarketApiKey } from "@/lib/auth/modelMarket";
import { findRequestDetailRow, sanitizeTrafficLogDetail } from "@/lib/trafficLogDetail";

export const dynamic = "force-dynamic";

export function findScopedModelMarketLog(db, id, apiKey) {
  return db.get(
    "SELECT id, timestamp, provider, model, connectionId, status, meta FROM usageHistory WHERE id = ? AND apiKey = ?",
    [id, apiKey],
  );
}

export async function GET(request, { params }) {
  const apiKey = extractModelMarketApiKey(request);
  if (!apiKey) return NextResponse.json({ error: "API key required" }, { status: 401 });

  const keyRecord = await getApiKeyByValue(apiKey);
  if (!keyRecord?.isActive) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

  try {
    const { id } = await params;
    const db = await getAdapter();
    const log = findScopedModelMarketLog(db, id, keyRecord.key);
    if (!log) return NextResponse.json({ error: "日志不存在" }, { status: 404 });
    if (["ok", "success", "200 ok"].includes(String(log.status || "").toLowerCase())) {
      return NextResponse.json({ error: "成功日志不提供错误详情" }, { status: 400 });
    }

    const meta = parseJson(log.meta, {}) || {};
    const detail = findRequestDetailRow(db, log, meta, { allowLegacyFallback: false });
    return NextResponse.json({ detail: sanitizeTrafficLogDetail(detail?.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Model Market] Failed to get scoped traffic log detail:", error);
    return NextResponse.json({ error: "获取日志详情失败" }, { status: 500 });
  }
}
