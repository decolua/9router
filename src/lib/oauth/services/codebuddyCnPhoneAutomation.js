import { randomInt } from "crypto";

const CODEBUDDY_CN_LOGIN_URL = "https://www.codebuddy.cn/login/?platform=admin&state=0";
const CODEBUDDY_CN_KEYS_URL = "https://www.codebuddy.cn/profile/keys";
const CODEBUDDY_CN_API_KEY_ENDPOINT = "/console/api/client/v1/api-keys";
const CODEBUDDY_CN_API_KEY_ENDPOINT_URL = "https://www.codebuddy.cn/console/api/client/v1/api-keys";
const CODEBUDDY_CN_PERSONAL_ENTERPRISE_ID = "personal-edition-user-id";
const PHONE_SUBMIT_SELECTORS = [
  "button:has-text('获取验证码')",
  "button:has-text('发送验证码')",
  "button:has-text('Get code')",
  "button:has-text('Send code')",
  "button:has-text('Continue')",
  "button:has-text('登录')",
  "button:has-text('Login')",
  "[role='button']:has-text('获取验证码')",
  "[role='button']:has-text('发送验证码')",
  "[role='button']:has-text('Send code')",
];
const OTP_SUBMIT_SELECTORS = [
  "button:has-text('登录')",
  "button:has-text('确认')",
  "button:has-text('完成')",
  "button:has-text('Continue')",
  "button:has-text('Login')",
  "button[type='submit']",
  "[role='button']:has-text('登录')",
  "[role='button']:has-text('确认')",
];
const PHONE_INPUT_SELECTORS = [
  "#phoneNumber",
  "input[type='tel']",
  "input[inputmode='tel']",
  "input[autocomplete='tel']",
  "input[name*='phone' i]",
  "input[name*='mobile' i]",
  "input[id*='phone' i]",
  "input[id*='mobile' i]",
  "input[placeholder*='手机']",
  "input[placeholder*='手机号']",
  "input[placeholder*='手机号码']",
  "input[placeholder*='电话号码']",
  "input[placeholder*='电话']",
  "input[placeholder*='phone' i]",
  "input[placeholder*='mobile' i]",
];
const PHONE_LOGIN_MODE_SELECTORS = [
  "text=手机号",
  "text=手机号登录",
  "text=手机登录",
  "text=短信登录",
  "text=验证码登录",
  "text=短信验证码登录",
  "text=Phone",
  "text=Phone number",
  "text=Mobile",
  "text=SMS",
  "button:has-text('手机')",
  "button:has-text('短信')",
  "button:has-text('验证码')",
  "button:has-text('Phone')",
  "button:has-text('SMS')",
  "[role='tab']:has-text('手机')",
  "[role='tab']:has-text('短信')",
  "[role='tab']:has-text('Phone')",
  "[role='button']:has-text('手机')",
  "[role='button']:has-text('短信')",
  "[role='button']:has-text('Phone')",
  "div.cursor-pointer:has-text('手机')",
  "div.cursor-pointer:has-text('短信')",
  "div.flex.items-center.gap-1.cursor-pointer",
  "div.cursor-pointer",
];
const OTP_INPUT_SELECTORS = [
  "#code",
  "input[autocomplete='one-time-code']",
  "input[name*='code' i]",
  "input[id*='code' i]",
  "input[placeholder*='验证码']",
  "input[placeholder*='短信']",
  "input[placeholder*='code' i]",
  "input[maxlength='6']",
];
const LOGIN_FRAME_READY_SELECTORS = [
  "#kc-form-login",
  "#phoneNumber",
  "input.kc-phone-number-input",
  "input.code-btn",
  "text=+86",
  "text=copilot",
  "#kc-login",
  ".kc-country-selector",
  "text=其他登录方式",
  "text=微信登录",
  "text=手机号",
  "text=服务条款",
  "text=Phone",
  "text=SMS",
  "input[type='checkbox']",
];
const PHONE_AUTH_SCOPE_SELECTORS = [
  "#kc-form-login",
  "#phoneNumber",
  "input.kc-phone-number-input",
  ".kc-country-selector",
  "input.code-btn",
  "#kc-login",
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomChoice(items) {
  return items[randomInt(0, items.length)];
}

export function generateCodeBuddyCnKeyName() {
  const left = ["china", "hoshi", "longma", "yulan", "meihua", "tianhe", "baihu", "yunhai"];
  const right = ["hoshi", "macan", "long", "mei", "shan", "hua", "yue", "xing"];
  return `${randomChoice(left)}-${randomChoice(right)}-${String(randomInt(0, 10_000)).padStart(4, "0")}`;
}

function normalizePhoneForInput(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function splitPhoneForLogin(phone) {
  const normalized = normalizePhoneForInput(phone);
  for (const rawDial of ["+852", "+86"]) {
    const withPlus = rawDial;
    const withoutPlus = rawDial.slice(1);
    if (normalized.startsWith(withPlus)) {
      return { dialCode: withPlus, localNumber: normalized.slice(withPlus.length) };
    }
    if (normalized.startsWith(withoutPlus)) {
      return { dialCode: withPlus, localNumber: normalized.slice(withoutPlus.length) };
    }
  }
  return { dialCode: null, localNumber: normalized.replace(/^\+/, "") };
}

async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator?.(selector)?.first?.();
    if (!locator) continue;
    const visible = await locator.isVisible?.({ timeout: 1_000 }).catch(() => false);
    if (!visible) continue;
    try {
      await locator.click({ timeout: 3_000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function checkFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator?.(selector)?.first?.();
    if (!locator) continue;
    const visible = await locator.isVisible?.({ timeout: 1_000 }).catch(() => false);
    if (!visible) continue;
    try {
      if (locator.check) await locator.check({ timeout: 3_000 });
      else await locator.click({ timeout: 3_000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function fillFirst(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator?.(selector)?.first?.();
    if (!locator) continue;
    const visible = await locator.isVisible?.({ timeout: 1_000 }).catch(() => false);
    if (!visible) continue;
    try {
      await locator.fill(String(value), { timeout: 3_000 });
      return true;
    } catch {
      try {
        await locator.click?.({ timeout: 3_000 });
        await locator.press?.("Control+A").catch(() => null);
        if (locator.pressSequentially) await locator.pressSequentially(String(value), { timeout: 5_000 });
        else if (locator.type) await locator.type(String(value), { timeout: 5_000 });
        else continue;
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function hasVisibleInput(scope, selectors) {
  for (const selector of selectors) {
    const locator = scope.locator?.(selector)?.first?.();
    if (!locator) continue;
    const waitFor = locator.waitFor?.({ state: "visible", timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    if (waitFor && await waitFor) return true;
    const visible = await locator.isVisible?.({ timeout: 500 }).catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function hasAnyVisible(scope, selectors) {
  for (const selector of selectors) {
    const locator = scope.locator?.(selector)?.first?.();
    if (!locator) continue;
    const visible = await locator.isVisible?.({ timeout: 500 }).catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function findPhoneAuthScope(loginFrame) {
  const scopes = [
    loginFrame.frameLocator?.("iframe[src*='/auth/realms/copilot/']"),
    loginFrame.frameLocator?.("iframe[src*='auth']"),
    loginFrame,
  ].filter(Boolean);

  for (const scope of scopes) {
    if (await hasVisibleInput(scope, PHONE_INPUT_SELECTORS)) return scope;
  }
  return null;
}

async function resolvePhoneAuthScope(loginFrame, { timeoutMs = 0 } = {}) {
  const startedAt = Date.now();
  do {
    const scope = await findPhoneAuthScope(loginFrame);
    if (scope) return scope;
    if (!timeoutMs) return null;
    await delay(250);
  } while (Date.now() - startedAt < timeoutMs);
  return null;
}

async function acceptLoginTerms(loginFrame) {
  return checkFirst(loginFrame, [
    "input[type='checkbox']",
    "label.t-checkbox",
  ]);
}

async function resolveLoginScope(page, { timeoutMs = 40_000 } = {}) {
  const startedAt = Date.now();
  do {
    if (await hasAnyVisible(page, LOGIN_FRAME_READY_SELECTORS)) return page;
    const frame = page.frameLocator?.("#phone-iframe");
    if (frame && await hasAnyVisible(frame, LOGIN_FRAME_READY_SELECTORS)) return frame;
    await delay(250);
  } while (Date.now() - startedAt < timeoutMs);
  return null;
}

async function syncHiddenPhoneNumber(scope, dialCode, localNumber) {
  if (!dialCode || !localNumber) return true;
  const expected = `${dialCode}${localNumber}`;
  const hidden = scope.locator?.("input[name='phoneNumber']")?.first?.();
  if (!hidden) return true;
  const hiddenCount = await hidden.count?.().catch(() => 0);
  if (hiddenCount === 0) return true;
  if (!hidden.inputValue || !hidden.evaluate) return true;
  const current = await hidden.inputValue?.({ timeout: 1_000 }).catch(() => "");
  if (current === expected) return true;
  await hidden.evaluate?.((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, expected).catch(() => null);
  const updated = await hidden.inputValue?.({ timeout: 1_000 }).catch(() => "");
  return updated === expected;
}

async function clickEnabledSubmit(scope) {
  for (const selector of ["#kc-login", ...OTP_SUBMIT_SELECTORS]) {
    const locator = scope.locator?.(selector)?.first?.();
    if (!locator) continue;
    const visible = await locator.isVisible?.({ timeout: 1_000 }).catch(() => false);
    if (!visible) continue;
    const enabled = locator.isEnabled
      ? await locator.isEnabled({ timeout: 10_000 }).catch(() => false)
      : true;
    if (!enabled) continue;
    try {
      await locator.click({ timeout: 3_000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function waitForCodeBuddyCnSession(page) {
  return page.waitForFunction?.(() => {
    const href = window.location?.href || "";
    const text = document.body?.innerText || "";
    return /\/(profile|console|dashboard|workspace)/i.test(href)
      || /profile|keys|工作台|退出|账号|控制台|dashboard|API Key|密钥/i.test(text);
  }, { timeout: 45_000 }).then(() => true).catch(() => false);
}

async function waitForCodeBuddyCnKeysPage(page) {
  return page.waitForFunction?.(() => {
    const href = window.location?.href || "";
    const text = document.body?.innerText || "";
    return /\/profile\/keys/i.test(href)
      || /API Key|API keys|密钥|令牌/i.test(text);
  }, { timeout: 15_000 }).then(() => true).catch(() => false);
}

function manualError(message, step) {
  const error = new Error(message);
  error.status = "needs_manual";
  error.step = step;
  return error;
}

export async function runCodeBuddyCnPhoneLogin({ page, phone, codeProvider, onStep }) {
  onStep?.("opening_codebuddy_cn", "Opening CodeBuddy CN phone login");
  await page.goto(CODEBUDDY_CN_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => null);

  const loginFrame = await resolveLoginScope(page, { timeoutMs: 40_000 });
  if (!loginFrame) throw manualError("CodeBuddy CN login form did not render", "login_form_not_rendered");

  await acceptLoginTerms(loginFrame);

  let authFrame = await resolvePhoneAuthScope(loginFrame, { timeoutMs: 3_000 });
  if (!authFrame) {
    const phoneModeOpened = await clickFirst(loginFrame, PHONE_LOGIN_MODE_SELECTORS);
    if (!phoneModeOpened) throw manualError("CodeBuddy CN phone login method not found", "phone_login_method_not_found");
    await page.waitForTimeout?.(1_000);
    await acceptLoginTerms(loginFrame);
    authFrame = await resolvePhoneAuthScope(loginFrame, { timeoutMs: 15_000 });
  }

  await acceptLoginTerms(loginFrame);

  if (!authFrame) {
    throw manualError("CodeBuddy CN phone authentication form did not load", "phone_auth_form_not_loaded");
  }
  const phoneParts = splitPhoneForLogin(phone);
  let phoneInputValue = phoneParts.localNumber;
  if (phoneParts.dialCode) {
    const countrySelectorOpened = await clickFirst(authFrame, [
      ".kc-country-selector",
      "[role='combobox']:has-text('+')",
      "button:has-text('+')",
    ]);
    if (countrySelectorOpened) {
      const countrySelected = await clickFirst(authFrame, [
        `.kc-country-option:has-text('${phoneParts.dialCode}')`,
        ".kc-country-dropdown > .kc-country-option:nth-of-type(2)",
        `[role='option']:has-text('${phoneParts.dialCode}')`,
        `text=${phoneParts.dialCode}`,
      ]);
      if (!countrySelected) {
        throw manualError(`CodeBuddy CN country code ${phoneParts.dialCode} not found`, "country_code_not_found");
      }
    } else {
      phoneInputValue = normalizePhoneForInput(phone);
    }
  }

  onStep?.("entering_phone", "Entering 5sim phone number");
  const phoneFilled = await fillFirst(authFrame, PHONE_INPUT_SELECTORS, phoneInputValue);
  if (!phoneFilled) throw manualError("CodeBuddy CN phone input not found", "phone_input_not_found");
  const hiddenPhoneSynced = await syncHiddenPhoneNumber(authFrame, phoneParts.dialCode, phoneInputValue);
  if (!hiddenPhoneSynced) throw manualError("CodeBuddy CN hidden phone value did not update", "hidden_phone_not_synced");

  onStep?.("requesting_otp", "Requesting CodeBuddy CN SMS code");
  const requested = await clickFirst(authFrame, ["input.code-btn", "input[type='button']", ...PHONE_SUBMIT_SELECTORS]);
  if (!requested) throw manualError("CodeBuddy CN send-code button not found", "otp_button_not_found");

  onStep?.("waiting_5sim_otp", "Waiting for 5sim OTP");
  const { code } = await codeProvider();
  if (!code) throw new Error("5sim returned no OTP code");

  onStep?.("entering_otp", "Entering CodeBuddy CN OTP");
  const otpFilled = await fillFirst(authFrame, OTP_INPUT_SELECTORS, code);
  if (!otpFilled) throw manualError("CodeBuddy CN OTP input not found", "otp_input_not_found");

  const submitted = await clickEnabledSubmit(authFrame);
  if (!submitted) throw manualError("CodeBuddy CN login button was not enabled after OTP", "login_button_not_enabled");
  const hasSession = await waitForCodeBuddyCnSession(page);
  if (!hasSession) {
    throw manualError("CodeBuddy CN login session was not confirmed after OTP", "login_session_not_confirmed");
  }
  return { phone, webEmail: `phone:${phone}` };
}

async function postCodeBuddyCnApiKeyFromPage(page, keyName) {
  return page.evaluate(async ({ endpoint, endpointUrl, name, userEnterpriseId }) => {
    const body = JSON.stringify({
      name,
      expire_in_days: 365,
      user_enterprise_id: userEnterpriseId,
    });
    const response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "include",
      referrer: "https://www.codebuddy.cn/profile/keys",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": navigator.language || "en-US,en;q=0.9",
        "content-type": "application/json",
        priority: "u=1, i",
      },
      body,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
      text,
      request: { endpoint: endpointUrl, body },
      page: { href: window.location.href, origin: window.location.origin },
    };
  }, {
    endpoint: CODEBUDDY_CN_API_KEY_ENDPOINT,
    endpointUrl: CODEBUDDY_CN_API_KEY_ENDPOINT_URL,
    name: keyName,
    userEnterpriseId: CODEBUDDY_CN_PERSONAL_ENTERPRISE_ID,
  });
}

function parseApiKeyPayload(payload, fallbackName) {
  const data = payload?.data || payload || {};
  const key = data.key || data.api_key || data.apiKey;
  if (!key) return null;
  const item = data.item || data.apiKeyItem || data;
  return {
    key,
    id: item?.key_id || item?.id || item?.keyId || null,
    name: item?.name || data.name || fallbackName,
    expiresAt: data.expires_at || data.expiresAt || item?.expires_at || item?.expiresAt || null,
    createdAt: item?.created_at || item?.createdAt || null,
  };
}

export async function createCodeBuddyCnApiKey(page, onStep) {
  onStep?.("opening_codebuddy_cn_keys", "Opening CodeBuddy CN API keys page");
  await page.goto(CODEBUDDY_CN_KEYS_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState?.("networkidle", { timeout: 10_000 }).catch(() => null);
  await page.waitForTimeout?.(3_000);
  const keysPageReady = await waitForCodeBuddyCnKeysPage(page);
  if (!keysPageReady) {
    throw manualError("CodeBuddy CN API keys page was not available after phone login", "api_key_page_not_available");
  }

  const names = [generateCodeBuddyCnKeyName(), generateCodeBuddyCnKeyName()];
  let lastMessage = "";
  for (const name of names) {
    onStep?.("creating_codebuddy_cn_api_key", `Creating CodeBuddy CN API key ${name}`);
    const result = await postCodeBuddyCnApiKeyFromPage(page, name);
    if (result.ok && (result.payload?.code === 0 || result.payload?.code === 200 || result.payload?.code === undefined)) {
      const key = parseApiKeyPayload(result.payload, name);
      if (key?.key) return key;
      lastMessage = "CodeBuddy CN API key created but secret was not returned";
      continue;
    }
    const upstreamMessage = result.payload?.msg || result.payload?.message || result.text || `HTTP ${result.status}`;
    lastMessage = `CodeBuddy CN API key request failed (${result.status}) at ${result.request?.endpoint}: ${upstreamMessage}`;
  }
  throw new Error(lastMessage || "CodeBuddy CN API key creation failed");
}
