# Operational Webhooks

9Router can send a small set of operational alerts to Discord, Slack, or a generic signed JSON endpoint. This page describes the behavior implemented in this repository. It is not a promise of universal compatibility, exactly-once delivery, or process-death detection.

Configure destinations in **Dashboard -> Webhooks**. The dashboard and the management API use the same underlying destination, outbox, and delivery records.

## What it does

- Sends only the events listed below. It does not forward console logs, warnings, or arbitrary text.
- Uses a local, persistent outbox. The LLM response never waits for a webhook HTTP request.
- Keeps retry state across a process restart when the delivery row was durably persisted.
- Stores destination credentials write-only. The dashboard and list API never reveal the full URL, URL path, query, fragment, signing secret, or header values.
- Supports three destination kinds only: `discord`, `slack`, and `generic`.

## Events

| Event | Severity | Default | When it is emitted |
| --- | --- | --- | --- |
| `request.failed` | error | subscribed | Once per admitted proxy request after the final outcome is known, including after all fallback attempts are exhausted. |
| `account.unavailable` | warning | opt-in | When an account is marked unavailable or put into cooldown after the fallback decision is formed. |
| `token.refresh_failed` | warning | opt-in | When an available token refresh path fails or a background refresh tick fails for a connection. |

`request.failed` is the only default subscription. Account and token refresh events can be more frequent and must be selected explicitly.

Event semantics:

- Invalid JSON, failed authentication, missing required input, or other pre-admission validation failures do not produce an event.
- `OPTIONS` requests, dashboard CRUD calls, and client disconnects do not produce `request.failed`.
- Nested combo, fusion, or fallback member failures do not produce their own final event. Only the outer admitted request can finalize one `request.failed`.
- An HTTP 200 response is not treated as success by itself. A stream that later terminates with an upstream failure can produce `request.failed`, while a completed or client-cancelled stream does not.
- A failing webhook sink or HTTP delivery never changes the proxy response status, headers, body, or fallback behavior.
- Transient events are coalesced inside the process for 5 seconds by event type, provider, and connection. This burst suppression is not a durable destination cooldown.
- Event data is restricted to `requestId`, `modality`, `provider`, `model`, `connectionId`, `statusCode`, `errorClass`, and `partialResponse`. Prompts, completions, email addresses, full URLs, stack traces, and raw upstream messages are not included.

The event envelope is:

```json
{
  "id": "uuid",
  "type": "request.failed",
  "schema_version": 1,
  "occurred_at": "2026-01-01T00:00:00.000Z",
  "severity": "error",
  "data": {
    "requestId": "request correlation id",
    "modality": "chat",
    "provider": "provider id",
    "model": "provider/model",
    "statusCode": 502,
    "errorClass": "upstream_http",
    "partialResponse": false
  }
}
```

Stable `errorClass` values are `upstream_http`, `upstream_network`, `upstream_timeout`, `no_credentials`, `all_unavailable`, `stream_failed`, `refresh_failed`, and `internal`.

## Destination input

| Field | Behavior |
| --- | --- |
| `name` | Required, trimmed, 1 to 80 characters. |
| `kind` | `discord`, `slack`, or `generic`. |
| `url` | Required on create. Maximum 2048 characters. HTTP and HTTPS only. Userinfo and fragments are rejected. Omitted on edit keeps the saved URL. A replacement must be a full new URL, not a masked placeholder. |
| `enabled` | Defaults to `true`. Disabled destinations receive no operational events. |
| `events` | Non-empty unique list from the three supported events. Defaults to `request.failed`. |
| `allowPrivateNetwork` | Defaults to `false`. Required for HTTP and private or local addresses. |
| `cooldownSeconds` | Integer from 0 to 3600. Defaults to 300. |
| `signingSecret` | Generic only. Write-only. Defaults to a generated `whsec_` secret. Omitted on edit keeps the saved secret. |
| `headers` | Generic only. Maximum 8 custom headers, each value at most 2048 characters. Only `Authorization` and allowed `X-*` names. Routing, forwarding, `Host`, `Content-Type`, `Content-Length`, cookie, and Standard Webhooks signature headers are rejected. |
| `clearSigningSecret` | PATCH only. Clears and regenerates the generic secret. A generic destination is never left unsigned. |
| `clearHeaders` | PATCH only. Removes all saved custom headers. |

Limits:

- Maximum 20 destinations.
- Maximum outbox payload size is 16 KiB of UTF-8 JSON per delivery.
- A generic destination gets a random 32-byte signing secret on create when none is supplied.
- URL, signing secret, and header values are credentials. For those fields, the list API returns only the URL scheme and host, whether a URL and signing secret are configured, and header names. It does not return paths, queries, fragments, secret values, or header values.

## Adapter formats

| Kind | Request format | Success acknowledgement |
| --- | --- | --- |
| `discord` | `POST` with `wait=true`. `content` and `embeds` stay inside Discord limits. `allowed_mentions` is `{ "parse": [] }`, and mention-like text from alert data is neutralized. | HTTP 200 with a JSON object containing a non-empty `id`. |
| `slack` | `POST` with a `text` field. Optional blocks are not required; a minimal `text` payload is valid. Mention-like text is neutralized. | HTTP 200 with body `ok` after trimming whitespace. |
| `generic` | Exact JSON envelope. `POST` with `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers. Signature is HMAC SHA-256 over `id.timestamp.rawBody`, sent as `v1,<base64>`. A `whsec_` secret is base64-decoded; a non-prefixed explicit secret is signed as raw UTF-8 bytes. | Any 2xx response. |

For generic destinations, `webhook-id` stays equal to the event id across retries. `webhook-timestamp` and `webhook-signature` are regenerated for each attempt.

Retry responses are classified as follows:

- Retry: network failure, timeout, HTTP 408, HTTP 429, and HTTP 5xx.
- Terminal failure: HTTP 3xx and other HTTP 4xx responses.
- Discord and Slack acknowledgements that are invalid or missing are terminal, so a deterministic bad acknowledgement is not retried forever.

## Delivery, retry, and cooldown

| Policy | Value |
| --- | --- |
| Poll interval | 1 second per process. |
| Concurrent deliveries | 2 globally. |
| Per destination | At most 1 in-flight delivery and at least 1 second between sends. FIFO is not strict during retry. |
| Attempts | Maximum 8, including the first attempt. |
| Backoff | Full jitter over `min(3600 seconds, 5 seconds * 2^(attempt - 1))`. |
| Retry-After | Numeric seconds and HTTP-date values are respected. A retry is never scheduled earlier than the server asks. If the requested delay passes the item expiry, the item expires instead of being clamped earlier. |
| Request timeout | 10 seconds total for DNS, connect, and response. |
| Lease | 30 seconds. Expired leases can be reclaimed. A valid lease owned by another process is not reset. |
| Pending expiry | 24 hours after enqueue. |
| Terminal retention | 7 days. |
| Queue capacity | 10,000 rows total, including terminal rows. The oldest terminal rows are pruned before rejecting a new enqueue. Pending rows are not silently deleted to make room. |

Cooldown is stored in SQLite under the `webhookCooldown` key-value scope, not in process memory. It applies per destination and per failure fingerprint. A suppressed event increments a counter. The next Discord or Slack message for that fingerprint includes a short suppressed-count note. The generic JSON body remains the exact event envelope.

Delivery statuses are `pending`, `inflight`, `retry`, `delivered`, `failed`, `cancelled`, and `expired`.

Edits and revocation:

- Disabling, deleting, or changing URL, kind, signing secret, headers, or network policy cancels queued deliveries for the old revision.
- Subscription and cooldown edits apply to future events. Already queued events are not removed just because the subscription changed.
- An HTTP request that has already been sent cannot be recalled.
- Deleted destinations keep only non-secret delivery status history.

`Send test` is an explicit synthetic check:

- It uses the saved destination configuration, including a disabled destination.
- It sends a synthetic event, not real request data.
- It bypasses the destination cooldown but still uses the same outbox, transport policy, concurrency, and rate limits.
- The API returns HTTP 202 with a `deliveryId`. Queued does not mean delivered. Check the delivery table or status API for the result.

## Security and access boundaries

Dashboard access:

- Management routes follow the existing dashboard guard. With login enabled, `/api/webhooks` requires a valid dashboard JWT or the local CLI token. With login disabled, the existing guard allows access.
- Webhooks do not add a separate password, `ALWAYS_PROTECTED` rule, or `LOCAL_ONLY` rule.
- When dashboard login is disabled, anyone who can reach the dashboard can add, edit, disable, delete, and test webhook destinations. If the dashboard is reachable from a LAN, that includes other users on the LAN. Enable login before sharing network access.
- Browser mutations must be same-origin JSON. Cross-site `Sec-Fetch-Site`, a foreign `Origin`, a non-JSON content type, or a body over 32 KiB is rejected. Origin-less JSON clients are accepted when they do not send `Sec-Fetch-*` headers. This is CSRF protection, not authentication.

Outbound network policy:

- HTTPS to a public address is the default.
- HTTP, loopback, RFC1918, and IPv6 ULA targets require `allowPrivateNetwork: true`. This opt-in supports local receivers such as a self-hosted automation service. HTTP exposes credentials and payloads in transit.
- The following are blocked in both modes: unspecified, multicast, broadcast, link-local, cloud metadata hosts and metadata address, and the metadata IPv6 address.
- Literal IPs, A/AAAA answers, and IPv4-mapped IPv6 addresses are canonicalized and checked. A mixed public/private DNS answer is rejected in public mode.
- One validated address is pinned to the socket. Host, SNI, and certificate verification still use the original hostname. There is no second DNS lookup, automatic redirect, global or environment proxy, URL userinfo, fragment, or insecure TLS.
- DNS and address policy are rechecked on every attempt. The response body is drained or discarded after at most 8 KiB and is never logged or stored.
- The `lookup` seam in the transport is for internal tests only. It is not a destination field or API option.

Header safety:

- Custom headers are generic only.
- Only `Authorization` and `X-*` names are accepted, with routing and forwarding names blocked.
- CR and LF in values are rejected. Duplicate header names are rejected case-insensitively.
- Header values are 2048 characters or shorter.

## Durability and delivery guarantees

The guarantee is at-least-once, and only for a delivery row that was successfully persisted and flushed to local storage.

Expected loss and duplicate cases:

- Crash before enqueue or before the synchronous flush completes can lose the alert.
- Storage failure, a full disk, or a full outbox can reject an alert. The proxy request still completes normally, but that alert is not delivered.
- If the receiver acknowledges a request and the process dies before the delivery status is committed, the row is reclaimed after its lease expires and the same event is sent again. Duplicates are expected.
- The unique `(eventId, destinationId)` pair prevents duplicate enqueue rows for the same event and destination. It does not prevent retries from resending the same row.
- There is no exactly-once delivery mode. Generic receivers should use `webhook-id` to deduplicate. Discord and Slack receivers should tolerate repeated messages.

Process death is not detected by 9Router:

- The dispatcher runs only while the 9Router process runs.
- If the process is stopped, crashed, or the host is down, no webhook reports that outage. Use an external uptime monitor for process and host availability.
- Graceful shutdown stops the dispatcher and does not wait for network delivery. Persisted pending or inflight rows remain retryable after restart or lease expiry.
- Import, pause, or stop can abort sockets, but the durable revision and generation checks remain authoritative.

The dashboard delivery history and status API show queue counts and recent rows. `degraded.enqueueFailures` is a process-local counter since process start and is not durable across restarts.

## Management API

| Method and path | Behavior |
| --- | --- |
| `GET /api/webhooks` | List redacted destinations. |
| `POST /api/webhooks` | Create a destination. Returns HTTP 201. |
| `PATCH /api/webhooks/[id]` | Update a destination. Accepts `expectedRevision`; a mismatch returns 409. |
| `DELETE /api/webhooks/[id]` | Delete a destination. Accepts `expectedRevision`. |
| `POST /api/webhooks/[id]/test` | Queue an explicit synthetic test to a saved destination. Returns HTTP 202. No custom URL is accepted. |
| `GET /api/webhooks/deliveries?destinationId=&limit=` | List recent deliveries. `limit` is 1 to 100, default 20. Includes queue and degraded counters. |

All routes are dynamic and return `Cache-Control: no-store`. Validation error responses use safe field and code names; raw exceptions, header values, and secrets are not returned.

## Backup and import

Logical database export (`/api/settings/database`) includes:

- Webhook destination configuration, including the full URL, signing secret, and custom header values.
- The export does not include delivery queue rows or cooldown state.

Downloading a logical backup therefore exposes webhook credentials. Store the file securely. The Profile page shows this warning next to the download action.

Logical import:

- Validates all destinations before changing the database. An invalid webhook cancels the whole import.
- A backup from an older version without a `webhooks` field is valid and replaces webhook configuration with an empty list.
- Pauses and aborts in-flight webhook work in a bounded way, increments the webhook generation, clears deliveries and cooldown state, replaces configuration in one transaction, flushes, and resumes.
- Does not replay old queued deliveries. Only new events after the import can enqueue deliveries.
- Rejects late completion from an old generation, so stale in-flight work cannot overwrite the imported state.

Automatic database safety backups (`src/lib/db/backup.js`) exclude `webhookDeliveries` and the `webhookCooldown` key-value scope. They still contain destination credentials. Manual physical recovery of a backup file is not promised to be replay-free because physical recovery is outside the logical import path.

## Storage backend notes

Native SQLite backends use transactional conditional claims and leases. The table schema and migrations are shared across backends.

The pure-JavaScript `sql.js` fallback is a snapshot adapter:

- It persists the whole database file from memory and uses a short debounce for ordinary writes.
- Webhook enqueue, claim, completion, destination mutation, and logical import call `flush()` so the durable row or acknowledgement is written before the HTTP side effect is treated as durable.
- `sql.js` supports one app writer per database file. It is not a shared-file multi-process backend. A second process or an already-open second adapter does not see later writes until it reopens the file.
- No recovery claim is made for power loss or filesystem corruption on any backend. The tested target is process restart after a successful flush.

## Limitations and non-goals

- No exactly-once delivery.
- No process-down, host-down, or dispatcher-stopped alert. Use an external monitor.
- No capture or forwarding of all console logs.
- No custom templates, custom scripts, custom HTTP methods, or arbitrary request bodies.
- No fourth adapter or plugin framework.
- No replay of historical queue items on import.
- No guarantee that an already accepted message can be recalled.
- No claim that every network environment, proxy, or receiver is compatible.
- No replacement for dashboard authentication.

## Prior art

Upstream pull request [decolua/9router#513](https://github.com/decolua/9router/pull/513) is recorded as prior art for the operational notification problem space. It is not accepted or merged in this repository, and this implementation does not depend on its code.

## Local checks

Focused webhook unit tests live in `tests/unit/webhook-*.test.js`. Vitest is intentionally installed outside this workspace, so the runner expects `/tmp/node_modules/vitest/vitest.mjs`. Install it once before running:

```bash
# One-time prerequisite, outside the workspace
cd /tmp && npm install vitest

# From the repository root
cd tests
bun /tmp/node_modules/vitest/vitest.mjs run --reporter=verbose unit/webhook

cd ..
bun run build
```

The production build uses Next webpack. A fully offline build environment can fail while fetching a Google font used by the existing app; that is a build environment dependency, not a webhook runtime check.
