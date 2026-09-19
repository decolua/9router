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
 * Priority (CB3): a row carrying a recorded `meta.combo` (D13/CB2 writers) is
 * attributed to THAT combo only — the name heuristic below must never
 * second-guess stored evidence, because it assigns one row to every combo
 * listing the same member (multi-combo members were misattributed by design).
 *
 * Fallback: rows without attribution (legacy, pre-CB2) keep the old behavior —
 * a model row appears under every combo that lists it as a member.
 * Combos with zero matching usage are omitted.
 */
function attributedComboOf(data) {
  const combo = data?.meta?.combo;
  return typeof combo === "string" && combo.trim() ? combo.trim() : null;
}

export function buildComboUsageMap(byModel, combos = []) {
  const out = {};
  for (const combo of combos) {
    if (!combo?.name || !Array.isArray(combo.models) || combo.models.length === 0) continue;
    for (const [key, data] of Object.entries(byModel || {})) {
      const attributed = attributedComboOf(data);
      if (attributed !== null) {
        // Real attribution exists for this row: it belongs to exactly one
        // combo (and nowhere else — not even a combo that lists the member).
        if (attributed === combo.name) out[`${combo.name}|${key}`] = { ...data, comboName: combo.name, attributed: true };
        continue;
      }
      if (!usageItemMatchesCombo(data, combo)) continue;
      out[`${combo.name}|${key}`] = {
        ...data,
        comboName: combo.name,
      };
    }
  }
  return out;
}
