# API key usage statistics

A dashboard menu for per-API-key usage, plus the parts of that view that do not
exist yet.

## What already exists

Most of this feature is already built. Establish this before planning work, or
the plan rebuilds it.

**Collection.** `usageRepo.js` buckets every request by
`${apiKey}|${model}|${provider}` into `usageDaily.data.byApiKey` (`:91-93`),
joins the key's name from `apiKeysRepo` (`:351`, `:368`), and `getUsageStats()`
rolls it up (`:503-520` for the daily path, `:638-648` for `period=all`).
`GET /api/usage/stats?period=…` serves it. Neither `usageHistory` nor
`usageDaily` has a pruning path, so the accumulation is already unbounded and
"cumulative" needs no retention work.

**The table.** `src/shared/components/UsageStats.js:385-407` already renders it:
one row per key, expanding to that key's per-model rows, with sorting and
persisted expand state. Its columns are `API_KEY_COLUMNS` (`:174-180`) — key
name, model, provider, requests, last used — and `UsageTable` automatically
appends four more (`UsageTable.js:138-153`): input / cached / output / total,
shown as tokens or as cost depending on the view's `viewMode` toggle.

So per-key token and cost breakdowns are on screen today. It is reached through
Usage → Overview → the table-view selector entry `Usage by API Key` (`:193`).

## What is missing

1. **A menu of its own.** The table is three controls deep inside the Usage
   page. Nothing in the sidebar names API keys.
2. **A per-key chart.** `getChartData(period)` (`usageRepo.js:668`) takes no
   dimension argument and returns global totals only, so every chart on the
   Usage page is all-keys-combined. There is no per-key time series.
3. **CSV export.** `grep` for `text/csv`, `toCSV`, `downloadCsv` across
   `src/app` and `src/shared` returns nothing. No view exports anything.
4. **The raw-key fix** below.

## The security fix

`stats.byApiKey` is keyed on `akKey`, which is `${rawApiKey}|${model}|${provider}`
(`usageRepo.js:92`, read back at `:503`). The *values* are masked — they carry
`apiKeyMasked` and `keyName`, never the raw string — but the JSON property names
in the `/api/usage/stats` response are the raw API keys, and `sortData`
(`UsageStats.js`) copies that property name onto each item as `item.key`, so it
reaches the browser.

The response is re-keyed on the key's id (or its masked form when no key record
matches) before it leaves `getUsageStats()`, in both paths that populate
`stats.byApiKey` — `:503` and `:638`.

**Stored aggregates are not re-keyed.** `usageDaily.data.byApiKey` keeps its raw
composite key, because every day already accumulated is written that way and
re-keying the store would orphan existing history. The raw key stays in SQLite
beside the `apiKeys` table that holds the same string in plaintext, which is no
new exposure. Only the HTTP response changes.

**The existing consumer is unaffected**, verified: `UsageStats.js:388` passes
`stats.byApiKey` through `sortData`, which uses the property name only for
`pendingMap[key]` — and the API-key view passes `{}` as `pendingMap` — and then
`groupDataByKey(..., "keyName")`, whose `getGroupKey` returns `item.keyName`.
Nothing reads the property name for display or grouping.

### To confirm during implementation

`usageRepo.js:567` reads `stats.byApiKey[apiKeyKey]`, where `apiKeyKey` is the
masked form, but entries are stored under `akKey` (raw|model|provider). That
lookup appears never to match today. Re-keying touches this line; verify what it
was meant to do and either fix it or leave it correct, rather than changing it
by accident.

## Components

### `src/lib/db/repos/apiKeyUsageRepo.js` (new)

Produces the per-key time series the chart needs: one entry per bucket,
`{ label, byKey: { <keyId>: tokens } }`, where tokens is
`promptTokens + completionTokens` — the same total `sortData` computes, so the
chart and the table's "Total Tokens" column agree.

**Bucketing mirrors `getChartData` exactly**, because `usageDaily` is per-day and
would draw a single bar for the two short periods:

| period | source | buckets |
|---|---|---|
| `today` | `usageHistory` rows since local midnight | 24 hourly |
| `24h` | `usageHistory` rows in the last 24h | 24 hourly |
| `7d` / `30d` / `60d` | `usageDaily` via `loadDaysInRange` | 7 / 30 / 60 daily |
| `all` | `usageDaily`, earliest `dateKey` → today | one per day |

`usageHistory` carries the `apiKey` column, so the hourly path can bucket per
key without any new storage. `getChartData:672-747` is the shape to follow for
bucket boundaries and labels.

It also exports the shared identity function, so the chart and the table cannot
key differently:

```js
// The one definition of "which bucket does this raw key belong to".
export function apiKeyBucketId(rawKey, apiKeyMap) {
  if (!rawKey) return "local-no-key";
  return apiKeyMap[rawKey]?.id || maskApiKey(rawKey) || "local-no-key";
}
```

`getUsageStats` imports it for the re-key at `:503` and `:638`. The new composite
is built from the **raw** `ak.provider`, never `providerDisplayName` — two
providers sharing a display name would otherwise collide into one row.

A new file rather than more of `usageRepo.js`, which is at 808 lines — the
project's stated ceiling.

The bucket projection is a pure function over already-fetched rows, exported
separately so it can be tested without a database.

### `GET /api/usage/api-keys` (new route)

`?period=today|24h|7d|30d|60d|all` — the same set `/api/usage/stats` validates.
Returns `{ series, keys }`, where `keys` maps each `<keyId>` appearing in the
series to its display name. Without it the chart has ids and no legend; putting
it here means one fetch gives the chart everything it draws.

`&format=csv` returns `text/csv` instead: one line per key/model pair, columns
`key,model,provider,requests,promptTokens,completionTokens,cachedTokens,cost,lastUsed`,
built from the same `getUsageStats().byApiKey` the table renders, so the file and
the screen cannot disagree.

### `src/shared/components/Sidebar.js` (edit)

One entry after `Usage`:
`{ href: "/dashboard/api-key-usage", label: "API Key Usage", icon: "key" }`.

### `src/app/(dashboard)/dashboard/api-key-usage/page.js` (new)

Period selector (the `PERIODS` array and `SegmentedControl` from
`dashboard/usage/page.js`), the new chart, and the existing API-key table.

The table is **not reimplemented**. The page reuses `UsageTable` with the same
column and render definitions the Usage page uses. `UsageStats.js` gains named
exports for exactly these, and its own `case "apiKey"` is rewritten to consume
them, so there is one definition rather than a copy:

- `sortData`, `groupDataByKey`, `API_KEY_COLUMNS`
- `renderApiKeySummaryCells(group)` and `renderApiKeyDetailCells(item)`,
  extracted verbatim from the `case "apiKey"` block at `:385-407`

**Page mechanics**, which differ from `UsageStats`:

- One `fetch` per period change, not the SSE stream `UsageStats` uses. The
  stream exists to update `pending` counts live, and the API-key view already
  passes `{}` as its `pendingMap` — there is nothing live to show.
- Two fetches per period: `/api/usage/stats?period=` for the table and
  `/api/usage/api-keys?period=` for the chart.
- Sort state in URL search params, via the same `toggleSort(tableType, field)`
  shape `UsageTable`'s `onToggleSort` expects (`UsageStats.js:311-320`).

### `components/ApiKeyUsageChart.js` (new)

recharts stacked bar: one bar per day, one colour per key, y = tokens.
recharts ^3.7.0 is already a dependency.

## Data flow

```
request
  → requestDetail.js:124  saveRequestUsage({ ..., apiKey })
  → usageHistory row + usageDaily.data.byApiKey[raw|model|provider]   (unchanged)
  → getUsageStats()          → re-keyed byApiKey → table   (existing, fixed)
  → apiKeyUsageRepo          → per-day series      → chart (new)
  → /api/usage/api-keys                                    (new)
```

## Display rules

| case | shown as |
|---|---|
| key exists | its name (already: `keyName` from the `apiKeysRepo` join) |
| key deleted from `apiKeys` | `usageRepo.js:510` already falls back to `apiKeyVal.slice(0, 8) + "..."`; the row stays |
| request arrived with no key | `Local (No API Key)` — already the fallback at `:510` |
| period has no data | `UsageTable`'s `emptyMessage`; the chart renders an empty-state card |
| route fails | 500 JSON; page renders an error card |

`deleteApiKey` hard-deletes the row (`apiKeysRepo.js:64`), so a deleted key has
no name to join against — which is why the existing truncated-key fallback is
what a deleted key shows.

## Testing

Under `tests/unit/` (the independent vitest package; `npx vitest run` from
`tests/`).

- `apiKeyBucketId`, as a pure unit: known key → its id, unknown key → masked
  form, empty → `local-no-key`.
- The bucket projection, as a pure unit over already-fetched rows: multi-model
  key, deleted key, no-key bucket, empty period, a key used on one day and not
  the next, and two providers whose display names collide staying separate.
- A regression assertion that no property name in `getUsageStats().byApiKey`
  contains a full API key. This is the fix's guard rail.

The last one needs `getUsageStats` driven against a stub. `tests/unit/routed-usage.test.js`
is the pattern: `vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ({ all: () => rows }) }))`,
with `apiKeysRepo` mocked alongside it. No real SQLite.

Judge the suite with `tests/__baseline__/verify-no-regression.mjs`, not a raw
run — the checkout is not green.

## Out of scope

- Retention or pruning. None exists; the data is already cumulative, and adding
  a policy would delete history.
- Changing what is collected. Every field this needs is already recorded.
- Rebuilding the per-key table, its token/cost columns, or its sorting — all
  present.
- `getChartData`, which stays global-only.
