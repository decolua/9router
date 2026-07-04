# ebRouter SaaS — production operations runbook

This guide covers hosting ebRouter as a multi-tenant SaaS (`DEPLOY_MODE=saas`) on a single server or small cluster. For per-client on-prem installs, see [`../client/README-CLIENT.md`](../client/README-CLIENT.md).

---

## Architecture overview

```text
Internet
   │
   ▼
Caddy or nginx (443) ── wildcard TLS for *.app.example.com
   │
   ▼
ebRouter container (:20128, localhost-only in production)
   │
   ▼
PostgreSQL 16 (internal Docker network)
```

- **Tenancy:** shared database, row-level `orgId` isolation.
- **Org URLs:** `https://{slug}.{SAAS_BASE_DOMAIN}` (primary). Path `/o/{slug}/...` works for local dev.
- **Apex domain:** marketing, `/register`, health checks.

---

## Prerequisites

| Item | Notes |
|------|-------|
| Server | Linux, 4+ GB RAM, Docker Engine + Compose v2 |
| Domain | e.g. `app.example.com` |
| DNS | `A`/`AAAA` for apex **and** wildcard `*.app.example.com` → server IP |
| Image | Pin `EBROUTER_IMAGE` to a released tag from GHCR |
| Secrets | Generate via `install.sh` or `openssl rand` — store `.env` in a secrets manager |

---

## First-time install

```bash
cd deploy/saas
cp .env.example .env
# Edit: SAAS_BASE_DOMAIN, EBROUTER_IMAGE, CLOUDFLARE_API_TOKEN, ACME_EMAIL

chmod +x install.sh backup.sh restore.sh
./install.sh --with-proxy
```

Verify:

```bash
curl -fsS https://app.example.com/api/health
# {"ok":true}
```

Create the first organization at `https://app.example.com/register`, then sign in at `https://{slug}.app.example.com`.

---

## TLS (wildcard certificates)

Dynamic org subdomains require a **wildcard** cert (`*.app.example.com`). HTTP-01 alone cannot issue wildcards.

### Option A — Caddy + Cloudflare DNS (included in this bundle)

1. Create a Cloudflare API token with **Zone → DNS → Edit** for your zone.
2. Set in `.env`:
   - `CLOUDFLARE_API_TOKEN`
   - `ACME_EMAIL`
3. Start with proxy profile: `docker compose --profile proxy up -d --build`

Caddy config: [`caddy/Caddyfile`](./caddy/Caddyfile). The Caddy image is built with the Cloudflare DNS module ([`caddy/Dockerfile`](./caddy/Dockerfile)).

Certificates renew automatically. Caddy state lives in the `caddy_data` Docker volume.

### Option B — nginx + certbot DNS

Use [`nginx/ebrouter.conf`](./nginx/ebrouter.conf) on the host:

```bash
# Example with Cloudflare DNS plugin
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d app.example.com -d '*.app.example.com'
```

Include [`nginx/ebrouter-proxy.conf`](./nginx/ebrouter-proxy.conf) and point `upstream` to `127.0.0.1:20128`. Keep `EBROUTER_BIND=127.0.0.1:20128` in `.env`.

### Option C — Cloudflare orange-cloud proxy

Terminate TLS at Cloudflare and run origin HTTP. Simpler, but traffic is proxied through Cloudflare (ensure SSE/streaming timeouts are configured). Set `AUTH_COOKIE_SECURE=true` and forward `Host` / `X-Forwarded-Proto` headers.

---

## DNS checklist

| Record | Type | Value |
|--------|------|-------|
| `app.example.com` | A / AAAA | Server IP |
| `*.app.example.com` | A / AAAA | Server IP (wildcard) |

After DNS propagates, Caddy will obtain certificates on first request (may take 1–2 minutes).

---

## Backup and restore

### What to back up

| Asset | Method | Frequency |
|-------|--------|-----------|
| PostgreSQL (all orgs) | `./backup.sh` | Daily (automated) |
| `.env` secrets | Encrypted off-site copy | On change + after install |
| `ebrouter_data` volume | Optional file-level snapshot | Weekly if storing local uploads |
| `caddy_data` volume | Optional (certs re-issue) | Low priority |

### Manual backup

```bash
./backup.sh                    # writes deploy/saas/backups/ebrouter-saas-YYYYMMDD-HHMMSS.sql
EBROUTER_BACKUP_RETENTION_DAYS=60 ./backup.sh   # custom retention
```

### Automated backups

Copy [`schedule-backup.example.cron`](./schedule-backup.example.cron) to `/etc/cron.d/ebrouter-saas` and fix the path.

**Off-site:** sync `backups/` to S3, B2, or rsync after each run:

```bash
aws s3 sync ./backups s3://your-bucket/ebrouter-saas/backups/
```

### Restore

```bash
./restore.sh backups/ebrouter-saas-20250702-020000.sql
```

This stops the app, replaces the database, and restarts. All organizations are restored together — there is no per-org restore in v1.

### Point-in-time recovery

For production, consider managed Postgres (RDS, Cloud SQL) with automated PITR instead of self-hosted `pg_dump` only.

---

## Upgrades

1. **Back up:** `./backup.sh`
2. **Pin new image** in `.env`: `EBROUTER_IMAGE=ghcr.io/org/ebrouter:vX.Y.Z`
3. **Pull and recreate:**

```bash
docker compose --profile proxy pull ebrouter
docker compose --profile proxy up -d ebrouter
```

4. **Verify:** health endpoint, login on one org subdomain, run a test `/v1` request.
5. Migrations run automatically on app startup (schema version in logs).

Rollback: restore previous image tag and `docker compose up -d`. If a migration already ran, restore from SQL backup instead.

---

## Log retention

| Log type | Location | Retention guidance |
|----------|----------|-------------------|
| Container stdout | `docker compose logs` | Rotate via Docker `json-file` max-size (add logging driver in compose) or ship to Loki/Datadog |
| Request bodies | DB `requestDetails` | Set `ENABLE_REQUEST_LOGS=false` in production unless needed; purge old rows periodically |
| Audit events | DB `auditLogs` | SQL job: `DELETE FROM "auditLogs" WHERE "createdAt" < NOW() - INTERVAL '90 days'` |
| Backup script output | `/var/log/ebrouter-saas-backup.log` | logrotate |

### Docker log rotation (recommended)

Add to `docker-compose.yml` under `ebrouter` and `caddy`:

```yaml
logging:
  driver: json-file
  options:
    max-size: "50m"
    max-file: "5"
```

### Disable verbose request logging in prod

```env
ENABLE_REQUEST_LOGS=false
```

---

## Rate limiting

ebRouter applies **application-level** limits on `/v1` and `/api/v1`:

| Variable | Default | Scope |
|----------|---------|-------|
| `API_RATE_LIMIT_PER_MIN` | 120 | Per client IP |
| `API_RATE_LIMIT_PER_KEY_PER_MIN` | 300 | Per API key |

Tune per your capacity. These are global per instance, not per organization.

### Per-organization limits (reverse proxy)

For SaaS plan tiers, rate-limit by subdomain at the proxy:

**nginx** (included): `limit_req_zone $host` in [`nginx/ebrouter.conf`](./nginx/ebrouter.conf) — 120 req/min per subdomain on API paths.

**Caddy:** use the [caddy-ratelimit](https://github.com/mholt/caddy-ratelimit) module or enforce quotas in a future app release. Until then, nginx per-host limits or Cloudflare rate rules per hostname are the practical options.

**Cloudflare:** create rate limiting rules on `*.{zone}/v1/*` per plan.

---

## Security checklist

- [ ] `AUTH_COOKIE_SECURE=true`
- [ ] `REQUIRE_API_KEY=true` for production API exposure
- [ ] App bound to `127.0.0.1:20128` (not public) when behind proxy
- [ ] Strong `JWT_SECRET`, `API_KEY_SECRET`, `MASTER_KEY` — never commit `.env`
- [ ] Postgres not exposed on host ports
- [ ] Firewall: allow 80/443 only (and SSH from admin IPs)
- [ ] SMTP configured for password reset (or admin-only reset flow)
- [ ] Daily backups tested with a restore drill quarterly

---

## Monitoring

| Check | Command / URL |
|-------|----------------|
| Liveness | `GET /api/health` → `{"ok":true}` |
| Containers | `docker compose ps` |
| App logs | `docker compose logs -f --tail=200 ebrouter` |
| Postgres | `docker compose exec postgres pg_isready` |
| Disk | Monitor `pgdata` and `backups/` volumes |

Alert on: health check failures, disk > 80%, backup script errors, elevated 5xx rate.

---

## Environment reference

Key SaaS-specific variables (see [`.env.example`](./.env.example)):

```env
DEPLOY_MODE=saas
SAAS_BASE_DOMAIN=app.example.com
BASE_URL=https://app.example.com
AUTH_COOKIE_SECURE=true
API_RATE_LIMIT_PER_MIN=120
API_RATE_LIMIT_PER_KEY_PER_MIN=300
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Wildcard cert fails | Missing DNS token or wildcard DNS record | Verify `*.domain` A record and `CLOUDFLARE_API_TOKEN` |
| Org login 404 | Wrong subdomain or slug | Check `organizations.slug` matches subdomain |
| Cookies not set | `AUTH_COOKIE_SECURE=false` over HTTPS | Set `AUTH_COOKIE_SECURE=true` |
| 429 on API | Rate limit hit | Raise limits or add proxy burst; check abusive org |
| Migration error on upgrade | Schema drift | Restore backup; contact support with logs |

---

## Related docs

- [SaaS README](./README.md) — quick start
- [GHCR publish](../GHCR-PUBLISH.md) — build Docker images
- [Client on-prem](../client/README-CLIENT.md) — single-org installs
- [Bundling guide](../../docs/BUNDLING-AND-DEPLOYMENT.md) — vendor release process
