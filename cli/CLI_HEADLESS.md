# 9Router Headless CLI Guide (Command Mode)

Use this when dashboard is not needed (CI, script, or remote automation).

## 1) Run 9Router in headless mode

Headless has two flows:

- Server mode: keep 9Router API alive without UI.
- Command mode: run API commands against a running server.

Command mode **must** target a running server first.

### Flow A: start server (terminal 1)

```bash
9router --headless --host 127.0.0.1 --port 20128
```

When running from source (not installed from npm), the binary isn't on PATH by default.
Use these fallback commands:

```bash
cd /path/ke/9router
npm run build:cli
node cli/cli.js --headless --port 20128
```

After one-time local install, PATH command works:

```bash
cd /path/ke/9router/cli
npm install -g .
9router --headless --port 20128
```

If `9router` still says command not found, export your npm global bin:

```bash
export PATH="$(npm prefix -g)/bin:$PATH"
```

If 9router is not found after install, run `hash -r` in your shell.

### Flow B: run command mode (terminal 2)

Then in another terminal, run command mode with same host/port.

```bash
9router --host 127.0.0.1 --port 20128 api-keys list
9router --host 127.0.0.1 --port 20128 providers models <connection_id>
9router --host 127.0.0.1 --port 20128 api-keys delete <key_id>
```

`--headless` is optional in command mode, but keep `--host/--port` explicit to avoid endpoint mismatch.

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

9router u key <key_id>
9router usg connection <provider_connection_id>
```

`usage key` calls `/api/usage/keys/:id`.
`usage connection` calls `/api/usage/:connectionId`.

Common gotcha:

- `connect ECONNREFUSED <host>:<port>` means the target endpoint is not running or host/port is wrong.

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
