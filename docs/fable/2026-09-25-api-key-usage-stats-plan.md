# API Key Usage Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give 9Router a sidebar menu for per-API-key usage, with a per-key time-series chart and CSV export, and stop `/api/usage/stats` from returning raw API keys as JSON property names.

**Architecture:** The per-key table already exists (`src/shared/components/UsageStats.js:385-407`) and is reused, not rebuilt — `UsageStats.js` grows named exports and the new page imports them. Two things are new: `apiKeyUsageRepo.js`, which buckets `usageHistory` (hourly) or `usageDaily` (daily) per key, and `GET /api/usage/api-keys`, which serves that plus CSV. One shared `apiKeyBucketId()` is the single definition of a key's bucket identity, imported by both the new repo and the re-keyed `getUsageStats`.

**Tech Stack:** Next.js (App Router, plain ESM JavaScript — no TypeScript), SQLite via `src/lib/db/driver.js`, recharts ^3.7.0, vitest (in `tests/`, an independent package), Tailwind.

## Global Constraints

- Plain JavaScript (ESM). No TypeScript. `@/*` → `src/*` (`jsconfig.json`).
- Files: 200-400 lines typical, 800 max. `usageRepo.js` is already at 808 — add nothing to it beyond the re-key edits in Task 2.
- Never mutate: build new objects rather than editing in place.
- Conventional Commits (`feat(usage): …`, `fix(usage): …`).
- Commit messages end with: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Tests run from `tests/`: `cd tests && npx vitest run <file>`. Root `npm install` must have been done first.
- The suite is **not** green on a plain checkout (~109 failures on this Windows checkout). Never judge by a raw count.
- **`tests/__baseline__/verify-no-regression.mjs` does not work here.** Line 17 is
  `f.name.split("/app/")[1]` — it assumes the container's `/app/` prefix, which no
  path on a Windows checkout has, so every failure is misreported as a regression.
  Verified 2026-09-25. Instead, do a controlled before/after:

  ```bash
  cd tests && npx vitest run --reporter=json > /tmp/after.json
  cd .. && git stash push -- <the files you changed>
  cd tests && npx vitest run --reporter=json > /tmp/before.json
  cd .. && git stash pop
  # then diff the two failure sets — the requirement is an identical set,
  # not an identical count
  ```
- Storage is never re-keyed: `usageDaily.data.byApiKey` keeps its raw composite key. Only HTTP responses change.
- Spec: `docs/fable/2026-09-25-api-key-usage-stats-design.md`.

---

### Task 1: `apiKeyBucketId` — one definition of a key's bucket identity

**Files:**
- Create: `src/lib/db/repos/apiKeyUsageRepo.js`
- Test: `tests/unit/api-key-usage-bucket-id.test.js`

**Interfaces:**
- Consumes: `maskApiKey` behaviour from `usageRepo.js:6-10` (re-implemented locally; it is not exported there).
- Produces: `apiKeyBucketId(rawKey, apiKeyMap)` → `string`. `apiKeyMap` is `{ [rawKey]: { name, id, createdAt } }`, exactly what `usageRepo.js:368` builds. Task 2 and Task 3 both import this.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api-key-usage-bucket-id.test.js`:

```js
import { describe, it, expect } from "vitest";
import { apiKeyBucketId, maskApiKey } from "@/lib/db/repos/apiKeyUsageRepo.js";

/**
 * The bucket id is what the chart colours by and what the table's re-keyed
 * response is keyed on. If the two derived it differently they would drift, so
 * there is one function and both call it.
 */
describe("apiKeyBucketId", () => {
  const map = { "sk-9router-abcdefgh-xyz": { name: "hermes", id: "key-1" } };

  it("uses the key's id when the key still exists", () => {
    expect(apiKeyBucketId("sk-9router-abcdefgh-xyz", map)).toBe("key-1");
  });

  it("falls back to the masked form for a key that was deleted", () => {
    // deleteApiKey hard-deletes the row, so a past request's key has no record
    // to join against. The masked form is all that is left — and it must never
    // be the raw key.
    const id = apiKeyBucketId("sk-9router-deleted-999", map);
    expect(id).toBe("sk-9rout***");
    expect(id).not.toContain("deleted-999");
  });

  it("buckets keyless traffic under one well-known id", () => {
    expect(apiKeyBucketId(null, map)).toBe("local-no-key");
    expect(apiKeyBucketId("", map)).toBe("local-no-key");
    expect(apiKeyBucketId(undefined, {})).toBe("local-no-key");
  });

  it("masks short keys without revealing them whole", () => {
    expect(maskApiKey("abc")).toBe("a***");
    expect(maskApiKey("")).toBeNull();
    expect(maskApiKey(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/api-key-usage-bucket-id.test.js`
Expected: FAIL — cannot resolve `@/lib/db/repos/apiKeyUsageRepo.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/db/repos/apiKeyUsageRepo.js`:

```js
/**
 * Per-API-key usage, for the API Key Usage page.
 *
 * usageRepo.js already aggregates per key for the table; this file adds the
 * time series that table has never had, and owns the one definition of a key's
 * bucket identity so the chart and the table cannot key differently.
 *
 * Kept out of usageRepo.js deliberately: that file is at its 800-line ceiling.
 */

/**
 * The displayable stand-in for a key. Deliberately a second copy of the rule
 * usageRepo.js:6-10 applies privately, not an import of it: usageRepo imports
 * apiKeyBucketId from this file, so importing maskApiKey back out of usageRepo
 * would close a cycle between the two modules. Eleven lines of duplication
 * beats a circular import that works until the load order changes.
 *
 * If the two ever have to diverge, that is the bug — they describe one rule.
 */
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

/**
 * Which bucket a raw key belongs to.
 *
 * Never the raw key itself: this value becomes a JSON property name in the
 * /api/usage/stats response and a series key in /api/usage/api-keys, both of
 * which reach the browser.
 *
 * @param {string|null|undefined} rawKey  the key as stored in usageHistory
 * @param {Record<string, {name: string, id: string}>} apiKeyMap  rawKey → record
 * @returns {string}
 */
export function apiKeyBucketId(rawKey, apiKeyMap) {
  if (!rawKey) return "local-no-key";
  return (apiKeyMap || {})[rawKey]?.id || maskApiKey(rawKey) || "local-no-key";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/api-key-usage-bucket-id.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/repos/apiKeyUsageRepo.js tests/unit/api-key-usage-bucket-id.test.js
git commit -m "feat(usage): add apiKeyBucketId, one identity for per-key buckets

Both the re-keyed stats response and the new chart series key on a key's
bucket id. One function so they cannot drift, and never the raw key, which
reaches the browser in both.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Stop `/api/usage/stats` returning raw API keys

**Files:**
- Modify: `src/lib/db/repos/usageRepo.js:503-521` (daily path) and `:638-652` (`period=all` path)
- Test: `tests/unit/usage-stats-no-raw-keys.test.js`

**Interfaces:**
- Consumes: `apiKeyBucketId(rawKey, apiKeyMap)` from Task 1.
- Produces: `getUsageStats(period).byApiKey` keyed `${bucketId}|${model}|${rawProvider}`. Values are unchanged — still `{ requests, promptTokens, completionTokens, cachedTokens, cost, rawModel, provider, apiKeyMasked, keyName, apiKeyKey, lastUsed }`. Task 4 relies on the values, not the property name.

**Background the implementer needs:** `usageDaily.data.byApiKey` stores its buckets under `${rawKey}|${model}|${provider}` (written at `usageRepo.js:92`). That storage is **not** changed — days already accumulated use it, and re-keying the store would orphan them. Only the value returned from `getUsageStats` is re-keyed.

The existing consumer (`UsageStats.js:388`) is unaffected: `sortData` uses the property name only for `pendingMap[key]`, and the API-key view passes `{}`; grouping reads `item.keyName`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/usage-stats-no-raw-keys.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const daily = [];
const history = [];

// routed-usage.test.js is the pattern: swap the adapter, no real SQLite.
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    all: (sql) => (sql.includes("usageDaily") ? daily : history),
    get: () => null,
    run: () => ({ changes: 0 }),
    transaction: (fn) => fn(),
  }),
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeys: async () => [{ id: "key-1", key: "sk-9router-abcdefgh-live", name: "hermes" }],
}));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({ getProviderConnections: async () => [] }));
vi.mock("@/lib/db/repos/nodesRepo.js", () => ({ getProviderNodes: async () => [] }));

const { getUsageStats } = await import("@/lib/db/repos/usageRepo.js");

beforeEach(() => { daily.length = 0; history.length = 0; });

const LIVE = "sk-9router-abcdefgh-live";
const GONE = "sk-9router-zzzzzzzz-gone";

function day(dateKey, byApiKey) {
  return { dateKey, data: JSON.stringify({ requests: 1, promptTokens: 0, completionTokens: 0, cost: 0, byProvider: {}, byModel: {}, byAccount: {}, byApiKey, byEndpoint: {} }) };
}

function bucket(apiKey) {
  return { requests: 2, promptTokens: 100, completionTokens: 50, cachedTokens: 10, cost: 0.5, rawModel: "claude-cli-opus-1m", provider: "claude-cli", apiKey };
}

describe("getUsageStats byApiKey keying", () => {
  it("never puts a raw API key in a property name", async () => {
    daily.push(day("2026-09-25", {
      [`${LIVE}|claude-cli-opus-1m|claude-cli`]: bucket(LIVE),
      [`${GONE}|claude-cli-opus-1m|claude-cli`]: bucket(GONE),
      [`local-no-key|claude-cli-haiku|claude-cli`]: bucket(null),
    }));

    const stats = await getUsageStats("7d");
    const names = Object.keys(stats.byApiKey);

    expect(names.length).toBe(3);
    for (const name of names) {
      expect(name, `"${name}" leaks a raw key`).not.toContain(LIVE);
      expect(name, `"${name}" leaks a raw key`).not.toContain(GONE);
    }
    expect(names).toContain("key-1|claude-cli-opus-1m|claude-cli");
    expect(names).toContain("sk-9rout***|claude-cli-opus-1m|claude-cli");
    expect(names).toContain("local-no-key|claude-cli-haiku|claude-cli");
  });

  it("keeps the values the table renders", async () => {
    daily.push(day("2026-09-25", { [`${LIVE}|claude-cli-opus-1m|claude-cli`]: bucket(LIVE) }));

    const stats = await getUsageStats("7d");
    const row = stats.byApiKey["key-1|claude-cli-opus-1m|claude-cli"];
    expect(row).toMatchObject({
      requests: 2, promptTokens: 100, completionTokens: 50, cachedTokens: 10,
      keyName: "hermes", rawModel: "claude-cli-opus-1m",
    });
    expect(row.apiKeyMasked).toBe("sk-9rout***");
  });

  it("keeps two providers with one display name apart", async () => {
    // The composite must use the raw provider id. Display names are not unique.
    daily.push(day("2026-09-25", {
      [`${LIVE}|m|prov-a`]: { ...bucket(LIVE), provider: "prov-a" },
      [`${LIVE}|m|prov-b`]: { ...bucket(LIVE), provider: "prov-b" },
    }));

    const stats = await getUsageStats("7d");
    expect(Object.keys(stats.byApiKey).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/usage-stats-no-raw-keys.test.js`
Expected: FAIL — the first test finds property names containing `sk-9router-abcdefgh-live`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/db/repos/usageRepo.js`, add the import beside the existing ones at the top of the file:

```js
import { apiKeyBucketId } from "./apiKeyUsageRepo.js";
```

Then in the daily loop (currently `:503-521`), replace the loop header and the
`stats.byApiKey[akKey]` references. The loop currently opens:

```js
      for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
        const rawModel = ak.rawModel || "";
        const provider = ak.provider || "";
```

Change it to derive a response key and use that throughout the loop body:

```js
      for (const [, ak] of Object.entries(day.byApiKey || {})) {
        const rawModel = ak.rawModel || "";
        const provider = ak.provider || "";
        // The stored composite carries the raw API key (see :92). It stays in
        // SQLite — re-keying the store would orphan every day already
        // accumulated — but it must not become a property name in the
        // response, which reaches the browser. Built from the raw provider,
        // never providerDisplayName: display names are not unique.
        const akKey = `${apiKeyBucketId(ak.apiKey, apiKeyMap)}|${rawModel}|${provider}`;
```

Leave the rest of the loop body exactly as it is — every later line already
refers to `akKey` and now gets the safe one.

Apply the identical change to the `period=all` loop (currently `:638-652`),
whose bucket fields come from a history row rather than a day blob:

```js
        const akKey = `${apiKeyBucketId(r.apiKey, apiKeyMap)}|${r.model}|${r.provider || ""}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/usage-stats-no-raw-keys.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Check `:567`, which the spec flags**

`usageRepo.js:567` reads `stats.byApiKey[apiKeyKey]` where `apiKeyKey` is the
masked form, but entries are keyed on a composite — so it has never matched.
Read the surrounding block, decide whether it was meant to update `lastUsed` for
a whole key or for one key/model pair, and either fix it to iterate the matching
composites or leave it. **Do not change it incidentally.** Record the decision in
the commit message.

- [ ] **Step 6: Verify no regression**

Run the controlled before/after from Global Constraints (verify-no-regression.mjs is broken on this checkout).
Expected: the failure SET is identical before and after — not merely the count.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/repos/usageRepo.js tests/unit/usage-stats-no-raw-keys.test.js
git commit -m "fix(usage): stop returning raw API keys as JSON property names

stats.byApiKey was keyed on \${rawApiKey}|model|provider (:92, read back at
:503), and sortData copies that property name onto each item, so the raw key
reached the browser. The response is now keyed on the key's id, or its masked
form when the key has been deleted.

Stored aggregates keep the raw composite: every day already accumulated uses
it, and re-keying the store would orphan them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The per-key time series

**Files:**
- Modify: `src/lib/db/repos/apiKeyUsageRepo.js`
- Test: `tests/unit/api-key-usage-series.test.js`

**Interfaces:**
- Consumes: `apiKeyBucketId` from Task 1.
- Produces:
  - `bucketApiKeyRows(rows, buckets, apiKeyMap)` → `Array<{ label, byKey: Record<string, number> }>` — pure, no database. `rows` is `[{ timestamp, apiKey, promptTokens, completionTokens }]`; `buckets` is `[{ label, start, end }]` with `start`/`end` as epoch ms, `end` exclusive.
  - `getApiKeyUsageSeries(period)` → `Promise<{ series, keys }>`, where `series` is the array above and `keys` is `Record<bucketId, displayName>`. Task 4 serves this.

**Background:** tokens per bucket is `promptTokens + completionTokens`, matching
the table's Total Tokens (`sortData` computes the same sum). `usageDaily` is
per-day, so `today` and `24h` must come from `usageHistory`, which carries the
`apiKey` column. `getChartData` (`usageRepo.js:668-760`) is the shape to mirror.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api-key-usage-series.test.js`:

```js
import { describe, it, expect } from "vitest";
import { bucketApiKeyRows } from "@/lib/db/repos/apiKeyUsageRepo.js";

const MAP = { "sk-9router-abcdefgh-live": { id: "key-1", name: "hermes" } };
const H = 3600000;

// Three one-hour buckets starting at epoch 0, end exclusive.
const BUCKETS = [
  { label: "00:00", start: 0, end: H },
  { label: "01:00", start: H, end: 2 * H },
  { label: "02:00", start: 2 * H, end: 3 * H },
];

const row = (ms, apiKey, p, c) => ({
  timestamp: new Date(ms).toISOString(), apiKey, promptTokens: p, completionTokens: c,
});

describe("bucketApiKeyRows", () => {
  it("sums prompt and completion tokens per key per bucket", () => {
    const out = bucketApiKeyRows([
      row(10, "sk-9router-abcdefgh-live", 100, 50),
      row(20, "sk-9router-abcdefgh-live", 10, 5),
    ], BUCKETS, MAP);

    expect(out[0]).toEqual({ label: "00:00", byKey: { "key-1": 165 } });
  });

  it("gives every bucket an entry, including empty ones", () => {
    const out = bucketApiKeyRows([row(10, "sk-9router-abcdefgh-live", 1, 1)], BUCKETS, MAP);
    expect(out.length).toBe(3);
    expect(out[1]).toEqual({ label: "01:00", byKey: {} });
    expect(out[2]).toEqual({ label: "02:00", byKey: {} });
  });

  it("keeps a deleted key and keyless traffic as their own series", () => {
    const out = bucketApiKeyRows([
      row(10, "sk-9router-zzzzzzzz-gone", 4, 0),
      row(20, null, 2, 0),
    ], BUCKETS, MAP);

    expect(out[0].byKey).toEqual({ "sk-9rout***": 4, "local-no-key": 2 });
    expect(Object.keys(out[0].byKey).join()).not.toContain("zzzzzzzz");
  });

  it("drops rows outside every bucket rather than misplacing them", () => {
    const out = bucketApiKeyRows([
      row(-1, "sk-9router-abcdefgh-live", 9, 9),
      row(3 * H, "sk-9router-abcdefgh-live", 9, 9),
    ], BUCKETS, MAP);

    expect(out.every((b) => Object.keys(b.byKey).length === 0)).toBe(true);
  });

  it("returns a bucket per input bucket when there are no rows at all", () => {
    expect(bucketApiKeyRows([], BUCKETS, MAP)).toEqual([
      { label: "00:00", byKey: {} },
      { label: "01:00", byKey: {} },
      { label: "02:00", byKey: {} },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/api-key-usage-series.test.js`
Expected: FAIL — `bucketApiKeyRows is not a function`.

- [ ] **Step 3: Write the pure bucketer**

Append to `src/lib/db/repos/apiKeyUsageRepo.js`:

```js
/**
 * Fold usage rows into fixed buckets, one token total per key per bucket.
 *
 * Pure: the caller decides the bucket boundaries, so the same function serves
 * the hourly and the daily path and can be tested without a database. A row
 * outside every bucket is dropped rather than clamped into the nearest one —
 * a misplaced request is a wrong chart, a dropped one is a short chart.
 *
 * @param {Array<{timestamp: string, apiKey: string|null, promptTokens: number, completionTokens: number}>} rows
 * @param {Array<{label: string, start: number, end: number}>} buckets  end exclusive, epoch ms
 * @param {Record<string, {id: string, name: string}>} apiKeyMap
 * @returns {Array<{label: string, byKey: Record<string, number>}>}
 */
export function bucketApiKeyRows(rows, buckets, apiKeyMap) {
  const out = buckets.map((b) => ({ label: b.label, byKey: {} }));

  for (const r of Array.isArray(rows) ? rows : []) {
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const index = buckets.findIndex((b) => t >= b.start && t < b.end);
    if (index === -1) continue;

    const id = apiKeyBucketId(r.apiKey, apiKeyMap);
    const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
    const bucket = out[index];
    bucket.byKey = { ...bucket.byKey, [id]: (bucket.byKey[id] || 0) + tokens };
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/api-key-usage-series.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the database-backed series function**

First add these two imports **at the top of `src/lib/db/repos/apiKeyUsageRepo.js`**,
above everything else — ESM import declarations must be at module scope, not
appended mid-file:

```js
import { getAdapter } from "../driver.js";
import { parseJson } from "../helpers/jsonCol.js";
```

Then append the rest to the bottom of the file:

```js
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

function dateKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The bucket boundaries for a period, mirroring getChartData (usageRepo.js:668)
 * so this chart lines up with every other chart on the dashboard.
 *
 * today / 24h are hourly, because usageDaily is per-day and would draw a single
 * bar for them. Everything else is daily.
 */
function bucketsFor(period, earliestDateKey) {
  if (period === "today") {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return { hourly: true, buckets: Array.from({ length: 24 }, (_, i) => {
      const s = start.getTime() + i * HOUR_MS;
      return { label: new Date(s).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }), start: s, end: s + HOUR_MS };
    }) };
  }
  if (period === "24h") {
    const end = Date.now();
    const start = end - 24 * HOUR_MS;
    return { hourly: true, buckets: Array.from({ length: 24 }, (_, i) => {
      const s = start + i * HOUR_MS;
      return { label: new Date(s).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }), start: s, end: s + HOUR_MS };
    }) };
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let count;
  if (period === "all") {
    const earliest = earliestDateKey ? new Date(`${earliestDateKey}T00:00:00`) : today;
    count = Math.max(1, Math.round((today - earliest) / DAY_MS) + 1);
  } else {
    count = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  }

  const first = new Date(today);
  first.setDate(first.getDate() - count + 1);
  return { hourly: false, buckets: Array.from({ length: count }, (_, i) => {
    const d = new Date(first); d.setDate(d.getDate() + i);
    const s = d.getTime();
    return { label: dateKeyOf(d), start: s, end: s + DAY_MS };
  }) };
}

/**
 * The per-key series the API Key Usage chart draws, plus the display name for
 * each series so the legend has something to say.
 *
 * @param {string} period  today | 24h | 7d | 30d | 60d | all
 * @returns {Promise<{series: Array<{label: string, byKey: Record<string, number>}>, keys: Record<string, string>}>}
 */
export async function getApiKeyUsageSeries(period = "7d") {
  const db = await getAdapter();
  const { getApiKeys } = await import("./apiKeysRepo.js");

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch { /* no keys yet */ }
  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id };

  let earliest = null;
  if (period === "all") {
    const first = db.all(`SELECT dateKey FROM usageDaily ORDER BY dateKey ASC LIMIT 1`);
    earliest = first?.[0]?.dateKey || null;
  }
  const { hourly, buckets } = bucketsFor(period, earliest);
  if (!buckets.length) return { series: [], keys: {} };

  let rows;
  if (hourly) {
    rows = db.all(
      `SELECT timestamp, apiKey, promptTokens, completionTokens FROM usageHistory WHERE timestamp >= ?`,
      [new Date(buckets[0].start).toISOString()]
    );
  } else {
    // usageDaily holds one JSON blob per day, whose byApiKey buckets are keyed
    // `${rawKey}|${model}|${provider}` and carry the raw key in `.apiKey`.
    // Flattened to row shape so one bucketer serves both paths.
    const dayRows = db.all(
      `SELECT dateKey, data FROM usageDaily WHERE dateKey >= ? ORDER BY dateKey ASC`,
      [dateKeyOf(new Date(buckets[0].start))]
    );
    rows = [];
    for (const dr of dayRows) {
      const day = parseJson(dr.data, {}) || {};
      const at = new Date(`${dr.dateKey}T00:00:00`).toISOString();
      for (const ak of Object.values(day.byApiKey || {})) {
        rows.push({
          timestamp: at, apiKey: ak.apiKey || null,
          promptTokens: ak.promptTokens || 0, completionTokens: ak.completionTokens || 0,
        });
      }
    }
  }

  const series = bucketApiKeyRows(rows, buckets, apiKeyMap);

  const keys = {};
  for (const bucket of series) {
    for (const id of Object.keys(bucket.byKey)) {
      if (keys[id]) continue;
      if (id === "local-no-key") { keys[id] = "Local (No API Key)"; continue; }
      const match = allApiKeys.find((k) => k.id === id);
      keys[id] = match ? match.name : `(deleted) ${id}`;
    }
  }

  return { series, keys };
}
```

- [ ] **Step 6: Run the whole new test file again**

Run: `cd tests && npx vitest run unit/api-key-usage-series.test.js unit/api-key-usage-bucket-id.test.js`
Expected: PASS, 9 tests. The new import of `getAdapter` must not break the pure tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/repos/apiKeyUsageRepo.js tests/unit/api-key-usage-series.test.js
git commit -m "feat(usage): per-API-key time series

usageDaily is per-day, so today/24h read usageHistory hourly (it carries the
apiKey column) and everything else reads usageDaily daily — the same bucket
boundaries getChartData uses, so this chart lines up with the others.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `GET /api/usage/api-keys`, with CSV

**Files:**
- Create: `src/app/api/usage/api-keys/route.js`
- Test: `tests/unit/api-key-usage-csv.test.js`

**Interfaces:**
- Consumes: `getApiKeyUsageSeries(period)` from Task 3; `getUsageStats(period).byApiKey` from Task 2.
- Produces: `GET /api/usage/api-keys?period=…` → `{ series, keys }`; `&format=csv` → `text/csv`. Also exports `toCsv(byApiKey)` → `string` for the test.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api-key-usage-csv.test.js`:

```js
import { describe, it, expect } from "vitest";
import { toCsv } from "@/app/api/usage/api-keys/route.js";

describe("toCsv", () => {
  const byApiKey = {
    "key-1|claude-cli-opus-1m|claude-cli": {
      requests: 2, promptTokens: 100, completionTokens: 50, cachedTokens: 10, cost: 0.5,
      rawModel: "claude-cli-opus-1m", provider: "Claude Code CLI", keyName: "hermes",
      lastUsed: "2026-09-25",
    },
  };

  it("writes a header and one line per key/model pair", () => {
    const lines = toCsv(byApiKey).trim().split("\n");
    expect(lines[0]).toBe("key,model,provider,requests,promptTokens,completionTokens,cachedTokens,cost,lastUsed");
    expect(lines[1]).toBe("hermes,claude-cli-opus-1m,Claude Code CLI,2,100,50,10,0.5,2026-09-25");
  });

  it("quotes a field containing a comma so the columns do not shift", () => {
    const csv = toCsv({ "k|m|p": { keyName: 'my key, v2', rawModel: "m", provider: "p", requests: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, lastUsed: "" } });
    expect(csv).toContain('"my key, v2"');
  });

  it("escapes an embedded quote rather than breaking the field", () => {
    const csv = toCsv({ "k|m|p": { keyName: 'say "hi"', rawModel: "m", provider: "p", requests: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, lastUsed: "" } });
    expect(csv).toContain('"say ""hi"""');
  });

  it("returns only a header when there is nothing to export", () => {
    expect(toCsv({}).trim()).toBe("key,model,provider,requests,promptTokens,completionTokens,cachedTokens,cost,lastUsed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/api-key-usage-csv.test.js`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the route**

Create `src/app/api/usage/api-keys/route.js`:

```js
import { NextResponse } from "next/server";
import { getApiKeyUsageSeries } from "@/lib/db/repos/apiKeyUsageRepo.js";
import { getUsageStats } from "@/lib/usageDb";

// The same set /api/usage/stats validates — the page offers one selector.
const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

const CSV_COLUMNS = [
  "key", "model", "provider", "requests",
  "promptTokens", "completionTokens", "cachedTokens", "cost", "lastUsed",
];

/** RFC 4180: quote a field that carries a comma, a quote or a newline. */
function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * The key x model table as CSV, built from the same byApiKey the table renders
 * so the file and the screen cannot disagree.
 *
 * @param {Record<string, object>} byApiKey  from getUsageStats(period)
 * @returns {string}
 */
export function toCsv(byApiKey) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of Object.values(byApiKey || {})) {
    lines.push([
      row.keyName, row.rawModel, row.provider, row.requests,
      row.promptTokens, row.completionTokens, row.cachedTokens, row.cost, row.lastUsed,
    ].map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    if (searchParams.get("format") === "csv") {
      const stats = await getUsageStats(period);
      return new NextResponse(toCsv(stats.byApiKey), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="api-key-usage-${period}.csv"`,
        },
      });
    }

    const { series, keys } = await getApiKeyUsageSeries(period);
    return NextResponse.json({ series, keys });
  } catch (error) {
    console.error("[API] Failed to get API key usage:", error);
    return NextResponse.json({ error: "Failed to fetch API key usage" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/api-key-usage-csv.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/usage/api-keys/route.js tests/unit/api-key-usage-csv.test.js
git commit -m "feat(usage): GET /api/usage/api-keys, with CSV export

Serves the per-key chart series plus a display name per series, and the same
byApiKey the table renders as CSV, so the file and the screen cannot disagree.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Make the existing API-key table reusable

**Files:**
- Modify: `src/shared/components/UsageStats.js` — `:128` (`groupDataByKey`), the `sortData` definition, `:174-180` (`API_KEY_COLUMNS`), `:385-407` (`case "apiKey"`)

**Interfaces:**
- Produces, as named exports from `src/shared/components/UsageStats.js`:
  - `sortData(dataMap, pendingMap, sortBy, sortOrder)` → `Array<object>`
  - `groupDataByKey(data, keyField)` → `Array<{ groupKey, summary, items }>`
  - `API_KEY_COLUMNS` → `Array<{ field, label, align? }>`
  - `renderApiKeySummaryCells(group)` → JSX
  - `renderApiKeyDetailCells(item)` → JSX

  Task 6 imports all five.

**This task changes no behaviour.** It is a pure extraction so one table
definition serves two pages. The Usage page must look and behave exactly as
before.

- [ ] **Step 1: Add `export` to the three existing definitions**

In `src/shared/components/UsageStats.js`, change:

```js
function groupDataByKey(data, keyField) {
function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
const API_KEY_COLUMNS = [
```

to:

```js
export function groupDataByKey(data, keyField) {
export function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
export const API_KEY_COLUMNS = [
```

- [ ] **Step 2: Extract the two render functions**

Lift the two arrow functions out of the `case "apiKey"` block (`:385-407`) to
module scope, above the component, as named exports. Copy the JSX **verbatim** —
this is a move, not a rewrite:

```js
/**
 * The API-key table's cells, at module scope so the API Key Usage page renders
 * the same table rather than a copy that drifts from this one.
 */
export function renderApiKeySummaryCells(group) {
  return (
    <>
      <td className="px-6 py-3 text-text-muted">—</td>
      <td className="px-6 py-3 text-text-muted">—</td>
      <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
      <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
    </>
  );
}

export function renderApiKeyDetailCells(item) {
  return (
    <>
      <td className="px-6 py-3 font-medium">{item.keyName}</td>
      <td className="px-6 py-3">{item.rawModel}</td>
      <td className="px-6 py-3"><Badge variant="neutral" size="sm">{item.provider}</Badge></td>
      <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
      <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
    </>
  );
}
```

- [ ] **Step 3: Point the `apiKey` case at them**

Replace the `case "apiKey"` body so it references the extracted functions:

```js
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byApiKey, {}, sortBy, sortOrder), "keyName"),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No API key usage recorded yet.",
          renderSummaryCells: renderApiKeySummaryCells,
          renderDetailCells: renderApiKeyDetailCells,
        };
      }
```

- [ ] **Step 4: Verify the lint passes and nothing else moved**

Run: `npx eslint src/shared/components/UsageStats.js`
Expected: no errors.

Run: `git diff --stat src/shared/components/UsageStats.js`
Expected: roughly equal insertions and deletions — an extraction, not new logic.

- [ ] **Step 5: Verify no regression**

Run the controlled before/after from Global Constraints (verify-no-regression.mjs is broken on this checkout).
Expected: the failure SET is identical before and after — not merely the count.

- [ ] **Step 6: Commit**

```bash
git add src/shared/components/UsageStats.js
git commit -m "refactor(usage): export the API-key table's column and cell definitions

The API Key Usage page renders the same table. Exporting these rather than
copying them means one definition — a copy would drift the moment either page
gained a column.

No behaviour change: the cells are moved verbatim and the apiKey case now
references them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The chart component

**Files:**
- Create: `src/app/(dashboard)/dashboard/api-key-usage/components/ApiKeyUsageChart.js`

**Interfaces:**
- Consumes: `{ series, keys }` from Task 4's route.
- Produces: `<ApiKeyUsageChart series={series} keys={keys} loading={bool} />`. Task 7 renders it.

**Background:** recharts ^3.7.0 is already a dependency. `ProviderBarChart.js`
and `UsageChart.js` in `dashboard/usage/components/` are the existing recharts
usages to match for styling and container sizing — read one before writing.

- [ ] **Step 1: Write the component**

Create `src/app/(dashboard)/dashboard/api-key-usage/components/ApiKeyUsageChart.js`:

```js
"use client";

import { useMemo } from "react";
import PropTypes from "prop-types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import Card from "@/shared/components/Card";

// Enough distinct hues for a realistic number of keys; beyond that they repeat,
// which is better than running out and drawing two series in one colour.
const COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4",
  "#a855f7", "#ec4899", "#84cc16", "#f97316", "#14b8a6",
];

const fmtTokens = (n) => new Intl.NumberFormat().format(n || 0);

/**
 * Tokens per API key over time, one stacked bar per bucket.
 *
 * Series are keyed on the bucket id the route returns, which is the same id
 * getUsageStats keys its byApiKey response on — so a key's colour here and its
 * row in the table below are the same key.
 */
export default function ApiKeyUsageChart({ series, keys, loading }) {
  // recharts wants one flat object per bucket: { label, <keyId>: tokens, ... }
  const data = useMemo(() => (series || []).map((bucket) => ({
    label: bucket.label,
    ...bucket.byKey,
  })), [series]);

  const keyIds = useMemo(() => Object.keys(keys || {}), [keys]);

  if (loading) {
    return (
      <Card className="p-4">
        <div className="h-[280px] animate-pulse rounded bg-bg-subtle/50" />
      </Card>
    );
  }

  if (!keyIds.length) {
    return (
      <Card className="p-4">
        <h3 className="mb-2 font-semibold">Tokens by API Key</h3>
        <div className="flex h-[280px] items-center justify-center text-sm text-text-muted">
          No API key usage recorded for this period.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="mb-4 font-semibold">Tokens by API Key</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtTokens} width={70} />
          <Tooltip formatter={(value, id) => [fmtTokens(value), keys[id] || id]} />
          <Legend formatter={(id) => keys[id] || id} />
          {keyIds.map((id, i) => (
            <Bar key={id} dataKey={id} stackId="tokens" fill={COLORS[i % COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

ApiKeyUsageChart.propTypes = {
  series: PropTypes.array,
  keys: PropTypes.object,
  loading: PropTypes.bool,
};
```

- [ ] **Step 2: Verify it lints**

Run: `npx eslint "src/app/(dashboard)/dashboard/api-key-usage/components/ApiKeyUsageChart.js"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/dashboard/api-key-usage/components/ApiKeyUsageChart.js"
git commit -m "feat(usage): stacked bar chart of tokens per API key

Series key on the same bucket id the stats response uses, so a key's colour
here and its row in the table are the same key.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The page and the sidebar entry

**Files:**
- Create: `src/app/(dashboard)/dashboard/api-key-usage/page.js`
- Modify: `src/shared/components/Sidebar.js:25` (insert after the `Usage` entry)

**Interfaces:**
- Consumes: `ApiKeyUsageChart` (Task 6); `sortData`, `groupDataByKey`, `API_KEY_COLUMNS`, `renderApiKeySummaryCells`, `renderApiKeyDetailCells` (Task 5); `GET /api/usage/api-keys` and `GET /api/usage/stats` (Task 4, Task 2); `UsageTable` from `dashboard/usage/components/UsageTable`.

- [ ] **Step 1: Add the sidebar entry**

In `src/shared/components/Sidebar.js`, the list currently reads:

```js
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
```

Insert one line between them:

```js
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/api-key-usage", label: "API Key Usage", icon: "key" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
```

- [ ] **Step 2: Write the page**

Create `src/app/(dashboard)/dashboard/api-key-usage/page.js`:

```js
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CardSkeleton, SegmentedControl } from "@/shared/components";
import {
  API_KEY_COLUMNS, groupDataByKey, sortData,
  renderApiKeyDetailCells, renderApiKeySummaryCells,
} from "@/shared/components/UsageStats";
import UsageTable from "../usage/components/UsageTable";
import ApiKeyUsageChart from "./components/ApiKeyUsageChart";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

export default function ApiKeyUsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ApiKeyUsageContent />
    </Suspense>
  );
}

function ApiKeyUsageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [period, setPeriod] = useState("7d");
  const [viewMode, setViewMode] = useState("tokens");
  const [chart, setChart] = useState({ series: [], keys: {} });
  const [byApiKey, setByApiKey] = useState({});
  const [loading, setLoading] = useState(true);

  const sortBy = searchParams.get("sortBy") || "requests";
  const sortOrder = searchParams.get("sortOrder") || "desc";

  // One fetch per period, not the SSE stream UsageStats uses: that stream
  // exists to move `pending` counts live, and the API-key view has no pending
  // data — it passes {} as its pendingMap.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch(`/api/usage/api-keys?period=${period}`).then((r) => r.json()),
      fetch(`/api/usage/stats?period=${period}`).then((r) => r.json()),
    ])
      .then(([chartData, stats]) => {
        if (cancelled) return;
        setChart({ series: chartData.series || [], keys: chartData.keys || {} });
        setByApiKey(stats.byApiKey || {});
      })
      .catch(() => { if (!cancelled) { setChart({ series: [], keys: {} }); setByApiKey({}); } })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [period]);

  // Same shape UsageTable's onToggleSort expects, and the same URL-param home
  // UsageStats gives it.
  const toggleSort = useCallback((tableType, field) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) {
      params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[{ value: "tokens", label: "Tokens" }, { value: "costs", label: "Costs" }]}
          value={viewMode}
          onChange={setViewMode}
          size="sm"
        />
        <div className="flex items-center gap-2">
          <a
            href={`/api/usage/api-keys?period=${period}&format=csv`}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[13px] hover:bg-bg-subtle"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            CSV
          </a>
          <SegmentedControl options={PERIODS} value={period} onChange={setPeriod} size="sm" />
        </div>
      </div>

      <ApiKeyUsageChart series={chart.series} keys={chart.keys} loading={loading} />

      <UsageTable
        title="Usage by API Key"
        columns={API_KEY_COLUMNS}
        groupedData={groupDataByKey(sortData(byApiKey, {}, sortBy, sortOrder), "keyName")}
        tableType="apiKey"
        sortBy={sortBy}
        sortOrder={sortOrder}
        onToggleSort={toggleSort}
        viewMode={viewMode}
        storageKey="api-key-usage:expanded"
        renderSummaryCells={renderApiKeySummaryCells}
        renderDetailCells={renderApiKeyDetailCells}
        emptyMessage="No API key usage recorded yet."
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify it lints**

Run: `npx eslint "src/app/(dashboard)/dashboard/api-key-usage/page.js" src/shared/components/Sidebar.js`
Expected: no errors.

- [ ] **Step 4: Confirm no propTypes warning in the console**

`UsageTable.propTypes` marks exactly twelve props required: `title`, `columns`,
`groupedData`, `tableType`, `sortBy`, `sortOrder`, `onToggleSort`, `viewMode`,
`storageKey`, `renderDetailCells`, `renderSummaryCells`, `emptyMessage`. Step 2
passes all twelve.

`renderGroupLabel` appears in that file's JSDoc (`:90`) but is in neither
`propTypes` nor the component's destructured props — it is a stale doc
parameter. Do not pass it.

Open the browser console on the page and confirm there is no
`Failed prop type` warning.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: compiles. `/dashboard/api-key-usage` appears in the route list.

> This build is the repo's memory high-water mark — it needs a large heap and
> must not run concurrently with another build.

- [ ] **Step 6: Run it and look at the page**

Run: `PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev`

Open `http://localhost:20128/dashboard/api-key-usage` and confirm:
- the sidebar shows `API Key Usage` between `Usage` and `Quota Tracker`
- the chart draws one stacked bar per day at `7D`, and 24 hourly bars at `Today`
- the table lists keys, and a row expands to its per-model rows
- `Tokens` / `Costs` switches the four right-hand columns
- the CSV button downloads a file whose rows match the table
- in devtools, the `/api/usage/stats` response contains **no** raw API key

- [ ] **Step 7: Verify no regression**

Run the controlled before/after from Global Constraints (verify-no-regression.mjs is broken on this checkout).
Expected: the failure SET is identical before and after — not merely the count.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/dashboard/api-key-usage/page.js" src/shared/components/Sidebar.js
git commit -m "feat(usage): API Key Usage page and sidebar entry

The per-key table was three controls deep inside Usage. It gets a menu of its
own, with the time series and CSV export it never had. The table itself is the
existing one, imported rather than copied.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Document it

**Files:**
- Modify: `AGENT-HANDOFF.md`
- Modify: `FORK-CHANGELOG.md`

- [ ] **Step 1: Add a section to `AGENT-HANDOFF.md`**

After the existing `## Prompt-cache sessions` section, add:

```markdown
## API Key Usage

`/dashboard/api-key-usage` — tokens and cost per API key, per model, with a
per-key time series and CSV export.

The aggregation is not new: `usageRepo.js` has bucketed requests by
`apiKey|model|provider` into `usageDaily` all along, and the table was already
reachable under Usage → Overview → Usage by API Key. What this adds is a menu of
its own, the chart (`apiKeyUsageRepo.js` — hourly from `usageHistory` for
today/24h, daily from `usageDaily` otherwise), and the export.

Neither `usageHistory` nor `usageDaily` is pruned, so this grows without bound.
On a busy install, watch the SQLite file under `DATA_DIR`.

`/api/usage/stats` used to key `byApiKey` on the raw API key, which reached the
browser. It is keyed on the key's id now; the stored aggregate still uses the
raw composite, so do not assume the two match.
```

- [ ] **Step 2: Add a `FORK-CHANGELOG.md` entry**

Under `## Unreleased (on top of v0.5.85)` → `### Features`, after the existing
`#### Claude Code CLI …` block, add:

```markdown
#### API Key Usage: a menu, a per-key chart, and CSV export

`usageRepo.js` has bucketed every request by `apiKey|model|provider` into
`usageDaily` all along, and the per-key table was already on screen — three
controls deep, under Usage → Overview → Usage by API Key. Nothing named API keys
in the sidebar, no way to see one key's usage over time, and no export.

`/dashboard/api-key-usage` gives it a menu of its own. The table is the existing
one, imported rather than copied, so a column added to either page appears on
both. New beside it: a stacked bar chart of tokens per key over the selected
period — hourly from `usageHistory` for Today and 24h, daily from `usageDaily`
beyond that, the same bucket boundaries every other chart uses — and a CSV
button built from the same rows the table renders.

Neither `usageHistory` nor `usageDaily` is pruned, so this view is genuinely
cumulative and grows without bound. On a busy install, watch the SQLite file
under `DATA_DIR`.

### Fixes

#### `/api/usage/stats` no longer returns raw API keys

`stats.byApiKey` was keyed on `${rawApiKey}|model|provider`, and the dashboard's
`sortData` copies that property name onto each item — so every raw API key
reached the browser on every stats poll. The values were masked; the property
names were not.

The response is keyed on the key's id now, or its masked form when the key has
since been deleted. Stored aggregates are untouched: every day already
accumulated is written under the raw composite, and re-keying the store would
orphan that history.
```

- [ ] **Step 3: Commit**

```bash
git add AGENT-HANDOFF.md FORK-CHANGELOG.md
git commit -m "docs: API Key Usage page

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Deployment

This repo's Kubernetes bundle lives in a separate checkout
(`Kubernetes-Application/9router`). After merging, deploy in this order —
ArgoCD auto-syncs with `selfHeal: true` and the rollout is `Recreate`, so a
manifest that lands before its image kills the running pod into
`ImagePullBackOff`:

```bash
# 1. build and push first, from a clean tree at the merge commit
TAG=0.5.86-<sha>
H=harbor.thisisserver.com/library
docker build -t $H/9router:$TAG .
docker push $H/9router:$TAG

# 2. only then bump `image:` in deployment.yaml and push that commit
node scripts/fork/check-k8s-manifests.mjs <k8s-dir>   # must be 21/21
```
