# Docker

Run ebRouter in a container. Build from the included `Dockerfile` (multi-platform `linux/amd64` + `linux/arm64` when published).

---

# 👤 For Users

## Quick start (SQLite file in volume)

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  --name ebrouter \
  ebrouter:latest
```

App listens on port `20128`. Open: http://localhost:20128

## Quick start (PostgreSQL)

For production-style deployments, use the included Compose stack (app + Postgres):

```bash
# Set a stable encryption key (recommended)
export MASTER_KEY="$(openssl rand -base64 32)"

docker compose up -d --build
```

- App: http://localhost:20128  
- Data: PostgreSQL volume `pgdata` (via `DATABASE_URL` in compose)  
- Certs/logs: `ebrouter_data` volume under `/app/data`

**Testing guide:** [docs/POSTGRESQL_TESTING.md](docs/POSTGRESQL_TESTING.md)

## Production client bundle (sell / on-prem)

For shipping to customers (install scripts, backups, pinned image, hardened defaults):

→ **[deploy/client/](deploy/client/)** — zip this folder and send with [README-CLIENT.md](deploy/client/README-CLIENT.md).

Quick start on client machine:

```powershell
cd deploy\client
.\install.ps1
```

Vendor packaging notes: [deploy/client/VENDOR.md](deploy/client/VENDOR.md)

**Full guide (simple language):** [docs/BUNDLING-AND-DEPLOYMENT.md](docs/BUNDLING-AND-DEPLOYMENT.md)

## Manage container

```bash
docker logs -f ebrouter        # view logs
docker stop ebrouter           # stop
docker start ebrouter          # start again
docker rm -f ebrouter          # remove
```

## Data persistence

```bash
-v "$HOME/.9router:/app/data" \
-e DATA_DIR=/app/data
```

Without `DATA_DIR`, the app falls back to `~/.9router/` (macOS/Linux) or `%APPDATA%\9router\` (Windows). In the container, `DATA_DIR=/app/data` makes the bind mount work.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # auto backups
└── ...                   # certs, logs, runtime configs
```

Host path: `$HOME/.9router/db/data.sqlite`
Container path: `/app/data/db/data.sqlite`

## Optional env vars

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DEBUG=true \
  --name ebrouter \
  ebrouter:latest
```

## Optional Headroom sidecar

The 9Router image does not bundle Python or Headroom. To use Headroom in Docker, run it as a separate service and point 9Router at that proxy:

```yaml
services:
  9router:
    image: decolua/9router:latest
    ports:
      - "20128:20128"
    volumes:
      - "$HOME/.9router:/app/data"
    environment:
      DATA_DIR: /app/data
      HEADROOM_URL: http://headroom:8787
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/chopratejas/headroom:latest
    ports:
      - "8787:8787"
```

In the dashboard, open `Endpoint` → `Token Saver` → `Headroom`, confirm the URL is `http://headroom:8787`, recheck status, then enable Headroom.

If Headroom runs on the Docker host instead of as a sidecar, use `http://host.docker.internal:8787` on macOS/Windows. On Linux, add `--add-host=host.docker.internal:host-gateway` or the equivalent compose `extra_hosts` entry.

## Update to latest

```bash
docker pull ebrouter:latest
docker rm -f ebrouter
# re-run the quick start command
```

---

# 🛠 For Developers

## Build image locally (test)

```bash
docker build -t ebrouter .

docker run --rm -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  ebrouter
```

## Publish to GitHub Container Registry (GHCR)

Images are published as **`ghcr.io/YOUR_GITHUB_ORG/ebrouter:<version>`** (not legacy `9router`).

**Automatic:** push a git tag `v*` → GitHub Actions builds multi-platform (amd64+arm64) and pushes to GHCR.

```bash
git tag v0.4.56
git push origin v0.4.56
```

**Manual push from your machine:** see [deploy/GHCR-PUBLISH.md](deploy/GHCR-PUBLISH.md).

Workflow: `.github/workflows/docker-publish.yml`
