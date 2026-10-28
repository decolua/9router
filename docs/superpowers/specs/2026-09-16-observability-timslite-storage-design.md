# Observability Timslite Storage Design

## Problem

Request-detail observability records currently keep both indexed request metadata
and the potentially large request and response payloads in SQLite. Payloads make
the primary local database grow quickly, increase page-read cost, and make
retention work more expensive than the dashboard's metadata queries require.

The dashboard and compatibility APIs still need SQLite to be the authoritative
source for filtering, ordering, pagination, and summary metadata. They also need
to show a detail payload when one is available. This design moves only eligible
full detail payloads into a local Timslite dataset while preserving the existing
SQLite schema and its query behavior.

## Goals

- Keep all existing SQLite index columns and queries authoritative.
- Store full, header-sanitized request-detail payloads in a local Timslite
  dataset when the feature is enabled.
- Preserve one SQLite-compatible JSON detail field by replacing offloaded content
  with an exact Timslite pointer object.
- Keep behavior safe and useful when Timslite is unavailable, a payload is
  missing, or the feature flag is disabled after historical data was offloaded.
- Bound storage and read work with deterministic payload truncation, a fixed
  Timslite retention policy, bounded point hydration, and a page size cap.
- Add the feature without SQLite DDL, a SQLite migration, a network service, or
  a new required native dependency.

## Non-Goals

- Replacing SQLite as the request-detail index, query engine, or retention owner
  for metadata rows.
- Changing the SQLite schema, adding a migration, or introducing any DDL.
- Defining or calling HTTP, RPC, batch, deletion, or other invented Timslite
  APIs.
- Deleting individual Timslite records when SQLite rows expire or when pointer
  values change.
- Backfilling existing inline SQLite detail rows.
- Storing unsanitized headers, credentials, or other data currently excluded by
  the request-detail sanitizer.
- Guaranteeing payload availability for every historical metadata row.

## Architecture

`src/lib/db/repos/requestDetailsRepo.js` remains the persistence boundary for
request-detail rows. SQLite keeps the current index columns and detail column
unchanged. When enabled and available, the repository writes the sanitized full
detail payload to Timslite and writes this exact JSON value in SQLite instead:

```json
{ "timslite_id": "<decimal bigint>" }
```

`<decimal bigint>` is a base-10 string representation of a monotonic bigint
timestamp ID. It is never persisted as a JavaScript number, because numbers lose
integer precision at this range. The string is the only supported pointer shape.
No version, dataset name, path, tenant, payload copy, or auxiliary property is
added to it.

The read path treats the pointer as an implementation detail. SQLite selects and
orders rows exactly as it does today. For pointer rows, the repository performs
a bounded synchronous Timslite point read for each row on the requested page,
then returns the hydrated payload when found. Timslite has no arbitrary-ID batch
read API for this use case, so the implementation must not invent one or emulate
an unbounded batch operation.

## Configuration

| Variable | Default | Rules |
| --- | --- | --- |
| `OBSERVABILITY_TIMSLITE_DATA_STORE` | `false` | Enables new Timslite writes only when its value is explicitly `true`. Any other value leaves new writes in the existing SQLite path. |
| `OBSERVABILITY_TIMSLITE_RETENTION_DAYS` | `90` | Timslite retention in days. It must parse as a positive integer. Missing, zero, negative, fractional, non-numeric, or otherwise invalid values fall back to `90`. |

The feature depends on the local optional `timslite` package and requires Node
22 or later. The package remains optional so existing installations can run
without it. If the package cannot be loaded or initialized, the system follows
the failure behavior below and does not make observability persistence a startup
requirement.

Feature flag evaluation controls writes only. Reads must recognize and hydrate
valid historical pointer rows even after
`OBSERVABILITY_TIMSLITE_DATA_STORE` is changed to `false`.

## Local Path and Dataset Layout

Timslite uses the same local persistence root as SQLite. Its directory is beside

```text
<SQLite data directory>/timslite/9router
```

The Timslite dataset name is exactly `requestDetails`. The implementation opens
this local dataset with the configured 90-day retention value, or the validated
override. It uses only the supported local Timslite lifecycle and point-read,
write, and close operations provided by the installed package.

No endpoint URL, remote credential, service discovery, or HTTP transport is
part of this design.

## Storage Model

### SQLite

SQLite remains the sole authoritative store for the existing request-detail index
columns, including request identity, timing, provider and model metadata, status,
and any fields used by current list, filter, ordering, and retention queries.
The schema and column types do not change.

The existing SQLite detail field can contain either of these historical forms:

1. A legacy inline sanitized detail payload.
2. The exact Timslite pointer object shown above.

The reader must support both forms for the lifetime of existing records.

### Timslite

Timslite stores the sanitized full detail payload keyed by a monotonic bigint

Before the Timslite write, payload serialization is measured against a safe
payload budget below Timslite's hard 4 MiB (4,194,304-byte) record limit.
Content over that budget is reduced using deterministic,
controlled truncation. Given the same sanitized payload and budget, truncation
must produce the same stored payload. The truncation must retain valid structured
data, clearly mark that content was truncated, and record enough deterministic
summary information to distinguish unavailable or omitted content from an empty
original value. It must prioritize retaining metadata and bounded prefixes of
large text or collections rather than allowing an oversized write.

The precise safe budget is an implementation constant derived from Timslite's
document constraints, with a margin for serialization overhead. It is not a user
configuration setting in this rollout.

## Timslite Lifecycle and API Constraints

The repository owns a process-local Timslite client or dataset handle. It opens
lazily on the first eligible write or pointer hydration, rather than making
application startup depend on the optional package. Concurrent callers share
the initialized handle and initialization result, so they do not race to create
multiple datasets.

The implementation must follow the installed Timslite package's supported local
API. It may use supported dataset creation or opening, point writes by supplied
ID, synchronous point reads by ID, retention configuration, and shutdown or
close operations. It must not assume unsupported arbitrary-ID batch reads,
per-record deletion, HTTP APIs, or a hidden migration facility.

On process shutdown, the application closes or flushes the Timslite handle using
the package's supported lifecycle method. Shutdown failure is logged and must
not prevent the existing SQLite shutdown path from completing.

## ID Generation

Each offloaded payload receives an ID generated from a monotonic bigint clock.
The generator uses the current timestamp in a chosen fixed time unit as its
candidate value. If the candidate is less than or equal to the last issued ID,
the generator issues `lastIssuedId + 1n`; otherwise it issues the candidate.

The generator, SQLite pointer serialization, Timslite write input, and Timslite
read input preserve the value as bigint or decimal string as required by the
package API. Conversion through `Number` is forbidden. This makes IDs strictly
increasing within the process even if the wall clock repeats or moves backward.

## Write Flow

1. Build the request-detail object exactly as the current observability path
   does.
2. Sanitize headers and sensitive fields before any persistence decision.
3. If `OBSERVABILITY_TIMSLITE_DATA_STORE` is not explicitly enabled, write the
   existing inline sanitized detail payload to SQLite.
4. If enabled, lazily acquire the local `requestDetails` Timslite dataset.
5. Generate a monotonic bigint timestamp ID and deterministically truncate the
   sanitized payload if it exceeds the safe budget.
6. Write the resulting payload to Timslite under that ID.
7. Only after a successful Timslite write, write the exact pointer JSON object to
   SQLite along with the unchanged authoritative index metadata.
8. If Timslite writing fails, do not store a dangling pointer. Fall back to the
   existing inline SQLite detail write when it is safe to do so, and log the
   degraded offload result without logging sensitive payload content.

Timslite writes happen before pointer persistence so SQLite never points to a
record that was known not to be written. A crash between those operations may
leave an orphan Timslite record. This is accepted because Timslite's own
90-day retention removes historical and orphan records.

## Read Flow

1. Run the existing SQLite query for filters, ordering, cursor behavior, and
   summary metadata.
2. Enforce `pageSize <= 100` before detail hydration.
3. For a legacy inline detail row, return its sanitized payload unchanged.
4. For a valid pointer object, synchronously point-read Timslite using its decimal
   bigint ID, even when the write feature flag is currently disabled.
5. Hydrate the row with the returned payload when it exists.
6. When the payload cannot be read, return the SQLite metadata as a partial row,
   omit unavailable detail content, and set `detailUnavailable: true`.

Hydration is bounded by at most one synchronous point read per pointer row on a
page, and never more than 100 point reads. The repository must not issue a read
for malformed pointer data. Malformed values are handled as unavailable detail
metadata, with diagnostic logging that excludes payload content.

## Mixed Legacy Rows

Old inline rows and new pointer rows coexist without backfill. A response page
may contain both forms, but callers receive a consistent detail result after
hydration. The presence of a legacy inline payload is not an error and does not
trigger rewriting it into Timslite.

Rows with a valid pointer but an expired, orphaned, inaccessible, or missing
Timslite record remain useful for indexed observability. They return partial
metadata with `detailUnavailable: true` rather than failing the entire page or
detail request.

## Retention and Deletion

Existing SQLite retention continues to remove SQLite request-detail rows under
its current policy. SQLite retention and pointer updates NEVER delete Timslite
records. No per-record Timslite delete is added.

Timslite has its own configured retention of 90 days by default, with the valid
positive-integer environment override. Timslite retention cleans historical
records and records orphaned by SQLite deletion, pointer replacement, or a crash
between the Timslite and SQLite writes. Temporary mismatch between SQLite and
Timslite retention is expected and is represented by `detailUnavailable`.

## Failure Behavior

| Condition | Required behavior |
| --- | --- |
| Optional package absent, unsupported Node runtime, or initialization failure | Do not crash startup. New writes use the inline SQLite path. Pointer reads return partial metadata with `detailUnavailable: true`. |
| Timslite write failure | Do not persist a pointer. Write inline sanitized SQLite detail when safe, and log a redacted operational error. |
| SQLite write failure after Timslite success | Report the SQLite persistence failure normally. Leave the resulting Timslite orphan for Timslite retention. Do not issue a compensating Timslite delete. |
| Timslite point-read failure or missing record | Return partial indexed metadata with `detailUnavailable: true`; do not fail the surrounding page. |
| Malformed pointer JSON or non-decimal ID | Treat it as unavailable detail, do not call Timslite, and log redacted diagnostics. |
| Shutdown close or flush failure | Log the failure and continue application shutdown. |

Failure logs must identify the operation and non-sensitive request correlation
metadata where available. They must not include request bodies, response bodies,

## Security and Privacy

The existing header sanitizer remains the single source of truth. Every detail
payload is sanitized before either SQLite or Timslite persistence. The pointer
object contains only an opaque decimal ID and exposes no path, credentials, or
payload content.

Timslite data uses the application's local data directory and inherits its file
permission and backup considerations. The implementation must not expose the
local path through external observability responses and must not send details to

## Performance and Observability

The primary list query remains SQLite-only until pointer hydration. Keeping
filter and order columns in SQLite preserves current query plans. The page size
cap of 100 bounds synchronous point-read work and latency. Deterministic
truncation bounds document size and prevents a single large request or response
from creating an unbounded local storage or write cost.

Add redacted operational telemetry or logs for Timslite initialization, write
success and failure, payload truncation, pointer hydration success and failure,
missing payloads, and shutdown failures. Metrics, when available in the existing
observability framework, should count these outcomes and measure bounded
point-read and write duration. They must not label by raw payload, credentials,

## Testing

Tests must cover the following behavior with a local Timslite test double or
the supported local package test setup, without any HTTP Timslite dependency:

- Feature flag defaults to disabled and preserves the inline SQLite path.
- `OBSERVABILITY_TIMSLITE_RETENTION_DAYS` defaults to `90`, accepts positive
  integers, and falls back to `90` for missing, zero, negative, fractional, and
  non-numeric values.
- Enabled writes use the required sibling path and dataset name `requestDetails`.
- A successful offload stores a header-sanitized payload in Timslite and exactly
  `{ "timslite_id": "<decimal bigint>" }` in SQLite.
- Generated IDs are decimal bigint values and are strictly monotonic when the
  clock repeats or moves backward.
- Oversized payloads use deterministic controlled truncation and remain valid
  structured data with an explicit truncation indication.
- Timslite write failure leaves no SQLite pointer and uses the inline fallback.
- SQLite failure after Timslite success does not attempt a Timslite delete.
- Legacy inline rows return unchanged, pointer rows hydrate successfully, and
  pointer rows continue to hydrate after the write flag is disabled.
- Missing, expired, malformed, or unreadable pointers produce partial metadata
  with `detailUnavailable: true` and do not fail a page.
- A page never hydrates more than its rows, and page size is capped at 100.
- SQLite retention and pointer changes make no per-record Timslite deletion
  calls; Timslite retention is the only cleanup mechanism for historical and
  orphan records.
- Initialization and shutdown failures are non-fatal and redact payload data
  from logs.

## Rollout

Ship the code with `OBSERVABILITY_TIMSLITE_DATA_STORE=false`. Existing
installations continue to write inline SQLite payloads. Operators who run Node
22 or later and have the optional local `timslite` package may enable offloading
explicitly. No migration, backfill, or downtime is required.

Enable first in a controlled environment and monitor initialization errors,
fallback writes, truncation counts, hydration misses, page latency, and local
storage growth. Disable the flag to stop new Timslite writes if needed. Existing
pointer rows remain readable through hydration, and unavailable historical
payloads degrade to partial metadata rather than breaking observability pages.

## Acceptance Criteria

- The default configuration is exactly
  `OBSERVABILITY_TIMSLITE_DATA_STORE=false` and
  `OBSERVABILITY_TIMSLITE_RETENTION_DAYS=90`.
- Retention accepts only positive integer days and falls back to `90` for every
  invalid value.
- Timslite is optional, local, Node 22 or later, stored beside SQLite at
  `timslite/9router`, and uses dataset `requestDetails`.
- SQLite schema, DDL, and migrations are unchanged; its indexed metadata remains
  authoritative.
- Every offloaded SQLite detail value is exactly the required one-property
  decimal-bigint pointer object.
- IDs are monotonically increasing bigint timestamp IDs with no precision-losing
  number conversion.
- Full payloads are sanitized before storage and safely, deterministically
  truncated when above the payload budget.
- Page reads hydrate pointer rows with bounded synchronous point reads, cap page
  size at 100, and never depend on an arbitrary-ID batch API.
- Pointer hydration works after write offloading is disabled.
- Missing payloads return partial metadata with `detailUnavailable: true`.
- SQLite retention and pointer updates never delete Timslite records. Timslite's
  own retention cleans historical and orphan records.
- Package, initialization, write, read, retention mismatch, and shutdown
  failures do not expose payloads or take down observability reads.
