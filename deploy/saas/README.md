# ebRouter SaaS deployment

Multi-tenant hosted deployment (`DEPLOY_MODE=saas`). For single-org on-prem installs, use [`../client/`](../client/).

| Doc | What |
|-----|------|
| **[SAAS-OPS.md](./SAAS-OPS.md)** | Production runbook: DNS, TLS, backup, upgrades, logs, rate limits |
| [../GHCR-PUBLISH.md](../GHCR-PUBLISH.md) | Build and push the Docker image |

## Quick start

1. Point DNS: `app.example.com` and `*.app.example.com` → your server.
2. Copy `.env.example` → `.env` (or run `./install.sh --with-proxy`).
3. Set `SAAS_BASE_DOMAIN`, `CLOUDFLARE_API_TOKEN`, `ACME_EMAIL`, and pin `EBROUTER_IMAGE`.
4. Start:

```bash
cd deploy/saas
chmod +x install.sh backup.sh restore.sh
./install.sh --with-proxy
```

Without TLS (local dev):

```bash
EBROUTER_BIND=0.0.0.0:20128 docker compose up -d
```

Register the first org at `/register`, then access it at `https://{slug}.app.example.com`.

## Files

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | Postgres + app + optional Caddy (`--profile proxy`) |
| `caddy/` | Wildcard TLS reverse proxy (Cloudflare DNS) |
| `nginx/` | Alternative host-level nginx config |
| `backup.sh` / `restore.sh` | PostgreSQL backup and restore |
| `schedule-backup.example.cron` | Daily backup cron template |
