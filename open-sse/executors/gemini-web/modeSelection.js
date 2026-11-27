// Per-model Gemini Web UI mode selection + verification.
//
// The executor's real selection step: for each advertised model (and for the
// Extended Thinking control), it tries the corresponding UI control, then READS
// BACK the active-mode indicator to confirm the switch actually took effect
// before the caller is allowed to proceed. `gemini-3.1-pro` is treated as the
// mode `gemini.google.com/app` already opens to (no interaction needed); every
// other advertised model requires a confirmed switch.
//
// ⚠️ SELECTOR SET IS UNVALIDATED. Every CSS selector below is a best-effort
// guess at Gemini's current DOM, not a value confirmed against a live account.
// That is fine BY DESIGN: `selectGeminiUiMode()` never trusts an unconfirmed
// guess. If a selector is wrong, the toggle/indicator lookup simply fails, the
// read-back does not confirm the requested mode, and the caller gets a clear
// 400 (`unsupported_control_for_provider`) instead of a response silently
// labeled with a model/mode that never actually ran. Update the selectors only
// after inspecting the real DOM on a live account, never from guesswork.

// Model -> Gemini UI mode map for the advertised ids. Keep the two catalogs in
// sync: an advertised model with no entry here fails closed as `unknown_model`,
// which is the intended, honest behavior for a model this module cannot yet
// select.
export const GEMINI_WEB_MODEL_MODES = {
  "gemini-3.1-pro": { id: "gemini-3.1-pro", isDefault: true },
  "gemini-3.7-flash": {
    id: "gemini-3.7-flash",
    isDefault: false,
    toggleSelector:
      '[data-test-id="bard-mode-menu-button"], button[aria-haspopup="menu"][aria-label*="model" i]',
    activeIndicatorSelector:
      '[data-test-id="bard-mode-menu-button"] .mode-title, [data-test-id="bard-mode-menu-button"]',
    expectedIndicatorPattern: /\bflash\b(?!.*\blite\b)/i,
  },
  "gemini-3.1-flash-lite": {
    id: "gemini-3.1-flash-lite",
    isDefault: false,
    toggleSelector:
      '[data-test-id="bard-mode-menu-button"], button[aria-haspopup="menu"][aria-label*="model" i]',
    activeIndicatorSelector:
      '[data-test-id="bard-mode-menu-button"] .mode-title, [data-test-id="bard-mode-menu-button"]',
    expectedIndicatorPattern: /flash.*\blite\b/i,
  },
};

// The Extended Thinking control — account-dependent, not a model.
export const GEMINI_WEB_EXTENDED_THINKING_MODE = {
  id: "extended-thinking",
  isDefault: false,
  toggleSelector:
    '[data-test-id="deep-think-toggle"], button[aria-label*="extended thinking" i], ' +
    'button[aria-label*="deep think" i]',
  activeIndicatorSelector:
    '[data-test-id="deep-think-toggle"][aria-pressed="true"], [data-test-id="deep-think-toggle"].is-active',
  expectedIndicatorPattern: /thinking|deep think/i,
};

async function readIndicatorText(el) {
  try {
    if (typeof el.textContent === "function") {
      const text = await el.textContent();
      if (typeof text === "string") return text;
    }
    if (typeof el.innerText === "function") {
      return await el.innerText();
    }
  } catch {
    // Unreadable is treated the same as "did not confirm" below — never a pass.
  }
  return null;
}

/**
 * Try to switch the live Gemini Web page to `descriptor`'s mode, then READ
 * BACK the active-mode indicator before reporting success. A click landing
 * is never itself treated as success — only a confirmed, pattern-matching
 * indicator text is.
 */
export async function selectGeminiUiMode(page, descriptor, timeoutMs = 5000) {
  if (descriptor.isDefault) return { confirmed: true, descriptor };

  const { toggleSelector, activeIndicatorSelector, expectedIndicatorPattern } = descriptor;
  if (!toggleSelector || !activeIndicatorSelector || !expectedIndicatorPattern) {
    return { confirmed: false, reason: "control_not_found", descriptor };
  }

  const toggle = await page
    .waitForSelector(toggleSelector, { timeout: timeoutMs })
    .catch(() => null);
  if (!toggle) return { confirmed: false, reason: "control_not_found", descriptor };

  await toggle.click();

  const indicator = await page
    .waitForSelector(activeIndicatorSelector, { timeout: timeoutMs })
    .catch(() => null);
  if (!indicator) return { confirmed: false, reason: "indicator_not_found", descriptor };

  const text = await readIndicatorText(indicator);
  if (!text || !expectedIndicatorPattern.test(text)) {
    return { confirmed: false, reason: "indicator_mismatch", descriptor };
  }

  return { confirmed: true, descriptor };
}

export function resolveGeminiModelMode(modelId) {
  return GEMINI_WEB_MODEL_MODES[modelId] ?? null;
}

/** Select + verify the requested advertised model's Gemini UI mode. */
export async function selectGeminiModel(page, modelId, timeoutMs) {
  const descriptor = resolveGeminiModelMode(modelId);
  if (!descriptor) return { confirmed: false, reason: "unknown_model" };
  return selectGeminiUiMode(page, descriptor, timeoutMs);
}

/** Select + verify the Extended Thinking control. */
export async function selectGeminiExtendedThinking(page, timeoutMs) {
  return selectGeminiUiMode(page, GEMINI_WEB_EXTENDED_THINKING_MODE, timeoutMs);
}

const REASON_DETAIL = {
  unknown_model: "it is not one of the advertised, selectable gweb models",
  control_not_found: "the Gemini UI control used to switch modes was not found",
  indicator_not_found: "the active-mode indicator used to confirm the switch was not found",
  indicator_mismatch: "the active-mode indicator did not confirm the switch after attempting it",
};

/**
 * Client-facing explanation for a failed-closed selection, safe to put
 * directly in a response body (no selector text, no stack trace).
 */
export function describeModeSelectionFailure(controlLabel, reason) {
  const detail = (reason && REASON_DETAIL[reason]) || "the switch could not be verified";
  return (
    `Model provider "gemini-web" could not verify that "${controlLabel}" is actually active in ` +
    `the Gemini web UI (${detail}). Rather than silently answering under a model/mode label that ` +
    'may not be accurate, the request was rejected with "unsupported_control_for_provider".'
  );
}
