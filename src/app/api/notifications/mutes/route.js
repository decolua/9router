import { addMute } from "@/lib/notifications/store";
import { adminRoute, json } from "@/lib/notifications/routes";

export const POST = adminRoute((repo, body, now) => {
  addMute(repo, body, now);
  return json({ ok: true }, 201);
});
export const DELETE = adminRoute((repo, { id }) => json({ ok: !!repo.deleteMute(id) }));
