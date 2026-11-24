import { testChannel } from "@/lib/notifications/store";
import { adminRoute, json } from "@/lib/notifications/routes";

export const POST = adminRoute(async (repo, { id }, now) => {
  const status = await testChannel(repo, id, now);
  return json({ ok: status === 200 }, status);
}, "notification.channel.test");
