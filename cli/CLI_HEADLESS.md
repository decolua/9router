# 9Router Headless CLI Guide (Command Mode)

Use this when dashboard is not needed (CI, script, or remote automation).

## 1) Run server without UI

```bash
9router --headless --port 20128
```

Then in another terminal, run non-interactive commands against the same API endpoint.

## 2) API Key management

```bash
9router api-keys list
9router api-keys create "ci-key"
9router api-keys usage <key_id> --period 7d
9router api-keys delete <key_id>

# aliases
9router keys list
9router k list
```

Supported usage periods: `today`, `24h`, `7d`, `30d`, `60d`, `all`.

## 3) Provider management

```bash
9router providers list
9router providers add openrouter <provider_api_key> --name openrouter-free --default-model nvidia/nemotron-3.5-content-safety:free
9router providers test <connection_id>
9router providers models <connection_id>
9router providers delete <connection_id>

9router prov list
9router p list
```

`provider add` uses `/api/providers` and creates an API-key type connection.

## 4) Usage lookup

```bash
9router usage key <key_id> --period 30d
9router usage connection <provider_connection_id>

9router u key <key_id> --period 30d
9router usg connection <provider_connection_id>
```

`usage key` calls `/api/usage/keys/:id`.
`usage connection` calls `/api/usage/:connectionId`.

## 5) Endpoint mode flags

```bash
9router --host 127.0.0.1 --port 20128 providers list
9router --port 20128 api-keys list
```

## 6) Related endpoints (REST)

- `GET /api/keys`, `POST /api/keys`, `DELETE /api/keys/:id`
- `GET /api/usage/keys/:id?period=...`
- `GET /api/providers`, `POST /api/providers`, `DELETE /api/providers/:id`
- `POST /api/providers/:id/test`, `GET /api/providers/:id/models`
- `GET /api/usage/:connectionId`
