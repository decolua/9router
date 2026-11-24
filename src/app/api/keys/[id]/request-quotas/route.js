import { getAdapter } from "@/lib/db/driver.js";
import { REQUEST_WINDOWS, requestQuotaSummary } from "@/shared/utils/requestWindows.js";

export const dynamic = "force-dynamic";
const columns = REQUEST_WINDOWS.flatMap(w => [w.limit, w.used, w.bucket]).join(", ");
export async function GET(_request, { params }) {
  const { id } = await params;
  const db = await getAdapter();
  const row = db.get(`SELECT ${columns} FROM apiKeys WHERE id=?`, [id]);
  return Response.json(row ? { windows: requestQuotaSummary(row) } : { error: "Key not found" },
    { status: row ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
