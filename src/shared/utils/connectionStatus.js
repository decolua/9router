export function getStatusVariant(isActive, effectiveStatus) {
  // A quarantined profile is disabled on purpose; keep it visible as an error
  // instead of the neutral "disabled" badge so the repair action stands out.
  if (effectiveStatus === "reauth_required") return "error";
  if (isActive === false) return "default";
  if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
  if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
  return "default";
}

/**
 * Identify providers that have connections configured, but ALL of them are deactivated (isActive === false).
 * Providers with 0 connections (e.g. keyless local nodes) are NOT considered deactivated.
 * @param {Array<{provider: string, isActive?: boolean}>} connections
 * @returns {Set<string>} Set of deactivated provider IDs
 */
export function getDeactivatedProviderIds(connections) {
  const byProvider = {};
  for (const c of connections || []) {
    if (!c?.provider) continue;
    if (!byProvider[c.provider]) byProvider[c.provider] = { total: 0, active: 0 };
    byProvider[c.provider].total += 1;
    if (c.isActive !== false) byProvider[c.provider].active += 1;
  }
  const deactivated = new Set();
  for (const [provider, stats] of Object.entries(byProvider)) {
    if (stats.total > 0 && stats.active === 0) {
      deactivated.add(provider);
    }
  }
  return deactivated;
}
