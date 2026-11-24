import { createHash } from "node:crypto";
import { publicText } from "../usage/reportFields.js";
import { redactLogValue } from "../observability/logPrivacy.js";

import { severity } from "../../shared/constants/notificationTypes.js";
export { severity };
export const defaults = { minRequests: 20, errorPercent: 25 };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function safeId(id) {
  return uuid.test(id) ? id : createHash("sha256").update(String(id)).digest("hex");
}
export const connectionSubject = id => "connection:" + safeId(id);
// Allow short human labels only. Never include free-form provider names/errors or imported IDs.
function keyLabel(name) {
  return publicText(name) && /^[\p{L}\d _-]{1,48}$/u.test(name) && !/[\w-]{20,}|token|secret|password|bearer/i.test(name)
    && redactLogValue(name) === name ? name : null;
}

export function evaluate(snapshot, now, thresholds = defaults) {
  const active = [];
  const add = (type, target, label = null, subject = target) => active.push({ type, target, label, subject, severity: severity[type] });
  for (const key of snapshot.keys) {
    const target = "key:" + safeId(key.id), label = keyLabel(key.name);
    for (const percent of [80, 100]) {
      if (key.limits.some(({ used, limit }) => limit > 0 && used * 100 >= limit * percent))
        add("key.quota." + percent, target, label);
    }
    const remaining = Date.parse(key.expiresAt) - now;
    if (remaining >= 0 && remaining <= 72 * 3600_000) add("key.expiring", target, label);
  }
  for (const { target, subject, state, since } of snapshot.providers) {
    if (state === "needs_reauth") add("provider.needs_reauth", target, null, subject);
    if (["unavailable", "rate_limited"].includes(state) && now - since >= 15 * 60_000)
      add("provider.unavailable", target, null, subject);
  }
  if (snapshot.requests >= thresholds.minRequests && snapshot.errors * 100 >= thresholds.errorPercent * snapshot.requests)
    add("errors.high", "gateway");
  if (snapshot.healthy === false) add("health.failed", "gateway");
  if (snapshot.diskPercent >= 90) add("disk.critical", "data");
  if (snapshot.backup === "failed") add("backup.failed", "backup");
  return active;
}
