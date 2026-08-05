// 成本显示按界面语言切换本地货币。
// 9Router 定价数据为 USD per million tokens，成本值本身是美元金额。
// 此工具按当前 locale 选择货币符号 + 汇率，让成本以本地货币展示。
//
// 汇率表（USD → 本地货币，近似值，可随行情调整）：
//   CNY ¥ ×7.2     TWD NT$ ×31.5    JPY ¥ ×155
//   KRW ₩ ×1350    VND ₫ ×25000
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";

const RATES = {
  "zh-CN": { sym: "¥", rate: 7.2 },
  "zh-TW": { sym: "NT$", rate: 31.5 },
  ja: { sym: "¥", rate: 155 },
  ko: { sym: "₩", rate: 1350 },
  vi: { sym: "₫", rate: 25000 },
};

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
}

/**
 * 把 USD 成本格式化为当前界面语言的本地货币。
 * @param {number} n  美元成本
 * @param {number} precision  小数位（默认 2）
 * @returns {string}  本地货币字符串（未匹配 locale 时回退 $）
 */
export function fmtCost(n, precision = 2) {
  const v = n || 0;
  const cur = RATES[normalizeLocale(getLocaleFromCookie())];
  if (!cur) return `$${v.toFixed(precision)}`;
  return `${cur.sym}${(v * cur.rate).toFixed(precision)}`;
}
