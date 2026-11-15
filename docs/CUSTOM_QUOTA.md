# Custom quota sources

The quota tracker ships built-in readers for providers that expose a usage API.
For any other provider (custom OpenAI-compatible endpoints, internal gateways,
regional resellers), a custom quota source maps the provider's own usage
response onto the tracker with JSON paths.

## Create a source

Dashboard -> **Quota Tracker** -> **Custom quota**, then pick a connection and
describe its usage endpoint:

| Field | Meaning |
|---|---|
| Request URL | Endpoint to call. Supports `{{baseUrl}}`, `{{apiKey}}`, `{{accessToken}}`, `{{provider}}`, `{{connectionId}}`, `{{name}}` |
| Method | `GET` or `POST` |
| Headers | One `Name: value` per line; values support the same placeholders |
| Body | JSON for `POST` only |
| Items path | Optional path to an array; one row is produced per item |

Each quota row maps response fields to the tracker:

| Field | Meaning |
|---|---|
| Name | Row label |
| Name path | Optional value used as the label (for item arrays) |
| Used path / Total path | Consumed and total amounts |
| Remaining path | Absolute remaining amount (used is derived) |
| % used path / % remaining path | Share-based quotas (0-100) |
| Unit / Unit path | Display unit (`tokens`, `USD`, `requests`, ...) |
| Reset at path | Timestamp or relative offset |
| Reset format | `auto`, epoch seconds/milliseconds, or seconds/minutes from now |
| Unlimited path | Boolean; forces an unlimited row |
| Credit balance path | Renders the total as a currency balance |

Paths use dots and brackets: `usage.used`, `limits[0].percent`,
`data.limits[*].quota`. Wildcards return arrays; item arrays are handled through
**Items path**.

## Examples

OpenAI-compatible endpoint returning a single bucket:

```json
{ "usage": { "used": 125000, "limit": 1000000 }, "resets_at": "2026-12-01T00:00:00Z" }
```

- Used path: `usage.used`
- Total path: `usage.limit`
- Unit: `tokens`
- Reset at path: `resets_at`

Array of windows, one row per entry:

```json
{ "data": { "limits": [
  { "type": "session", "used": 12, "limit": 50, "resets_at": "2026-12-01T00:00:00Z" },
  { "type": "weekly", "used": 300, "limit": 1000, "resets_at": "2026-12-07T00:00:00Z" }
] } }
```

- Items path: `data.limits[*]`
- Name path: `type`
- Used path: `used`
- Total path: `limit`
- Reset at path: `resets_at`

Percentage-based quota:

```json
{ "percent_used": 30, "percent_remaining": 70 }
```

- % used path: `percent_used`

Prepaid credit balance:

```json
{ "balance": { "amount": 42.5, "currency": "USD" } }
```

- Credit balance path: `balance.amount`
- Currency: `USD`

## Test and save

**Test** calls the endpoint and shows the resolved rows plus the raw JSON
response. Saving stores the source in the local settings database and the
connection becomes visible in the quota tracker like any built-in provider.
A custom source takes precedence over the built-in reader for that connection.

The stored configuration never contains the API key: placeholders resolve from
the saved provider connection at request time.

## Private endpoints

Requests go through the SSRF guard. To allow a usage endpoint on a private / LAN
address (self-hosted gateway), set `CUSTOM_QUOTA_ALLOW_PRIVATE_HOSTS=1` in the
9Router environment and restart. Only enable it when the dashboard is not exposed
to untrusted users.

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/quota/custom?connectionId=...` | Read one source (all sources without the query) |
| `PUT` | `/api/quota/custom` | Save `{ connectionId, config }` |
| `DELETE` | `/api/quota/custom?connectionId=...` | Remove a source |
| `POST` | `/api/quota/custom/test` | Dry-run `{ connectionId, config }` and return rows + raw response |

`GET /api/usage/<connectionId>` returns the resolved rows, which is what the
quota tracker and the auto-ping checks consume.
