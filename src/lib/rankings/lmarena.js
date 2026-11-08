/**
 * LMArena source adapter.
 *
 * LMArena ranks by anonymous pairwise human preference, which covers something
 * no objective benchmark does: whether people actually prefer the answers. That
 * makes it a genuinely different axis rather than another re-run of the same
 * questions.
 *
 * The board is server-rendered, so the table can be read directly. Each score
 * carries a `±N` spread, which is used as a confidence interval — two models
 * whose intervals overlap were not separated by the board, so the consensus
 * records a draw instead of a win off noise.
 *
 * Two boards are published (text and webdev). Per the budget rules they split
 * their operator's 10% rather than each drawing a full share.
 */

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const BASE_URL = "https://lmarena.ai/leaderboard";
const FETCH_TIMEOUT_MS = 45000;

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Strip tags/entities and collapse whitespace. */
function textOf(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull the model slug out of a LMArena model cell.
 *
 * The cell is decorated with a vendor label and licence ("Anthropic
 * claude-opus-4-6-high Anthropic · Proprietary"), and the slug is the
 * lowercase hyphenated token. Requiring at least one separator avoids matching
 * the bare vendor words.
 */
export function slugFromModelCell(cell) {
  const text = textOf(cell);
  const match = text.match(/\b([a-z][a-z0-9]*(?:[.-][a-z0-9]+)+)\b/);
  return match ? match[1] : null;
}

/** "1525 ±9 Preliminary" -> 1525, plus the ±N interval when present. */
export function scoreFromCell(cell) {
  const text = textOf(cell);
  const score = parseFloat(text);
  if (!Number.isFinite(score)) return null;
  const spread = text.match(/±\s*(\d+(?:\.\d+)?)/);
  if (!spread) return { score };
  const delta = Number(spread[1]);
  return Number.isFinite(delta) ? { score, ciLow: score - delta, ciHigh: score + delta } : { score };
}

/**
 * Parse a LMArena leaderboard table.
 * @param {string} html
 * @returns {{models: Array, count: number}}
 */
export function parseLmArenaHtml(html) {
  const rows = String(html || "").split("<tr").slice(1).map((row) => row.split("</tr>")[0]);
  const models = [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => m[1]);
    if (cells.length < 4) continue;
    // Rank is the first cell; the header row and any layout row lack a numeric one.
    if (!/^\d+$/.test(textOf(cells[0]))) continue;

    const slug = slugFromModelCell(cells[2]);
    const parsed = scoreFromCell(cells[3]);
    if (!slug || !parsed) continue;

    models.push({ slug, name: slug, ...parsed });
  }

  return { models, count: models.length };
}

async function fetchBoard(path) {
  const response = await proxyAwareFetch(`${BASE_URL}/${path}`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return { models: [], error: `HTTP ${response.status}` };
  return parseLmArenaHtml(await response.text());
}

/**
 * Fetch both Arena boards.
 *
 * A board that fails simply contributes no comparisons; the other still counts.
 * @returns {Promise<{boards: Object<string,Array>, count: number, error?: string}>}
 */
export async function fetchLmArena() {
  const [text, webdev] = await Promise.all([
    fetchBoard("text").catch((error) => ({ models: [], error: error?.message || String(error) })),
    fetchBoard("webdev").catch((error) => ({ models: [], error: error?.message || String(error) })),
  ]);

  const boards = {};
  if (text.models?.length) boards["arena-text"] = text.models;
  if (webdev.models?.length) boards["arena-webdev"] = webdev.models;

  const count = Object.values(boards).reduce((sum, list) => sum + list.length, 0);
  return {
    boards,
    count,
    ...(count === 0 ? { error: text.error || webdev.error || "no rows parsed" } : {}),
  };
}

export { BASE_URL as LMARENA_BASE_URL };
