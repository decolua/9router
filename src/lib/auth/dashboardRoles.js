export const ADMIN = "admin";
export const VIEWER = "viewer";

export function sessionEpoch(settings) {
  const value = settings.sessionEpoch === undefined ? 0 : settings.sessionEpoch;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid session epoch");
  return value;
}

export function nextSessionEpoch(settings) {
  return sessionEpoch({ sessionEpoch: sessionEpoch(settings) + 1 });
}

export function normalizeRoleList(values, emails = false) {
  if (!Array.isArray(values) || values.some(value => typeof value !== "string")) return null;
  return [...new Set(values.map(value => emails ? value.trim().toLowerCase() : value.trim()).filter(Boolean))];
}

export function ssoRole(settings, email, groups) {
  const emails = normalizeRoleList(settings.ssoAdminEmails, true) || [];
  if (typeof email === "string" && emails.includes(email.trim().toLowerCase())) return ADMIN;
  const allowed = normalizeRoleList(settings.ssoAdminGroups) || [];
  const memberships = normalizeRoleList(typeof groups === "string" ? [groups] : groups) || [];
  return memberships.some(group => allowed.includes(group)) ? ADMIN : VIEWER;
}
