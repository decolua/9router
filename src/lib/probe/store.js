/**
 * Persistence for real-request model capability probes.
 *
 * A full probe sweep costs one real upstream call per model per capability, so
 * results MUST outlive the modal that triggered them — otherwise closing the
 * picker throws away minutes of billed requests. Results are keyed by the fully
 * routed model id ("provider/model") and merged, never wholesale-replaced, so
 * probing one provider does not erase another provider's data.
 *
 * Fail-open like `@/lib/aa/store.js`: a corrupt or missing file reads as "no
 * probes yet" rather than throwing, because a broken snapshot must never take
 * the model picker down with it.
 */

import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir.js";

const PROBE_FILE = path.join(DATA_DIR, "model-probes.json");
const SCHEMA_VERSION = 1;

/** Probes older than this are surfaced as stale — providers change models often. */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Keep the file bounded; oldest probes are dropped first. */
const MAX_ENTRIES = 5000;

/**
 * @returns {{version:number, results:Object<string,Object>, updatedAt:string|null}}
 */
export function readProbes() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PROBE_FILE, "utf8"));
    const results = parsed?.results && typeof parsed.results === "object" ? parsed.results : {};
    return { version: parsed?.version || SCHEMA_VERSION, results, updatedAt: parsed?.updatedAt || null };
  } catch {
    return { version: SCHEMA_VERSION, results: {}, updatedAt: null };
  }
}

function writeProbes(results) {
  const payload = {
    version: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    results,
  };
  fs.mkdirSync(path.dirname(PROBE_FILE), { recursive: true });
  // Write-then-rename so a crash mid-write cannot leave a truncated file that
  // would read back as "no probes" and silently discard every prior result.
  const tmp = `${PROBE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  fs.renameSync(tmp, PROBE_FILE);
  return payload;
}

/** Drop the oldest entries once the map outgrows MAX_ENTRIES. */
function evictOldest(results) {
  const keys = Object.keys(results);
  if (keys.length <= MAX_ENTRIES) return results;
  const sorted = keys.sort(
    (a, b) => Date.parse(results[a]?.probedAt || 0) - Date.parse(results[b]?.probedAt || 0),
  );
  for (const key of sorted.slice(0, keys.length - MAX_ENTRIES)) delete results[key];
  return results;
}

/**
 * Merge a batch of probe results into the stored map.
 *
 * @param {Array<Object>} batch - probeModel() results
 * @returns {{count:number, updatedAt:string}}
 */
export function saveProbeResults(batch) {
  const list = Array.isArray(batch) ? batch.filter((r) => r && typeof r.model === "string") : [];
  if (list.length === 0) {
    const current = readProbes();
    return { count: Object.keys(current.results).length, updatedAt: current.updatedAt };
  }

  const { results } = readProbes();
  for (const entry of list) {
    results[entry.model] = {
      ok: !!entry.ok,
      status: entry.status ?? null,
      latencyMs: entry.latencyMs ?? null,
      error: entry.error ?? null,
      failureKind: entry.failureKind ?? null,
      capabilities: {
        chat: !!entry.capabilities?.chat,
        vision: !!entry.capabilities?.vision,
        tools: !!entry.capabilities?.tools,
        audioInput: !!entry.capabilities?.audioInput,
      },
      detail: entry.detail || null,
      probedAt: entry.probedAt || new Date().toISOString(),
    };
  }

  const written = writeProbes(evictOldest(results));
  return { count: Object.keys(written.results).length, updatedAt: written.updatedAt };
}

/** Remove specific models, or every stored probe when `models` is omitted. */
export function clearProbeResults(models) {
  if (!Array.isArray(models) || models.length === 0) {
    const written = writeProbes({});
    return { count: 0, updatedAt: written.updatedAt };
  }
  const { results } = readProbes();
  for (const model of models) delete results[model];
  const written = writeProbes(results);
  return { count: Object.keys(written.results).length, updatedAt: written.updatedAt };
}

export { PROBE_FILE };
