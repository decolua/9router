/**
 * CB3 — combo-stats aggregation reads (docs/orchestration/DECISIONS.md D13).
 *
 * Why a dedicated SQL aggregate instead of `getUsageHistory({ includeFailures:
 * true })`: that API imposes NO row cap at all — its LIMIT question answers
 * "unbounded" — but it materializes EVERY row of the window (parsed tokens
 * JSON, meta JSON, masked apiKey) just so a caller can count them. Over 30d on
 * a busy gateway that is the same memory-pressure class CB2 was chasing when
 * it found the combo-recursion OOM. COUNT/SUM/GROUP BY do the counting inside
 * SQLite; only the grouped numbers cross the boundary. The window scan rides
 * the existing `idx_uh_ts` (timestamp DESC) index, same as the other bounded
 * reads in usageRepo.js.
 *
 * Contracts this module keeps:
 *  • Attribution is ONLY `meta.combo` (CB2). A row without it is never guessed
 *    into a combo — that is what the old name heuristic got wrong (RC1 Q1).
 *  • "Legacy" (the ONLY thing that may downgrade coverage to "partial") is an
 *    unattributed winner that PREDATES the attribution epoch — the first
 *    record in the whole DB whose meta carries a combo (REV-D NIT-1). An
 *    unattributed winner after that instant is legitimate direct traffic and
 *    says nothing about coverage.
 *  • A combo that lists ANOTHER COMBO as a member only ever sees the traffic
 *    its own direct members produce (nested wins are attributed to the inner
 *    combo) — REV-D NIT-2. The payload flags those combos by NAME
 *    (sources.nestedCombos + entry.nestedSubCombos) so the card can explain
 *    the shadowing; no number is ever fabricated for the outer combo.
 *  • Failure status rule = the SQL twin of `isFailureUsageStatus`
 *    (usageRepo.js, D13/CB2): `status LIKE 'error%'`. Success = everything
 *    else (NULL-safe: legacy "ok"/"success"/NULL all count as non-failure).
 *    The JS twin re-checks every failure line before it is reported as a
 *    member's last error, so a line the JS side would call success never
 *    surfaces as an error in the payload.
 *  • `attempts === 0` ⇒ rate is `null`, never a fabricated 0%/100%.
 *  • json_extract is guarded by json_valid() so a malformed legacy meta blob
 *    can never throw the whole window query (same extension already relied on
 *    by services/usage/alibabaTokenPlan.js).
 */
import { getAdapter } from "@/lib/db/driver.js";
import { isFailureUsageStatus } from "@/lib/db/repos/usageRepo.js";
import { getAllCircuitBreakerStatuses } from "open-sse/utils/circuitBreaker.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getCombos } from "@/lib/db/repos/combosRepo.js";

/** Accepted `?range=` values → window length. `24h` is the route default. */
export const RANGE_MS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

/**
 * `n/d` as a 4-decimal fraction, or null when there is no denominator.
 * null is the honest "—" the UI (CB4) must render — 0 from an empty window is
 * the fabricated number D13 forbids.
 */
export function rateOrNull(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/** ISO-bounded window for a range key. Callers must validate the key first. */
export function resolveWindow(range, now = Date.now()) {
  const ms = RANGE_MS[range];
  if (!ms) return null;
  return {
    range,
    from: new Date(now - ms).toISOString(),
    to: new Date(now).toISOString(),
  };
}

/** Combo-level totals entry. successRate is null exactly when attempts is 0. */
export function comboAggregate({ combo, window: win, attempts, successes, failures }) {
  return {
    combo,
    window: win,
    attempts,
    successes,
    failures,
    successRate: rateOrNull(successes, attempts),
  };
}

// ── SQL twins (kept next to each other on purpose) ──────────────────────────
const FAILURE_SQL = `(status LIKE 'error%')`;
const NOT_FAILURE_SQL = `(status IS NULL OR status NOT LIKE 'error%')`;
// lazy CASE branches: json_extract only ever runs on valid JSON
const META_FIELD = (field) => `(CASE WHEN json_valid(meta) THEN json_extract(meta, '$.${field}') END)`;

/**
 * One grouped pass over the window. Only lines whose meta carries a combo
 * contribute; per member we also keep the distinct connectionIds the attempts
 * actually ran on (live-state merge below resolves them).
 */
function fetchGroups(db, window) {
  return db.all(
    `SELECT combo, member, provider, model,
            COUNT(*) AS attempts,
            SUM(is_error) AS failures,
            COUNT(*) - SUM(is_error) AS successes,
            GROUP_CONCAT(connectionId, ',') AS connIds
     FROM (
       SELECT provider, model, connectionId,
              CASE WHEN ${FAILURE_SQL} THEN 1 ELSE 0 END AS is_error,
              ${META_FIELD("combo")} AS combo,
              ${META_FIELD("member")} AS member
       FROM usageHistory
       WHERE timestamp >= ? AND timestamp <= ?
     )
     WHERE combo IS NOT NULL
     GROUP BY combo, member, provider, model`,
    [window.from, window.to],
  );
}

/**
 * Latest error per combo|member (REV-D NIT-3). The CB3 draft pulled EVERY
 * failure row of the window newest-first just so assemble could keep the
 * first sighting per member — precisely the stream that explodes in an
 * outage across a 30d window. The ranking now runs inside SQLite:
 * ROW_NUMBER picks the newest id per (combo, member) and only those rows
 * cross the boundary. The LIMIT bounds the OUTPUT group count (distinct
 * combo|member pairs with failures — combo configs × members, typically a
 * few dozen); when the bound is reached the fetcher flags `truncated` so
 * the payload says so instead of lying by omission.
 */
const FAILURE_GROUPS_LIMIT = 5000;

function fetchFailureLines(db, window) {
  const rows = db.all(
    `SELECT combo, member, status, timestamp
     FROM (
       SELECT id, combo, member, status, timestamp,
              ROW_NUMBER() OVER (PARTITION BY combo, member ORDER BY id DESC) AS rn
       FROM (
         SELECT id, status, timestamp,
                ${META_FIELD("combo")} AS combo,
                ${META_FIELD("member")} AS member
         FROM usageHistory
         WHERE timestamp >= ? AND timestamp <= ? AND ${FAILURE_SQL}
       )
       WHERE combo IS NOT NULL
     )
     WHERE rn = 1
     ORDER BY timestamp DESC
     LIMIT ?`,
    [window.from, window.to, FAILURE_GROUPS_LIMIT],
  );
  return { lines: rows, truncated: rows.length >= FAILURE_GROUPS_LIMIT };
}

/**
 * Attribution epoch (REV-D NIT-1): the timestamp of the FIRST record in the
 * whole DB whose meta carries a combo — when attribution actually started on
 * THIS install, not a hardcoded deploy date. null (nothing attributed yet)
 * means there is no "pre-attribution" era to report. Rides idx_uh_ts
 * ascending and stops at the first match; USAGE_RETENTION_DAYS bounds the
 * walk on old installs.
 */
function fetchAttributionEpoch(db) {
  const row = db.get(
    `SELECT timestamp FROM usageHistory
     WHERE json_valid(meta) AND ${META_FIELD("combo")} IS NOT NULL
     ORDER BY timestamp ASC LIMIT 1`,
  );
  return row?.timestamp ?? null;
}

/**
 * REV-D NIT-2, pure half: outer combos whose member list references another
 * combo by NAME. Traffic through that member is attributed to the INNER combo
 * (CB2 nesting rule), so the outer card undercounts — the names are the
 * signal the card needs to explain it. Detection is config-only (no numbers).
 */
export function findNestedCombos(combos = []) {
  const names = new Set(combos.map((c) => (typeof c?.name === "string" && c.name ? c.name : null)).filter(Boolean));
  const out = [];
  for (const c of combos) {
    if (!c?.name || !Array.isArray(c.models)) continue;
    const subCombos = c.models.filter((m) => typeof m === "string" && names.has(m) && m !== c.name);
    if (subCombos.length > 0) out.push({ combo: c.name, subCombos });
  }
  return out;
}

/**
 * Winning lines in the window that carry NO combo attribution AND predate the
 * attribution epoch (REV-D NIT-1): the only honest "history we cannot count"
 * signal. Post-epoch unattributed winners are legit direct traffic and never
 * flip coverage; with no epoch in the DB there is no pre-attribution era at
 * all, so the fallback is 0 — never a guess.
 */
function countUnattributedWins(db, window, epoch) {
  if (!epoch) return 0;
  const row = db.get(
    `SELECT COUNT(*) AS n FROM usageHistory
     WHERE timestamp >= ? AND timestamp <= ?
       AND timestamp < ?
       AND ${NOT_FAILURE_SQL}
       AND (meta IS NULL OR json_valid(meta) = 0 OR ${META_FIELD("combo")} IS NULL)`,
    [window.from, window.to, epoch],
  );
  return row?.n ?? 0;
}

// ── live-state merge ─────────────────────────────────────────────────────────
// F24c's segment-boundary rule (open-sse/utils/circuitBreaker.js and the
// mirror in api/health/providers/route.js): breaker keys are
// `provider:connectionId:model` and only the FIRST two ":" are structural — a
// model id may itself contain one (`gemini-2.5-flash:free`). A member may run
// on several accounts, so every model-specific key for provider+model counts;
// the worst state wins (F24d's rule, as in the health matrix).
const BREAKER_SEVERITY = { CLOSED: 0, DEGRADED: 1, HALF_OPEN: 2, OPEN: 3 };

function breakerMatchesMember(name, provider, model) {
  if (typeof name !== "string" || !name) return false;
  const first = name.indexOf(":");
  if (first === -1) return false;
  if (name.slice(0, first) !== provider) return false;
  const second = name.indexOf(":", first + 1);
  if (second === -1) return false; // account-wide key: no model in it
  return name.slice(second + 1) === model;
}

function worstBreakerFor(breakers, provider, model) {
  let worst = null;
  for (const b of breakers) {
    if (!b || !breakerMatchesMember(b.name, provider, model)) continue;
    if (!worst || (BREAKER_SEVERITY[b.state] ?? 0) > (BREAKER_SEVERITY[worst.state] ?? 0)) worst = b;
  }
  if (!worst) return null;
  return {
    state: worst.state ?? null,
    failureCount: worst.failureCount ?? 0,
    retryAfterMs: worst.retryAfterMs ?? 0,
  };
}

function memberConnections(connIdsCsv, connectionsById) {
  if (typeof connIdsCsv !== "string" || !connIdsCsv) return [];
  const ids = [...new Set(connIdsCsv.split(",").filter(Boolean))].sort();
  return ids.map((id) => {
    const c = connectionsById.get(id);
    return { id, name: c?.name ?? null, testStatus: c?.testStatus ?? null };
  });
}

/**
 * Pure shaping step (exported so the null-rate contract is testable without a
 * DB). Groups come from fetchGroups(), latest errors from fetchFailureLines().
 */
export function assembleComboStats({
  window,
  groups = [],
  failureLines = [],
  failureLinesTruncated = false,
  legacyWinners = 0,
  attributionEpoch = null,
  nestedCombos = [],
  breakers = [],
  connections = [],
}) {
  const connectionsById = new Map();
  for (const c of connections) if (c?.id) connectionsById.set(c.id, c);
  const nestedByName = new Map(nestedCombos.map((n) => [n.combo, n.subCombos]));

  // fetchFailureLines already yields the NEWEST line per combo|member (SQL
  // ROW_NUMBER, NIT-3). The JS twin (isFailureUsageStatus, the CB2 contract)
  // stays the reporting authority: a line the JS side would call success
  // never surfaces as an error. Known conservative edge: if a member's
  // newest SQL-error row is one JS rejects (the theoretical "errorish"
  // split — no writer emits it today), the member shows no last error
  // rather than falling back to an older line. Under-report, never lie.
  const latestError = new Map();
  for (const line of failureLines) {
    if (!line?.combo || !isFailureUsageStatus(line.status)) continue;
    const key = `${line.combo}\u0000${line.member ?? ""}`;
    if (!latestError.has(key)) latestError.set(key, line);
  }

  const byCombo = new Map();
  for (const g of groups) {
    if (!g?.combo) continue;
    if (!byCombo.has(g.combo)) byCombo.set(g.combo, { totals: { attempts: 0, successes: 0, failures: 0 }, members: [] });
    const bucket = byCombo.get(g.combo);
    bucket.totals.attempts += Number(g.attempts) || 0;
    bucket.totals.successes += Number(g.successes) || 0;
    bucket.totals.failures += Number(g.failures) || 0;

    const memberKey = `${g.combo}\u0000${g.member ?? ""}`;
    const err = latestError.get(memberKey);
    const attempts = Number(g.attempts) || 0;
    const failures = Number(g.failures) || 0;
    bucket.members.push({
      member: g.member ?? null,
      provider: g.provider ?? null,
      model: g.model ?? null,
      attempts,
      successes: Number(g.successes) || 0,
      failures,
      failureRate: rateOrNull(failures, attempts),
      lastErrorStatus: err ? (err.status ?? null) : null,
      lastErrorAt: err ? (err.timestamp ?? null) : null,
      breaker: worstBreakerFor(breakers, g.provider, g.model),
      connections: memberConnections(g.connIds, connectionsById),
    });
  }

  const combos = [...byCombo.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([combo, { totals, members }]) => {
      const subCombos = nestedByName.get(combo);
      return {
        ...comboAggregate({ combo, window: window.range, ...totals }),
        members: members.sort((a, b) => (String(a.member) < String(b.member) ? -1 : 1)),
        // NIT-2: names only (zero new numbers) — the card explains that
        // traffic routed through a member-combo is counted on THAT card.
        ...(subCombos?.length ? { nestedSubCombos: subCombos } : {}),
      };
    });

  return {
    window,
    coverage: legacyWinners > 0 ? "partial" : "full",
    sources: {
      failuresRecorded: failureLines.length > 0,
      legacyWinnersWithoutCombo: legacyWinners,
      attributedRows: combos.reduce((s, c) => s + c.attempts, 0),
      truncated: Boolean(failureLinesTruncated),
      attributionEpoch: attributionEpoch ?? null,
      nestedCombos,
    },
    combos,
  };
}

/**
 * Read path used by GET /api/usage/combo-stats. Breaker/connection merges are
 * best-effort: a stats gap must never turn into a failed response (F12 pattern).
 */
export async function getComboStats(range) {
  const window = resolveWindow(range);
  if (!window) return null;
  const db = await getAdapter();
  const groups = fetchGroups(db, window);
  const { lines: failureLines, truncated } = fetchFailureLines(db, window);
  // NIT-1: "legacy" is defined against THIS install's attribution epoch, never
  // a fixed date — a row only predates attribution if attribution had begun.
  const attributionEpoch = fetchAttributionEpoch(db);
  const legacyWinners = countUnattributedWins(db, window, attributionEpoch);

  let breakers = [];
  try { breakers = getAllCircuitBreakerStatuses() || []; } catch { breakers = []; }
  let connections = [];
  try { connections = await getProviderConnections(); } catch { connections = []; }
  let nestedCombos = [];
  try { nestedCombos = findNestedCombos(await getCombos()); } catch { nestedCombos = []; }

  return assembleComboStats({
    window, groups, failureLines, failureLinesTruncated: truncated,
    legacyWinners, attributionEpoch, nestedCombos, breakers, connections,
  });
}
