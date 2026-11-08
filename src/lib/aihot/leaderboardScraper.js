import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { DATA_DIR } from "@/lib/dataDir.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const CACHE_FILE = path.join(DATA_DIR, "aihot-leaderboard-models.json");
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour cache by default
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const AIHOT_LEADERBOARD_BASE = "https://aihot.news/leaderboard";

export const AIHOT_BOARDS = [
  { url: "https://aihot.news/leaderboard", key: "general", label: "综合" },
  { url: "https://aihot.news/leaderboard/category/coding", key: "coding", label: "编程" },
  { url: "https://aihot.news/leaderboard/category/reasoning", key: "research", label: "科研" },
  { url: "https://aihot.news/leaderboard/category/professional", key: "office", label: "专业办公" },
  { url: "https://aihot.news/leaderboard/category/knowledge", key: "knowledge", label: "知识问答" },
];

/**
 * Solve EdgeOne / WAF JavaScript bot challenge if encountered.
 * Uses a sandboxed VM with no external permissions.
 *
 * @param {string} html
 * @returns {string|null} Cookie header value e.g. "__tst_status=...; EO_Bot_Ssid=..."
 */
function solveChallenge(html) {
  try {
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
    const code = scriptMatch ? scriptMatch[1] : html;
    if (!code || !code.includes("__tst_status")) return null;

    const cookies = {};
    const sandbox = {
      document: {
        set cookie(val) {
          if (!val) return;
          const [k, v] = val.split(";")[0].split("=");
          if (k) cookies[k.trim()] = v ? v.trim() : "";
        },
        querySelectorAll: () => [],
        documentElement: { setAttribute: () => {} },
      },
      location: { href: "", pathname: "/leaderboard", search: "" },
      history: { replaceState: () => {} },
      localStorage: { getItem: () => null },
      setTimeout: () => {},
      window: {},
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(code, context, { timeout: 2000 });

    const entries = Object.entries(cookies);
    if (entries.length === 0) return null;
    return entries.map(([k, v]) => `${k}=${v}`).join("; ");
  } catch {
    return null;
  }
}

/**
 * Fetch a URL with automatic EdgeOne challenge solving.
 */
async function fetchWithChallenge(url, sharedCookie = "", timeoutMs = 15000) {
  const fetcher = typeof proxyAwareFetch === "function" ? proxyAwareFetch : fetch;
  const headers = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };
  if (sharedCookie) headers.Cookie = sharedCookie;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res = await fetcher(url, { headers, signal: controller.signal });
    let text = await res.text();

    // If challenge was returned (small script setting __tst_status)
    if (text.length < 3000 && text.includes("__tst_status")) {
      const challengeCookie = solveChallenge(text);
      if (challengeCookie) {
        headers.Cookie = challengeCookie;
        res = await fetcher(url, { headers, signal: controller.signal });
        text = await res.text();
        return { text, cookie: challengeCookie, status: res.status, ok: res.ok };
      }
    }

    return { text, cookie: sharedCookie, status: res.status, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Clean model display names or text from HTML tags and metadata suffixes.
 */
function cleanModelName(raw) {
  if (!raw) return "";
  let name = String(raw).replace(/<[^>]*>/g, " ").trim();
  // Strip newline descriptions (e.g. "Qwen3.8 Max 0902\n编程评测还不到 3 类...")
  name = name.split(/\r?\n/)[0].trim();
  // Strip trailing notes like "目前只有一家评测机构..." or "编程评测还不到..."
  name = name.replace(/(?:目前只有一家评测机构|评测还不到|项评测)[\s\S]*/, "").trim();
  return name;
}

/**
 * Extract rows with scores from a board HTML page.
 */
function parseBoardRows(html, catKey) {
  const matches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  const results = [];

  for (const m of matches) {
    const row = m[1];
    const linkMatch = row.match(/href="\/leaderboard\/([^"?#\s>]+)(?:\?[^"]*)?"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    const slug = linkMatch[1];
    if (["rules", "sources", "category"].some((k) => slug.startsWith(k))) continue;

    const rawName = cleanModelName(linkMatch[2]);
    const textOnly = row.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

    let score = null;
    const scoreMatch = textOnly.match(/\s(\d{2}(?:\.\d)?)\s*(?:分|覆盖|$)/);
    if (scoreMatch) {
      score = parseFloat(scoreMatch[1]);
    } else {
      const anyNum = textOnly.match(/(\d{2}\.\d)/g);
      if (anyNum) score = parseFloat(anyNum[anyNum.length - 1]);
    }

    results.push({ slug, name: rawName || slug, score, catKey });
  }

  // Also check for any additional model links rendered on the page outside the main <tr>
  const allLinks = [...html.matchAll(/href="\/leaderboard\/([^"?#\s>]+)(?:\?[^"]*)?"[^>]*>([\s\S]*?)<\/a>/g)];
  for (const m of allLinks) {
    const slug = m[1];
    if (!slug || ["rules", "sources", "category"].some((k) => slug.startsWith(k))) continue;
    if (!results.some((r) => r.slug === slug)) {
      const rawName = cleanModelName(m[2]);
      const textChunk = html.slice(Math.max(0, m.index - 50), m.index + 200).replace(/<[^>]*>/g, " ");
      const scMatch = textChunk.match(/(\d{2}\.\d)/);
      const score = scMatch ? parseFloat(scMatch[1]) : null;
      results.push({ slug, name: rawName || slug, score, catKey });
    }
  }

  return results;
}

/**
 * Crawl only the main board and the 4 category sub-boards on aihot.news/leaderboard:
 * 1. 综合主榜 (/leaderboard)
 * 2. 编程子榜 (/leaderboard/category/coding)
 * 3. 科研子榜 (/leaderboard/category/reasoning)
 * 4. 专业办公子榜 (/leaderboard/category/professional)
 * 5. 知识问答子榜 (/leaderboard/category/knowledge)
 *
 * @returns {Promise<{models: Array, count: number, fetchedAt: string}>}
 */
export async function scrapeAihotLeaderboard(options = {}) {
  const { onProgress } = options;
  const catalog = new Map();
  let cookie = "";

  for (const b of AIHOT_BOARDS) {
    if (onProgress) onProgress(`Fetching ${b.label}...`);
    try {
      const res = await fetchWithChallenge(b.url, cookie);
      if (res.cookie) cookie = res.cookie;
      if (!res.ok) continue;

      const rows = parseBoardRows(res.text, b.key);
      for (const r of rows) {
        if (!catalog.has(r.slug)) {
          catalog.set(r.slug, {
            slug: r.slug,
            name: r.name || r.slug,
            scores: {},
            categories: [],
            rawAliases: new Set(),
          });
        }
        const entry = catalog.get(r.slug);
        if (r.name && (!entry.name || entry.name === entry.slug)) entry.name = r.name;
        if (!entry.categories.includes(b.key)) entry.categories.push(b.key);
        if (typeof r.score === "number") entry.scores[b.key] = r.score;
        if (r.name) entry.rawAliases.add(r.name);
      }
    } catch (err) {
      console.warn(`[aihot-scraper] error fetching ${b.label} (${b.url}):`, err.message);
    }
  }

  const models = Array.from(catalog.values()).map((e) => {
    // Determine a composite/overall score: prefer general score, then highest available score
    const scoreVals = Object.values(e.scores).filter((v) => typeof v === "number");
    const primaryScore = typeof e.scores.general === "number"
      ? e.scores.general
      : (scoreVals.length > 0 ? Math.max(...scoreVals) : null);

    return {
      slug: e.slug,
      name: e.name,
      score: primaryScore,
      scores: e.scores,
      categories: e.categories,
      rawAliases: Array.from(e.rawAliases),
    };
  });

  // Sort by general score descending
  models.sort((a, b) => (b.score || 0) - (a.score || 0));

  const payload = {
    fetchedAt: new Date().toISOString(),
    count: models.length,
    models,
  };

  // Persist to cache file
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    console.warn("[aihot-scraper] failed to write cache:", err.message);
  }

  return payload;
}

/**
 * Read cached leaderboard models if available.
 */
export function readCachedLeaderboardModels() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const content = fs.readFileSync(CACHE_FILE, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get leaderboard catalog with cache fallback.
 * Always attempts a fresh scrape when `force: true` or cache is older than `maxAgeMs`.
 * If network request fails, gracefully falls back to cached data.
 *
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - force network crawl
 * @param {number} [options.maxAgeMs] - max cache age (default 1h)
 * @param {Function} [options.onProgress]
 * @returns {Promise<{models: Array, count: number, fetchedAt: string, fromCache: boolean, stale?: boolean}>}
 */
export async function getAihotLeaderboardCatalog(options = {}) {
  const { force = false, maxAgeMs = DEFAULT_MAX_AGE_MS, onProgress } = options;
  const cached = readCachedLeaderboardModels();

  const isCacheFresh =
    cached &&
    cached.fetchedAt &&
    Date.now() - new Date(cached.fetchedAt).getTime() < maxAgeMs;

  if (!force && isCacheFresh && Array.isArray(cached.models) && cached.models.length > 0) {
    return { ...cached, fromCache: true };
  }

  try {
    const fresh = await scrapeAihotLeaderboard({ onProgress });
    if (fresh && fresh.count > 0) {
      return { ...fresh, fromCache: false };
    }
  } catch (err) {
    console.warn("[aihot-scraper] live scrape failed:", err.message);
  }

  // Fallback to cache if fresh fetch failed
  if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
    return { ...cached, fromCache: true, stale: true };
  }

  return {
    fetchedAt: null,
    count: 0,
    models: [],
    fromCache: false,
    error: "Failed to scrape leaderboard and no cache available",
  };
}
