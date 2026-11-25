import { UsageInputError } from "./range.js";
import { connectionName, publicText } from "./reportFields.js";
import { usageIdentity } from "../db/helpers/usageFingerprint.js";

const fields = ["timestamp", "requestId", "provider", "model", "keyName", "project", "owner", "description", "connection", "endpoint",
  "status", "inputTokens", "outputTokens", "cost", "latencyMs", "attempts", "fallbacks", "errorCategory"];
const PAGE = 256;
export const EXPORT_LIMIT = 1_000_000;

function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

function endpointPath(endpoint) {
  if (!endpoint) return null;
  try {
    const path = decodeURIComponent(new URL(endpoint, "http://localhost").pathname);
    return publicText(path) && /^\/[\w./:-]+$/.test(path) ? path : null;
  } catch { return null; }
}

export function usageExport(reports, range, format, limit = EXPORT_LIMIT) {
  if (!["csv", "json"].includes(format)) throw new UsageInputError("Expected format=csv or format=json");
  const { keys, providerName, n, first, last, page } = reports.openExport(range, limit);
  if (n > limit) throw new UsageInputError(`Export exceeds ${limit} rows; select a shorter range`, 413);
  let after = (first ?? 0) - 1;
  let started = false;
  const csv = format === "csv";
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    pull(controller) {
      let chunk = started ? "" : csv ? fields.join(",") + "\r\n" : "[";
      const rows = n ? page(after, PAGE) : [];
      for (const { id,apiKey,connectionId, ...row } of rows) {
        const key = keys.get(usageIdentity(apiKey));
        const provider = providerName(row.provider);
        const data = { ...row, timestamp: publicText(row.timestamp), requestId: publicText(row.requestId),
          model: publicText(row.model), provider, status: publicText(row.status),
          keyName: key?.name ?? null, project: key?.project ?? null, owner: key?.owner ?? null, description: key?.description ?? null,
          connection: connectionName(provider, connectionId), endpoint: endpointPath(row.endpoint) };
        chunk += csv ? fields.map(k => csvCell(data[k])).join(",") + "\r\n" : (started ? "," : "") + JSON.stringify(data);
        after = id; started = true;
      }
      const done = rows.length < PAGE || after === last;
      if (done && !csv) chunk += "]";
      controller.enqueue(encoder.encode(chunk));
      if (done) controller.close();
    },
  }, { highWaterMark: 0 });
  return new Response(stream, { headers: { "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json",
    "Content-Disposition": `attachment; filename="usage.${format}"`, "Cache-Control": "no-store" } });
}
