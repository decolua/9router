import { recordComboModelResult, shouldSkipModelInCombo } from "./comboFailTracker.js";
import { isDiepXuanEnabled } from "../../src/diepxuan/shared/config/flags.js";

export function shouldSkipComboModel(modelStr, comboName) {
  if (!isDiepXuanEnabled()) return false;
  return shouldSkipModelInCombo(modelStr, comboName);
}

export function recordComboModelOutcome(modelStr, comboName, success) {
  if (!isDiepXuanEnabled()) return;
  recordComboModelResult(modelStr, comboName, success);
}

export function beforeComboModelAttempt({ modelStr, comboName, log }) {
  if (!shouldSkipComboModel(modelStr, comboName)) return { skip: false };
  log?.debug?.("COMBO", `Skipping ${modelStr} (fail count exceeded)`);
  return { skip: true };
}

export function afterComboModelAttempt({ modelStr, comboName, ok }) {
  recordComboModelOutcome(modelStr, comboName, ok);
}
