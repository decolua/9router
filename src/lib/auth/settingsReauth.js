// Settings changes that weaken the instance or repoint who can sign in. A session alone
// (possibly stolen, or on an instance with requireLogin=false) must not be able to make
// them: PATCH /api/settings requires the current dashboard password for these, the same
// re-auth the DB export/import uses (GHSA-vmjq-hvgq-2wv4).

// Auth/SSO fields: changing any of them can hand sign-in to an attacker's IdP.
const SSO_KEYS = [
  "authMode", "ssoType",
  "oidcIssuerUrl", "oidcClientId", "oidcClientSecret", "oidcScopes",
  "samlEntryPoint", "samlIssuer", "samlCert", "samlAttributeEmail", "samlAttributeName",
];

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Keys in `updates` that need re-auth given the stored `current` settings. Turning a
// protection back on, or re-saving an unchanged value, never does.
export function reauthRequiredKeys(updates, current = {}) {
  if (!updates || typeof updates !== "object") return [];
  const keys = [];
  if (has(updates, "requireLogin") && updates.requireLogin === false && current.requireLogin !== false) keys.push("requireLogin");
  if (has(updates, "requireApiKey") && updates.requireApiKey === false && current.requireApiKey !== false) keys.push("requireApiKey");
  if (has(updates, "tunnelDashboardAccess") && updates.tunnelDashboardAccess === true && current.tunnelDashboardAccess !== true) keys.push("tunnelDashboardAccess");
  for (const key of SSO_KEYS) {
    if (!has(updates, key)) continue;
    // Blank secret means "keep the stored one" (the PATCH handler drops it).
    if (key === "oidcClientSecret" && !String(updates[key] ?? "").trim()) continue;
    if ((updates[key] ?? "") !== (current[key] ?? "")) keys.push(key);
  }
  return keys;
}

export const REAUTH_REQUIRED_CODE = "REAUTH_REQUIRED";
