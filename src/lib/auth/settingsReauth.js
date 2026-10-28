// Settings changes that weaken the instance or repoint who can sign in require
// the current dashboard password (or a validated local CLI token).
const SSO_KEYS = [
  "authMode", "ssoType",
  "oidcIssuerUrl", "oidcClientId", "oidcClientSecret", "oidcScopes",
  "samlEntryPoint", "samlIssuer", "samlCert", "samlAttributeEmail", "samlAttributeName",
];
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function reauthRequiredKeys(updates, current = {}) {
  if (!updates || typeof updates !== "object") return [];
  const keys = [];
  if (has(updates, "requireLogin") && updates.requireLogin === false && current.requireLogin !== false) keys.push("requireLogin");
  if (has(updates, "requireApiKey") && updates.requireApiKey === false && current.requireApiKey !== false) keys.push("requireApiKey");
  if (has(updates, "tunnelDashboardAccess") && updates.tunnelDashboardAccess === true && current.tunnelDashboardAccess !== true) keys.push("tunnelDashboardAccess");
  for (const key of SSO_KEYS) {
    if (!has(updates, key)) continue;
    if (key === "oidcClientSecret" && !String(updates[key] ?? "").trim()) continue;
    if ((updates[key] ?? "") !== (current[key] ?? "")) keys.push(key);
  }
  return keys;
}

export const REAUTH_REQUIRED_CODE = "REAUTH_REQUIRED";
