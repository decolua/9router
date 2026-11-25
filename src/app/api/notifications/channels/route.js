import { addChannel } from "@/lib/notifications/store";
import { adminRoute, json } from "@/lib/notifications/routes";

export const POST = adminRoute(async (repo, body) => json({ id: await addChannel(repo, body) }, 201), "notification.channel.add");
export const DELETE = adminRoute((repo, { id }) =>
  repo.deleteChannel(id) ? json({ ok: true }) : json({ ok: false }, 404),
"notification.channel.delete");
