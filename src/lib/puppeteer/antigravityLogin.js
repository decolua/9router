/**
 * Puppeteer + Stealth login engine for Antigravity (Google OAuth).
 *
 * Handles the full Google sign-in flow including:
 *   - Account chooser ("Use another account")
 *   - Email / password entry with native setter (anti-detection)
 *   - Google Workspace Education TOS ("Welcome to your new account")
 *   - App verification ("Make sure you downloaded this app from Google")
 *   - OAuth consent screen
 *   - Challenge pages (KPE recovery email, "Try another way")
 *
 * Designed to run inside a shared Puppeteer browser instance — each call
 * creates its own incognito BrowserContext for isolation.
 */

import { sleep, safeEval, safeWaitForSelector } from "./helpers.js";

const MAX_INTERSTITIAL_LOOPS = 10;

/**
 * Run a headless Google OAuth login and return the authorization code.
 *
 * @param {import('puppeteer').Browser} browser - Shared Puppeteer browser
 * @param {string} email - Google account email
 * @param {string} password - Google account password
 * @param {string} authUrl - Full OAuth authorization URL (from generateAuthData)
 * @param {string} redirectUri - OAuth redirect URI (e.g. "http://localhost:8080/callback")
 * @param {(msg: string) => void} [onLog] - Optional log callback
 * @returns {Promise<{ code: string, state: string }>}
 */
export async function headlessGoogleLogin(
  browser,
  email,
  password,
  authUrl,
  redirectUri,
  onLog = () => {},
) {
  let context = null;
  let page = null;

  try {
    onLog("[1/5] Creating browser context...");
    context = await browser.createBrowserContext();
    page = await context.newPage();

    // Configure page to match a real browser
    const browserVersion = await browser.version();
    const chromeVersion =
      browserVersion.match(/Chrome\/(\d+)/)?.[1] || "130";
    await page.setUserAgent(
      `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`,
    );
    await page.setViewport({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    // Track navigations for debugging
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        onLog(`  nav: ${frame.url().split("?")[0]}`);
      }
    });

    // Capture the OAuth callback URL via request listener.
    // When Google redirects to localhost:8080/callback, Chrome can't load it
    // (nothing listening), so page.url() becomes chrome-error://. The request
    // event fires BEFORE the load attempt, letting us capture the full URL
    // with the auth code and state params.
    let capturedCallbackUrl = null;
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith(redirectUri)) {
        capturedCallbackUrl = url;
      }
    });

    // Navigate to Google OAuth
    onLog("[2/5] Navigating to Google login...");
    await page.goto(authUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(2000);
    onLog(`  page: ${page.url().split("?")[0]}`);

    // Handle account chooser
    const hasChooser = await safeEval(page, () => {
      const link =
        document.querySelector('[data-identifier="Use another account"]') ||
        document.querySelector('a[data-action="Use another account"]');
      if (link) {
        link.click();
        return true;
      }
      const btns = [...document.querySelectorAll("button")];
      const useAnother = btns.find((b) =>
        (b.textContent || "").includes("Use another account"),
      );
      if (useAnother) {
        useAnother.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (hasChooser) {
      onLog('  clicked "Use another account"');
      await sleep(2000);
    }

    // Wait for email field
    const emailFound = await safeWaitForSelector(
      page,
      'input[type="email"]',
      20000,
    );
    if (!emailFound) {
      const bodyText = await safeEval(
        page,
        () => document.body?.innerText?.substring(0, 300) || "",
      ).catch(() => "");
      onLog(`DEBUG no email field — body: ${bodyText}`);
      throw new Error(
        `Email field not found. URL: ${page.url().split("?")[0]}`,
      );
    }

    // Step 1: Enter email (native setter pattern)
    onLog(`[3/5] Entering credentials for ${email}...`);
    await safeEval(
      page,
      (val) => {
        const input = document.querySelector('input[type="email"]');
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set;
        nativeSetter.call(input, val);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      email,
    );
    await sleep(300);

    await safeEval(page, () => {
      const btn = document.querySelector("#identifierNext");
      if (btn) btn.click();
    });

    // Wait for password field
    onLog("  waiting for password...");
    let pwdFound = await safeWaitForSelector(
      page,
      'input[type="password"]',
      20000,
    );

    if (!pwdFound) {
      // Check if still on email page — retry
      const stillOnEmail = await safeEval(
        page,
        () => !!document.querySelector('input[type="email"]'),
      ).catch(() => false);

      if (stillOnEmail) {
        onLog("  retrying email + Next...");
        await safeEval(
          page,
          (val) => {
            const input = document.querySelector('input[type="email"]');
            if (!input) return;
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value",
            ).set;
            setter.call(input, val);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          },
          email,
        );
        await sleep(500);
        await safeEval(page, () =>
          document.querySelector("#identifierNext")?.click(),
        );
        pwdFound = await safeWaitForSelector(
          page,
          'input[type="password"]',
          15000,
        );
      }

      if (!pwdFound) {
        const bodyText = await safeEval(
          page,
          () => document.body?.innerText?.substring(0, 500) || "",
        ).catch(() => "");
        onLog(`DEBUG body: ${bodyText}`);
        if (bodyText.toLowerCase().includes("couldn't find")) {
          throw new Error("Google Account not found");
        }
        throw new Error(
          `Password field not found. URL: ${page.url().split("?")[0]}`,
        );
      }
    }

    // Step 2: Enter password (native setter pattern)
    await sleep(500);
    await safeEval(
      page,
      (val) => {
        const input = document.querySelector('input[type="password"]');
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set;
        nativeSetter.call(input, val);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      password,
    );
    await sleep(300);

    await safeEval(page, () => {
      const btn = document.querySelector("#passwordNext");
      if (btn) btn.click();
    });

    await page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 })
      .catch(() => {});
    await sleep(2000);

    // Check for wrong password
    const pwdError = await safeEval(
      page,
      () =>
        (document.body?.innerText || "").toLowerCase().includes("wrong password"),
    ).catch(() => false);
    if (pwdError) throw new Error("Wrong password");

    // Check for challenge / rejection after password
    const postPwdUrl = page.url();
    if (postPwdUrl.includes("signin/rejected")) {
      throw new Error("Account sign-in rejected by Google");
    }
    if (postPwdUrl.includes("challenge/")) {
      const challengeType =
        postPwdUrl.match(/challenge\/([^/?]+)/)?.[1] || "unknown";
      onLog(`  challenge page detected: ${challengeType}`);
      const handled = await handleChallengePage(page, email, onLog);
      if (!handled) {
        throw new Error(`Account requires verification: ${challengeType}`);
      }
    }

    // Step 3: Handle interstitial pages (TOS, app verification, consent)
    onLog("[4/5] Handling consent/verification pages...");
    await handleInterstitialPages(page, email, redirectUri, () => capturedCallbackUrl, onLog);

    // Step 4: Extract auth code from callback URL
    onLog("[5/5] Extracting authorization code...");
    const callbackUrl = await waitForCallbackUrl(page, redirectUri, () => capturedCallbackUrl, 30000);
    const parsed = new URL(callbackUrl);
    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");

    if (!code) {
      throw new Error("OAuth callback missing authorization code");
    }

    onLog("  auth code obtained");
    return { code, state };
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
  }
}

/**
 * Poll page URL until it matches the redirect URI or timeout.
 * Also checks the capturedCallbackUrl getter — the request listener captures
 * the redirect URL before Chrome fails to load localhost.
 */
async function waitForCallbackUrl(page, redirectUri, getCapturedUrl, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check request-listener captured URL first (most reliable)
    const captured = getCapturedUrl();
    if (captured) {
      return captured;
    }

    const currentUrl = page.url();
    if (currentUrl.startsWith(redirectUri)) {
      return currentUrl;
    }

    await sleep(500);
  }

  // Final check before timeout
  const captured = getCapturedUrl();
  if (captured) return captured;

  throw new Error(
    `OAuth callback timeout — last URL: ${page.url().split("?")[0]}`,
  );
}

/**
 * Handle Google challenge pages (KPE recovery email, "Try another way", etc.)
 *
 * @returns {Promise<boolean>} true if challenge was resolved
 */
async function handleChallengePage(page, email, onLog) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pageInfo = await safeEval(page, () => {
      const inputs = [...document.querySelectorAll('input:not([type="hidden"])')];
      const btns = [
        ...document.querySelectorAll(
          'button, input[type="submit"], input[type="button"]',
        ),
      ];
      return {
        inputs: inputs.map((i) => ({ type: i.type, name: i.name, id: i.id })),
        buttons: btns
          .map((b) => (b.textContent || b.value || "").trim())
          .filter(Boolean),
      };
    }).catch(() => ({ inputs: [], buttons: [] }));

    onLog(
      `  challenge attempt ${attempt + 1}: inputs=${JSON.stringify(pageInfo.inputs)} buttons=${JSON.stringify(pageInfo.buttons)}`,
    );

    // Try "Try another way" link
    const tryAnother = await safeEval(page, () => {
      const btns = [...document.querySelectorAll("button")];
      const btn = btns.find((b) =>
        (b.textContent || "").toLowerCase().includes("try another way"),
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (tryAnother) {
      onLog('  challenge: clicked "Try another way"');
      await sleep(3000);

      // Try to click skip/confirm/done if available
      const skipClicked = await safeEval(page, () => {
        const btns = [
          ...document.querySelectorAll('button, a, [role="link"]'),
        ];
        const target = btns.find((b) => {
          const t = (b.textContent || "").toLowerCase();
          return (
            t.includes("skip") ||
            t.includes("confirm") ||
            t.includes("i don") ||
            t.includes("not now")
          );
        });
        if (target) {
          target.click();
          return (target.textContent || "").trim();
        }
        return null;
      }).catch(() => null);

      if (skipClicked) {
        onLog(`  challenge: clicked "${skipClicked}"`);
        await page
          .waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 15000,
          })
          .catch(() => {});
        await sleep(2000);
        if (!page.url().includes("challenge/")) {
          onLog("  challenge resolved via skip");
          return true;
        }
      }
      continue;
    }

    // Click any "Next" / "Skip" / "Continue" / "I understand" button
    const clicked = await safeEval(page, () => {
      const btns = [
        ...document.querySelectorAll(
          'button, input[type="submit"], input[type="button"]',
        ),
      ];
      const target = btns.find((b) => {
        const t = (b.textContent || b.value || "").toLowerCase();
        return (
          t.includes("next") ||
          t.includes("skip") ||
          t.includes("continue") ||
          t.includes("i understand") ||
          t.includes("accept") ||
          t.includes("done") ||
          t.includes("sign in") ||
          t.includes("verify")
        );
      });
      if (target) {
        target.click();
        return (target.textContent || target.value || "").trim();
      }
      return null;
    }).catch(() => null);

    if (clicked) {
      onLog(`  challenge: clicked "${clicked}"`);
      await page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 })
        .catch(() => {});
      await sleep(2000);

      if (!page.url().includes("challenge/")) {
        onLog("  challenge resolved");
        return true;
      }
      continue;
    }

    await sleep(1000);
  }

  return false;
}

/**
 * Handle interstitial pages between password entry and OAuth callback.
 *
 * Loops up to MAX_INTERSTITIAL_LOOPS times, handling:
 *   - TOS / "Welcome to your new account" → clicks "I understand" / "Accept"
 *   - App verification / "downloaded this app" → clicks "Sign in"
 *   - OAuth consent → clicks "Allow" / "Continue" / #submit_approve_access
 *   - Challenge pages → delegates to handleChallengePage
 *
 * Exits when the page URL matches the redirectUri (callback reached).
 */
async function handleInterstitialPages(page, email, redirectUri, getCapturedUrl, onLog) {
  for (let i = 0; i < MAX_INTERSTITIAL_LOOPS; i++) {
    // Check captured URL first — request listener may have caught the redirect
    if (getCapturedUrl()) {
      onLog("  callback URL captured via request listener");
      return;
    }

    const currentUrl = page.url();

    // Callback page reached — auth complete
    if (currentUrl.startsWith(redirectUri) || currentUrl.includes("oauth-callback")) {
      onLog("  callback page reached");
      return;
    }

    if (
      currentUrl.includes("chrome-error://") ||
      currentUrl === "about:blank"
    ) {
      await sleep(1000);
      return;
    }

    if (currentUrl.includes("signin/rejected")) {
      throw new Error("Account sign-in rejected by Google");
    }

    if (currentUrl.includes("challenge/")) {
      const challengeType =
        currentUrl.match(/challenge\/([^/?]+)/)?.[1] || "unknown";
      onLog(`  interstitial challenge: ${challengeType}`);
      const handled = await handleChallengePage(page, email, onLog);
      if (!handled) {
        throw new Error(`Account requires verification: ${challengeType}`);
      }
      continue;
    }

    const content = await safeEval(
      page,
      () => document.body?.innerText || "",
    ).catch(() => "");
    onLog(`  loop ${i + 1}: ${currentUrl.split("?")[0]}`);

    // TOS page — "Welcome to your new account"
    if (
      currentUrl.includes("speedbump") ||
      content.includes("Welcome to your new account")
    ) {
      const clicked = await safeEval(page, () => {
        const btns = [
          ...document.querySelectorAll('button, input[type="submit"]'),
        ];
        const target =
          btns.find((b) => {
            const t = (b.textContent || b.value || "").toLowerCase();
            return t.includes("i understand") || t.includes("accept");
          }) || btns[0];
        if (target) {
          target.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (clicked) {
        onLog("  accepted TOS");
        await page
          .waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 15000,
          })
          .catch(() => {});
        await sleep(1000);
        continue;
      }
    }

    // App verification — "Make sure you downloaded this app from Google"
    if (
      currentUrl.includes("nativeapp") ||
      content.includes("downloaded this app")
    ) {
      const clicked = await safeEval(page, () => {
        const btns = [...document.querySelectorAll("button")];
        const signIn = btns.find((b) =>
          (b.textContent || "").toLowerCase().includes("sign in"),
        );
        if (signIn) {
          signIn.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (clicked) {
        onLog("  confirmed app verification");
        await sleep(2000);
        continue;
      }
    }

    // OAuth consent screen
    const consentClicked = await safeEval(page, () => {
      const submit = document.querySelector("#submit_approve_access");
      if (submit) {
        submit.click();
        return true;
      }
      const btns = [...document.querySelectorAll("button")];
      const allow = btns.find((b) => {
        const t = (b.textContent || "").toLowerCase();
        return t.includes("allow") || t.includes("continue");
      });
      if (allow) {
        allow.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (consentClicked) {
      onLog("  clicked consent");
      await sleep(2000);
      continue;
    }

    await sleep(1500);
  }
}
