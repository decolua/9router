import { getProviderSummary } from "@/lib/db/index.js";

export async function GET() {
  const providers = await getProviderSummary();
  return Response.json({ providers }, { headers: { "Cache-Control": "no-store" } });
}
