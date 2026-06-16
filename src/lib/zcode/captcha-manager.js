import { launch as launchBrowser } from "./browser.js";
import config from "./config.js";

export class CaptchaManager {
  constructor() {
    this.cachedVerifyParam = null;
    this.pendingPromise = null;
    this.resolveCallback = null;
    this.rejectCallback = null;
    this.captchaPage = null;
    this.captchaConfigCache = null;
    this.captchaConfigCacheTime = 0;
    this._clearCacheTimer = null;
    this._captchaTimeoutId = null;
    this._headlessTimeoutId = null;
    this._verificationPhase = null;
    this._headedFallbackAttempted = false;
    this._activePort = config.captchaPort;
  }

  async fetchCaptchaConfig() {
    const now = Date.now();
    if (this.captchaConfigCache && now - this.captchaConfigCacheTime < config.captchaConfigCacheTTL) {
      return this.captchaConfigCache;
    }

    try {
      const res = await fetch(
        `https://zcode.z.ai/api/v1/client/configs?app_version=${config.appVersion}&platform=win32`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const captchaConfig = json.data?.configs?.captcha;
      if (captchaConfig) {
        this.captchaConfigCache = captchaConfig;
        this.captchaConfigCacheTime = now;
        return captchaConfig;
      }
    } catch (err) {
      console.error("[ZCode Captcha] Failed to fetch config, using defaults:", err.message);
    }

    return {
      enabled: true,
      prefix: "no8xfe",
      region: "sgp",
      sceneId: "11xygtvd",
    };
  }

  _clearVerificationTimers() {
    if (this._captchaTimeoutId) {
      clearTimeout(this._captchaTimeoutId);
      this._captchaTimeoutId = null;
    }
    if (this._headlessTimeoutId) {
      clearTimeout(this._headlessTimeoutId);
      this._headlessTimeoutId = null;
    }
  }

  _rejectPending(err) {
    this._clearVerificationTimers();
    if (this.rejectCallback) {
      this.rejectCallback(err);
    }
    this.pendingPromise = null;
    this.resolveCallback = null;
    this.rejectCallback = null;
    this._verificationPhase = null;
    this._headedFallbackAttempted = false;
  }

  _resolvePending(verifyParam) {
    this._clearVerificationTimers();
    if (this.resolveCallback) {
      this.resolveCallback(verifyParam);
    }
    this.pendingPromise = null;
    this.resolveCallback = null;
    this.rejectCallback = null;
    this._verificationPhase = null;
    this._headedFallbackAttempted = false;
  }

  _armPhaseTimeout(phase) {
    this._clearVerificationTimers();

    const timeoutMs =
      phase === "headed"
        ? config.captchaInteractiveTimeoutMs
        : config.captchaHeadlessTimeoutMs;

    this._captchaTimeoutId = setTimeout(() => {
      if (phase === "headless" && config.captchaHeadedFallback && !this._headedFallbackAttempted) {
        console.warn(
          `[ZCode Captcha] Traceless verification timed out after ${Math.round(timeoutMs / 1000)}s, opening visible browser...`
        );
        this.onNeedsInteractive().catch((err) => {
          console.error("[ZCode Captcha] Headed fallback failed:", err.message);
          this._rejectPending(
            new Error(
              `Captcha verification timed out. Complete the puzzle in the browser window or retry later. (${err.message})`
            )
          );
        });
        return;
      }

      this._rejectPending(
        new Error(
          phase === "headed"
            ? `Interactive captcha timed out after ${Math.round(timeoutMs / 1000)}s. Complete the puzzle in the browser window and retry.`
            : `Captcha verification timed out after ${Math.round(timeoutMs / 1000)}s. Ensure CloakBrowser can reach /zcode/captcha.html and retry.`
        )
      );
    }, timeoutMs);
  }

  async _closeCaptchaPage() {
    if (!this.captchaPage) return;
    try {
      await this.captchaPage.close();
    } catch {
      // ignore
    }
    this.captchaPage = null;
  }

  async openVerificationPage(port = config.captchaPort, { headless = true, interactive = false } = {}) {
    this._activePort = port;
    this._verificationPhase = headless ? "headless" : "headed";

    if (this.captchaPage && !this.captchaPage.isClosed()) {
      if (!interactive) {
        try {
          await this.captchaPage.evaluate(() => {
            if (typeof window.__resetCaptcha === "function") {
              return window.__resetCaptcha();
            }
          });
          this._armPhaseTimeout(this._verificationPhase);
          return;
        } catch (err) {
          console.warn("[ZCode Captcha] page.evaluate failed, reopening page:", err.message);
          await this._closeCaptchaPage();
        }
      } else {
        await this._closeCaptchaPage();
      }
    }

    const browserInstance = await launchBrowser({ headless });
    const context = browserInstance.contexts()[0] || (await browserInstance.newContext());
    this.captchaPage = await context.newPage();

    const query = interactive ? "?mode=interactive" : "";
    await this.captchaPage.goto(`http://localhost:${port}/zcode/captcha.html${query}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    this.captchaPage.on("close", () => {
      this.captchaPage = null;
    });

    this._armPhaseTimeout(this._verificationPhase);

    if (!headless) {
      console.log(
        "[ZCode Captcha] Visible browser opened — complete the security puzzle in the window to continue."
      );
    }
  }

  async onNeedsInteractive() {
    if (!this.pendingPromise || this._headedFallbackAttempted || !config.captchaHeadedFallback) {
      return;
    }

    this._headedFallbackAttempted = true;
    await this._closeCaptchaPage();
    await this.openVerificationPage(this._activePort, { headless: false, interactive: true });
  }

  async getVerifyParam(port = config.captchaPort) {
    if (this.cachedVerifyParam) {
      return this.cachedVerifyParam;
    }

    if (this.pendingPromise) {
      return this.pendingPromise;
    }

    this._headedFallbackAttempted = false;
    this._activePort = port;

    this.pendingPromise = new Promise((resolve, reject) => {
      this.resolveCallback = resolve;
      this.rejectCallback = reject;
    });

    this.openVerificationPage(port, { headless: true, interactive: false }).catch((err) => {
      this._rejectPending(new Error("Browser launch failed: " + err.message));
    });

    return this.pendingPromise;
  }

  submit(verifyParam) {
    if (this.resolveCallback) {
      this._resolvePending(verifyParam);
    }

    if (this._clearCacheTimer) {
      clearTimeout(this._clearCacheTimer);
      this._clearCacheTimer = null;
    }

    this.cachedVerifyParam = verifyParam;
    this._clearCacheTimer = setTimeout(() => {
      this.cachedVerifyParam = null;
      this._clearCacheTimer = null;
    }, config.captchaCacheTTL);
  }

  invalidate() {
    this.cachedVerifyParam = null;
    if (this._clearCacheTimer) {
      clearTimeout(this._clearCacheTimer);
      this._clearCacheTimer = null;
    }
  }

  async close() {
    this._clearVerificationTimers();
    await this._closeCaptchaPage();
  }
}