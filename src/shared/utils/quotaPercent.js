/**
 * Compute the minimum remaining quota percentage across all windows
 * from a raw provider usage API response.
 *
 * @param {string} provider - Provider name (claude, github, antigravity, etc.)
 * @param {Object} usageData - Raw response from getUsageForProvider()
 * @returns {number|null} Minimum remaining % (0-100) or null if no quota data
 */
export function computeMinRemainingPercent(provider, usageData) {
  if (!usageData || typeof usageData !== "object" || !usageData.quotas) return null;

  const quotas = usageData.quotas;
  if (typeof quotas !== "object" || Object.keys(quotas).length === 0) return null;

  let minRemaining = null;

  for (const [, quota] of Object.entries(quotas)) {
    if (!quota || typeof quota !== "object") continue;
    if (quota.unlimited === true) continue;

    const total = quota.total || 0;
    if (total <= 0) continue;

    const used = quota.used || 0;
    const remaining = Math.max(0, total - used);
    const remainingPct = (remaining / total) * 100;

    if (minRemaining === null || remainingPct < minRemaining) {
      minRemaining = remainingPct;
    }
  }

  return minRemaining !== null ? Math.round(minRemaining) : null;
}
