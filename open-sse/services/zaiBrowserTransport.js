// zaiBrowserTransport.js — browser-backed chat for Z.ai (chat.z.ai).
//
// Why this exists: chat.z.ai's v2 completion endpoint (`/api/v2/chat/completions`)
// requires a `captcha_verify_param` proof issued by Aliyun Captcha, bound to a
// real browser fingerprint/session. A plain HTTP request always gets a generic
// 500 "Internal Server Error" (verified live: guest and signed-API paths alike).
// The OmniRoute PR we ported solves this the same way — the browser is the
// DEFAULT transport and the signed HTTP path is only used when the caller
// supplies a proof.
//
// This module drives the real chat.z.ai page with playwright-core:
//   1. a shared browser (installed Chrome/Edge/Chromium; `channel` resolved at
//      launch), one persistent context per session token (localStorage.token),
//   2. per request: navigate fresh → pick the model (throws a clear error when
//      the account cannot select it, e.g. guests are limited to GLM-4.7) →
//      best-effort Deep Think / web-search / tools toggles → type the prompt →
//      click Send → capture the completion SSE body,
//   3. returns the captured upstream body so the executor can reuse its
//      existing SSE parsers (transformZaiStream / collectZaiContent).
//
// Configuration (all optional):
//   ER_ZAI_BROWSER_CHANNEL   e.g. "chrome" | "msedge" | "chromium" (default: auto-try)
//   ER_ZAI_BROWSER_HEADED=1  run visible so a human can solve an interactive CAPTCHA
//   ER_ZAI_BROWSER_TIMEOUT_MS  overall request cap (default 150s)

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { loadRuntimeDep } from "./lazyRuntime.js";

const _require = createRequire(import.meta.url);

// playwright-core is optional. The browser transport is only reached when Z.ai
// is called without a caller-supplied proof, so a host that never takes that
// path should not be forced to ship a browser driver. Resolved on first use
// instead of at import time, same graceful shape as utils/tlsClient.js.
let _chromium;
export async function getChromium() {
  if (_chromium) return _chromium;
  try {
    const mod = await loadRuntimeDep("playwright-core");
    _chromium = mod.chromium || mod.default?.chromium || mod;
    return _chromium;
  } catch {
    try {
      _chromium = _require("playwright-core").chromium || null;
    } catch {
      _chromium = null;
    }
  }
  if (!_chromium) {
    throw new Error(
      "playwright-core is not installed. Run `npm install playwright-core` and " +
        "have a Chrome or Edge channel available to use the Z.ai browser transport."
    );
  }
  return _chromium;
}

export function chromium() {
  if (!_chromium) {
    try {
      _chromium = _require("playwright-core").chromium || null;
    } catch {
      _chromium = null;
    }
  }
  if (!_chromium) {
    throw new Error(
      "playwright-core is not installed. Run `npm install playwright-core` and " +
        "have a Chrome or Edge channel available to use the Z.ai browser transport."
    );
  }
  return _chromium;
}

const ZAI_BASE_URL = "https://chat.z.ai";
const ZAI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const NAV_TIMEOUT_MS = 45000;
const MENU_TIMEOUT_MS = 8000;
const INPUT_TIMEOUT_MS = 15000;
const CAPTURE_TIMEOUT_MS = Number(process.env.ER_ZAI_BROWSER_TIMEOUT_MS) || 150000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024; // 16 MB OOM guard

// Installed-channel fallback order; `chromium.launch()` without a channel
// (playwright's own bundled browser) is tried afterwards.
const CHANNELS = process.env.ER_ZAI_BROWSER_CHANNEL
  ? [process.env.ER_ZAI_BROWSER_CHANNEL]
  : ["chrome", "msedge"];

let browserPromise = null;
let sharedBrowser = null;
const contextPool = new Map(); // tokenKey -> { context, page, busy }
const contextPromises = new Map(); // tokenKey -> in-flight Promise<entry> (single-flight guard)

// The pooled browser keeps the event loop alive (its child processes). Best-effort
// close on exit so standalone scripts / server restarts do not leak Chrome.
export async function shutdownZaiBrowser() {
  browserPromise = null;
  if (!sharedBrowser) return;
  const browser = sharedBrowser;
  sharedBrowser = null;
  try {
    await browser.close();
  } catch {
    /* already closed */
  }
  contextPool.clear();
  contextPromises.clear();
}

// Thrown when the chat.z.ai model picker cannot be driven to the requested
// model. zaiBrowserChat treats these as retryable (a fresh reload usually
// resolves the transient hydration state) UNLESS `disabled` is set — a model
// the account cannot use stays disabled after a reload, so retrying only wastes
// time.
class ZaiPickerError extends Error {
  constructor(message, { disabled = false } = {}) {
    super(message);
    this.name = "ZaiPickerError";
    this.disabled = disabled;
  }
}

process.once("exit", () => {
  if (sharedBrowser) {
    sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
});

function abortError() {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); }
    );
  });
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function tokenPoolKey(token) {
  return createHash("sha256").update(String(token || "")).digest("hex").slice(0, 24);
}

// Guest sessions (auto-created accounts, e.g. "guest-1786799164504@guest.com")
// are gated server-side: chat.z.ai only completes GLM-4.7 for them — every
// other model returns a generic HTTP 500, and the picker disables those items.
// Detect them so failures can point the user at the real fix (sign in).
export function isZaiGuestToken(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded?.role === "guest") return true;
    return typeof decoded?.email === "string" && /@guest\.com$/i.test(decoded.email);
  } catch {
    return false;
  }
}

// Human-readable hint appended to model-selection failures.
export function zaiGuestHint(token) {
  return isZaiGuestToken(token)
    ? "This is a guest session — chat.z.ai only allows GLM-4.7 for guests. Sign in at chat.z.ai and re-capture the token."
    : "Sign in to chat.z.ai (the model may require an account), or request a model this account can use.";
}

// Map an API model id to the display name shown in the picker.
export function browserModelName(modelId) {
  const trimmed = String(modelId || "").trim();
  const unprefixed = trimmed.split("/").at(-1) || trimmed;
  const lower = unprefixed.toLowerCase();
  if (lower === "glm-5.2") return "GLM-5.2";
  if (lower === "glm-5v-turbo") return "GLM-5V-Turbo";
  return unprefixed;
}

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const headless = process.env.ER_ZAI_BROWSER_HEADED !== "1";
    let lastError = null;
    const cr = await getChromium();
    for (const channel of CHANNELS) {
      try {
        const browser = await cr.launch({
          channel,
          headless,
          args: ["--no-first-run", "--disable-blink-features=AutomationControlled"],
        });
        sharedBrowser = browser;
        return browser;
      } catch (err) {
        lastError = err;
      }
    }
    // Fall back to playwright's own bundled chromium if any (rare installs).
    try {
      const browser = await cr.launch({ headless, args: ["--no-first-run"] });
      sharedBrowser = browser;
      return browser;
    } catch {
      /* keep the descriptive error below */
    }
    throw new Error(
      `no Chromium-based browser found (tried channels: ${CHANNELS.join(", ")}). ` +
        `Install Chrome or Edge, or set ER_ZAI_BROWSER_CHANNEL. ${lastError?.message || ""}`
    );
  })();
  try {
    return await browserPromise;
  } catch (err) {
    browserPromise = null;
    throw err;
  }
}

async function acquireContext(token) {
  const key = tokenPoolKey(token);
  const existing = contextPool.get(key);
  if (existing) return existing;

  // Single-flight: concurrent first requests for the same token must share ONE
  // context instead of each spinning up its own page (which made parallel
  // model tests interfere with each other on chat.z.ai).
  let promise = contextPromises.get(key);
  if (!promise) {
    promise = (async () => {
      const browser = await getBrowser();
      const context = await browser.newContext({
        userAgent: ZAI_USER_AGENT,
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        timezoneId: "UTC",
      });
      await context.addInitScript((tok) => {
        try { localStorage.setItem("token", tok); } catch { /* storage blocked */ }
      }, token);

      // Warm the page once so the session + risk fingerprint (Aliyun CAPTCHA
      // cookies like acw_tc / cdn_sec_tc) are established for the context.
      const page = await context.newPage();
      try {
        await page.goto(`${ZAI_BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
        await wait(2500);
      } catch {
        /* the per-request navigation retries anyway */
      }

      return { context, page, key, busy: Promise.resolve() };
    })();
    contextPromises.set(key, promise);
  }

  try {
    const entry = await promise;
    contextPool.set(key, entry);
    return entry;
  } finally {
    contextPromises.delete(key);
  }
}

function currentSelectionText(selector) {
  return selector.innerText().then((t) => String(t || "").trim()).catch(() => "");
}

// Does any visible picker menu show a signed-out/guest state (Sign in / Sign up
// footer buttons)? Used to produce actionable errors for non-guest tokens whose
// session silently dropped to a limited state.
async function pickerLooksSignedOut(page) {
  try {
    const count = await page
      .locator('[role="menu"] button:has-text("Sign in"), [role="menu"] button:has-text("Sign up")')
      .count();
    return count > 0;
  } catch {
    return false;
  }
}

// Build a precise picker-failure message: include the reason AND whether the
// menu indicates a signed-out/guest state (a real-account token whose session
// was logged out on chat.z.ai shows exactly the same limited picker as a guest).
async function pickerFailure(page, modelName, detail, hint) {
  let state = "";
  if (await pickerLooksSignedOut(page)) {
    state =
      " The picker shows a signed-out/guest state (Sign in / Sign up buttons) — the session token may be invalid, logged out, or the model may need a paid plan. Re-capture the token from chat.z.ai Local Storage while signed in.";
  }
  return `cannot select model "${modelName}" in the chat.z.ai picker (${detail}).${state} ${hint}`;
}

// Find the clickable element for a model inside an open picker menu. chat.z.ai
// renders items as <button>s; fall back to generic menu-item roles in case a
// future FE version switches markup.
async function findModelItem(menu, modelName) {
  const strategies = [
    menu.locator("button").filter({ hasText: modelName }),
    menu
      .locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]')
      .filter({ hasText: modelName }),
  ];
  for (const strategy of strategies) {
    const count = await strategy.count().catch(() => 0);
    if (count > 0) return strategy.first();
  }
  return null;
}

async function openModelPicker(page, signal) {
  const selector = page.locator('[aria-label="Select a model"]').first();
  await withAbort(selector.waitFor({ state: "visible", timeout: INPUT_TIMEOUT_MS }), signal);
  // Real pointer click first — the bits/radix dropdown listens to pointer
  // events; a synthetic el.click() does not always register. Fall back to it
  // in case the button is covered by a transient overlay.
  try {
    await withAbort(selector.click({ timeout: 5000 }), signal);
  } catch {
    await withAbort(selector.evaluate((el) => el.click()), signal);
  }
  await wait(700, signal);
}

// Pick the requested model in the dropdown. Returns true when the picker
// already shows the model. Throws ZaiPickerError with a precise, actionable
// message when the item is disabled (guests are limited to GLM-4.7), missing,
// or the selection does not stick.
async function selectModel(page, modelName, signal, hint) {
  const selector = page.locator('[aria-label="Select a model"]').first();
  await withAbort(selector.waitFor({ state: "visible", timeout: INPUT_TIMEOUT_MS }), signal);
  const current = await currentSelectionText(selector);
  if (current.toLowerCase().includes(modelName.toLowerCase())) return true;

  await openModelPicker(page, signal);
  const menu = page.locator('[role="menu"]').filter({ hasText: modelName }).first();
  await withAbort(menu.waitFor({ state: "visible", timeout: MENU_TIMEOUT_MS }), signal);

  const item = await findModelItem(menu, modelName);
  if (!item) {
    throw new ZaiPickerError(await pickerFailure(page, modelName, `model "${modelName}" is not listed in the picker menu`, hint));
  }
  await item.scrollIntoViewIfNeeded().catch(() => {});

  const enabled = await item.isEnabled().catch(() => true);
  if (!enabled) {
    throw new ZaiPickerError(
      await pickerFailure(page, modelName, `model "${modelName}" is disabled in the picker`, hint),
      { disabled: true }
    );
  }

  try {
    await withAbort(item.click({ timeout: MENU_TIMEOUT_MS }), signal);
  } catch (err) {
    const detail = String(err?.message || err).slice(0, 200);
    throw new ZaiPickerError(await pickerFailure(page, modelName, detail, hint));
  }
  await page.keyboard.press("Escape").catch(() => {});
  await wait(700, signal);
  const after = await currentSelectionText(selector);
  if (!after.toLowerCase().includes(modelName.toLowerCase())) {
    throw new ZaiPickerError(await pickerFailure(page, modelName, `selection did not stick (picker shows "${after || "unknown"}")`, hint));
  }
  return true;
}

// Best-effort UI toggles. Any failure is logged and ignored — the page
// defaults (Deep Think on, web search off) are acceptable fallbacks.
async function configureToggles(page, { thinking, vlm, capabilities, log }, signal) {
  const deepThinkSupported = Boolean(capabilities?.thinking);
  const webSearchSupported = Boolean(capabilities?.webSearch || capabilities?.vlmWebSearch);
  const toolsSupported = Boolean(capabilities?.vlmTools);

  // Deep Think toggle (data-autothink attribute on 1.1.84).
  try {
    if (deepThinkSupported) {
      const autothink = page.locator("button[data-autothink]").first();
      if (await autothink.count()) {
        const on = (await autothink.getAttribute("data-autothink")) === "true";
        if (on !== thinking.enabled) {
          await withAbort(autothink.click({ timeout: 5000 }), signal);
          await wait(400, signal);
        }
      }
    }
  } catch (err) {
    log?.warn?.("ZAI-WEB", `Deep Think toggle skipped: ${err?.message || err}`);
  }

  // Web search + Tools toggles (aria-label wrappers with data-selected buttons).
  const toggles = [];
  if (webSearchSupported) toggles.push(["Web search", vlm.webSearchEnabled]);
  if (toolsSupported) toggles.push(["Tools", vlm.toolsEnabled]);
  for (const [label, enabled] of toggles) {
    try {
      const wrapper = page.locator(`[aria-label^="${label} "]`).first();
      if (await wrapper.count()) {
        const button = wrapper.locator("button[data-selected]").first();
        if (await button.count()) {
          const on = (await button.getAttribute("data-selected")) === "true";
          if (on !== enabled) {
            await withAbort(button.click({ timeout: 5000 }), signal);
            await wait(400, signal);
          }
        }
      }
    } catch (err) {
      log?.warn?.("ZAI-WEB", `${label} toggle skipped: ${err?.message || err}`);
    }
  }
}

function looksLikeCaptchaOverlay(page) {
  return page
    .locator('iframe[src*="captcha"], iframe[src*="verify"], [id*="captcha"]')
    .first()
    .count()
    .then((n) => n > 0)
    .catch(() => false);
}

// chat.z.ai periodically shows full-screen onboarding/upgrade wizards ("Model
// Upgraded — GLM-5.2 Now Available", "New Editing & Template Saving Features
// Launched") that cover the composer and send button. Without dismissal, the
// send click times out (element covered) and the Enter fallback just activates
// the modal — the message is never sent, so captureCompletion's
// waitForResponse never resolves (observed live: 150s timeout, zero completion
// requests). Click through the wizard (Next / Got it / ...) until it is gone,
// with Escape as the fallback for dialogs whose dismissal button we can't
// match. Best-effort: any failure is logged and ignored.
async function dismissUpgradeModals(page, signal, log) {
  for (let i = 0; i < 6; i++) {
    const dialog = page
      .locator(
        '[role="dialog"]:has-text("Now Available"), [role="dialog"]:has-text("Upgraded"), [role="dialog"]:has-text("GLM-5.2"), [role="alertdialog"]'
      )
      .first();
    if (!(await dialog.count().catch(() => 0))) break;
    try {
      const next = dialog
        .locator('button:has-text("Next"), button:has-text("Got it"), button:has-text("Continue"), button:has-text("Confirm"), button:has-text("Skip"), button:has-text("Close"), button[aria-label="Close"]')
        .first();
      if (await next.count().catch(() => 0)) {
        await withAbort(next.click({ timeout: 4000 }), signal);
      } else {
        await withAbort(page.keyboard.press("Escape"), signal);
      }
    } catch (err) {
      log?.warn?.(`modal dismissal (step ${i + 1}) skipped: ${err?.message || err}`);
    }
    await wait(600, signal);
  }
}

async function captureCompletion(page, signal) {
  const responsePromise = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/v2/chat/completions"),
    { timeout: CAPTURE_TIMEOUT_MS }
  );
  const response = await withAbort(responsePromise, signal);
  await withAbort(
    Promise.race([
      response.finished().catch(() => {}),
      wait(CAPTURE_TIMEOUT_MS, signal).then(() => {}),
    ]),
    signal
  );
  const status = response.status();
  const contentType = response.headers()["content-type"] || null;
  let body = Buffer.alloc(0);
  try {
    body = Buffer.from(await response.body().catch(() => Buffer.alloc(0)));
  } catch { /* empty body */ }
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Z.ai response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  return { status, contentType, body };
}

/**
 * Drive one chat turn through the real chat.z.ai page.
 * Returns `{ ok: true, status, contentType, body }` for any upstream response
 * (including non-2xx — the executor classifies them), or `{ ok: false, error }`
 * for transport-level failures. Never throws for HTTP-level outcomes.
 */
// One full turn on the pooled page: navigate fresh, pick the model, best-effort
// toggles, send, capture. Returns { ok:false, error, retryable } where retryable
// marks picker failures (a fresh reload usually clears the transient state).
async function runTurn({ entry, token, modelId, prompt, thinking, vlm, capabilities, signal, log }) {
  const { page } = entry;
  try {
    await withAbort(page.goto(`${ZAI_BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }), signal);
    await wait(1800, signal);

    await dismissUpgradeModals(page, signal, log);

    if (await looksLikeCaptchaOverlay(page)) {
      const headlessHint =
        process.env.ER_ZAI_BROWSER_HEADED === "1"
          ? "solve the CAPTCHA in the opened browser window and retry."
          : "set ER_ZAI_BROWSER_HEADED=1, solve the CAPTCHA in the opened browser window, and retry.";
      return { ok: false, error: `chat.z.ai is showing a CAPTCHA challenge — ${headlessHint}` };
    }

    const modelName = browserModelName(modelId);
    await selectModel(page, modelName, signal, zaiGuestHint(token));
    await configureToggles(page, { thinking, vlm, capabilities, log }, signal);

    const input = page.locator("#chat-input");
    await withAbort(input.waitFor({ state: "visible", timeout: INPUT_TIMEOUT_MS }), signal);
    await withAbort(input.fill(prompt), signal);
    await wait(700, signal);

    const sendButton = page.locator("#send-message-button");
    let clicked = false;
    try {
      if ((await sendButton.count()) > 0 && (await sendButton.isEnabled().catch(() => false))) {
        await withAbort(sendButton.click({ timeout: 5000 }), signal);
        clicked = true;
      }
    } catch { /* fall back to Enter */ }
    if (!clicked) await withAbort(input.press("Enter"), signal);

    log?.info?.("ZAI-WEB", `browser sent (model=${modelName}, thinking=${thinking.enabled})`);
    return { ok: true, ...(await captureCompletion(page, signal)) };
  } catch (err) {
    if (err?.name === "AbortError") return { ok: false, error: "request aborted" };
    const message = err instanceof Error ? err.message : String(err);
    // Picker failures are transient (first paint before the composer hydrates);
    // the caller retries once with a fresh reload — observed live: the second
    // attempt succeeds.
    return { ok: false, error: message, retryable: err instanceof ZaiPickerError && !err.disabled };
  }
}

export async function zaiBrowserChat({ token, modelId, prompt, thinking, vlm, capabilities, signal, log }) {
  if (!token) return { ok: false, error: "missing session token" };
  const entry = await acquireContext(token);
  const run = entry.busy.then(async () => {
    const params = { entry, token, modelId, prompt, thinking, vlm, capabilities, signal, log };
    let result = await runTurn(params);
    if (!result.ok && result.retryable && !signal?.aborted) {
      log?.warn?.("ZAI-WEB", `model picker failed on first attempt — reloading and retrying once (${result.error})`);
      result = await runTurn(params);
    }
    return result;
  });
  // Keep the chain alive for the next caller; the error is consumed here.
  entry.busy = run.then(
    () => {},
    () => {}
  );
  return run;
}
