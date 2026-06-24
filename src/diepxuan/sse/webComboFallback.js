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

export async function handleDiepXuanWebComboFallback({
  body,
  providerInput,
  combos,
  kind,
  resolvedProvider,
  settings,
  handleComboChat,
  handleSingleModel,
  log,
  logScope,
}) {
  const firstCombo = getFallbackWebCombo(providerInput, combos, kind, !!resolvedProvider);
  if (!firstCombo) return null;

  const comboStrategies = settings.comboStrategies || {};
  const comboStrategy = comboStrategies[firstCombo.name]?.fallbackStrategy || settings.comboStrategy || "fallback";
  const comboStickyLimit = settings.comboStickyRoundRobinLimit;

  if (!providerInput) {
    log.info(logScope, `No provider/model specified, using firstCombo "${firstCombo.name}"`);
  } else if (firstCombo.name !== providerInput) {
    log.warn(logScope, `Unknown provider "${providerInput}", using firstCombo "${firstCombo.name}"`);
  }

  log.info(logScope, `Combo "${firstCombo.name}" with ${firstCombo.models.length} providers (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);

  return handleComboChat({
    body,
    models: firstCombo.models,
    handleSingleModel,
    log,
    comboName: firstCombo.name,
    comboStrategy,
    comboStickyLimit,
  });
}