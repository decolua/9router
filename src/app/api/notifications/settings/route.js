import { settings, saveThresholds } from "@/lib/notifications/store";
import { adminRoute, json } from "@/lib/notifications/routes";

export const GET = adminRoute((repo, _, now) => json(settings(repo, now)));
export const PATCH = adminRoute((repo, body) => {
  saveThresholds(repo, body);
  return json({ ok: true });
});
