/**
 * Locale-aware cost formatting.
 * Uses Intl.NumberFormat with the user's locale to display costs.
 * Defaults to USD ($) but adapts to CNY (¥), EUR (€), etc.
 *
 * Issue #2976: Usage cost display should follow UI locale
 */

// Map of locale prefixes to currency codes for common non-USD locales
const LOCALE_CURRENCY_MAP = {
  "zh": "CNY",
  "ja": "JPY",
  "ko": "KRW",
  "pt-BR": "BRL",
  "pt-PT": "EUR",
  "es": "EUR",
  "de": "EUR",
  "fr": "EUR",
  "ru": "RUB",
  "pl": "PLN",
  "cs": "CZK",
  "nl": "EUR",
  "tr": "TRY",
  "uk": "UAH",
  "th": "THB",
  "hi": "INR",
  "bn": "BDT",
  "ar": "SAR",
  "he": "ILS",
};

/**
 * Get the currency code for a locale
 * @param {string} locale - Browser locale (e.g. "zh-CN", "pt-BR", "en")
 * @returns {string} Currency code (e.g. "CNY", "BRL", "USD")
 */
function getCurrencyForLocale(locale) {
  if (!locale) return "USD";
  // Check full locale first (e.g. "pt-BR"), then base language (e.g. "zh")
  const lang = locale.split("-")[0];
  return LOCALE_CURRENCY_MAP[locale] || LOCALE_CURRENCY_MAP[lang] || "USD";
}

// Cache the formatter for performance
let _cachedLocale = null;
let _cachedFormatter = null;

/**
 * Get a locale-aware currency formatter
 * @param {string} [locale] - Optional locale override; auto-detected if omitted
 * @returns {Intl.NumberFormat}
 */
function getCostFormatter(locale) {
  if (!locale && _cachedFormatter) return _cachedFormatter;

  const effectiveLocale = locale || (typeof navigator !== "undefined" ? navigator.language : "en");
  const currency = getCurrencyForLocale(effectiveLocale);

  const formatter = new Intl.NumberFormat(effectiveLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

  if (!locale) {
    _cachedLocale = effectiveLocale;
    _cachedFormatter = formatter;
  }

  return formatter;
}

/**
 * Format a cost value using the user's locale.
 *
 * @param {number|null|undefined} cost - Cost in dollars (or equivalent base unit)
 * @param {string} [locale] - Optional locale override (e.g. "zh-CN")
 * @returns {string} Formatted cost string (e.g. "$1.23", "¥1.23", "€1.23")
 */
export function fmtCost(cost, locale) {
  if (cost === null || cost === undefined || isNaN(cost)) {
    return getCostFormatter(locale).format(0);
  }
  return getCostFormatter(locale).format(cost);
}

/**
 * Legacy-compatible formatCost that returns a plain string.
 * Used by PricingModal and other components that need the old $ format
 * but can be upgraded to use fmtCost() for locale support.
 */
export { fmtCost as formatCost };
