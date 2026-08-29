import { CaptchaManager } from "./captcha-manager.js";
import config from "./config.js";

// Next.js webpack can load this module twice (API routes vs open-sse executor).
// Use a process-global singleton so captcha submit resolves the waiting executor.
const CAPTCHA_MANAGER_KEY = Symbol.for("9router.zcode.captchaManager");

export function getCaptchaManager() {
  if (!globalThis[CAPTCHA_MANAGER_KEY]) {
    globalThis[CAPTCHA_MANAGER_KEY] = new CaptchaManager();
  }
  return globalThis[CAPTCHA_MANAGER_KEY];
}

export function getZcodeCaptchaPort() {
  return config.captchaPort;
}

export async function isCaptchaError(response) {
  try {
    const clone = response.clone();
    const text = await clone.text();
    return (
      text.toLowerCase().includes("captcha") ||
      text.includes("verify token") ||
      text.includes("verify failed")
    );
  } catch {
    return false;
  }
}