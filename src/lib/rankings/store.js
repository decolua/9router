/**
 * Multi-leaderboard snapshot store.
 *
 * Each source is fetched and persisted independently so one broken scrape never
 * takes the ranking down: a failed refresh keeps that source's previous
 * snapshot, and a source that has never been reachable simply contributes no
 * comparisons. That is not a degraded mode — it is the specified behaviour.
 * Vacant budget is never redistributed to the sources that did report, so an
 * unreachable board cannot inflate whoever happened to be up.
 */

import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { readSnapshot as readAaSnapshot, refreshSnapshot as refreshAaSnapshot } from "@/lib/aa/store";
import { fetchLiveBench } from "./livebench";
import { fetchEqBench } from "./eqbench";
import { fetchLmArena } from "./lmarena";
import { buildComposite } from "./composite";
import { SOURCE_GROUPS, listMetrics } from "./budget";

const SNAPSHOT_FILE = path.join(DATA_DIR, "leaderboards.json");
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fetchers for the sources reachable today. A group listed in budget.js without
 * a fetcher keeps its budget reserved and reports as unavailable — deliberately,
 * so the weighting never silently rescales itself around whatever happens to be
 * implemented.
 */
const FETCHERS = {
  livebench: fetchLiveBench,
  eqbench: fetchEqBench,
  lmarena: fetchLmArena,
};

function readFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : { sources: {} };
  } catch {
    return { sources: {} };
  }
}

function writeFile(payload) {
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  const tmp = `${SNAPSHOT_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  fs.renameSync(tmp, SNAPSHOT_FILE);
}

const isStale = (fetchedAt) => !(fetchedAt && Date.now() - Date.parse(fetchedAt) < STALE_AFTER_MS);

/** Per-source snapshot status, including AA's separately-managed store. */
export function readSourceStatus() {
  const file = readFile();
  const aa = readAaSnapshot();

  return Object.values(SOURCE_GROUPS).map((group) => {
    const base = {
      id: group.id,
      label: group.label,
      operator: group.operator,
      description: group.description,
      url: group.url,
      budget: group.budget,
      family: group.family,
      boards: group.metrics?.length || 1,
      implemented: group.id === "aa" || Boolean(FETCHERS[group.id]),
    };

    if (group.id === "aa") {
      return {
        ...base,
        count: aa.count,
        fetchedAt: aa.fetchedAt,
        stale: aa.stale,
        // Written by a parser that captured fewer metrics, so the dimensions
        // cannot score from it until a re-sync.
        ...(aa.outdated ? { outdated: true } : {}),
      };
    }

    const stored = file.sources?.[group.id];
    const storedCount = stored?.boards
      ? Object.values(stored.boards).reduce((sum, list) => sum + (list?.length || 0), 0)
      : stored?.models?.length || 0;
    return {
      ...base,
      count: storedCount,
      fetchedAt: stored?.fetchedAt || null,
      stale: isStale(stored?.fetchedAt),
      ...(stored?.date ? { date: stored.date } : {}),
    };
  });
}

/**
 * Assemble the per-metric boards the composite consumes.
 * Board ids must match budget.js metric ids so each carries its declared share.
 */
function collectBoards(enabledIds) {
  const file = readFile();
  const aa = readAaSnapshot();
  const enabled = Array.isArray(enabledIds) && enabledIds.length > 0 ? new Set(enabledIds) : null;
  const allow = (groupId) => !enabled || enabled.has(groupId);

  const boards = [];

  if (allow("aa") && aa.models?.length) {
    boards.push({
      id: "aa",
      models: aa.models.map((model) => ({
        slug: model.slug,
        name: model.name,
        creator: model.creator,
        openrouterApiId: model.openrouterApiId,
        score: model.intelligenceIndex,
        // Every metric the dimension presets may weight. AA is the only source
        // that publishes these per-benchmark scores, so they all ride on its
        // board and are carried through the merge untouched.
        metrics: {
          intelligenceIndex: model.intelligenceIndex,
          codingIndex: model.codingIndex,
          agenticIndex: model.agenticIndex,
          tau2: model.tau2,
          priceBlended: model.priceBlended,
          terminalBench40: model.terminalBench40,
          terminalbenchHard: model.terminalbenchHard,
          scicode: model.scicode,
          critpt: model.critpt,
          hle: model.hle,
          gpqa: model.gpqa,
          lcr: model.lcr,
          ifbench: model.ifbench,
          omniscience: model.omniscience,
          omniscienceNonHallucination: model.omniscienceNonHallucination,
          tauBanking: model.tauBanking,
          apexAgents: model.apexAgents,
          gdpvalNormalized: model.gdpvalNormalized,
          itbenchSre: model.itbenchSre,
          analystAgent: model.analystAgent,
          mmmuPro: model.mmmuPro,
        },
      })),
    });
  }

  for (const groupId of Object.keys(FETCHERS)) {
    if (!allow(groupId)) continue;
    const stored = file.sources?.[groupId];
    if (!stored) continue;

    if (stored.boards) {
      for (const [metricId, list] of Object.entries(stored.boards)) {
        if (list?.length) boards.push({ id: metricId, models: list });
      }
      continue;
    }
    if (stored.models?.length) boards.push({ id: groupId, models: stored.models });
  }

  return boards;
}

/**
 * Build the merged catalog from the stored snapshots.
 * @param {string[]|null} enabledIds - restrict to these source groups (null = all)
 */
export function readComposite(enabledIds = null) {
  return buildComposite(collectBoards(enabledIds));
}

/**
 * Refresh one or all sources. Never throws: each source reports its own outcome
 * and a failure leaves that source's previous snapshot in place.
 *
 * @param {string[]|null} ids
 * @returns {Promise<{results: Array}>}
 */
export async function refreshSources(ids = null) {
  const wanted =
    Array.isArray(ids) && ids.length > 0
      ? ids
      : ["aa", ...Object.keys(FETCHERS)];
  const results = [];

  for (const id of wanted) {
    const group = SOURCE_GROUPS[id];
    if (!group) {
      results.push({ id, ok: false, error: "Unknown source" });
      continue;
    }

    if (id === "aa") {
      const result = await refreshAaSnapshot();
      results.push({ id, label: group.label, ...result });
      continue;
    }

    const fetcher = FETCHERS[id];
    if (!fetcher) {
      results.push({
        id,
        label: group.label,
        ok: false,
        error: "No adapter yet — this source's budget stays reserved and unused",
        unimplemented: true,
      });
      continue;
    }

    try {
      const { models, boards, count, error, date, generatedAt } = await fetcher();
      if (!count) {
        const previous = readFile().sources?.[id];
        results.push({
          id,
          label: group.label,
          ok: false,
          error: error || "no rows parsed",
          kept: Boolean(previous?.models?.length),
          count: previous?.models?.length || 0,
        });
        continue;
      }
      const file = readFile();
      file.sources = file.sources || {};
      file.sources[id] = {
        fetchedAt: new Date().toISOString(),
        ...(date ? { date } : {}),
        ...(generatedAt ? { generatedAt } : {}),
        // A multi-board operator stores one list per metric so each can carry its
        // own share of the group's budget.
        ...(boards ? { boards } : { models }),
      };
      writeFile(file);
      results.push({ id, label: group.label, ok: true, count, ...(date ? { date } : {}) });
    } catch (error) {
      results.push({ id, label: group.label, ok: false, error: error?.message || String(error) });
    }
  }

  return { results };
}

export { SNAPSHOT_FILE, SOURCE_GROUPS, listMetrics };
