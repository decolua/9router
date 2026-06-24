import { isDiepXuanEnabled } from "@/diepxuan/shared/config/flags.js";

export function getFirstWebCombo(combosData, kind) {
  if (!isDiepXuanEnabled()) return null;
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  return combos.find((combo) => combo?.kind === kind && Array.isArray(combo.models) && combo.models.length > 0) || null;
}

export function getNamedWebCombo(providerInput, combosData, kind) {
  if (!isDiepXuanEnabled()) return null;
  if (!providerInput || typeof providerInput !== "string" || providerInput.includes("/")) return null;

  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  return combos.find((combo) => combo?.name === providerInput && combo?.kind === kind && Array.isArray(combo.models) && combo.models.length > 0) || null;
}

export function getFallbackWebCombo(providerInput, combosData, kind, isKnownProvider) {
  if (!isDiepXuanEnabled()) return null;
  if (!providerInput || typeof providerInput !== "string") {
    return getFirstWebCombo(combosData, kind);
  }

  const namedCombo = getNamedWebCombo(providerInput, combosData, kind);
  if (namedCombo) return namedCombo;

  if (!isKnownProvider) {
    return getFirstWebCombo(combosData, kind);
  }

  return null;
}