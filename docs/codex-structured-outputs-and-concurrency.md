# Codex Structured Outputs and Local Concurrency

This guide covers two independent 9Router features:

1. transporting OpenAI-compatible structured-output requests to and from the
   Responses API shape used by Codex; and
2. bounding concurrent OAuth-account use with process-local admission.

Structured-output translation preserves a caller's schema contract. It does
not validate the model's generated output, and it cannot add a capability that
the selected upstream model or provider does not support.

Admission is a local safety control, not an OpenAI quota detector. It does not
prove that any particular account, model, or subscription can safely sustain a
chosen concurrency value.

## Structured output request shapes

### Responses API with strict JSON Schema

Send the Responses-native shape to `/v1/responses`:

```bash
curl http://127.0.0.1:20128/v1/responses \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <9router-api-key>' \
  -d '{
    "model": "cx/gpt-5.6-sol",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "Return a title."
          }
        ]
      }
    ],
    "text": {
      "format": {
        "type": "json_schema",
        "name": "title_result",
        "description": "A generated title",
        "schema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "title": {
              "type": "string"
            }
          },
          "required": [
            "title"
          ]
        },
        "strict": true
      }
    }
  }'
```

In the Responses shape, `name`, `description`, `schema`, and `strict` are
direct children of `text.format`.

### Chat Completions with strict JSON Schema

Send the Chat Completions-native shape to `/v1/chat/completions`:

```bash
curl http://127.0.0.1:20128/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <9router-api-key>' \
  -d '{
    "model": "cx/gpt-5.6-sol",
    "messages": [
      {
        "role": "user",
        "content": "Return a title."
      }
    ],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "title_result",
        "description": "A generated title",
        "schema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "title": {
              "type": "string"
            }
          },
          "required": [
            "title"
          ]
        },
        "strict": true
      }
    }
  }'
```

In the Chat Completions shape, the schema fields are nested under
`response_format.json_schema`.

### JSON mode

Responses API:

```json
{
  "text": {
    "format": {
      "type": "json_object"
    }
  }
}
```

Chat Completions:

```json
{
  "response_format": {
    "type": "json_object"
  }
}
```

The prompt should still tell the model to produce JSON. JSON mode requests a
JSON object but does not impose the field-level contract of strict JSON Schema.

## Translation rules

9Router maps the two supported structured-output types in both directions:

| Source | Target |
| --- | --- |
| Chat `response_format.type = "json_schema"` | Responses `text.format.type = "json_schema"` |
| Responses `text.format.type = "json_schema"` | Chat `response_format.type = "json_schema"` with nested `json_schema` |
| Chat `response_format.type = "json_object"` | Responses `text.format.type = "json_object"` |
| Responses `text.format.type = "json_object"` | Chat `response_format.type = "json_object"` |

The optional `name`, `description`, `schema`, and `strict` fields are copied
without inventing omitted values. `strict: false` remains false.

When a mixed request contains both source and target representations, the
target-native field wins:

- Chat-to-Responses translation keeps an existing `text.format` instead of
  overwriting it from `response_format`.
- Responses-to-Chat translation keeps an existing `response_format` instead
  of overwriting it from `text.format`.

After translation, the source-only field is removed so an incompatible field
does not leak to the upstream API. Unknown format types are not converted into
invented semantics.

Codex executors are constructed per dispatch. Request-specific compact-route
or session state is therefore not shared between overlapping Codex requests.

## Process-local admission

Admission is disabled by default and configured per provider under:

```text
providerStrategies[providerId].admission
```

The dashboard exposes the same values on each provider's Connections card.
The provider-scoped settings endpoint is also available:

```bash
curl -X PATCH \
  http://127.0.0.1:20128/api/settings/provider-strategies/codex \
  -H 'Content-Type: application/json' \
  -d '{
    "admission": {
      "enabled": true,
      "maxInFlightPerAccount": 2,
      "maxQueueSize": 200,
      "queueTimeoutMs": 30000
    }
  }'
```

The endpoint merges the provider override atomically. Updating admission does
not delete round-robin settings, unknown future keys, or sibling providers.

### Settings contract

| Field | Default | Valid value | Meaning |
| --- | ---: | --- | --- |
| `enabled` | `false` | Boolean | Enables admission for new acquisitions for this provider. |
| `maxInFlightPerAccount` | `1` | Integer `1..100` | Maximum active leases for one account in this process. |
| `maxQueueSize` | `200` | Integer `0..5000` | Maximum provider-level waiters. `0` rejects immediately when all eligible accounts are full. |
| `queueTimeoutMs` | `30000` | Integer `100..300000` | Maximum time a queued acquisition waits for capacity. |

The API rejects unknown admission fields, non-integers, and out-of-range
values with HTTP `400`.

### Capacity semantics

For one 9Router process, the upper bound on active upstream work is:

```text
eligible account count × maxInFlightPerAccount
```

For example, four eligible accounts with a limit of two can hold at most eight
active leases in that process. A queue size of 200 can absorb additional
inbound requests, but those requests wait locally; it does not send 208
requests upstream at once.

An account must be active, not excluded by fallback, and not locked for the
requested model before it is eligible. Fill-first or round-robin ordering is
then applied only among accounts with available capacity. Selection and
reservation occur under the same process-local critical section.

A lease starts before token refresh and upstream dispatch. It is released:

- after a successful response body reaches EOF;
- when the downstream reader cancels;
- when the upstream response stream errors;
- before an unsuccessful attempt marks an account unavailable and falls back;
  or
- when dispatch throws before returning a response.

Release is idempotent. A queued request does not hold the account-selection
mutex while it waits.

### Queue outcomes

If all eligible accounts are at capacity:

- a request joins the provider FIFO queue while space remains;
- a full queue returns local HTTP `429`;
- an expired queue wait returns local HTTP `429`; and
- a client abort while queued returns HTTP `499`.

A local admission `429` has an OpenAI-compatible body:

```json
{
  "error": {
    "message": "Local provider admission queue is full",
    "type": "rate_limit_error",
    "code": "local_admission_limit"
  }
}
```

Queue timeouts use the message
`Timed out waiting for local provider capacity`. Both local `429` outcomes
include `Retry-After`, rounded up to seconds from `queueTimeoutMs`. They are
request-scoped local outcomes: they do not lock, penalize, or rotate an OAuth
account.

### Observability

`GET /api/usage/stream` adds an aggregate `admission` object to full and
lightweight usage events:

```json
{
  "admission": {
    "providers": {
      "codex": {
        "enabled": true,
        "active": 4,
        "queued": 12,
        "rejected": 3,
        "accountCount": 2,
        "capacity": 4,
        "maxInFlightPerAccount": 2,
        "maxQueueSize": 200,
        "queueTimeoutMs": 30000
      }
    }
  }
}
```

`rejected` is the aggregate count of local queue-full and queue-timeout
rejections retained by the current in-process provider state. `accountCount`
is the number of account keys currently carrying active leases, and
`capacity` is that observed active-account count multiplied by the configured
per-account limit. These two observability fields are not a discovery API for
all configured or upstream-eligible accounts.

The snapshot never includes connection IDs, account names, email addresses,
tokens, prompts, request bodies, or JSON Schemas.

## Disable and rollback

To stop applying admission to new acquisitions, save:

```bash
curl -X PATCH \
  http://127.0.0.1:20128/api/settings/provider-strategies/codex \
  -H 'Content-Type: application/json' \
  -d '{
    "admission": {
      "enabled": false
    }
  }'
```

Existing leases drain normally. Acquisitions that already entered the queue
finish their original wait path; do not clear in-memory counters while
responses are active. To remove the stored override after disabling it:

```json
{
  "admission": null
}
```

No database migration rollback is required because provider strategies are
stored in the existing JSON settings document.

## Deployment warning

> Admission is process-local. It is not a global concurrency limit across
> multiple 9Router processes, containers, workers, or replicas.

Two replicas configured with a per-account limit of two can each admit two
leases for the same OAuth account. Do not infer an aggregate limit of two.
Keep admission disabled in a multi-replica deployment unless a shared
coordinator is added, or size the per-process limits with the aggregate risk
explicitly understood.

OpenAI/Codex limits can vary by account, subscription, model, and time. Start
conservatively and use separate manual OAuth testing to choose operational
values. A local admission limit prevents oversubscription relative to that
configuration; it does not prevent an upstream `429` if the configured value
is too high.

## Deterministic shadow validation

`tests/unit/codex-admission-shadow-load.test.js` exercises synthetic accounts
and mocked response streams. It includes:

- 200 simultaneous inbound requests with bounded active leases and queueing;
- normal EOF, downstream cancel, response-stream error, and account fallback;
- an exact accepted/rejected split for queue overflow;
- queue timeout and request abort under occupied capacity; and
- sticky-1 round-robin waves with equal synthetic duration.

The harness replaces `global.fetch` with a function that throws, uses fake
timers and deferred stream gates, and asserts that all promises settle without
leaked leases, waiters, or timers.

This is shadow implementation validation only. It is not a live Codex OAuth
benchmark, production load test, visual test, deployment validation, or
official QA result. It makes no claim that 100 upstream requests are safe for
one account.
