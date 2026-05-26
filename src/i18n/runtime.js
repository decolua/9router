"use client";

import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "./config";

let translationMap = {};
let currentLocale = DEFAULT_LOCALE;
let reloadCallbacks = [];

// Read locale from cookie
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
function processTextNode(node, fromObserver = false) {
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

  // When the MutationObserver re-processes a text node that React has
  // already updated, the stored _originalText is stale. Detect this by
  // checking if _originalText differs from current nodeValue — if so,
  // React changed the content and the new nodeValue is the true original.
  if (node._originalText && node._originalText !== node.nodeValue) {
    node._originalText = node.nodeValue;
  } else if (!node._originalText) {
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
function processElement(element, fromObserver = false) {
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
  nodesToProcess.forEach((n) => processTextNode(n, fromObserver));
}

// Initialize runtime i18n
export async function initRuntimeI18n() {
  if (typeof window === "undefined") return;

  currentLocale = getLocaleFromCookie();
  await loadTranslations(currentLocale);

  // Wait for React hydration to complete before translating DOM.
  // Two requestAnimationFrame ticks ensure React has committed its work.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // Process existing DOM
  processElement(document.body);

  // Watch for new nodes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processElement(node, true);
        } else if (node.nodeType === Node.TEXT_NODE) {
          processTextNode(node, true);
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
