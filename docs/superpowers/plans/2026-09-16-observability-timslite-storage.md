# Observability Timslite Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optionally store full observability request-detail payloads in a local Timslite dataset while keeping the existing SQLite `requestDetails` rows as the metadata and pointer index.

**Architecture:** Add a small, lazy-loaded `requestDetailsStore` that owns the local Timslite database at the SQLite sibling path, ID allocation, UTF-8-safe size limiting, batched writes, retention configuration, and close behavior. `requestDetailsRepo` will dual-write payloads to that store, flush the Timslite batch once, then atomically save SQLite rows containing either legacy inline details or Timslite pointers in the unchanged `data` column. Reads will preserve pagination from SQLite and hydrate only the page's pointers with bounded Timslite point reads, returning usable metadata plus `detailUnavailable` when a detail cannot be loaded.

**Tech Stack:** Node.js ESM, Next.js 16, SQLite repository layer, optional `timslite` native package, Vitest, fake Timslite adapter for tests.

**Spec:** User-approved design in this task, including local-only Timslite storage, decimal-string monotonic microsecond IDs, a 4 MiB record cap, and the two observability environment variables.

## Global Constraints

- Add `timslite` as an optional dependency. The application must continue to run and keep writing legacy inline SQLite request details when that package is unavailable or Timslite initialization fails.
- Document `OBSERVABILITY_TIMSLITE_DATA_STORE`. Only the literal value `true` enables new Timslite writes.
- Document `OBSERVABILITY_TIMSLITE_RETENTION_DAYS`, whose default is exactly `90` days. Invalid, zero, or negative values must resolve to `90`.
- The local database path is the SQLite sibling `path.join(DB_DIR, "timslite", "9router")`. Open database or store name `9router` and dataset name `requestDetails`.
- Timslite IDs are decimal strings generated from monotonic bigint microseconds. IDs must increase even if multiple writes occur in one clock tick or the wall clock moves backward.
- A Timslite record must not exceed 4 MiB measured as UTF-8 bytes. Truncation must preserve valid JSON and report what was truncated.
- **Do not make any SQLite migration or schema change.** The existing `requestDetails.data` column continues to contain JSON, now either a legacy inline detail or exactly `{ "timslite_id": "<decimal bigint>" }` for an offloaded detail.
- Do not add HTTP Timslite configuration, remote Timslite support, discovery APIs, or dataset browsing endpoints.
- Preserve existing request-details API redaction. A payload loaded from Timslite is still redacted before it reaches the dashboard list endpoint.
- Flush every staged Timslite write once before the SQLite pointer transaction. If the Timslite batch flush fails, do not insert or update pointers for that batch; fall back to inline SQLite records where the design's availability policy requires it and log the failure without breaking request handling.
- Hydrate one SQLite page with bounded Timslite point reads only. Do not scan the dataset, and do not turn an unavailable pointer into a failed request-details listing.
- Preserve the metadata available from SQLite columns when a pointed record is missing, malformed, or unreadable. Mark it `detailUnavailable: true` and retain `id`, `timestamp`, `provider`, `model`, `connectionId`, and `status`. Because the schema is unchanged and pointer JSON contains only `timslite_id`, unavailable records cannot retain `tokens`, `latency`, or `pxpipe`.
- Timslite retention owns old external payload eviction. SQLite record-count retention and pointer replacement must **not** call `dataset.delete()` or any per-record Timslite delete operation.
- On process shutdown, clear the repository timer, finish the pending Timslite batch before the final SQLite pointer transaction, and close the Timslite handle gracefully. Repeated close or shutdown calls must be safe.
- Tests must inject a fake adapter. Do not require native Timslite installation in CI or in the normal test setup.
- The repository's full Vitest suite is not expected to be all green on a plain checkout. Run targeted Vitest files and the baseline-aware verification commands described in `CLAUDE.md`.

---

## File Structure

- Modify: `package.json`, add `timslite` to `optionalDependencies` only. Do not move existing dependencies.
- Modify: `.env.example`, document the disabled-by-default Timslite switch and 90-day retention setting beside the observability settings.
- Modify: `src/lib/db/paths.js`, export the local Timslite directory and request-details store path derived from `DB_DIR`.
- Create: `src/lib/timslite/requestDetailsStore.js`, the only module that imports Timslite and owns its adapter contract, paths, configuration parsing, monotonic IDs, UTF-8 truncation, write staging, bounded point reads, retention setup, and close.
- Modify: `src/lib/db/repos/requestDetailsRepo.js`, replace direct full-detail persistence with the dual-write, pointer-envelope, hydration, retention, and shutdown integration while preserving public repository APIs.
- Modify: `src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js`, render a clear unavailable-state in the detail drawer without crashing on partial payloads.
- Modify if needed: `src/app/api/usage/request-details/route.js`, preserve `detailUnavailable` while continuing to redact any hydrated payload fields. Keep the route contract otherwise unchanged.
- Create: `tests/unit/timslite-request-details-store.test.js`, isolated store, ID, truncation, configuration, retention, and close tests using a fake adapter.
- Create: `tests/unit/request-details-timslite-integration.test.js`, repository dual-write, pointer persistence, flush ordering, fallback, hydration, and no-delete regression tests using a fake adapter plus the existing SQLite test adapter.
- Modify: `tests/unit/request-details-tab.test.js`, verify mixed inline and unavailable-pointer data remains safe for the API and dashboard-facing helpers.

## Adapter and Record Contracts

Keep the native API at the boundary. The store should depend on this testable adapter shape, supplied by a lazy native adapter in production and a fake in tests:

```js
/** @typedef {{
 *   configureRetention: (days: number) => Promise<void>,
 *   put: (id: string, value: string) => Promise<void>,
 *   flush: () => Promise<void>,
 *   get: (id: string) => Promise<string | null>,
 *   close: () => Promise<void>,
 * }} RequestDetailsDataset */

/** @typedef {{
 *   openRequestDetailsDataset: (options: {
 *     path: string,
 *     database: "9router",
 *     dataset: "requestDetails",
 *   }) => Promise<RequestDetailsDataset>,
 * }} RequestDetailsStoreAdapter */
```

The store module exports the following focused interface. Keep its implementation local and do not leak native Timslite objects into `requestDetailsRepo`:

```js
export const TIMSLITE_RECORD_MAX_BYTES = 4 * 1024 * 1024;
export function getTimsliteRetentionDays(env = process.env);
export function createMonotonicMicrosecondId(clock = Date.now);
export function truncateUtf8Json(value, maxBytes = TIMSLITE_RECORD_MAX_BYTES);
export function createRequestDetailsStore({ adapter, env, clock, logger } = {});
// store: { enabled, stage(detail), flush(), getMany(ids), close() }
```

Use this exact pointer object in SQLite. Indexed metadata remains in the existing SQLite columns and must not be duplicated into `data`:

```js
{
  timslite_id: "1726480000000000"
}
```

`stage(detail)` returns `{ timslite_id }` only after assigning the decimal-string Timslite ID and serializing the controlled payload. `flush()` writes all staged records and calls the underlying dataset flush once. `getMany(ids)` accepts at most the current page's unique IDs, uses one `get(id)` per ID, catches per-record failures, and returns `Map<string, object | null>`.

### Task 1: Add the Optional Dependency, Environment Contract, and Path Tests

**Files:**
- Modify: `package.json:54-57`
- Modify: `.env.example:13-19`
- Modify: `src/lib/db/paths.js:1-18`
- Create: `tests/unit/timslite-request-details-store.test.js`

**Interfaces:**
- Produces: `TIMSLITE_REQUEST_DETAILS_DIR`, `TIMSLITE_REQUEST_DETAILS_PATH`, and `getTimsliteRetentionDays(env)` for later store construction.
- Consumes: `DB_DIR` from `@/lib/db/paths.js` and the process environment.

- [ ] **Step 1: Write the failing path and configuration tests**

Create the store unit test file with a deterministic environment table. Test that only `"true"` enables the store in the later constructor, and test retention parsing now:

```js
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DB_DIR, TIMSLITE_REQUEST_DETAILS_PATH } from "@/lib/db/paths.js";
import { getTimsliteRetentionDays } from "@/lib/timslite/requestDetailsStore.js";

describe("Timslite request-details configuration", () => {
  it("uses the SQLite sibling request-details path", () => {
    expect(TIMSLITE_REQUEST_DETAILS_PATH).toBe(path.join(DB_DIR, "timslite", "9router"));
  });

  it.each([undefined, "", "0", "-3", "1.5", "30days", "not-a-number"])("defaults invalid retention %j to 90 days", (value) => {
    expect(getTimsliteRetentionDays({ OBSERVABILITY_TIMSLITE_RETENTION_DAYS: value })).toBe(90);
  });

  it("uses a positive whole-day retention value", () => {
    expect(getTimsliteRetentionDays({ OBSERVABILITY_TIMSLITE_RETENTION_DAYS: "30" })).toBe(30);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cd tests && npx vitest run unit/timslite-request-details-store.test.js`

Expected: FAIL because `requestDetailsStore.js` and the Timslite path exports do not exist.

- [ ] **Step 3: Add only the configuration, dependency, documentation, and path foundation**

Add the package with npm so the repository records the resolved package version, without changing the existing SQLite optional dependency:

```bash
npm install --save-optional timslite
```

Document the disabled default and local behavior in `.env.example`:

```dotenv
# Optional local request-detail payload store. Only literal true enables new Timslite writes.
# OBSERVABILITY_TIMSLITE_DATA_STORE=false
# Retain Timslite request-detail payloads for this many days. Defaults to 90.
# OBSERVABILITY_TIMSLITE_RETENTION_DAYS=90
```

Add paths derived from the existing SQLite location, not `DATA_DIR` directly:

```js
export const TIMSLITE_DIR = path.join(DB_DIR, "timslite");
export const TIMSLITE_REQUEST_DETAILS_PATH = path.join(TIMSLITE_DIR, "9router");
```

Implement only `getTimsliteRetentionDays`. Require the complete trimmed value to match a positive base-10 integer before converting it with `Number`; then require `Number.isSafeInteger(value)` and `value > 0`. Missing, blank, signed, fractional, suffixed, unsafe, or otherwise invalid values return `90`. Do not use permissive `Number.parseInt` parsing, and do not initialize Timslite in this task.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `cd tests && npx vitest run unit/timslite-request-details-store.test.js`

Expected: PASS for the path and retention cases.

- [ ] **Step 5: Commit the configuration foundation**

```bash
git add package.json .env.example src/lib/db/paths.js src/lib/timslite/requestDetailsStore.js tests/unit/timslite-request-details-store.test.js
git commit -m "feat(observability): add Timslite storage configuration"
```

### Task 2: Build the Focused Store With Fake-Adapter Tests

**Files:**
- Modify: `src/lib/timslite/requestDetailsStore.js`
- Modify: `tests/unit/timslite-request-details-store.test.js`

**Interfaces:**
- Consumes: `TIMSLITE_REQUEST_DETAILS_PATH`, `getTimsliteRetentionDays(env)`, and the `RequestDetailsStoreAdapter` contract.
- Produces: `createRequestDetailsStore`, monotonic ID allocation, UTF-8-safe controlled serialization, a once-per-batch `flush`, bounded `getMany`, and idempotent `close`.

- [ ] **Step 1: Write failing store behavior tests using a fake adapter**

Add a fake whose call history catches implementation regressions without loading native Timslite:

```js
function makeFakeAdapter() {
  const records = new Map();
  const calls = { open: [], retention: [], put: [], flush: 0, get: [], close: 0, delete: 0 };
  return {
    calls,
    records,
    adapter: {
      async openRequestDetailsDataset(options) {
        calls.open.push(options);
        return {
          async configureRetention(days) { calls.retention.push(days); },
          async put(id, value) { calls.put.push(id); records.set(id, value); },
          async flush() { calls.flush += 1; },
          async get(id) { calls.get.push(id); return records.get(id) ?? null; },
          async close() { calls.close += 1; },
        };
      },
    },
  };
}

it("opens local 9router/requestDetails, configures 90-day retention, and stays disabled unless true", async () => {
  const fake = makeFakeAdapter();
  const disabled = createRequestDetailsStore({ adapter: fake.adapter, env: {} });
  expect(disabled.enabled).toBe(false);
  await disabled.flush();
  expect(fake.calls.open).toEqual([]);

  const enabled = createRequestDetailsStore({
    adapter: fake.adapter,
    env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
  });
  await enabled.stage({ id: "detail-a", request: { body: "hello" } });
  await enabled.flush();
  expect(fake.calls.open[0]).toMatchObject({ database: "9router", dataset: "requestDetails" });
  expect(fake.calls.retention).toEqual([90]);
});

it("generates strictly increasing decimal bigint microsecond IDs", () => {
  const next = createMonotonicMicrosecondId(() => 1_726_480_000_000);
  const ids = [next(), next(), next()];
  expect(ids).toEqual(ids.map((id) => expect.stringMatching(/^\\d+$/)));
  expect(BigInt(ids[1])).toBeGreaterThan(BigInt(ids[0]));
  expect(BigInt(ids[2])).toBeGreaterThan(BigInt(ids[1]));
});

it("writes staged values then issues exactly one flush for the batch", async () => {
  const fake = makeFakeAdapter();
  const store = createRequestDetailsStore({ adapter: fake.adapter, env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" } });
  await store.stage({ id: "a", request: { x: 1 } });
  await store.stage({ id: "b", response: { y: 2 } });
  await store.flush();
  expect(fake.calls.put).toHaveLength(2);
  expect(fake.calls.flush).toBe(1);
  expect(fake.calls.delete).toBe(0);
});
```

Add cases that prove a multi-byte string is constrained by `Buffer.byteLength(serialized, "utf8")`, the result parses as JSON, truncation includes a stable marker and original byte count, `getMany` reads each unique requested pointer once and maps missing or malformed data to `null`, and calling `close()` twice closes the native dataset once.

- [ ] **Step 2: Run the store suite to verify it fails**

Run: `cd tests && npx vitest run unit/timslite-request-details-store.test.js`

Expected: FAIL because the store interface and behavior have not been implemented.

- [ ] **Step 3: Implement the smallest local-only store**

Implement a lazy `import("timslite")` adapter factory inside `requestDetailsStore.js`, so the package is never imported when the flag is not exactly `true`. Keep the native constructor mapping in one function, passing this fixed configuration:

```js
{
  path: TIMSLITE_REQUEST_DETAILS_PATH,
  database: "9router",
  dataset: "requestDetails",
}
```

Use a closure-scoped `lastId` bigint. For each ID, calculate `BigInt(clock()) * 1000n`, advance to `lastId + 1n` when needed, assign `lastId`, and return `lastId.toString()`.

Serialize a cloned request-detail payload, never mutate the caller's detail, and enforce the 4 MiB cap in UTF-8 bytes. When oversized, replace progressively large payload fields such as `request`, `providerRequest`, `providerResponse`, and `response` with JSON-safe preview metadata until the full serialized record fits. If metadata alone cannot fit, return a minimal valid JSON truncation envelope. Do not slice a JSON string by character count.

`flush()` must open once, configure retention once per opened dataset, put all currently staged values, then invoke the dataset flush exactly once. Leave a failed batch available to the caller for fallback handling, and never call a delete method. `getMany()` must cap its input at a named page-size bound, deduplicate IDs, and convert each independently failed, missing, or invalid JSON value to `null`. `close()` must flush nothing implicitly, close only an initialized dataset, and be idempotent.

- [ ] **Step 4: Run the store suite to verify it passes**

Run: `cd tests && npx vitest run unit/timslite-request-details-store.test.js`

Expected: PASS, with no native Timslite module required.

- [ ] **Step 5: Commit the isolated storage module**

```bash
git add src/lib/timslite/requestDetailsStore.js tests/unit/timslite-request-details-store.test.js
git commit -m "feat(observability): add local Timslite request-details store"
```

### Task 3: Dual-Write Request Details and Preserve SQLite Compatibility

**Files:**
- Modify: `src/lib/db/repos/requestDetailsRepo.js:13-224`
- Create: `tests/unit/request-details-timslite-integration.test.js`

**Interfaces:**
- Consumes: `createRequestDetailsStore({ adapter, env, clock, logger })`, existing `getAdapter()`, `getObservabilityConfig()`, and the unchanged `requestDetails(id, timestamp, provider, model, connectionId, status, data)` table.
- Produces: unchanged `saveRequestDetail(detail)`, `getRequestDetails(filter)`, `getRequestDetailById(id)`, and `getDistinctProviders()` public APIs, now accepting mixed inline and Timslite-pointer `data` values.

- [ ] **Step 1: Write the failing repository integration tests**

Create a fake-store factory injection seam in the repository module, then add tests with temporary `DATA_DIR` and the existing SQLite adapter:

```js
it("flushes Timslite once before committing SQLite pointer rows", async () => {
  const events = [];
  const fakeStore = {
    enabled: true,
    async stage(detail) {
      events.push(`stage:${detail.id}`);
      return { timslite_id: "1726480000000000" };
    },
    async flush() { events.push("timslite:flush"); },
    async getMany() { return new Map(); },
    async close() {},
  };
  const { saveRequestDetail, __test__ } = await loadRepoWithStore(fakeStore);
  __test__.onBeforeSqlitePointerTransaction(() => events.push("sqlite:transaction"));

  await saveRequestDetail({ id: "dual-a", provider: "openai", model: "gpt-test", request: { messages: [] } });
  await __test__.flushNow();

  expect(events).toEqual(["stage:dual-a", "timslite:flush", "sqlite:transaction"]);
});

it("keeps the SQLite data column and stores a pointer envelope, not a full payload", async () => {
  // save a large detail through the repository, query requestDetails.data directly,
  // and assert its JSON equals { timslite_id: "1726480000000000" } exactly.
});

it("keeps inline SQLite detail records when the flag is disabled", async () => {
  // assert legacy request and response fields remain available from getRequestDetailById.
});

it("does not write SQLite pointers when the Timslite batch flush fails", async () => {
  // fake flush throws, then assert no pointer row is committed and request handling does not throw.
});
```

Also test a pointer replacement and SQLite count retention. Make the fake adapter expose a `delete` spy and assert it remains at zero in both cases. The retention test should assert only the existing SQL `DELETE FROM requestDetails` runs to manage SQLite count, never a Timslite per-record delete.

- [ ] **Step 2: Run the integration suite to verify it fails**

Run: `cd tests && npx vitest run unit/request-details-timslite-integration.test.js`

Expected: FAIL because the repository has no store injection, no pointer envelope, and no Timslite-before-SQLite ordering.

- [ ] **Step 3: Implement the minimal buffered dual-write flow**

Keep the existing `writeBuffer`, batching threshold, and timer behavior. At each repository flush:

1. Normalize IDs, timestamps, header redaction, and normal metadata as the current implementation does.
2. When Timslite is disabled or unavailable, build the existing inline record and persist it exactly as before.
3. When enabled, stage every normalized detail in the focused store, then call `await store.flush()` once for the whole drained batch.
4. Only after that await resolves, open the current SQLite transaction and upsert the exact `{ timslite_id: "<decimal bigint>" }` pointer objects into the unchanged `data` column, while continuing to write metadata into the existing SQLite columns, followed by the existing SQLite record-count retention query.
5. If staging or the one Timslite flush fails, catch, log a scoped error, and persist the batch inline rather than writing dangling pointers. The caller-facing `saveRequestDetail` continues to fail open.

Make the store injectable only through a small `__test__` factory setter or exported test setup helper. Production must instantiate the default focused store once. Do not expose Timslite types through `src/lib/db/index.js`.

Keep the existing SQLite `INSERT ... ON CONFLICT` statement and retention SQL. Do not alter the schema, migrations, `requestDetails.data` column type, or migration snapshots. Do not call `dataset.delete()` for a replaced pointer or for rows removed by SQLite retention.

- [ ] **Step 4: Run the integration suite to verify it passes**

Run: `cd tests && npx vitest run unit/request-details-timslite-integration.test.js`

Expected: PASS for disabled compatibility, enabled dual writes, one Timslite flush before the SQLite transaction, safe failure fallback, unchanged SQLite schema usage, and zero per-record deletes.

- [ ] **Step 5: Commit the dual-write integration**

```bash
git add src/lib/db/repos/requestDetailsRepo.js tests/unit/request-details-timslite-integration.test.js
git commit -m "feat(observability): dual-write request details to Timslite"
```

### Task 4: Hydrate Mixed Rows and Expose Unavailable Details Safely

**Files:**
- Modify: `src/lib/db/repos/requestDetailsRepo.js:162-205`
- Modify: `src/app/api/usage/request-details/route.js:49-66` if its current spread/redaction needs the flag preserved
- Modify: `src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js:346-<drawer content>`
- Modify: `tests/unit/request-details-timslite-integration.test.js`
- Modify: `tests/unit/request-details-tab.test.js`

**Interfaces:**
- Consumes: `store.getMany(pointerIds)`, existing SQLite pagination query, exact `timslite_id` pointer objects, and redaction route.
- Produces: detail list and by-ID records where inline values remain unchanged; pointed records are hydrated when available; unavailable payloads retain SQLite-column metadata plus `detailUnavailable: true`.

- [ ] **Step 1: Write failing mixed-hydration and UI safety tests**

Add repository tests for a page containing inline, present-pointer, missing-pointer, malformed-pointer, and store-read-error records:

```js
it("hydrates only pointer rows in the current page and preserves unavailable metadata", async () => {
  fakeStore.getMany = vi.fn(async (ids) => new Map([
    ["present", { request: { messages: ["private"] }, response: { text: "ok" } }],
    ["missing", null],
  ]));

  const result = await getRequestDetails({ page: 1, pageSize: 5 });

  expect(fakeStore.getMany).toHaveBeenCalledWith(["present", "missing", "malformed"]);
  expect(result.details.find((d) => d.id === "inline").request).toEqual({ method: "POST" });
  expect(result.details.find((d) => d.id === "present").response).toEqual({ text: "ok" });
  expect(result.details.find((d) => d.id === "missing")).toMatchObject({
    provider: "openai", model: "gpt-test", detailUnavailable: true,
  });
  expect(result.details.find((d) => d.id === "missing").tokens).toBeUndefined();
});
```

Assert `getRequestDetailById` follows the same mixed behavior for a single pointer. Add an API test that a hydrated request payload becomes `{ redacted: true }`, while `detailUnavailable` and the SQLite-column metadata survive the route response. Update the dashboard-focused test so undefined tokens and `detailUnavailable: true` do not throw, and add a component-level assertion using the project’s existing lightweight rendering approach that the drawer shows this copy:

```text
Full request and response details are no longer available for this record.
```

- [ ] **Step 2: Run the hydration and tab tests to verify they fail**

Run: `cd tests && npx vitest run unit/request-details-timslite-integration.test.js unit/request-details-tab.test.js`

Expected: FAIL because the repository currently parses each `data` value as a full detail and the drawer has no unavailable-state rendering.

- [ ] **Step 3: Implement bounded point-read hydration and the UI fallback**

Change the SQLite page query to select `id`, `timestamp`, `provider`, `model`, `connectionId`, `status`, and `data`. After `parseJson(data)`, partition only that page into legacy inline details and valid decimal-string `timslite_id` pointers. Deduplicate and cap IDs to the page size before calling `store.getMany` once. For a successful matching result, merge the external payload with SQLite-column identity metadata kept authoritative.

For missing, malformed, or failing reads, return the envelope with `detailUnavailable: true`; do not discard the row, fabricate payload fields, or retry with a dataset scan. Apply the same helper to `getRequestDetailById` so the drawer and callers have a consistent contract.

Keep route redaction after hydration. Redact any present `request`, `providerRequest`, `providerResponse`, and `response` fields, but never replace the top-level `detailUnavailable` value.

In `RequestDetailsTab`, keep the metadata grid visible. Before rendering the payload-oriented collapsible sections, show the stated unavailable text when `selectedDetail.detailUnavailable` is true. Continue optional chaining for tokens and latency. Do not add another HTTP request to retrieve Timslite data.

- [ ] **Step 4: Run the hydration and tab tests to verify they pass**

Run: `cd tests && npx vitest run unit/request-details-timslite-integration.test.js unit/request-details-tab.test.js`

Expected: PASS for inline compatibility, one bounded page-level point-read set, partial metadata fallback, API redaction, and safe unavailable-state rendering.

- [ ] **Step 5: Commit the read and UI compatibility work**

```bash
git add src/lib/db/repos/requestDetailsRepo.js src/app/api/usage/request-details/route.js "src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js" tests/unit/request-details-timslite-integration.test.js tests/unit/request-details-tab.test.js
git commit -m "feat(observability): hydrate Timslite request details safely"
```

### Task 5: Finish Shutdown, Retention, and Regression Coverage

**Files:**
- Modify: `src/lib/timslite/requestDetailsStore.js`
- Modify: `src/lib/db/repos/requestDetailsRepo.js:207-<shutdown handler>`
- Modify: `tests/unit/timslite-request-details-store.test.js`
- Modify: `tests/unit/request-details-timslite-integration.test.js`

**Interfaces:**
- Consumes: existing repository shutdown handler registration and the store `flush()` and `close()` methods.
- Produces: graceful, idempotent shutdown that drains buffered request details, commits pointers only after the final Timslite flush, then closes the local dataset.

- [ ] **Step 1: Write failing shutdown and retention tests**

Add fake-adapter tests that record lifecycle events:

```js
it("on shutdown flushes staged Timslite records before SQLite pointers and closes once", async () => {
  const events = [];
  const repo = await loadRepoWithStore({
    enabled: true,
    async stage() { events.push("stage"); return pointerEnvelope; },
    async flush() { events.push("timslite:flush"); },
    async getMany() { return new Map(); },
    async close() { events.push("timslite:close"); },
  });
  repo.__test__.onBeforeSqlitePointerTransaction(() => events.push("sqlite:transaction"));
  await repo.saveRequestDetail({ id: "shutdown-a" });
  await repo.__test__.shutdown();
  await repo.__test__.shutdown();

  expect(events).toEqual(["stage", "timslite:flush", "sqlite:transaction", "timslite:close"]);
});

it("configures default 90-day Timslite retention without per-record deletes", async () => {
  // Write enough SQLite rows to trigger existing count retention, then assert
  // configureRetention received 90 and the fake dataset delete spy remains zero.
});
```

Also test that an unfinished timer is cleared, a final flush failure falls back inline before close, and a native close error is logged but cannot make shutdown throw or register duplicate process handlers.

- [ ] **Step 2: Run the final focused test group to verify it fails**

Run: `cd tests && npx vitest run unit/timslite-request-details-store.test.js unit/request-details-timslite-integration.test.js`

Expected: FAIL because the current shutdown hook only drains SQLite buffering and does not close Timslite with the required ordering.

- [ ] **Step 3: Implement idempotent graceful close behavior**

Extend the existing repository `_shutdownHandler` rather than adding competing signal handlers. Clear `flushTimer`, await the existing drained flush flow, then `await requestDetailsStore.close()` in a `try/catch` that logs a scoped close failure. Guard with one shared shutdown promise so `beforeExit`, `SIGINT`, `SIGTERM`, and tests cannot execute the sequence twice.

Keep the existing `ensureShutdownHandler()` de-duplication pattern. The store itself should configure the exact default retention once when it opens. Do not add SQLite retention migrations, do not issue Timslite per-record delete calls, and do not implement remote or HTTP Timslite behavior.

- [ ] **Step 4: Run the final focused test group to verify it passes**

Run: `cd tests && npx vitest run unit/timslite-request-details-store.test.js unit/request-details-timslite-integration.test.js`

Expected: PASS for retention defaults, no-delete guarantees, final write ordering, timer cleanup, and idempotent close.

- [ ] **Step 5: Run required diagnostics and baseline-aware regression verification**

Run language diagnostics on changed JavaScript files:

```text
lsp_diagnostics src/lib/timslite/requestDetailsStore.js
lsp_diagnostics src/lib/db/repos/requestDetailsRepo.js
lsp_diagnostics src/app/api/usage/request-details/route.js
lsp_diagnostics src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js
```

Expected: no errors.

Run the complete targeted set from the `tests` directory:

```bash
cd tests && npx vitest run unit/timslite-request-details-store.test.js unit/request-details-timslite-integration.test.js unit/request-details-tab.test.js unit/request-details-redaction.test.js
```

Expected: PASS. Do not treat a raw full-suite run as the acceptance criterion.

Run the repository baseline checks required by `CLAUDE.md`, keeping their output as regression evidence:

```bash
cd tests && node __baseline__/verify-no-regression.mjs
cd tests && node __baseline__/verify-providers.mjs
cd tests && node __baseline__/verify-aliases.mjs
cd tests && node __baseline__/verify-oauth-urls.mjs
```

Expected: each available baseline verifier reports no unexpected regression. If a named verifier does not exist in the checkout, list the missing command in the implementation report and run the available `verify-*.mjs` scripts instead. Do not hide known unrelated suite failures.

- [ ] **Step 6: Commit the final lifecycle and tests**

```bash
git add src/lib/timslite/requestDetailsStore.js src/lib/db/repos/requestDetailsRepo.js tests/unit/timslite-request-details-store.test.js tests/unit/request-details-timslite-integration.test.js
git commit -m "fix(observability): close Timslite request detail storage safely"
```

## Self-Review

### Spec Coverage

- Optional dependency and environment documentation are covered in Task 1.
- SQLite sibling path, database `9router`, dataset `requestDetails`, 90-day retention, and local-only scope are covered in Tasks 1, 2, and 5.
- Focused store, bigint microsecond decimal IDs, UTF-8 4 MiB controlled truncation, fake adapter, batch flush, bounded reads, and close are covered in Task 2.
- Dual writes, one Timslite flush before the SQLite pointer transaction, inline fallback, and no per-record deletes are covered in Task 3.
- Mixed inline/pointer hydration, partial metadata fallback, API redaction, and UI `detailUnavailable` handling are covered in Task 4.
- Shutdown lifecycle, retention regression, diagnostics, targeted Vitest, and baseline-aware verification are covered in Task 5.
- No task changes SQLite migrations or schema, adds HTTP Timslite, or calls `dataset.delete()` for pointer replacement or SQLite retention.

### Placeholder Scan

No implementation placeholders remain. Task 1 uses npm to write the resolved optional dependency version rather than embedding an unverified version in this plan.

### Interface Consistency

All tasks use `createRequestDetailsStore`, `stage`, `flush`, `getMany`, and `close`. SQLite continues to expose `saveRequestDetail`, `getRequestDetails`, `getRequestDetailById`, and `getDistinctProviders` without an external signature change.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-16-observability-timslite-storage.md`. Two execution options:

1. **Subagent-Driven, recommended**. Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution**. Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
