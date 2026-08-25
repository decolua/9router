import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver";
import { parseJson } from "@/lib/db/helpers/jsonCol";

export function findRequestDetailRow(db, log, meta = {}) {
  const requestDetailId = typeof meta.requestDetailId === "string" ? meta.requestDetailId.trim() : "";
  if (requestDetailId) {
    const exact = db.get("SELECT data FROM requestDetails WHERE id = ?", [requestDetailId]);
    if (exact) return exact;
  }

  return db.get(
    `SELECT data FROM requestDetails
     WHERE provider = ? AND model = ? AND COALESCE(connectionId, '') = COALESCE(?, '')
     ORDER BY ABS(julianday(timestamp) - julianday(?)) ASC LIMIT 1`,
    [log.provider, log.model, log.connectionId, log.timestamp],
  );
}

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const db = await getAdapter();
    const log = db.get("SELECT id, timestamp, provider, model, connectionId, status, meta FROM usageHistory WHERE id = ?", [id]);
    if (!log) return NextResponse.json({ error: "日志不存在" }, { status: 404 });
    const meta = parseJson(log.meta, {}) || {};
    const detail = findRequestDetailRow(db, log, meta);
    const rawDetail = detail ? parseJson(detail.data, {}) : null;
    // Detail payloads contain user prompts and credentials-adjacent request
    // metadata. The traffic-log viewer only needs response diagnostics.
    const safeDetail = rawDetail ? {
      id: rawDetail.id,
      timestamp: rawDetail.timestamp,
      status: rawDetail.status,
      latency: rawDetail.latency,
      tokens: rawDetail.tokens,
      providerResponse: rawDetail.providerResponse,
      response: rawDetail.response,
    } : null;
    return NextResponse.json({
      log: { id: log.id, timestamp: log.timestamp, provider: log.provider, model: log.model, status: log.status, meta },
      detail: safeDetail,
    });
  } catch (error) {
    console.error("[API] Failed to get traffic log detail:", error);
    return NextResponse.json({ error: "获取日志详情失败" }, { status: 500 });
  }
}
