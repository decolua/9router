const DEFAULT_SHORT_TIMEOUT_MS = 90_000;
const DEFAULT_MANUAL_TIMEOUT_MS = 15 * 60_000;

// Comma-separated CSS selector. Includes Google's stable ID, mobile/legacy form
// names, and aria-label fallbacks for English + Indonesian. Multi-language
// aria-label support matters because Google renders the form in the user's
// browser locale (so "Email or phone" becomes "Email atau nomor telepon" for
// id-ID accounts and similar for other locales).
export const EMAIL_INPUT_SELECTOR = [
  'input[type="email"]',
  'input[autocomplete="username"]',
  "input#identifierId",
  'input[name="identifier"]',
  'input[name="Email"]',
  'input[type="text"][autofocus]',
  'input[aria-label*="Email" i]',
  'input[aria-label*="email" i]',
  'input[aria-label*="phone" i]',
  'input[aria-label*="telepon" i]',
].join(", ");

export const PASSWORD_INPUT_SELECTOR = [
  'input[type="password"]',
  'input[name="Passwd"]',
  'input[name="password"]',
  'input[aria-label*="Password" i]',
  'input[aria-label*="password" i]',
  'input[aria-label*="Sandi" i]',
  'input[aria-label*="kata sandi" i]',
].join(", ");

const NEXT_BUTTON_SELECTORS = [
  'button:has-text("Next")',
  'button:has-text("Berikutnya")',
  'button:has-text("Continue")',
  'div[role="button"]:has-text("Next")',
  'div[role="button"]:has-text("Berikutnya")',
  "#identifierNext button",
  "#passwordNext button",
];

const APPROVE_BUTTON_SELECTORS = [
  "#submit_approve_access",
  "#submit_approve_access button",
  "#confirm",
  'form#tos_form input[type="submit"]',
  'button[jsname]:has-text("Allow")',
  'button:has-text("Allow")',
  '[role="button"]:has-text("Allow")',
  'input[type="submit"][value="Allow"]',
  'input[type="button"][value="Allow"]',
  'button[jsname]:has-text("Izinkan")',
  'button:has-text("Izinkan")',
  '[role="button"]:has-text("Izinkan")',
  'button:has-text("Continue")',
  'button:has-text("Next")',
  'button:has-text("Yes")',
  'button:has-text("Accept")',
  'button:has-text("Lanjutkan")',
  'button:has-text("Berikutnya")',
  'button:has-text("Setuju")',
  'button:has-text("Saya mengerti")',
  'button:has-text("Oke")',
  'button:has-text("OK")',
  'button:has-text("Got it")',
  'button:has-text("I understand")',
  'div[role="button"]:has-text("Continue")',
  'div[role="button"]:has-text("Next")',
  'div[role="button"]:has-text("Allow")',
  'div[role="button"]:has-text("Lanjutkan")',
  'div[role="button"]:has-text("Berikutnya")',
  'div[role="button"]:has-text("Izinkan")',
  'div[role="button"]:has-text("Setuju")',
  'div[role="button"]:has-text("Saya mengerti")',
  'div[role="button"]:has-text("Oke")',
  'div[role="button"]:has-text("OK")',
  'div[role="button"]:has-text("Got it")',
  'div[role="button"]:has-text("I understand")',
  'input[type="button"][value="Saya mengerti"]',
  'input[type="submit"][value="Saya mengerti"]',
];

const SKIP_BUTTON_SELECTORS = [
  'button:has-text("Skip")',
  'button:has-text("Lewati")',
  'button:has-text("Not now")',
  'button:has-text("Bukan sekarang")',
  'button:has-text("No thanks")',
  'button:has-text("Tidak sekarang")',
  'div[role="button"]:has-text("Skip")',
  'div[role="button"]:has-text("Not now")',
];

const GOOGLE_LOGIN_BUTTON_SELECTORS = [
  "#social-google",
  "a#social-google",
  'a:has-text("Sign up with Google")',
  'a:has-text("Log in with Google")',
  'button:has-text("Sign up with Google")',
  'button:has-text("Log in with Google")',
  'button:has-text("Google")',
  'a:has-text("Google")',
  'div[role="button"]:has-text("Google")',
  'span:has-text("Google")',
  '[aria-label*="Google"]',
  '[data-provider*="google" i]',
];

const TERMS_CHECKBOX_SELECTORS = [
  "#agree-policy-account",
  "#agree-policy",
  "#agree-policy-sso",
  'input[type="checkbox"][id*="agree" i]',
  'input[type="checkbox"][name*="agree" i]',
  'input[type="checkbox"][id*="policy" i]',
  'input[type="checkbox"][name*="policy" i]',
  'input[type="checkbox"][id*="terms" i]',
  'input[type="checkbox"][name*="terms" i]',
  '.login-checkbox input[type="checkbox"]',
  '[class*="checkbox"] input[type="checkbox"]',
  '[class*="agree"] input[type="checkbox"]',
  'input[type="checkbox"]',
];

const PRIVACY_CONFIRM_BUTTON_SELECTORS = [
  '.ui-dialog button:has-text("Confirm")',
  'dialog button:has-text("Confirm")',
  'button:has-text("Confirm")',
  'button:has-text("I agree")',
  'button:has-text("Agree")',
  'button:has-text("同意")',
  'button:has-text("确认")',
];

const PROVIDER_ONBOARDING_ACTION_SELECTORS = [
  'button:has-text("Continue")',
  '[role="button"]:has-text("Continue")',
  'button:has-text("Get started")',
  'button:has-text("GET STARTED")',
  'input[type="submit"][value="GET STARTED"]',
  'button:has-text("Start")',
  'button:has-text("Confirm")',
  'button:has-text("Done")',
  'button:has-text("Next")',
  'button:has-text("Skip")',
  'button:has-text("Not now")',
  'button:has-text("Save")',
  'button:has-text("Create")',
  'button:has-text("Enter")',
  'button:has-text("Launch")',
  'button:has-text("Use CodeBuddy")',
  'button:has-text("Go to CodeBuddy")',
];

const PROVIDER_REGION_TRIGGER_SELECTORS = [
  "select",
  '[role="combobox"]',
  '.page-region [role="combobox"]',
  ".page-region .t-select",
  '.page-region [class*="t-select"]',
  '.page-region [class*="select"]',
  ".page-region input[placeholder]",
  'button:has-text("Region")',
  '[role="button"]:has-text("Region")',
  'button:has-text("Select region")',
  '[role="button"]:has-text("Select region")',
  'button:has-text("Data region")',
  '[aria-label*="region" i]',
  '[placeholder*="region" i]',
];

const PROVIDER_REGION_OPTION_SELECTORS = [
  "text=/^Indonesia$/i",
  "text=/^ID$/i",
  "text=/^Singapore$/i",
  "text=/^SG$/i",
  "text=/^Japan$/i",
  "text=/^JP$/i",
  "text=/^Thailand$/i",
  "text=/^TH$/i",
  "text=/^Global$/i",
  "text=/^International$/i",
  "text=/^United States$/i",
  "text=/^US$/i",
  "text=/^Asia Pacific$/i",
  "text=/^Hong Kong$/i",
  "text=/^Default$/i",
];

const PROVIDER_ONBOARDING_INPUT_DEFAULTS = [
  { selector: 'input[name*="workspace" i]', value: "Default" },
  { selector: 'input[placeholder*="workspace" i]', value: "Default" },
  { selector: 'input[name*="team" i]', value: "Default" },
  { selector: 'input[placeholder*="team" i]', value: "Default" },
  { selector: 'input[name*="name" i]', value: "Default" },
  { selector: 'input[placeholder*="name" i]', value: "Default" },
];

const INVALID_CREDENTIAL_MARKERS = [
  "wrong password",
  "incorrect password",
  "couldn't find your google account",
  "couldn’t find your google account",
  "enter a valid email",
  "couldn’t sign you in",
  "couldn't sign you in",
  "invalid email or password",
  "password is incorrect",
];

const MANUAL_ASSIST_MARKERS = [
  "2-step verification",
  "2-step verification required",
  "verify it’s you",
  "verify it's you",
  "check your phone",
  "confirm it’s you",
  "confirm it's you",
  "recovery email",
  "recovery phone",
  "suspicious sign-in prevented",
  "unusual activity detected",
  "captcha",
  "try again later",
];

const RESTRICTED_ACCOUNT_MARKERS = [
  "restricted",
  "account has been restricted",
  "account is restricted",
  "account has been suspended",
  "account is suspended",
  "account has been disabled",
  "account is disabled",
  "account has been banned",
  "account is banned",
  "access denied",
  "account blocked",
  "your account has been",
  "violation of terms",
  "terms of service violation",
  "temporarily locked",
  "permanently locked",
  "account locked",
  "akun dibatasi",
  "akun diblokir",
  "akun ditangguhkan",
];

const GOOGLE_ONBOARDING_MARKERS = [
  "welcome to your new google account",
  "selamat datang di akun google baru anda",
  "welcome to your new account",
  "selamat datang di akun baru",
  "privacy and terms",
  "privasi dan persyaratan",
  "personalize your google services",
  "personalisasikan layanan google anda",
  "add recovery phone",
  "tambahkan nomor telepon pemulihan",
  "choose your settings",
  "pilih setelan anda",
];

const GOOGLE_WORKSPACE_WELCOME_MARKERS = [
  "welcome to your new account",
  "selamat datang di akun baru",
  "your administrator decides which",
  "administrator anda memutuskan layanan",
  "your organisation administrator manages",
  "your organization administrator manages",
];

const KIRO_CALLBACK_PREFIX = "kiro://kiro.kiroAgent/authenticate-success";

function parseCallbackUrl(rawUrl) {
  if (!rawUrl || !rawUrl.startsWith(KIRO_CALLBACK_PREFIX)) return null;

  const queryIndex = rawUrl.indexOf("?");
  const params = new URLSearchParams(
    queryIndex >= 0 ? rawUrl.slice(queryIndex + 1) : "",
  );
  const code = params.get("code");
  const state = params.get("state");

  if (!code) return null;

  return {
    callbackUrl: rawUrl,
    code,
    state,
  };
}

function getInteractionScopes(page) {
  const frames = typeof page.frames === "function" ? page.frames() : [];
  return [page, ...frames.filter((frame) => frame !== page.mainFrame?.())];
}

async function clickFirstVisible(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      await locator.click({ timeout: 5_000 }).catch(() => null);
      return true;
    }
  }

  return false;
}

async function clickFirstActionable(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      await locator.scrollIntoViewIfNeeded().catch(() => null);

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      const enabled = await locator.isEnabled().catch(() => true);
      if (!enabled) continue;

      const clicked = await locator
        .click({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (clicked) return true;
    }
  }

  return false;
}

async function checkFirstVisible(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const checked = await locator.isChecked().catch(() => false);
      if (checked) return true;

      const visible = await locator.isVisible().catch(() => false);
      const didCheck = visible
        ? await locator
            .check({ force: true, timeout: 5_000 })
            .then(() => true)
            .catch(() => false)
        : false;
      if (didCheck) return true;

      const clicked = visible
        ? await locator
            .click({ force: true, timeout: 5_000 })
            .then(() => true)
            .catch(() => false)
        : false;
      if (clicked) return true;

      const domChecked = await scope
        .evaluate((candidateSelector) => {
          const input = document.querySelector(candidateSelector);
          if (!(input instanceof HTMLInputElement)) return false;
          input.checked = true;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return input.checked;
        }, selector)
        .catch(() => false);
      if (domChecked) return true;
    }
  }

  return false;
}

async function getFirstVisibleLocator(page, selector) {
  for (const scope of getInteractionScopes(page)) {
    const locator = scope.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;

    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;

    return locator;
  }

  return null;
}

async function waitForFirstVisibleLocator(
  page,
  selector,
  { timeout = 15_000, pollInterval = 500 } = {},
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await getFirstVisibleLocator(page, selector);
    if (found) return found;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(pollInterval, remaining)));
  }
  return null;
}

async function fillInputResilient(locator, value, { timeout = 15_000 } = {}) {
  if (!locator || value == null) return false;

  try {
    await locator.fill(value, { timeout });
  } catch {
    // swallow; verification + fallback below will decide
  }

  let observed = "";
  try {
    observed = await locator.inputValue();
  } catch {
    observed = "";
  }
  if (observed === value) return true;

  // Fallback for React/Vue-controlled inputs where .fill() bypasses the
  // framework's onChange wiring and the value snaps back to empty.
  try {
    await locator.click({ timeout: 5_000 });
  } catch {
    /* noop */
  }
  try {
    await locator.fill("");
  } catch {
    /* noop */
  }
  try {
    await locator.type(value, { delay: 50, timeout });
  } catch {
    return false;
  }

  try {
    observed = await locator.inputValue();
  } catch {
    observed = "";
  }
  return observed === value;
}

function parseSelectorList(selector) {
  return String(selector || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readPageText(page) {
  const chunks = [];
  for (const scope of getInteractionScopes(page)) {
    try {
      chunks.push(await scope.evaluate(() => document.body?.innerText || ""));
    } catch {
      // Cross-origin frames can be unreadable; ignore them.
    }
  }
  return chunks.join("\n");
}

function includesAny(text, markers) {
  const normalized = String(text || "").toLowerCase();
  return markers.some((marker) => normalized.includes(marker));
}

function isGoogleAuthPage(page) {
  try {
    const url = new URL(page.url());
    return (
      url.hostname === "accounts.google.com" ||
      url.hostname.endsWith(".accounts.google.com")
    );
  } catch {
    return false;
  }
}

function isProviderPage(page) {
  try {
    const url = new URL(page.url());
    return (
      /codebuddy\.(ai|cn)$/.test(url.hostname) ||
      url.hostname.endsWith(".codebuddy.ai") ||
      url.hostname.endsWith(".codebuddy.cn")
    );
  } catch {
    return false;
  }
}

async function handleGoogleConsent(page, reportStep) {
  if (!isGoogleAuthPage(page)) return false;

  const text = await readPageText(page);
  const looksLikeConsent =
    /wants to access|ingin mengakses|akses ke akun google|allow/i.test(text);
  if (!looksLikeConsent) return false;

  await page
    .evaluate(() => {
      const root =
        document.scrollingElement || document.documentElement || document.body;
      if (root) root.scrollTop = root.scrollHeight;
      window.scrollTo(
        0,
        document.body?.scrollHeight ||
          document.documentElement?.scrollHeight ||
          0,
      );
    })
    .catch(() => null);
  await page.waitForTimeout(300);

  const clickedApprove = await clickFirstActionable(
    page,
    APPROVE_BUTTON_SELECTORS,
  );
  if (clickedApprove) {
    reportStep("approving_google_consent", "Approving Google OAuth consent");
    await page.waitForTimeout(1000);
    return true;
  }

  return false;
}

async function handleGoogleOnboarding(page, pageText) {
  const text = String(pageText || "");
  if (!includesAny(text, GOOGLE_ONBOARDING_MARKERS)) {
    return false;
  }

  await page
    .evaluate(() => {
      const root =
        document.scrollingElement || document.documentElement || document.body;
      if (root) root.scrollTop = root.scrollHeight;
      window.scrollTo(
        0,
        document.body?.scrollHeight ||
          document.documentElement?.scrollHeight ||
          0,
      );
    })
    .catch(() => null);
  await page.waitForTimeout(500);

  // Workspace welcome ("Welcome to your new account" for @domain.com) has
  // only one valid action: the primary "I understand" button. There is no
  // skip option — clicking nothing leaves the worker stuck polling forever
  // while the headless tab sits on the consent screen. Prioritise the
  // primary action selector before the generic skip pass so we don't fall
  // through to a non-existent "Not now" link.
  if (includesAny(text, GOOGLE_WORKSPACE_WELCOME_MARKERS)) {
    const acknowledged = await clickFirstActionable(
      page,
      APPROVE_BUTTON_SELECTORS,
    );
    if (acknowledged) {
      await page.waitForTimeout(700);
      return true;
    }
    const submittedFromDom = await page
      .evaluate(() => {
        const candidates = [
          document.getElementById("confirm"),
          document.querySelector('form#tos_form input[type="submit"]'),
          document.querySelector('input[type="submit"][value="Saya mengerti"]'),
          document.querySelector('input[type="submit"][value="I understand"]'),
        ].filter(Boolean);
        const btn = candidates[0];
        if (!btn) return false;
        btn.scrollIntoView({ block: "center" });
        btn.click();
        return true;
      })
      .catch(() => false);
    if (submittedFromDom) {
      await page.waitForTimeout(800);
      return true;
    }
    const formSubmitted = await page
      .evaluate(() => {
        const form = document.getElementById("tos_form");
        if (!form) return false;
        form.submit();
        return true;
      })
      .catch(() => false);
    if (formSubmitted) {
      await page.waitForTimeout(800);
      return true;
    }
  }

  const clickedSkip = await clickFirstActionable(page, SKIP_BUTTON_SELECTORS);
  if (clickedSkip) {
    await page.waitForTimeout(700);
    return true;
  }

  const clickedContinue = await clickFirstActionable(
    page,
    APPROVE_BUTTON_SELECTORS,
  );
  if (clickedContinue) {
    await page.waitForTimeout(700);
    return true;
  }

  return false;
}

async function selectNativeRegionOption(page) {
  const preferred =
    /global|international|singapore|united states|^us$|asia|hong kong|default/i;

  for (const scope of getInteractionScopes(page)) {
    const selects = scope.locator("select");
    const count = await selects.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const select = selects.nth(index);
      const visible = await select.isVisible().catch(() => false);
      const enabled = await select.isEnabled().catch(() => true);
      if (!visible || !enabled) continue;

      const value = await select
        .evaluate((element, patternSource) => {
          const matcher = new RegExp(patternSource, "i");
          const options = [...element.options].filter(
            (option) => !option.disabled && option.value !== "",
          );
          const preferredOption = options.find((option) =>
            matcher.test(
              `${option.label} ${option.textContent} ${option.value}`,
            ),
          );
          return (preferredOption || options[0])?.value || "";
        }, preferred.source)
        .catch(() => "");

      if (!value) continue;
      const selected = await select
        .selectOption(value)
        .then(() => true)
        .catch(() => false);
      if (selected) return true;
    }
  }

  return false;
}

async function fillProviderOnboardingDefaults(page) {
  let filled = false;

  for (const scope of getInteractionScopes(page)) {
    for (const { selector, value } of PROVIDER_ONBOARDING_INPUT_DEFAULTS) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const visible = await locator.isVisible().catch(() => false);
      const enabled = await locator.isEnabled().catch(() => true);
      if (!visible || !enabled) continue;

      const currentValue = await locator.inputValue().catch(() => "");
      if (currentValue) continue;

      const didFill = await locator
        .fill(value, { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (didFill) filled = true;
    }
  }

  return filled;
}

async function clickLocatorCenter(page, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => null);
  const visible = await locator.isVisible().catch(() => false);
  const enabled = await locator.isEnabled().catch(() => true);
  if (!visible || !enabled) return false;

  const box = await locator.boundingBox().catch(() => null);
  if (!box || box.width <= 0 || box.height <= 0) return false;

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  return true;
}

async function clickVisibleLocatorByText(page, selector, patterns) {
  for (const scope of getInteractionScopes(page)) {
    const locators = scope.locator(selector);
    const count = Math.min(await locators.count().catch(() => 0), 80);
    const candidates = [];

    for (let index = 0; index < count; index += 1) {
      const locator = locators.nth(index);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      const text = (
        (await locator.innerText({ timeout: 1_000 }).catch(() => "")) ||
        (await locator.textContent({ timeout: 1_000 }).catch(() => "")) ||
        ""
      ).trim();
      if (!text) continue;
      candidates.push({ locator, text });
    }

    for (const pattern of patterns) {
      const candidate = candidates.find((item) => pattern.test(item.text));
      if (!candidate) continue;
      const clicked = await clickLocatorCenter(page, candidate.locator).catch(
        () => false,
      );
      if (clicked) return candidate.text;
    }

    if (candidates[0]) {
      const clicked = await clickLocatorCenter(
        page,
        candidates[0].locator,
      ).catch(() => false);
      if (clicked) return candidates[0].text;
    }
  }

  return "";
}

async function clickFirstVisibleLocatorCenter(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locators = scope.locator(selector);
      const count = Math.min(await locators.count().catch(() => 0), 20);
      for (let index = 0; index < count; index += 1) {
        const locator = locators.nth(index);
        const clicked = await clickLocatorCenter(page, locator).catch(
          () => false,
        );
        if (clicked) return true;
      }
    }
  }

  return false;
}

async function handleCodeBuddyRegionPageViaApi(page, reportStep) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const result = await page
    .evaluate(async () => {
      const bodyText = document.body?.innerText || "";
      const looksLikeRegionPage =
        document.querySelector(".page-region") ||
        /select\s+region|region|country|area|get started|complete/i.test(
          bodyText,
        );
      if (!looksLikeRegionPage) return null;

      try {
        const response = await fetch(
          "https://www.codebuddy.ai/console/login/account",
          {
            method: "POST",
            credentials: "include",
            headers: {
              accept: "application/json, text/plain, */*",
              "content-type": "application/json",
              "x-requested-with": "XMLHttpRequest",
              "x-domain": window.location.hostname || "www.codebuddy.ai",
            },
            referrer: "https://www.codebuddy.ai/register/user/complete",
            body: JSON.stringify({
              attributes: {
                countryCode: ["62"],
                countryFullName: ["Indonesia"],
                countryName: ["ID"],
              },
            }),
          },
        );

        const text = await response.text().catch(() => "");
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text };
        }

        if (
          response.ok &&
          (!data ||
            data.code === 0 ||
            data.code === 200 ||
            typeof data.code === "undefined")
        ) {
          return { action: "submitted_via_api" };
        }

        return {
          action: "api_failed",
          status: response.status,
          code: data?.code,
          message:
            data?.msg || data?.message || text || `HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          action: "api_failed",
          message: error?.message || "region submit request failed",
        };
      }
    })
    .catch(() => null);

  if (!result?.action) return false;

  if (result.action === "submitted_via_api") {
    reportStep(
      "submitting_codebuddy_region",
      "Submitted CodeBuddy region via account API",
    );
    await page.waitForTimeout(1500);
    return true;
  }

  reportStep(
    "codebuddy_region_api_failed",
    result.message
      ? `CodeBuddy region API submit failed: ${result.message}`
      : "CodeBuddy region API submit failed",
  );
  return false;
}

async function handleCodeBuddyRegionPageWithMouse(page, reportStep) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const isRegionPage = await page
    .locator(".page-region")
    .first()
    .count()
    .then(Boolean)
    .catch(() => false);
  if (!isRegionPage) return false;

  const optionPatterns = [
    /indonesia|^id$|\u5370\u5ea6\u5c3c\u897f\u4e9a/i,
    /singapore|^sg$|\u65b0\u52a0\u5761/i,
    /japan|^jp$|\u65e5\u672c/i,
    /thailand|^th$|\u6cf0\u56fd/i,
    /global|international|default/i,
  ];

  const submitClicked = await clickFirstVisibleLocatorCenter(page, [
    ".page-region [class*='28B894']",
    ".page-region button:has-text('Get started')",
    ".page-region button:has-text('Start')",
    ".page-region button:has-text('Submit')",
    ".page-region button:has-text('Continue')",
    ".page-region [role='button']:has-text('Get started')",
    ".page-region [role='button']:has-text('Start')",
    ".page-region [role='button']:has-text('Submit')",
    ".page-region [role='button']:has-text('Continue')",
  ]);
  if (submitClicked) {
    reportStep(
      "submitting_codebuddy_region",
      "Submitted CodeBuddy region selection",
    );
    await page.waitForTimeout(1200);
    return true;
  }

  const visibleOption = await clickVisibleLocatorByText(
    page,
    "ul.dropdown-section li, .dropdown-section li, [role='option'], .t-select-option, [class*='option']",
    optionPatterns,
  );
  if (visibleOption) {
    reportStep(
      "selecting_codebuddy_region",
      `Selected CodeBuddy region: ${visibleOption}`,
    );
    await page.waitForTimeout(900);
    return true;
  }

  const opened = await clickFirstVisibleLocatorCenter(page, [
    ".page-region .t-select",
    ".page-region [class*='t-select']",
    ".page-region [role='combobox']",
    ".page-region input[placeholder]",
    ".page-region [class*='select']",
    ".page-region [class*='cursor-pointer']",
  ]);
  if (!opened) return false;

  reportStep(
    "opening_codebuddy_region_selector",
    "Opening CodeBuddy region selector",
  );
  await page.waitForTimeout(600);

  const openedOption = await clickVisibleLocatorByText(
    page,
    "ul.dropdown-section li, .dropdown-section li, [role='option'], .t-select-option, [class*='option']",
    optionPatterns,
  );
  if (openedOption) {
    reportStep(
      "selecting_codebuddy_region",
      `Selected CodeBuddy region: ${openedOption}`,
    );
    await page.waitForTimeout(900);
  }

  return true;
}

async function handleCodeBuddyRegionPage(page, reportStep) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const handledViaApi = await handleCodeBuddyRegionPageViaApi(page, reportStep);
  if (handledViaApi) return true;

  const handledWithMouse = await handleCodeBuddyRegionPageWithMouse(
    page,
    reportStep,
  );
  if (handledWithMouse) return true;

  for (const scope of getInteractionScopes(page)) {
    const result = await scope
      .evaluate(() => {
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(element);
          if (
            style.visibility === "hidden" ||
            style.display === "none" ||
            Number(style.opacity) === 0
          )
            return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const root = document.querySelector(".page-region");
        const bodyText = document.body?.innerText || "";
        const looksLikeRegionPage =
          root ||
          /select\s+region|region|country|area|get started|complete/i.test(
            bodyText,
          );
        if (!looksLikeRegionPage) return null;

        const clickElement = (element) => {
          element.scrollIntoView({ block: "center", inline: "center" });
          for (const type of [
            "pointerdown",
            "mousedown",
            "pointerup",
            "mouseup",
            "click",
          ]) {
            element.dispatchEvent(
              new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                buttons: type.endsWith("down") ? 1 : 0,
              }),
            );
          }
        };

        const optionPatterns = [
          /indonesia|^id$|\u5370\u5ea6\u5c3c\u897f\u4e9a/i,
          /singapore|^sg$|\u65b0\u52a0\u5761/i,
          /japan|^jp$|\u65e5\u672c/i,
          /thailand|^th$|\u6cf0\u56fd/i,
          /global|international|default/i,
        ];

        const searchRoot = root || document.body;
        const submitSelectors = [
          "button",
          "[role='button']",
          "input[type='submit']",
          ".t-button",
          "[class*='button']",
          "[class*='28B894']",
        ];
        const submitButtons = [
          ...searchRoot.querySelectorAll(submitSelectors.join(",")),
        ]
          .filter(visible)
          .filter((element) => {
            const text = `${element.innerText || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("value") || ""}`;
            const className = element.getAttribute("class") || "";
            return (
              /submit|start|continue|confirm|done|get started|complete|\u5b8c\u6210|\u5f00\u59cb|\u786e\u5b9a|\u4e0b\u4e00\u6b65/i.test(
                text,
              ) || className.includes("28B894")
            );
          });

        if (submitButtons.length) {
          clickElement(submitButtons[0]);
          return { action: "submitted" };
        }

        const optionSelectors = [
          "ul.dropdown-section li",
          ".dropdown-section li",
          "[role='option']",
          ".t-select-option",
          "[class*='option']",
          "[class*='dropdown'] li",
        ];
        const options = [
          ...document.querySelectorAll(optionSelectors.join(",")),
        ]
          .filter(visible)
          .filter((element) =>
            (element.innerText || element.textContent || "").trim(),
          );

        if (options.length) {
          const option =
            optionPatterns
              .map((pattern) =>
                options.find((element) =>
                  pattern.test(
                    (element.innerText || element.textContent || "").trim(),
                  ),
                ),
              )
              .find(Boolean) || options[0];
          const label = (option.innerText || option.textContent || "").trim();
          clickElement(option);
          return { action: "selected", label };
        }

        const controlSelectors = [
          "[role='combobox']",
          ".t-select",
          "[class*='t-select']",
          "[class*='select']",
          "input[placeholder]",
          ".text-sm",
          "[class*='cursor-pointer']",
        ];
        const controls = [
          ...searchRoot.querySelectorAll(controlSelectors.join(",")),
        ]
          .filter(visible)
          .filter((element) => {
            const text = `${element.innerText || ""} ${element.getAttribute("placeholder") || ""} ${element.getAttribute("aria-label") || ""}`;
            return (
              /region|country|area|select|placeholder|\u5730\u533a|\u56fd\u5bb6|\u9009\u62e9/i.test(
                text,
              ) ||
              element.matches?.(
                ".t-select,[class*='t-select'],input[placeholder],[class*='select']",
              )
            );
          });

        if (controls.length) {
          clickElement(controls[0]);
          return { action: "opened" };
        }

        return null;
      })
      .catch(() => null);

    if (!result?.action) continue;

    if (result.action === "selected") {
      reportStep(
        "selecting_codebuddy_region",
        `Selected CodeBuddy region${result.label ? `: ${result.label}` : ""}`,
      );
      await page.waitForTimeout(700);
      return true;
    }

    if (result.action === "submitted") {
      reportStep(
        "submitting_codebuddy_region",
        "Submitted CodeBuddy region selection",
      );
      await page.waitForTimeout(1200);
      return true;
    }

    reportStep(
      "opening_codebuddy_region_selector",
      "Opening CodeBuddy region selector",
    );
    await page.waitForTimeout(700);
    return true;
  }

  return false;
}

async function handleCodeBuddyStartedAuthorization(page, reportStep) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const result = await page
    .evaluate(async () => {
      const url = new URL(window.location.href);
      if (!/\/started\/?$/.test(url.pathname)) return null;

      const platform = url.searchParams.get("platform") || "CLI";
      const state = url.searchParams.get("state");
      if (!state) return null;

      const domains = [window.location.hostname || "www.codebuddy.ai"].filter(
        Boolean,
      );
      for (const domain of [...new Set(domains)]) {
        const authUrl = new URL("/console/auth/login", window.location.origin);
        authUrl.searchParams.set("platform", platform);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("domain", domain);

        try {
          const response = await fetch(authUrl.toString(), {
            method: "GET",
            credentials: "include",
            redirect: "manual",
            headers: {
              "x-requested-with": "XMLHttpRequest",
              "X-Domain": domain,
            },
          });
          if (
            response.type === "opaqueredirect" ||
            (response.status >= 300 && response.status < 400)
          ) {
            return { action: "attempted", domain, message: "redirected" };
          }
          const text = await response.text();
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = { raw: text };
          }
          if (
            response.ok &&
            (!data ||
              data.code === 0 ||
              data.code === 200 ||
              typeof data.code === "undefined")
          ) {
            return { action: "authorized", domain };
          }
          if (response.ok) {
            return {
              action: "attempted",
              domain,
              code: data?.code,
              message: data?.msg || data?.message || "",
            };
          }
        } catch (error) {
          // Try the next domain variant.
        }
      }

      return { action: "failed" };
    })
    .catch(() => null);

  if (!result?.action || result.action === "failed") return false;

  if (result.action === "authorized") {
    reportStep(
      "authorizing_codebuddy_cli_state",
      "Authorized CodeBuddy CLI login state",
    );
    await page.waitForTimeout(1200);
    return true;
  }

  reportStep(
    "authorizing_codebuddy_cli_state",
    result.message
      ? `Attempted CodeBuddy CLI login state authorization: ${result.message}`
      : "Attempted CodeBuddy CLI login state authorization",
  );
  await page.waitForTimeout(1200);
  return true;
}

async function handleProviderOnboarding(page, reportStep, serviceLabel) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const confirmedPrivacy = await clickFirstActionable(
    page,
    PRIVACY_CONFIRM_BUTTON_SELECTORS,
  );
  if (confirmedPrivacy) {
    reportStep(
      "accepting_provider_privacy_dialog",
      `Confirmed ${serviceLabel} privacy or terms dialog`,
    );
    await page.waitForTimeout(800);
    return true;
  }

  const handledCodeBuddyStarted = await handleCodeBuddyStartedAuthorization(
    page,
    reportStep,
  );
  if (handledCodeBuddyStarted) {
    return true;
  }

  const handledCodeBuddyRegion = await handleCodeBuddyRegionPage(
    page,
    reportStep,
  );
  if (handledCodeBuddyRegion) {
    return true;
  }

  const selectedNativeRegion = await selectNativeRegionOption(page);
  if (selectedNativeRegion) {
    reportStep("selecting_provider_region", `Selected ${serviceLabel} region`);
    await page.waitForTimeout(700);
    return true;
  }

  const openedRegionMenu = await clickFirstActionable(
    page,
    PROVIDER_REGION_TRIGGER_SELECTORS,
  );
  if (openedRegionMenu) {
    reportStep(
      "opening_provider_region_selector",
      `Opening ${serviceLabel} region selector`,
    );
    await page.waitForTimeout(500);
    const selectedRegion = await clickFirstActionable(
      page,
      PROVIDER_REGION_OPTION_SELECTORS,
    );
    if (selectedRegion) {
      reportStep(
        "selecting_provider_region",
        `Selected ${serviceLabel} region`,
      );
      await page.waitForTimeout(700);
    }
    return true;
  }

  const selectedRegion = await clickFirstActionable(
    page,
    PROVIDER_REGION_OPTION_SELECTORS,
  );
  if (selectedRegion) {
    reportStep("selecting_provider_region", `Selected ${serviceLabel} region`);
    await page.waitForTimeout(700);
    return true;
  }

  const filledDefaults = await fillProviderOnboardingDefaults(page);
  if (filledDefaults) {
    reportStep(
      "filling_provider_onboarding",
      `Filled ${serviceLabel} onboarding defaults`,
    );
    await page.waitForTimeout(500);
    return true;
  }

  const clickedAction = await clickFirstActionable(
    page,
    PROVIDER_ONBOARDING_ACTION_SELECTORS,
  );
  if (clickedAction) {
    reportStep(
      "continuing_provider_onboarding",
      `Continuing ${serviceLabel} onboarding`,
    );
    await page.waitForTimeout(1000);
    return true;
  }

  return false;
}

async function handleProviderLoginGate(page, reportStep) {
  if (isGoogleAuthPage(page)) return false;

  const confirmedExistingDialog = await clickFirstActionable(
    page,
    PRIVACY_CONFIRM_BUTTON_SELECTORS,
  );
  if (confirmedExistingDialog) {
    reportStep(
      "accepting_provider_privacy_dialog",
      "Confirmed provider privacy agreement dialog",
    );
    await page.waitForTimeout(1000);
    return true;
  }

  const checkedTerms = await checkFirstVisible(page, TERMS_CHECKBOX_SELECTORS);
  if (checkedTerms) {
    reportStep(
      "accepting_provider_terms",
      "Accepted provider terms for Google login",
    );
    await page.waitForTimeout(400);
  }

  const clickedGoogle = await clickFirstActionable(
    page,
    GOOGLE_LOGIN_BUTTON_SELECTORS,
  );
  if (clickedGoogle) {
    reportStep("selecting_google_login", "Selecting Google login");
    await page.waitForTimeout(1000);

    const confirmedDialog = await clickFirstActionable(
      page,
      PRIVACY_CONFIRM_BUTTON_SELECTORS,
    );
    if (confirmedDialog) {
      reportStep(
        "accepting_provider_privacy_dialog",
        "Confirmed provider privacy agreement dialog",
      );
      await page.waitForTimeout(1000);
    }

    return true;
  }

  return false;
}

export function createKiroCallbackMonitor(
  context,
  page,
  timeoutMs = DEFAULT_MANUAL_TIMEOUT_MS,
) {
  let resolveOuter;
  let rejectOuter;
  const promise = new Promise((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  let settled = false;
  const trackedPages = new Set();
  const contextCleanups = new Map();
  const timeoutHandle = setTimeout(() => {
    settle(null, new Error("Timed out waiting for Kiro callback"));
  }, timeoutMs);

  function settle(result, error = null) {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutHandle);
    for (const fns of contextCleanups.values()) {
      for (const fn of fns) {
        try {
          fn();
        } catch {}
      }
    }
    contextCleanups.clear();
    if (error) rejectOuter(error);
    else resolveOuter(result);
  }

  function registerPage(trackedPage, ownerCleanups) {
    if (!trackedPage || trackedPages.has(trackedPage)) return;
    trackedPages.add(trackedPage);

    const onFrame = (frame) => {
      const parsed = parseCallbackUrl(frame?.url?.() || "");
      if (parsed) settle(parsed);
    };
    const onRequest = (request) => {
      const parsed = parseCallbackUrl(request?.url?.() || "");
      if (parsed) settle(parsed);
    };
    const onRequestFailed = (request) => {
      const parsed = parseCallbackUrl(request?.url?.() || "");
      if (parsed) settle(parsed);
    };
    const onLoadState = () => {
      const parsed = parseCallbackUrl(trackedPage.url?.() || "");
      if (parsed) settle(parsed);
    };

    trackedPage.on("framenavigated", onFrame);
    trackedPage.on("request", onRequest);
    trackedPage.on("requestfailed", onRequestFailed);
    trackedPage.on("domcontentloaded", onLoadState);
    trackedPage.on("load", onLoadState);

    ownerCleanups.push(() => {
      trackedPage.off("framenavigated", onFrame);
      trackedPage.off("request", onRequest);
      trackedPage.off("requestfailed", onRequestFailed);
      trackedPage.off("domcontentloaded", onLoadState);
      trackedPage.off("load", onLoadState);
    });

    const current = parseCallbackUrl(trackedPage.url?.() || "");
    if (current) settle(current);
  }

  function bind(ctx, pg) {
    if (settled) return;
    if (contextCleanups.has(ctx)) return;
    const cleanups = [];
    contextCleanups.set(ctx, cleanups);

    const onPage = (newPage) => registerPage(newPage, cleanups);
    ctx.on("page", onPage);
    cleanups.push(() => ctx.off("page", onPage));

    if (pg) registerPage(pg, cleanups);
  }

  bind(context, page);

  promise.rebind = ({ context: newContext, page: newPage } = {}) => {
    if (newContext) bind(newContext, newPage);
  };

  return promise;
}

export async function runGoogleAccountAutomation({
  page,
  authUrl,
  email,
  password,
  successPromise,
  shortTimeoutMs = DEFAULT_SHORT_TIMEOUT_MS,
  serviceLabel = "provider",
  openingStep = "opening_google_oauth",
  openingMessage = "Opening Google OAuth page",
  successStep = "oauth_success_received",
  successMessage = "OAuth success received",
  onStep,
}) {
  const startTime = Date.now();
  const reportStep = (step, message) => {
    onStep?.(step, message);
  };

  reportStep(openingStep, openingMessage);
  try {
    await page.goto(authUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
  } catch (navigateError) {
    // Retry once — Qoder device page can be slow under proxy or cold start.
    reportStep("opening_retry", "Initial navigation timed out, retrying...");
    try {
      await page.goto(authUrl, { waitUntil: "commit", timeout: 90_000 });
    } catch (retryError) {
      reportStep(
        "opening_failed",
        `Navigation failed after retry: ${retryError.message}`,
      );
      throw retryError;
    }
  }
  await page.waitForTimeout(2_000);

  await handleProviderLoginGate(page, reportStep);

  const emailInput = await waitForFirstVisibleLocator(
    page,
    EMAIL_INPUT_SELECTOR,
    { timeout: 15_000 },
  );
  if (emailInput) {
    reportStep("entering_email", "Entering Google email");
    const filled = await fillInputResilient(emailInput, email);
    if (!filled) {
      reportStep(
        "email_fill_failed",
        "Could not fill the Google email field; will retry in the polling loop",
      );
    } else {
      reportStep("submitting_email", "Submitting email");
      await clickFirstVisible(page, NEXT_BUTTON_SELECTORS);
    }
  }

  while (Date.now() - startTime < shortTimeoutMs) {
    const successResult = await Promise.race([
      successPromise
        .then((result) => ({ kind: "success", result }))
        .catch((error) => ({ kind: "success_error", error })),
      new Promise((resolve) => setTimeout(() => resolve(null), 800)),
    ]);

    if (successResult?.kind === "success") {
      reportStep(successStep, successMessage);
      return {
        status: "success",
        ...successResult.result,
      };
    }

    if (successResult?.kind === "success_error") {
      reportStep(
        "oauth_timeout",
        `Timed out waiting for ${serviceLabel} authorization`,
      );
      return {
        status: "failed_timeout",
        error:
          successResult.error?.message ||
          `Timed out waiting for ${serviceLabel} authorization`,
      };
    }

    const handledGoogleConsent = await handleGoogleConsent(page, reportStep);
    if (handledGoogleConsent) {
      continue;
    }

    const text = await readPageText(page);
    if (includesAny(text, INVALID_CREDENTIAL_MARKERS)) {
      reportStep(
        "invalid_credentials",
        "Google rejected the supplied email or password",
      );
      return {
        status: "failed_invalid_credentials",
        error: "Google rejected the supplied email or password.",
      };
    }

    if (includesAny(text, RESTRICTED_ACCOUNT_MARKERS)) {
      reportStep(
        "account_restricted",
        "Account is restricted, suspended, or banned by the provider",
      );
      return {
        status: "failed_restricted",
        error: "Account is restricted, suspended, or banned. Skipping.",
      };
    }

    if (includesAny(text, MANUAL_ASSIST_MARKERS)) {
      reportStep(
        "manual_assist_required",
        "Google requested CAPTCHA, 2FA, or recovery verification",
      );
      return {
        status: "needs_manual",
        error:
          "Manual assist required in the browser session (CAPTCHA, 2FA, recovery, or suspicious-login challenge).",
      };
    }

    const handledOnboarding = await handleGoogleOnboarding(page, text);
    if (handledOnboarding) {
      reportStep(
        "google_onboarding",
        "Accepted Google onboarding or privacy prompt",
      );
      continue;
    }

    const handledProviderOnboarding = await handleProviderOnboarding(
      page,
      reportStep,
      serviceLabel,
    );
    if (handledProviderOnboarding) {
      continue;
    }

    const nextEmailInput = await getFirstVisibleLocator(
      page,
      EMAIL_INPUT_SELECTOR,
    );
    if (nextEmailInput) {
      reportStep("entering_email", "Entering Google email");
      const filled = await fillInputResilient(nextEmailInput, email);
      if (filled) {
        reportStep("submitting_email", "Submitting email");
        await clickFirstVisible(page, NEXT_BUTTON_SELECTORS);
      } else {
        reportStep(
          "email_fill_failed",
          "Could not fill the Google email field; retrying loop",
        );
      }
      await page.waitForTimeout(700);
      continue;
    }

    const passwordInput = await getFirstVisibleLocator(
      page,
      PASSWORD_INPUT_SELECTOR,
    );
    if (passwordInput) {
      reportStep("entering_password", "Entering Google password");
      const filled = await fillInputResilient(passwordInput, password);
      if (filled) {
        reportStep("submitting_password", "Submitting password");
        await clickFirstVisible(page, NEXT_BUTTON_SELECTORS);
      } else {
        reportStep(
          "password_fill_failed",
          "Could not fill the Google password field; retrying loop",
        );
      }
      await page.waitForTimeout(700);
      continue;
    }

    const handledProviderGate = await handleProviderLoginGate(page, reportStep);
    if (handledProviderGate) {
      continue;
    }

    const clickedApprove = await clickFirstVisible(
      page,
      APPROVE_BUTTON_SELECTORS,
    );
    if (clickedApprove) {
      reportStep(
        "approving_consent",
        `Approving Google or ${serviceLabel} consent`,
      );
      await page.waitForTimeout(700);
      continue;
    }

    reportStep(
      "waiting_for_next_screen",
      `Waiting for the next Google or ${serviceLabel} screen`,
    );
    await page.waitForTimeout(700);
  }

  reportStep(
    "manual_assist_required",
    `Flow did not complete ${serviceLabel} authorization automatically`,
  );
  return {
    status: "needs_manual",
    error: `Manual assist required in the browser session because the login flow did not complete ${serviceLabel} authorization automatically.`,
  };
}

export async function runKiroGoogleAutomation({
  page,
  authUrl,
  email,
  password,
  callbackPromise,
  shortTimeoutMs = DEFAULT_SHORT_TIMEOUT_MS,
  onStep,
}) {
  return runGoogleAccountAutomation({
    page,
    authUrl,
    email,
    password,
    successPromise: callbackPromise,
    shortTimeoutMs,
    serviceLabel: "Kiro",
    openingStep: "opening_google_oauth",
    openingMessage: "Opening Google OAuth page",
    successStep: "kiro_callback_received",
    successMessage: "Kiro callback received",
    onStep,
  });
}

export {
  handleCodeBuddyRegionPage,
  handleProviderOnboarding,
  handleCodeBuddyStartedAuthorization,
  isProviderPage,
};

export const __test__ = {
  waitForFirstVisibleLocator,
  fillInputResilient,
  parseSelectorList,
  getFirstVisibleLocator,
};
