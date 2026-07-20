import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
} from "./kiroBulkImportManager.js";
import {
  runGoogleAccountAutomation,
} from "./googleAutomation.js";
import {
  handleCodeBuddyRegionPage,
  handleProviderOnboarding,
  handleCodeBuddyStartedAuthorization,
  isProviderPage,
} from "./codebuddyAutomation.js";

const CODEBUDDY_PROVIDER_ID = "codebuddy";
const CODEBUDDY_LABEL = "CodeBuddy";
const CODEBUDDY_POLL_TIMEOUT_MS = 15 * 60_000;
const CODEBUDDY_POLL_INTERVAL_MS = 5_000;
const CODEBUDDY_MAX_TRANSIENT_POLL_ERRORS = 6;
const CODEBUDDY_COOKIE_DOMAINS = new Set(["codebuddy.ai", "www.codebuddy.ai"]);
const CODEBUDDY_KEYS_URL = "https://www.codebuddy.ai/profile/keys";
const CODEBUDDY_API_KEY_ENDPOINT = "https://www.codebuddy.ai/console/api/client/v1/api-keys";
const CODEBUDDY_REGION_ACCOUNT_ENDPOINT = "https://www.codebuddy.ai/console/login/account";
const CODEBUDDY_TRIAL_ENDPOINT = "https://www.codebuddy.ai/billing/ide/trial";
const CODEBUDDY_DEFAULT_KEY_EXPIRE_DAYS = 365;
const CODEBUDDY_KEY_SESSION_TIMEOUT_MS = 45_000;
const CODEBUDDY_KEY_SESSION_POLL_MS = 1_500;
const CODEBUDDY_PERSONAL_ENTERPRISE_ID = "personal-edition-user-id";
const CODEBUDDY_KEY_ERROR_CODES = {
  nameExists: 12502,
  keyLimitReached: 12601,
};
const CODEBUDDY_TRIAL_ERROR_CODES = {
  alreadyApplied: 14051,
};
const CODEBUDDY_BROWSER_ARGS = ["--start-maximized", "--disable-blink-features=AutomationControlled"];
const CODEBUDDY_BROWSER_CONTEXT_OPTIONS = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
  locale: "zh-CN",
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCodeBuddyAuthUrl(rawUrl, state) {
  if (!rawUrl && !state) return rawUrl;
  const url = rawUrl ? new URL(rawUrl) : new URL("https://www.codebuddy.ai/login");
  const platform = url.searchParams.get("platform") || "CLI";
  const effectiveState = state || url.searchParams.get("state");
  const normalized = new URL("https://www.codebuddy.ai/login");
  normalized.searchParams.set("platform", platform);
  if (effectiveState) normalized.searchParams.set("state", effectiveState);
  return normalized.toString();
}

async function defaultSaveCodeBuddyConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    ...(tokens.providerSpecificData || {}),
    loginEmail: email,
    automation: "gsuite-bulk",
  };

  if (tokens.webCookie) {
    providerSpecificData.webCookie = tokens.webCookie;
    providerSpecificData.webCookieCapturedAt = tokens.webCookieCapturedAt || new Date().toISOString();
  }

  if (tokens.generatedApiKey) {
    providerSpecificData.codebuddyApiKeyId = tokens.generatedApiKey.id || null;
    providerSpecificData.codebuddyApiKeyName = tokens.generatedApiKey.name || null;
    providerSpecificData.codebuddyApiKeyExpiresAt = tokens.generatedApiKey.expiresAt || null;
    providerSpecificData.authMode = "generated-api-key";
  }

  const connectionData = {
    provider: CODEBUDDY_PROVIDER_ID,
    authType: "oauth",
    ...tokens,
    email,
    providerSpecificData,
    expiresAt: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null,
    testStatus: "active",
  };

  const effectiveApiKey = tokens.generatedApiKey?.key || tokens.apiKey;
  if (effectiveApiKey) {
    connectionData.apiKey = effectiveApiKey;
  }

  const connection = await createProviderConnection(connectionData);

  return { connection };
}

async function defaultRequestDeviceCode(providerId) {
  const { requestDeviceCode } = await import("../providers.js");
  return requestDeviceCode(providerId);
}

async function defaultPollForToken(providerId, deviceCode) {
  const { pollForToken } = await import("../providers.js");
  return pollForToken(providerId, deviceCode);
}

async function defaultCodeBuddyBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "chromium",
    proxyUrl: job?.proxyUrl || undefined,
    headless: false,
    args: CODEBUDDY_BROWSER_ARGS,
  });
}

async function fetchCodeBuddyLoginAccount(accessToken, state, domain = "www.codebuddy.ai") {
  if (!accessToken || !state) return null;
  try {
    const response = await fetch(`https://${domain}/v2/plugin/login/account?state=${encodeURIComponent(state)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-Domain": domain,
      },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data || payload || {};
    if (!data || typeof data !== "object") return null;
    return {
      uid: data.uid || null,
      nickname: data.nickname || null,
      email: data.email || null,
      enterpriseId: data.enterpriseId || null,
      enterpriseName: data.enterpriseName || null,
      rawAuth: data,
    };
  } catch {
    return null;
  }
}

async function defaultFindExistingCodeBuddyApiKey(email) {
  if (!email) return null;
  try {
    const { getProviderConnections } = await import("../../../models/index.js");
    const connections = await getProviderConnections({ provider: CODEBUDDY_PROVIDER_ID });
    const existing = connections.find((connection) => (
      connection.authType === "oauth"
      && connection.email === email
      && connection.apiKey
    ));
    return existing?.apiKey || null;
  } catch {
    return null;
  }
}

async function captureCodeBuddyWebCookie(context) {
  if (!context?.cookies) {
    console.warn("[CodeBuddy] captureWebCookie: context.cookies not available");
    return null;
  }

  try {
    const cookies = await context.cookies(["https://www.codebuddy.ai", "https://codebuddy.ai"]);
    console.log(`[CodeBuddy] captureWebCookie: found ${cookies.length} raw cookies from browser context`);

    const usefulCookies = cookies
      .filter((cookie) => {
        const domain = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
        return CODEBUDDY_COOKIE_DOMAINS.has(domain)
          || domain.endsWith(".codebuddy.ai");
      })
      .filter((cookie) => cookie.name && cookie.value)
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));

    if (usefulCookies.length === 0) {
      console.warn("[CodeBuddy] captureWebCookie: no useful cookies after filtering. Raw cookie names:", cookies.map(c => `${c.name}@${c.domain}`).join(", "));
      return null;
    }

    const cookieString = usefulCookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    console.log(`[CodeBuddy] captureWebCookie: captured ${usefulCookies.length} cookies (${cookieString.length} chars). Names: ${usefulCookies.map(c => c.name).join(", ")}`);
    return cookieString;
  } catch (error) {
    console.error("[CodeBuddy] captureWebCookie error:", error.message);
    return null;
  }
}

async function attachCodeBuddyWebCookie(context, tokens = {}) {
  const webCookie = await captureCodeBuddyWebCookie(context);
  if (!webCookie) return tokens;

  return {
    ...tokens,
    webCookie,
    webCookieCapturedAt: new Date().toISOString(),
  };
}

function normalizeCodeBuddyKeyName(email) {
  const prefix = String(email || "codebuddy")
    .replace(/[^a-zA-Z0-9_.@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "codebuddy";
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `9router-${prefix}-${suffix}`.slice(0, 50);
}

function classifyCodeBuddyKeyError(status, payload) {
  const code = payload?.code ?? payload?.error?.code ?? payload?.data?.code;
  const msg = payload?.msg || payload?.message || payload?.error?.message || payload?.error || `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return {
      step: "key_session_invalid",
      status: "needs_manual",
      message: `CodeBuddy key session invalid (${status})`,
      retryable: false,
    };
  }
  if (code === CODEBUDDY_KEY_ERROR_CODES.keyLimitReached) {
    return {
      step: "key_limit_reached",
      status: "failed",
      message: "CodeBuddy API key limit reached",
      retryable: false,
    };
  }
  if (code === CODEBUDDY_KEY_ERROR_CODES.nameExists) {
    return {
      step: "key_name_exists",
      status: "failed",
      message: "CodeBuddy API key name already exists",
      retryable: true,
    };
  }
  return {
    step: "key_create_failed",
    status: "failed",
    message: msg || "CodeBuddy API key creation failed",
    retryable: false,
  };
}

function buildCodeBuddyKeyResult(payload, fallbackName) {
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

async function postJsonFromPage(page, url, { method = "POST", headers = {}, referrer, body } = {}) {
  return page.evaluate(async ({ url: targetUrl, method: requestMethod, headers: requestHeaders, referrer: requestReferrer, body: requestBody }) => {
    const response = await fetch(targetUrl, {
      method: requestMethod,
      credentials: "include",
      headers: requestHeaders,
      referrer: requestReferrer,
      body: requestBody == null ? null : JSON.stringify(requestBody),
    });
    const text = await response.text().catch(() => "");
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
    };
  }, {
    url,
    method,
    headers,
    referrer,
    body,
  });
}

async function submitCodeBuddyRegionProfile(page, onStep) {
  onStep?.("submitting_codebuddy_region_profile", "Submitting CodeBuddy region profile via account API");
  const result = await postJsonFromPage(page, CODEBUDDY_REGION_ACCOUNT_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      "x-domain": "www.codebuddy.ai",
    },
    referrer: "https://www.codebuddy.ai/register/user/complete",
    body: {
      attributes: {
        countryCode: ["62"],
        countryFullName: ["Indonesia"],
        countryName: ["ID"],
      },
    },
  });

  if (result.ok && (result.payload?.code === 0 || result.payload?.code === 200 || typeof result.payload?.code === "undefined")) {
    return {
      ok: true,
      code: result.payload?.code ?? 0,
      message: result.payload?.msg || result.payload?.message || "OK",
    };
  }

  return {
    ok: false,
    code: result.payload?.code ?? result.status,
    message: result.payload?.msg || result.payload?.message || result.text || `HTTP ${result.status}`,
  };
}

async function ensureCodeBuddyTrialActivated(page, onStep) {
  onStep?.("activating_codebuddy_trial", "Applying or verifying CodeBuddy IDE trial");
  const invokeTrial = () => postJsonFromPage(page, CODEBUDDY_TRIAL_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
      "x-domain": "www.codebuddy.ai",
    },
    referrer: "https://www.codebuddy.ai/profile/plan",
    body: null,
  });

  const first = await invokeTrial();
  const firstCode = first?.payload?.code;
  if (first.ok && firstCode === CODEBUDDY_TRIAL_ERROR_CODES.alreadyApplied) {
    return {
      ok: true,
      code: firstCode,
      state: "already_applied",
      message: first.payload?.msg || "has applied trial",
    };
  }

  if (first.ok && (firstCode === 0 || firstCode === 200 || typeof firstCode === "undefined")) {
    await wait(1200);
    const second = await invokeTrial();
    const secondCode = second?.payload?.code;
    if (second.ok && (
      secondCode === 0
      || secondCode === 200
      || secondCode === CODEBUDDY_TRIAL_ERROR_CODES.alreadyApplied
      || typeof secondCode === "undefined"
    )) {
      return {
        ok: true,
        code: secondCode ?? firstCode ?? 0,
        state: secondCode === CODEBUDDY_TRIAL_ERROR_CODES.alreadyApplied ? "applied_confirmed" : "applied",
        message: second.payload?.msg || first.payload?.msg || "OK",
      };
    }

    return {
      ok: false,
      code: secondCode ?? second.status,
      message: second.payload?.msg || second.payload?.message || second.text || `HTTP ${second.status}`,
    };
  }

  return {
    ok: false,
    code: firstCode ?? first.status,
    message: first.payload?.msg || first.payload?.message || first.text || `HTTP ${first.status}`,
  };
}

async function waitForCodeBuddyConsoleAccount(page, onStep, timeoutMs = CODEBUDDY_KEY_SESSION_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await page.evaluate(async () => {
      try {
        const response = await fetch("/console/accounts", {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "x-requested-with": "XMLHttpRequest",
            "X-Domain": window.location.hostname || "www.codebuddy.ai",
          },
        });
        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        const accounts = payload?.data?.accounts || payload?.accounts || [];
        return { ok: response.ok, status: response.status, payload, accounts };
      } catch (error) {
        return { ok: false, status: 0, error: error?.message || String(error) };
      }
    });

    if (result?.ok && Array.isArray(result.accounts) && result.accounts.length > 0) {
      const account = result.accounts.find((entry) => entry?.lastLogin) || result.accounts[0] || {};
      return {
        account,
        userEnterpriseId: account.type && account.type !== "personal" && account.enterpriseId
          ? account.enterpriseId
          : CODEBUDDY_PERSONAL_ENTERPRISE_ID,
      };
    }

    lastError = result?.error || `status=${result?.status || "unknown"}`;
    onStep?.("waiting_codebuddy_key_session", `Waiting for CodeBuddy web console session (${lastError})`);
    await page.waitForTimeout(CODEBUDDY_KEY_SESSION_POLL_MS);
  }

  const error = new Error(`CodeBuddy key session invalid: ${lastError || "no account session"}`);
  error.step = "key_session_invalid";
  error.status = "needs_manual";
  throw error;
}

async function postCodeBuddyApiKeyFromPage(page, keyName, userEnterpriseId) {
  return page.evaluate(async ({ endpoint, name, expireInDays, userEnterpriseId }) => {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        expire_in_days: expireInDays,
        user_enterprise_id: userEnterpriseId,
      }),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
      text: payload ? null : text.slice(0, 300),
    };
  }, {
    endpoint: CODEBUDDY_API_KEY_ENDPOINT,
    name: keyName,
    expireInDays: CODEBUDDY_DEFAULT_KEY_EXPIRE_DAYS,
    userEnterpriseId,
  });
}

export async function createCodeBuddyApiKey(page, email, onStep, {
  existingApiKey = null,
  directReplay = false,
  userEnterpriseId: forcedUserEnterpriseId = null,
} = {}) {
  if (existingApiKey) {
    return { skipped: true, key: existingApiKey };
  }
  if (!page) {
    const error = new Error("CodeBuddy browser session is not available for API key creation");
    error.step = "key_session_invalid";
    error.status = "needs_manual";
    throw error;
  }

  let userEnterpriseId = forcedUserEnterpriseId || CODEBUDDY_PERSONAL_ENTERPRISE_ID;
  if (directReplay) {
    onStep?.("creating_codebuddy_api_key_direct", "Replaying CodeBuddy API key creation from current web session");
  } else {
    onStep?.("opening_codebuddy_keys", "Opening CodeBuddy Access Keys page");
    await page.goto(CODEBUDDY_KEYS_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2_000);

    const session = await waitForCodeBuddyConsoleAccount(page, onStep);
    userEnterpriseId = session.userEnterpriseId || userEnterpriseId;
  }

  const firstName = normalizeCodeBuddyKeyName(email);
  const keyNames = [firstName, `${firstName.slice(0, 41)}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 50)];

  let lastFailure = null;
  for (let attempt = 0; attempt < keyNames.length; attempt += 1) {
    const keyName = keyNames[attempt];
    onStep?.("creating_codebuddy_api_key", `Creating CodeBuddy API key${attempt ? " with retry name" : ""}`);

    const result = await postCodeBuddyApiKeyFromPage(page, keyName, userEnterpriseId);

    if (result?.ok && (result.payload?.code === 0 || result.payload?.code === 200 || result.payload?.code === undefined)) {
      const apiKey = buildCodeBuddyKeyResult(result.payload, keyName);
      if (apiKey?.key) {
        return apiKey;
      }
      const error = new Error("CodeBuddy API key created but secret was not returned");
      error.step = "key_create_no_secret";
      error.status = "failed";
      throw error;
    }

    const failure = classifyCodeBuddyKeyError(result?.status, result?.payload || { message: result?.text });
    lastFailure = failure;
    if (failure.retryable && attempt === 0) continue;

    const error = new Error(failure.message);
    error.step = failure.step;
    error.status = failure.status;
    throw error;
  }

  const error = new Error(lastFailure?.message || "CodeBuddy API key creation failed");
  error.step = lastFailure?.step || "key_create_failed";
  error.status = lastFailure?.status || "failed";
  throw error;
}

function createCodeBuddyPollPromise({
  deviceCode,
  pollToken,
  onStep,
  fetchLoginAccount = fetchCodeBuddyLoginAccount,
  timeoutMs = CODEBUDDY_POLL_TIMEOUT_MS,
  pollIntervalMs = CODEBUDDY_POLL_INTERVAL_MS,
  maxTransientErrors = CODEBUDDY_MAX_TRANSIENT_POLL_ERRORS,
}) {
  return (async () => {
    const startedAt = Date.now();
    let lastStepAt = 0;
    let transientErrors = 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (Date.now() - lastStepAt > pollIntervalMs - 100) {
        onStep?.("polling_codebuddy_token", "Waiting for CodeBuddy OAuth token");
        lastStepAt = Date.now();
      }

      const result = await pollToken(CODEBUDDY_PROVIDER_ID, deviceCode);
      if (result.success) {
        const accessToken = result.tokens?.accessToken || result.tokens?.access_token;
        const loginAccount = await fetchLoginAccount(accessToken, deviceCode);
        return {
          tokens: {
            ...result.tokens,
            providerSpecificData: {
              ...(result.tokens?.providerSpecificData || {}),
              ...(loginAccount?.uid ? { uid: loginAccount.uid } : {}),
              ...(loginAccount?.nickname ? { nickname: loginAccount.nickname } : {}),
              ...(loginAccount?.enterpriseId ? { enterpriseId: loginAccount.enterpriseId } : {}),
              ...(loginAccount?.enterpriseName ? { enterpriseName: loginAccount.enterpriseName } : {}),
              ...(loginAccount?.rawAuth ? { rawAuth: loginAccount.rawAuth } : {}),
              domain: "www.codebuddy.ai",
              oauthState: deviceCode,
            },
          },
        };
      }

      if (!result.pending && result.error !== "authorization_pending" && result.error !== "slow_down") {
        if (result.error === "request_failed" && transientErrors < maxTransientErrors) {
          transientErrors += 1;
          onStep?.(
            "codebuddy_poll_retry",
            `CodeBuddy token poll failed temporarily (${transientErrors}/${maxTransientErrors}); retrying`
          );
          await wait(pollIntervalMs);
          continue;
        }
        throw new Error(result.errorDescription || result.error || "CodeBuddy OAuth polling failed");
      }

      await wait(pollIntervalMs);
    }

    throw new Error("Timed out waiting for CodeBuddy OAuth token");
  })();
}

const CODEBUDDY_DASHBOARD_URL = "https://www.codebuddy.ai/home";
const CODEBUDDY_COMPLETE_REGISTER_TIMEOUT_MS = 30_000;
const CODEBUDDY_COMPLETE_REGISTER_POLL_MS = 1_500;

async function completeCodeBuddyRegistration(page, onStep) {
  const reportStep = (step, message) => onStep?.(step, message);

  try {
    reportStep("navigating_to_dashboard", "Navigating to CodeBuddy to complete registration");
    await page.goto(CODEBUDDY_DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3_000);

    const startedAt = Date.now();
    let handledAnything = false;
    let loopCount = 0;

    while (Date.now() - startedAt < CODEBUDDY_COMPLETE_REGISTER_TIMEOUT_MS) {
      loopCount += 1;
      if (!isProviderPage(page)) break;

      const handledStarted = await handleCodeBuddyStartedAuthorization(page, reportStep);
      if (handledStarted) {
        handledAnything = true;
        await page.waitForTimeout(CODEBUDDY_COMPLETE_REGISTER_POLL_MS);
        continue;
      }

      const handledRegion = await handleCodeBuddyRegionPage(page, reportStep);
      if (handledRegion) {
        handledAnything = true;
        await page.waitForTimeout(CODEBUDDY_COMPLETE_REGISTER_POLL_MS);
        continue;
      }

      const handledOnboarding = await handleProviderOnboarding(page, reportStep, CODEBUDDY_LABEL);
      if (handledOnboarding) {
        handledAnything = true;
        await page.waitForTimeout(CODEBUDDY_COMPLETE_REGISTER_POLL_MS);
        continue;
      }

      // Nothing left to handle — page is stable
      break;
    }

    if (handledAnything) {
      reportStep("complete_register_done", "CodeBuddy registration completed, establishing session");
    }

    reportStep("codebuddy_registration_ready", "CodeBuddy registration flow is ready for API key creation");
  } catch (error) {
    reportStep("complete_register_skipped", `Could not complete registration: ${error.message}`);
  }
}

async function finalizeCodeBuddySuccess({ manager, job, account, context, page, tokens, email, createOptions = {} }) {
  let effectiveTokens = tokens || {};
  if (page && typeof page.evaluate === "function") {
    const regionResult = await submitCodeBuddyRegionProfile(page, (step, message) => {
      manager.setAccountStep(account, step, message);
      void manager.persistJobSnapshot(job, { forcePreview: false });
    });
    effectiveTokens = {
      ...effectiveTokens,
      providerSpecificData: {
        ...(effectiveTokens.providerSpecificData || {}),
        codebuddyRegionSubmitOk: regionResult.ok,
        codebuddyRegionSubmitCode: regionResult.code ?? null,
        codebuddyRegionSubmitMessage: regionResult.message || null,
      },
    };

    const trialResult = await ensureCodeBuddyTrialActivated(page, (step, message) => {
      manager.setAccountStep(account, step, message);
      void manager.persistJobSnapshot(job, { forcePreview: false });
    });
    if (!trialResult.ok) {
      const error = new Error(trialResult.message || "CodeBuddy IDE trial activation failed");
      error.step = "trial_not_activated";
      error.status = "trial_not_activated";
      throw error;
    }

    effectiveTokens = {
      ...effectiveTokens,
      providerSpecificData: {
        ...(effectiveTokens.providerSpecificData || {}),
        codebuddyTrialState: trialResult.state || null,
        codebuddyTrialCode: trialResult.code ?? null,
        codebuddyTrialMessage: trialResult.message || null,
      },
    };
  }

  manager.setAccountStep(account, "creating_codebuddy_api_key", "Generating CodeBuddy Access Key");
  await manager.persistJobSnapshot(job, { forcePreview: true });

  const existingApiKey = effectiveTokens.apiKey
    || effectiveTokens.generatedApiKey?.key
    || await manager.findExistingApiKey(email);

  const generatedApiKey = existingApiKey
    ? { skipped: true, key: existingApiKey }
    : await manager.createApiKey(page, email, (step, message) => {
      manager.setAccountStep(account, step, message);
      void manager.persistJobSnapshot(job, { forcePreview: false });
    }, {
      existingApiKey,
      ...createOptions,
    });

  manager.setAccountStep(account, "saving_connection", "Saving CodeBuddy connection with generated API key");
  await manager.persistJobSnapshot(job, { forcePreview: true });
  const tokensWithCookie = await attachCodeBuddyWebCookie(context, {
    ...effectiveTokens,
    ...(generatedApiKey?.skipped ? {} : { generatedApiKey }),
  });
  const { connection } = await manager.saveConnection({
    tokens: tokensWithCookie,
    email,
  });

  manager.finalizeAccount(account, "success", {
    connectionId: connection.id,
    step: "connection_saved",
    message: generatedApiKey?.skipped
      ? "CodeBuddy connection already has an API key"
      : "CodeBuddy connection saved with generated API key",
  });
  return { connection, generatedApiKey };
}

async function collectCodeBuddyOAuthTokensIfReady(successPromise, timeoutMs = 500) {
  if (!successPromise) return {};
  try {
    const result = await Promise.race([
      successPromise,
      wait(timeoutMs).then(() => null),
    ]);
    return result?.tokens || {};
  } catch {
    return {};
  }
}

async function finalizeRestrictedCodeBuddySession({
  manager,
  job,
  account,
  context,
  page,
  successPromise,
  reason,
}) {
  manager.setAccountStep(
    account,
    "restricted_key_replay",
    "Restricted page detected; replaying CodeBuddy Access Key creation from web session"
  );
  await manager.persistJobSnapshot(job, { forcePreview: true });

  const tokens = await collectCodeBuddyOAuthTokensIfReady(successPromise);
  const replayTokens = {
    ...tokens,
    providerSpecificData: {
      ...(tokens.providerSpecificData || {}),
      restrictedDetected: true,
      restrictedReason: reason || "Account restricted page detected during automation",
      oauthTokenCaptured: Boolean(tokens.accessToken),
    },
  };

  return finalizeCodeBuddySuccess({
    manager,
    job,
    account,
    context,
    page,
    tokens: replayTokens,
    email: account.email,
    createOptions: {
      directReplay: true,
      userEnterpriseId: CODEBUDDY_PERSONAL_ENTERPRISE_ID,
    },
  });
}

export class CodeBuddyBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher = defaultCodeBuddyBrowserLauncher,
    googleAutomation = runGoogleAccountAutomation,
    requestDeviceCodeFn = defaultRequestDeviceCode,
    pollToken = defaultPollForToken,
    saveConnection = defaultSaveCodeBuddyConnection,
    createApiKeyFn = createCodeBuddyApiKey,
    findExistingApiKeyFn = defaultFindExistingCodeBuddyApiKey,
    fetchLoginAccountFn = fetchCodeBuddyLoginAccount,
    pollIntervalMs = CODEBUDDY_POLL_INTERVAL_MS,
  } = {}) {
    super({
      browserLauncher,
      googleAutomation,
      storageName: "codebuddy-bulk-import",
    });
    this.requestDeviceCode = requestDeviceCodeFn;
    this.pollToken = pollToken;
    this.saveConnection = saveConnection;
    this.createApiKey = createApiKeyFn;
    this.findExistingApiKey = findExistingApiKeyFn;
    this.fetchLoginAccount = fetchLoginAccountFn;
    this.pollIntervalMs = pollIntervalMs;
  }

  async runManualFollowup(job, account, workerId, context, successPromise) {
    const followupPromise = (async () => {
      const closeManualResources = async () => {
        const ms = account.manualSession;
        const ctx = ms?.context || context;
        const headed = ms?.headedBrowser || null;
        if (ctx) await ctx.close().catch(() => null);
        if (headed) await headed.close().catch(() => null);
      };
      try {
        const result = await successPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        const manualPage = account.manualSession?.page;
        if (manualPage) {
          this.setAccountStep(account, "completing_registration", "Completing CodeBuddy registration");
          await this.persistJobSnapshot(job, { forcePreview: true });
          await completeCodeBuddyRegistration(manualPage, (step, message) => {
            this.setAccountStep(account, step, message);
            void this.persistJobSnapshot(job, { forcePreview: false });
          });
        }

        await finalizeCodeBuddySuccess({
          manager: this,
          job,
          account,
          context: account.manualSession?.context || context,
          page: manualPage || account.manualSession?.page,
          tokens: result.tokens,
          email: account.email,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
      } catch (error) {
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
        } else {
          this.finalizeAccount(account, error.status || "failed_exchange", {
            error: error.message || "Manual assist flow failed during token polling.",
            step: error.step || "exchange_failed",
            message: error.message || "Manual assist flow failed during token polling.",
          });
        }
        await this.persistJobSnapshot(job, { forcePreview: true });
      } finally {
        await closeManualResources();
        account.manualSession = null;
        account.runtimeSession = null;
        job.manualFollowups.delete(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: true });
      }
    })();

    job.manualFollowups.add(followupPromise);
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested || !browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const { context, page } = await createFreshContext(browser, CODEBUDDY_BROWSER_CONTEXT_OPTIONS);
    account.runtimeSession = { context, page, proxyUrl: browser.__ninerouterProxyUrl || job.proxyUrl || null };

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} is preparing a browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      this.setAccountStep(account, "requesting_codebuddy_state", "Requesting CodeBuddy OAuth state");
      const deviceData = await this.requestDeviceCode(CODEBUDDY_PROVIDER_ID);
      const authUrl = normalizeCodeBuddyAuthUrl(deviceData.verification_uri, deviceData.device_code);
      if (!authUrl || !deviceData.device_code) {
        throw new Error("CodeBuddy did not return an OAuth login URL");
      }

      const successPromise = createCodeBuddyPollPromise({
        deviceCode: deviceData.device_code,
        pollToken: this.pollToken,
        fetchLoginAccount: this.fetchLoginAccount,
        pollIntervalMs: this.pollIntervalMs,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });
      successPromise.catch(() => null);

      const automationResult = await this.googleAutomation({
        page,
        authUrl,
        email: account.email,
        password: account.password,
        successPromise,
        serviceLabel: CODEBUDDY_LABEL,
        openingStep: "opening_codebuddy_oauth",
        openingMessage: "Opening CodeBuddy OAuth page",
        successStep: "codebuddy_token_received",
        successMessage: "CodeBuddy OAuth token received",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        this.setAccountStep(account, "completing_registration", "Completing CodeBuddy registration");
        await this.persistJobSnapshot(job, { forcePreview: true });
        await completeCodeBuddyRegistration(page, (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        });

        const { connection } = await finalizeCodeBuddySuccess({
          manager: this,
          job,
          account,
          context,
          page,
          tokens: automationResult.tokens,
          email: account.email,
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      if (automationResult.status === "failed_restricted") {
        await finalizeRestrictedCodeBuddySession({
          manager: this,
          job,
          account,
          context,
          page,
          successPromise,
          reason: automationResult.error,
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      if (automationResult.status === "needs_manual") {
        account.manualSession = {
          context,
          page,
          opened: false,
          openedAt: null,
          proxyUrl: account.runtimeSession?.proxyUrl || browser.__ninerouterProxyUrl || job.proxyUrl || null,
        };
        this.setAccountStep(account, "awaiting_manual", "Waiting for manual completion in the browser session");
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
        await this.runManualFollowup(job, account, workerId, context, successPromise);
        return;
      }

      const terminalStatus = ["failed_invalid_credentials", "failed_exchange", "failed_timeout", "cancelled"].includes(automationResult.status)
        ? automationResult.status
        : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "CodeBuddy Google automation failed.",
        step: automationResult.step || terminalStatus,
        message: automationResult.error || "CodeBuddy Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: "Job cancelled while CodeBuddy automation was running",
        });
      } else {
        this.finalizeAccount(account, error.status || "failed", {
          error: error.message || "Unexpected CodeBuddy bulk import failure.",
          step: error.step || "failed",
          message: error.message || "Unexpected CodeBuddy bulk import failure.",
        });
      }
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__codeBuddyBulkImportSingleton) {
    globalThis.__codeBuddyBulkImportSingleton = {
      manager: new CodeBuddyBulkImportManager(),
    };
  }
  return globalThis.__codeBuddyBulkImportSingleton;
}

export function getCodeBuddyBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as CODEBUDDY_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as CODEBUDDY_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as CODEBUDDY_BULK_IMPORT_MIN_CONCURRENCY,
  parseKiroBulkAccounts as parseCodeBuddyBulkAccounts,
};
