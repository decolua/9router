/**
 * Persistence + refresh for the Artificial Analysis ranking snapshot.
 *
 * Fail-open by design: the leaderboard is a third-party page whose markup can
 * change without notice. A failed refresh keeps serving the previous snapshot
 * and reports staleness, so combo ordering never breaks because a scrape broke.
 */

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { parseAaLeaderboard } from "./parse.js";

export const AA_LEADERBOARD_URL = "https://artificialanalysis.ai/leaderboards/models";
const SNAPSHOT_FILE = path.join(DATA_DIR, "aa-rankings.json");
const FETCH_TIMEOUT_MS = 60000;
/** Snapshots older than this are surfaced as stale in the UI. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bumped whenever the parser starts capturing new fields.
 *
 * A snapshot written by an older parser lacks whatever was added since, and the
 * dimensions then report every model as unranked with no explanation — the data
 * is present, just not the metrics they score on. Comparing versions lets the UI
 * say "stale, re-sync" instead of looking broken.
 *
 * v2: per-benchmark scores (terminalBench40, scicode, hle, gpqa, lcr, …).
 */
const SNAPSHOT_SCHEMA_VERSION = 2;

/** Metrics a snapshot must carry for the dimension presets to score anything. */
const DIMENSION_METRICS = ["terminalBench40", "scicode", "hle", "gpqa", "lcr", "tauBanking"];

/** @returns {{models: Array, fetchedAt: string|null, count: number, stale: boolean}} */
export function readSnapshot() {
  try {
    const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const models = Array.isArray(parsed?.models) ? parsed.models : [];
    const fetchedAt = parsed?.fetchedAt || null;
    const age = fetchedAt ? Date.now() - new Date(fetchedAt).getTime() : Infinity;
    // Detected from the DATA, not just the version marker: a snapshot written
    // before the marker existed can still carry the metrics, and flagging it
    // would tell the user to re-sync data that is already current.
    const hasBenchmarks = models.some((m) => m && DIMENSION_METRICS.some((k) => typeof m[k] === "number"));
    const outdated = (parsed?.schemaVersion || 1) !== SNAPSHOT_SCHEMA_VERSION && !hasBenchmarks;
    return { models, fetchedAt, count: models.length, stale: age > STALE_AFTER_MS || outdated, outdated };
  } catch {
    return { models: [], fetchedAt: null, count: 0, stale: true };
  }
}

function writeSnapshot(models) {
  const payload = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fetchedAt: new Date().toISOString(),
    source: AA_LEADERBOARD_URL,
    models,
  };
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

async function fetchLeaderboardHtml() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await proxyAwareFetch(AA_LEADERBOARD_URL, {
      signal: controller.signal,
      headers: {
        // The page serves a bot-shaped body without a browser-ish UA.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) throw new Error(`leaderboard responded ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refresh the snapshot from the live leaderboard.
 *
 * Never throws: on any failure the previous snapshot stays in place and the
 * error is reported in the result.
 *
 * @returns {Promise<{ok: boolean, count: number, fetchedAt: string|null, error?: string, kept?: boolean}>}
 */
export async function refreshSnapshot() {
  const previous = readSnapshot();
  try {
    const html = await fetchLeaderboardHtml();
    const { models, count } = parseAaLeaderboard(html);

    if (count === 0) {
      return {
        ok: false,
        error: "leaderboard parsed to zero models — page structure likely changed",
        kept: previous.count > 0,
        count: previous.count,
        fetchedAt: previous.fetchedAt,
      };
    }

    // A large drop usually means a partial parse, not that models vanished.
    if (previous.count > 50 && count < previous.count * 0.5) {
      return {
        ok: false,
        error: `parsed only ${count} models vs ${previous.count} previously — keeping the older snapshot`,
        kept: true,
        count: previous.count,
        fetchedAt: previous.fetchedAt,
      };
    }

    const written = writeSnapshot(models);
    return { ok: true, count, fetchedAt: written.fetchedAt };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
      kept: previous.count > 0,
      count: previous.count,
      fetchedAt: previous.fetchedAt,
    };
  }
}

export { SNAPSHOT_FILE };
