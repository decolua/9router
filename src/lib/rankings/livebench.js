/**
 * LiveBench source adapter.
 *
 * LiveBench publishes dated CSV snapshots (`table_YYYY_MM_DD.csv`) with one row
 * per model and one column per task, scored 0-100. It matters as a second
 * opinion because it is built to resist contamination and is scored
 * independently of Artificial Analysis — two leaderboards that disagree are the
 * whole point of a composite.
 *
 * There is no "latest" endpoint, so the publication date is discovered by
 * probing a descending list of candidates and taking the first that answers.
 */

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const BASE_URL = "https://livebench.ai";
const FETCH_TIMEOUT_MS = 30000;

/** Task columns grouped into the categories LiveBench reports. */
export const LIVEBENCH_CATEGORIES = {
  coding: ["code_completion", "code_generation", "python", "javascript", "typescript", "LCB_generation", "coding_completion"],
  reasoning: ["zebra_puzzle", "spatial", "theory_of_mind", "connections"],
  math: ["AMPS_Hard", "math_comp", "olympiad"],
  language: ["paraphrase", "summarize", "story_generation", "typos", "plot_unscrambling"],
  data: ["tablejoin", "tablereformat", "simplify", "cta"],
};

/**
 * Split one CSV line, honouring quoted fields.
 * Model names can contain commas, so naive splitting shifts every later column.
 */
export function splitCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field);
  return out;
}

/**
 * Parse a LiveBench CSV into per-model records.
 *
 * The overall score is the mean of whatever task columns the row actually has,
 * matching LiveBench's own global-average presentation. Rows are not dropped for
 * missing columns — the table gains and loses tasks between releases.
 *
 * @param {string} csv
 * @returns {{models: Array, count: number}}
 */
export function parseLiveBenchCsv(csv) {
  const lines = String(csv || "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { models: [], count: 0 };

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const modelCol = header.findIndex((h) => h.toLowerCase() === "model");
  if (modelCol === -1) return { models: [], count: 0 };

  const models = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const name = (cells[modelCol] || "").trim();
    if (!name) continue;

    const scores = {};
    const values = [];
    for (let i = 0; i < header.length; i += 1) {
      if (i === modelCol) continue;
      // An empty cell means "not evaluated", not zero — Number("") is 0, and
      // scoring a blank as zero would sink the model to last place on a task it
      // was never run on.
      const raw = (cells[i] ?? "").trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      scores[header[i]] = value;
      values.push(value);
    }
    if (values.length === 0) continue;

    const categories = {};
    for (const [category, columns] of Object.entries(LIVEBENCH_CATEGORIES)) {
      const present = columns.map((c) => scores[c]).filter((v) => Number.isFinite(v));
      if (present.length > 0) {
        categories[category] = present.reduce((sum, v) => sum + v, 0) / present.length;
      }
    }

    models.push({
      slug: name,
      name,
      score: values.reduce((sum, v) => sum + v, 0) / values.length,
      categories,
      taskCount: values.length,
      // Per-category scores as rankable metrics: the dimension presets weight a
      // model's LiveBench coding separately from its maths, which the single
      // overall average cannot express.
      metrics: {
        liveBenchScore: values.reduce((sum, v) => sum + v, 0) / values.length,
        liveBenchCoding: categories.coding,
        liveBenchReasoning: categories.reasoning,
        liveBenchMath: categories.math,
        liveBenchLanguage: categories.language,
        liveBenchData: categories.data,
      },
    });
  }

  return { models, count: models.length };
}

/**
 * Candidate publication dates, newest first.
 *
 * LiveBench publishes on the 25th, so we walk back month by month from `from`.
 * Bounded at 24 months: older than that and the snapshot is not worth ranking on.
 */
export function candidateDates(from = new Date(), months = 24) {
  const out = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let i = 0; i < months; i += 1) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    out.push(`${year}_${month}_25`);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return out;
}

/**
 * Fetch the most recent LiveBench table.
 * @returns {Promise<{models: Array, count: number, date: string|null, error?: string}>}
 */
export async function fetchLiveBench({ now = new Date() } = {}) {
  let lastError = "no table found";
  for (const date of candidateDates(now)) {
    try {
      const response = await proxyAwareFetch(`${BASE_URL}/table_${date}.csv`, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv,*/*" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const { models, count } = parseLiveBenchCsv(await response.text());
      if (count > 0) return { models, count, date };
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }
  return { models: [], count: 0, date: null, error: lastError };
}

export { BASE_URL as LIVEBENCH_BASE_URL };
