import { validateKeyConnections } from "./keyConnections.js";
import { KEY_NAME_MAX, keyFieldLimits } from "./keyOwnership.js";
import { REQUEST_WINDOWS } from "./requestWindows.js";
import { isKeyBudget } from "./keyBudget.js";

// Missing fields preserve the current policy on update; null clears it.
export function validateKeyPolicy(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Expected a JSON object" };
  }
  const value = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > KEY_NAME_MAX) return { error: `name must be text of 1 to ${KEY_NAME_MAX} characters` };
    value.name = name;
  }
  if (body.allowedConnections !== undefined) {
    const checked = validateKeyConnections(body.allowedConnections);
    if (checked.error) return checked;
    value.allowedConnections = checked.value;
  }
  for (const [field, limit] of Object.entries(keyFieldLimits)) {
    const text = body[field];
    if (text === undefined) continue;
    if (text !== null && (typeof text !== "string" || text.length > limit))
      return { error: `${field} must be text of at most ${limit} characters or null` };
    value[field] = text?.trim() || null;
  }
  if (body.budget !== undefined) {
    if (body.budget !== null && !isKeyBudget(body.budget)) return { error: "Invalid token/cost budget or model tariff" };
    value.budget = body.budget;
  }
  for (const { limit } of REQUEST_WINDOWS) {
    if (body[limit] === undefined) continue;
    const n = body[limit];
    if (n !== null && (!Number.isSafeInteger(n) || n < 1)) {
      return { error: `${limit} must be a positive integer or null` };
    }
    value[limit] = n;
  }
  if (body.expiresAt !== undefined) {
    const s = body.expiresAt;
    if (s !== null) {
      const canonical = typeof s === "string" && !s.includes(".") ? s.replace(/Z$/, ".000Z") : s;
      if (typeof s !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(canonical) ||
          !Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== canonical) {
        return { error: "expiresAt must be a valid UTC timestamp or null" };
      }
    }
    value.expiresAt = s === null ? null : new Date(s).toISOString();
  }
  return { value };
}
