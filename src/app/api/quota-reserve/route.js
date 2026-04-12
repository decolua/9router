import { getAllReserveStates } from "@/shared/services/quotaReserveState";

/**
 * GET /api/quota-reserve - Return in-memory quota reserve states for all connections.
 * Used by the Quota Tracker UI to display reserve/cooldown badges.
 */
export async function GET() {
  const states = getAllReserveStates();
  return Response.json({ states });
}
