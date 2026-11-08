// Keeps the live DotHoosh catalog (lanes, wire format, limits, vision) fresh.
//
// Reads the two public listings from the worldwide mirror (no key; the Iran-hosted API is not
// reachable from outside Iran). Each listing keeps its last good copy on its own: a failed,
// empty, malformed or paginated answer never shrinks the table, and one listing failing never
// drops the other. Failures are swallowed on purpose: without a table the name-based family
// fallback in providers/models/helpers.js keeps deciding.

import { buildDotHooshLive, setDotHooshLive } from "open-sse/providers/models/dothooshLive.js";

const MIRROR = "https://www.dothoosh.com/gateway";
export const DOTHOOSH_OPENAI_LISTING = `${MIRROR}/v1/models`;
export const DOTHOOSH_ANTHROPIC_LISTING = `${MIRROR}/anthropic/v1/models`;

const FETCH_TIMEOUT_MS = 10 * 1000;
const STARTUP_DELAY_MS = 45 * 1000;
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;

let lastOpenAI = null;
let lastAnthropic = null;
let timer = null;

export function resetDotHooshSync() {
  lastOpenAI = null;
  lastAnthropic = null;
}

/** Rows with an id, or null when the answer is not a usable full listing. */
async function readListing(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    // Only part of the catalog: do not present it as the whole.
    if (body?.has_more === true) throw new Error("paginated listing");
    if (!Array.isArray(body?.data)) throw new Error("not a model listing");
    const rows = body.data.filter((row) => typeof row?.id === "string" && row.id.trim() !== "");
    // The public listing is never empty, so an empty or all-unusable one is an outage.
    if (rows.length === 0) throw new Error("no usable model entries");
    return rows;
  } catch (error) {
    console.warn(`[dothoosh] keeping the previous model data, ${url}: ${error.message}`);
    return null;
  }
}

/** Refresh the live table. Resolves to which listings were applied. */
export async function refreshDotHooshLive(fetchImpl = fetch) {
  const [openai, anthropic] = await Promise.all([
    readListing(fetchImpl, DOTHOOSH_OPENAI_LISTING),
    readListing(fetchImpl, DOTHOOSH_ANTHROPIC_LISTING),
  ]);
  if (openai) lastOpenAI = openai;
  if (anthropic) lastAnthropic = anthropic;
  if (lastOpenAI || lastAnthropic) {
    setDotHooshLive(buildDotHooshLive({ openai: lastOpenAI ?? [], anthropic: lastAnthropic ?? [] }));
  }
  return { openai: Boolean(openai), anthropic: Boolean(anthropic) };
}

export function startDotHooshSync() {
  if (timer) return;
  const run = () => refreshDotHooshLive().catch(() => {});
  setTimeout(run, STARTUP_DELAY_MS).unref?.();
  timer = setInterval(run, SYNC_INTERVAL_MS);
  timer.unref?.();
}
