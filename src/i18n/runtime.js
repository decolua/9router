"use client";

import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale, LOCALES } from "./config";

let translationMap = {};
let currentLocale = DEFAULT_LOCALE;
let reloadCallbacks = [];

// Detect browser language and map to a supported locale.
// Tries exact match first, then prefix (e.g. "en-GB" → "en"), falls back to "en".
function detectBrowserLocale() {
  if (typeof navigator === "undefined") return null;

  // navigator.language is the primary preference (e.g. "zh-CN", "en-US")
  const langs = [navigator.language];

  // navigator.languages lists all preferences in order (Chrome/Firefox)
  if (Array.isArray(navigator.languages) && navigator.languages.length) {
    langs.push(...navigator.languages);
  }

  for (const lang of [...new Set(langs)]) {
    const lower = lang.toLowerCase();

    // Exact match (case-insensitive)
    const matched = LOCALES.find(
      (l) => l.toLowerCase() === lower
    );
    if (matched) return matched;

    // zh-HK → zh-TW (Traditional Chinese)
    if (lower === "zh-hk" || lower === "zh-mo") return "zh-TW";

    // Prefix match: "en-GB" → "en", "fr-CA" → "fr"
    // Skip when prefix alone is "zh" (handled above for HK/MO)
    const prefix = lower.split("-")[0];
    if (prefix === "zh") continue;
    const prefixMatched = LOCALES.find(
      (l) => l.toLowerCase().split("-")[0] === prefix
    );
    if (prefixMatched) return prefixMatched;
  }

  return null;
}

// Set locale cookie via the existing /api/locale POST endpoint.
async function setLocaleCookie(locale) {
  if (typeof fetch === "undefined") return;
  try {
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
      credentials: "same-origin",
    });
  } catch {
    // Silently fail — translations still work in-memory for this session.
  }
}

// Read locale from cookie. If no cookie exists, auto-detect from browser language.
async function getLocaleAsync() {
  if (typeof document === "undefined") return DEFAULT_LOCALE;

  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));

  if (cookie) {
    const value = decodeURIComponent(cookie.split("=")[1]);
    return normalizeLocale(value);
  }

  // No cookie — detect from browser
  const detected = detectBrowserLocale();
  if (detected) {
    await setLocaleCookie(detected);
    return detected;
  }

  return DEFAULT_LOCALE;
}

// Sync version (for modules that can't await, e.g. translate() calls).
// Still used as fallback; initRuntimeI18n is the true entry point.
function getLocaleFromCookie() {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : DEFAULT_LOCALE;
  return normalizeLocale(value);
}

// Load translation map
async function loadTranslations(locale) {
  if (locale === "en") {
    translationMap = {};
    return;
  }
  
  try {
    const response = await fetch(`/i18n/literals/${locale}.json`);
    translationMap = await response.json();
  } catch (err) {
    console.error("Failed to load translations:", err);
    translationMap = {};
  }
}

// Translate text - exported for use in components
export function translate(text) {
  if (!text || typeof text !== "string") return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (currentLocale === "en") return text;
  return translationMap[trimmed] || text;
}

// Get current locale - exported for use in components
export function getCurrentLocale() {
  return currentLocale;
}

// Register callback for locale changes
export function onLocaleChange(callback) {
  reloadCallbacks.push(callback);
  return () => {
    reloadCallbacks = reloadCallbacks.filter(cb => cb !== callback);
  };
}

// Process text node
function processTextNode(node) {
  if (!node.nodeValue || !node.nodeValue.trim()) return;
  
  // Skip if parent is script, style, code, or structural elements
  const parent = node.parentElement;
  if (!parent) return;
  
  // Skip if parent or any ancestor has data-i18n-skip attribute
  let element = parent;
  while (element) {
    if (element.hasAttribute && element.hasAttribute('data-i18n-skip')) {
      return;
    }
    element = element.parentElement;
  }
  
  const tagName = parent.tagName?.toLowerCase();
  
  // Skip elements that don't allow text nodes
  const skipTags = [
    "script", "style", "code", "pre",
    "colgroup", "table", "thead", "tbody", "tfoot", "tr",
    "select", "datalist", "optgroup"
  ];
  
  if (skipTags.includes(tagName)) return;
  
  // Store original text if not already stored
  if (!node._originalText) {
    node._originalText = node.nodeValue;
  }
  
  // Use original text for translation
  const original = node._originalText;
  const translated = translate(original);
  
  // Only update if different to avoid unnecessary DOM mutations
  if (translated !== node.nodeValue) {
    node.nodeValue = translated;
  }
}

// Process all text nodes in element
function processElement(element) {
  if (!element) return;
  
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  const nodesToProcess = [];
  
  // Collect all nodes first to avoid live collection issues
  while ((node = walker.nextNode())) {
    nodesToProcess.push(node);
  }
  
  // Process collected nodes
  nodesToProcess.forEach(processTextNode);
}

// Initialize runtime i18n
// On first load (no cookie) this auto-detects browser language and sets the locale cookie.
export async function initRuntimeI18n() {
  if (typeof window === "undefined") return;

  // Auto-detect locale if no cookie exists (first visit)
  const hasCookie = typeof document !== "undefined" &&
    document.cookie.split(";").some((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));

  if (hasCookie) {
    currentLocale = getLocaleFromCookie();
  } else {
    currentLocale = await getLocaleAsync();
  }
  await loadTranslations(currentLocale);
  
  // Process existing DOM
  processElement(document.body);
  
  // Watch for new nodes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processElement(node);
        } else if (node.nodeType === Node.TEXT_NODE) {
          processTextNode(node);
        }
      });
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Reload translations when locale changes
export async function reloadTranslations() {
  currentLocale = getLocaleFromCookie();
  await loadTranslations(currentLocale);
  
  // Notify all registered callbacks
  reloadCallbacks.forEach(callback => callback());
  
  // Re-process entire DOM (will use stored original text)
  processElement(document.body);
}
