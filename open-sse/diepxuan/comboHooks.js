import { recordComboModelResult, shouldSkipModelInCombo } from "./comboFailTracker.js";
import { isDiepXuanEnabled } from "@/diepxuan/shared/config/flags.js";

export function shouldSkipComboModel(modelStr, comboName) {
  if (!isDiepXuanEnabled()) return false;
  return shouldSkipModelInCombo(modelStr, comboName);
}

export function recordComboModelOutcome(modelStr, comboName, success) {
  if (!isDiepXuanEnabled()) return;
  recordComboModelResult(modelStr, comboName, success);
}