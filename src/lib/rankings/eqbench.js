/**
 * EQ-Bench source adapter.
 *
 * EQ-Bench publishes an Elo with an explicit confidence interval per model,
 * which is exactly what the draw rule needs: two models whose intervals overlap
 * were not separated by the board, so they are recorded as a draw rather than a
 * win off noise.
 *
 * The site ships its data as a JS assignment rather than JSON, so the object
 * literal is sliced out and parsed. That is brittle by nature, which is why a
 * parse failure returns empty and leaves the previous snapshot in place instead
 * of throwing.
 */

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const DATA_URL = "https://eqbench.com/eqbench4/eqbench4_data.js";
const FETCH_TIMEOUT_MS = 30000;

/**
 * Extract the object literal from `const EQBENCH4_DATA = {...};`.
 * @param {string} source
 * @returns {Object|null}
 */
export function parseEqBenchModule(source) {
  const text = String(source || "");
  const start = text.indexOf("{");
  if (start === -1) return null;
  const body = text.slice(start).trim().replace(/;\s*$/, "");
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Normalise the parsed payload into board entries.
 * @param {Object} data
 * @returns {{models: Array, count: number}}
 */
export function normalizeEqBench(data) {
  const list = Array.isArray(data?.models) ? data.models : [];
  const models = [];

  for (const entry of list) {
    const slug = entry?.slug || entry?.model;
    const score = Number(entry?.elo);
    if (!slug || !Number.isFinite(score)) continue;

    const ciLow = Number(entry?.ci_low);
    const ciHigh = Number(entry?.ci_high);

    models.push({
      slug,
      name: entry.display || slug,
      score,
      ...(Number.isFinite(ciLow) ? { ciLow } : {}),
      ...(Number.isFinite(ciHigh) ? { ciHigh } : {}),
      metrics: { eqBenchElo: score },
    });
  }

  return { models, count: models.length };
}

/**
 * Fetch the current EQ-Bench board.
 * @returns {Promise<{models: Array, count: number, error?: string}>}
 */
export async function fetchEqBench() {
  try {
    const response = await proxyAwareFetch(DATA_URL, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { models: [], count: 0, error: `HTTP ${response.status}` };

    const data = parseEqBenchModule(await response.text());
    if (!data) return { models: [], count: 0, error: "could not parse the data module" };

    const result = normalizeEqBench(data);
    return { ...result, generatedAt: data.generated_at || null };
  } catch (error) {
    return { models: [], count: 0, error: error?.message || String(error) };
  }
}

export { DATA_URL as EQBENCH_DATA_URL };
