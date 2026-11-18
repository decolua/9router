import { CaptchaManager } from "./captcha-manager.js";

const KEY = Symbol.for("9router.zcode.captchaManager");

export function getCaptchaManager() {
  if (!globalThis[KEY]) globalThis[KEY] = new CaptchaManager();
  return globalThis[KEY];
}

export async function isCaptchaError(response) {
  if (![400, 403, 405].includes(response?.status)) return false;
  try {
    const text = await response.clone().text();
    return /(?:captcha|verify failed|unusual activity|"code"\s*:\s*(?:3007|3012))/i.test(text);
  } catch {
    return false;
  }
}
