import { getProviderByAlias, getProviderAlias } from "@/shared/constants/providers";

export function normalizeProviderId(value) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return getProviderByAlias(trimmed)?.id || getProviderAlias(trimmed) || trimmed;
}

/** True when a usage row belongs to the selected combo's member list. */
export function usageItemMatchesCombo(item, combo) {
  if (!combo?.models?.length) return false;
  const itemProvider = normalizeProviderId(item?.providerId || item?.provider);
  const itemModel = String(item?.rawModel || item?.model || "").trim();
  if (!itemModel) return false;

  return combo.models.some((member) => {
    if (!member || typeof member !== "string") return false;
    const raw = member.trim();
    if (!raw) return false;
    if (!raw.includes("/")) {
      return itemModel === raw || itemModel.endsWith(`/${raw}`);
    }
    const slash = raw.indexOf("/");
    const memberProvider = normalizeProviderId(raw.slice(0, slash));
    const memberModel = raw.slice(slash + 1).trim();
    if (!memberModel) return false;
    const providerOk = !memberProvider || !itemProvider || memberProvider === itemProvider;
    const modelOk = itemModel === memberModel
      || itemModel === raw
      || itemModel.endsWith(`/${memberModel}`);
    return providerOk && modelOk;
  });
}

/**
 * Build usage rows attributed to combos that actually saw traffic.
 *
 * CB5/NIT-4 (honesty revert): CB3 added a `meta.combo` priority branch here
 * and it was removed again because it never runs — the ONLY production caller
 * (UsageStats "combo" view) feeds `stats.byModel`, entries pre-aggregated per
 * provider/model by usageRepo.getUsageStats, which never select or carry a
 * `meta` column. The branch was exercised only by synthetic tests and made
 * commit 6038b564 read as if the table had become attribution-aware; it
 * never was. Live per-row combo attribution is served by
 * GET /api/usage/combo-stats (D13), which reads meta.combo in SQL.
 *
 * Contract (the D13-sanctioned legacy behavior, unchanged): a model row
 * appears under EVERY combo listing it as a member — shared members double-
 * count across combo rows here BY DESIGN — and combos with zero matching
 * usage are omitted.
 */
export function buildComboUsageMap(byModel, combos = []) {
  const out = {};
  for (const combo of combos) {
    if (!combo?.name || !Array.isArray(combo.models) || combo.models.length === 0) continue;
    for (const [key, data] of Object.entries(byModel || {})) {
      if (!usageItemMatchesCombo(data, combo)) continue;
      out[`${combo.name}|${key}`] = {
        ...data,
        comboName: combo.name,
      };
    }
  }
  return out;
}
