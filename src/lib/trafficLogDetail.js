import { parseJson } from "@/lib/db/helpers/jsonCol";

export function findRequestDetailRow(db, log, meta = {}, options = {}) {
  const requestDetailId = typeof meta.requestDetailId === "string" ? meta.requestDetailId.trim() : "";
  if (requestDetailId) {
    const exact = db.get("SELECT data FROM requestDetails WHERE id = ?", [requestDetailId]);
    if (exact) return exact;
  }
  if (options.allowLegacyFallback === false) return null;

  return db.get(
    `SELECT data FROM requestDetails
     WHERE provider = ? AND model = ? AND COALESCE(connectionId, '') = COALESCE(?, '')
     ORDER BY ABS(julianday(timestamp) - julianday(?)) ASC LIMIT 1`,
    [log.provider, log.model, log.connectionId, log.timestamp],
  );
}

export function sanitizeTrafficLogDetail(detail) {
  if (!detail) return null;
  const rawDetail = typeof detail === "string" ? parseJson(detail, {}) : detail;
  return {
    id: rawDetail.id,
    timestamp: rawDetail.timestamp,
    status: rawDetail.status,
    latency: rawDetail.latency,
    tokens: rawDetail.tokens,
    providerResponse: rawDetail.providerResponse,
    response: rawDetail.response,
  };
}
