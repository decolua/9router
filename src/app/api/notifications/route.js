import { dashboardRole } from "@/dashboardGuard";
import { getNotificationsRepo } from "@/lib/db/index.js";
import { inRange } from "@/lib/notifications/store";
import { adminRoute, json } from "@/lib/notifications/routes";

export async function GET(request) {
  if (!await dashboardRole(request)) return json({ error: "Unauthorized" }, 401);
  const cursor = new URL(request.url).searchParams.get("before");
  if (cursor !== null && !inRange(Number(cursor), 1, Number.MAX_SAFE_INTEGER)) return json({ error: "Invalid cursor" }, 400);
  return json((await getNotificationsRepo()).inbox(cursor === null ? null : Number(cursor)));
}

export const PATCH = adminRoute((repo, { id }, now) => {
  if (!inRange(id, 1, Number.MAX_SAFE_INTEGER)) return json({ error: "Invalid notification ID" }, 400);
  repo.markRead(id, now);
  return json({ ok: true });
});
