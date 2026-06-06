export const SECURITY_WIZARD_SNOOZE_KEY = "9router-security-wizard-snooze-until";
export const SECURITY_WIZARD_SNOOZE_MS = 24 * 60 * 60 * 1000;

export function isSecurityWizardSnoozed() {
  if (typeof window === "undefined") return false;
  try {
    const until = Number(localStorage.getItem(SECURITY_WIZARD_SNOOZE_KEY) || 0);
    return until > Date.now();
  } catch {
    return false;
  }
}

export function snoozeSecurityWizard() {
  try {
    localStorage.setItem(SECURITY_WIZARD_SNOOZE_KEY, String(Date.now() + SECURITY_WIZARD_SNOOZE_MS));
  } catch {
    /* ignore */
  }
}
