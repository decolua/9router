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

## Publish (automatic via CI)

Push a git tag `v*` → GitHub Actions builds multi-platform (amd64+arm64) and pushes images.

```bash
# Use scripts/release.js (recommended)
node scripts/release.js "Release title" "Notes"

# Or manually
git tag v0.4.x && git push origin v0.4.x
```

Workflow: `app/.github/workflows/docker-publish.yml`
