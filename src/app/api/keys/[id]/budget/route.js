import { getAdapter } from "@/lib/db/driver.js";
import { getBudgetBalance } from "@/lib/db/repos/budgetLedger.js";

export const dynamic = "force-dynamic";
export async function GET(_request, { params }) {
  const { id } = await params;
  const summary = getBudgetBalance(await getAdapter(), id);
  return Response.json(summary || { error: "Key not found" }, {
    status: summary ? 200 : 404, headers: { "Cache-Control": "no-store" },
  });
}
