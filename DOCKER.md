# Docker

Run 9Router in a container. Published image: [`decolua/9router`](https://hub.docker.com/r/decolua/9router) — multi-platform `linux/amd64` + `linux/arm64`.

---

# 👤 For Users

## Quick start

Before starting, create a local environment file and replace the example values. Set a non-default `INITIAL_PASSWORD` and long random `JWT_SECRET` and `API_KEY_SECRET` values; never use the example `change-me` values in a reachable deployment.

> **`API_KEY_SECRET` is a server-side secret, not a client key.** The gateway uses it (an HMAC secret) to derive and validate the API keys it mints — clients must never send it as `Authorization: Bearer <API_KEY_SECRET>` against `/v1`. When your tools need a key, create one in the dashboard (Endpoint → API Keys) or with login + `POST /api/keys`; minted keys look like `sk-…`. In federation deployments, sharing `API_KEY_SECRET` across instances keeps minted client keys valid everywhere — it does not make the secret itself a client key.

```bash
cp .env.example .env
# Edit .env: set INITIAL_PASSWORD, JWT_SECRET, and API_KEY_SECRET.

docker run -d \
  --env-file .env \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  --name 9router \
  decolua/9router:latest
```

Open the dashboard at http://localhost:20128/dashboard and log in with the `INITIAL_PASSWORD` you set in `.env`.

## Manage container

```bash
docker logs -f 9router        # view logs
docker stop 9router           # stop
docker start 9router          # start again
docker rm -f 9router          # remove
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
  --name 9router \
  decolua/9router:latest
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

## Clean host / pull-failure fallback (local build)

`docker-compose.yml` deploys the published third-party images
(`decolua/9router`, `ghcr.io/chopratejas/headroom`). On a clean or rootless
host those pulls can fail — measured on a clean agent, `docker compose up -d
--build` aborted while pulling from those namespaces, which left the only
documented deployment path unusable there. 9router therefore has a local-build
fallback, applied as a Compose **override** so the base file (images, ports,
volumes, env, wiring) stays exactly as published:

```bash
# 9router built from this checkout (Dockerfile at the repo root).
# The headroom image is still pulled if compose starts that service.
docker compose -f docker-compose.yml -f docker-compose.local-build.yml up -d --build

# Clean/rootless host, nothing pulled from a third-party registry at all —
# headroom sidecar omitted. Headroom is optional at runtime (9router only
# contacts HEADROOM_URL when the dashboard Token Saver toggle is enabled),
# so leave that toggle off until you can pull the image.
docker compose -f docker-compose.yml -f docker-compose.local-build.yml \
  up -d --build --no-deps 9router
```

- The override builds and tags **`9router:local`** — a distinct tag, so a local
  build never overwrites `decolua/9router:latest` in your image cache. Pick
  another tag with `NINEROUTER_LOCAL_IMAGE=my/9router:dev`.
- Port overrides (`PORT`, `HEADROOM_PORT`), the optional `.env` and the
  `9router-data` volume behave exactly as in the default path; only the 9router
  service gains a `build:` section.

**Host port conflict:** the compose file maps host port `20128` by default
(`${PORT:-20128}:20128`). If `20128` is occupied, run
`PORT=<free-port> docker compose up -d` to move the host-side mapping — the
container still serves on 20128 internally.
- Headroom has **no local build** in this repository (it is a third-party
  project), which is why the second command omits the sidecar instead of
  building it. Once the headroom image is pullable again, start it with
  `docker compose -f docker-compose.yml up -d headroom` (or drop
  `--no-deps 9router` and use the first command).
- The federation stack already builds from source
  (`docker-compose.federation.yml` → `Dockerfile.federation`); this fallback
  gives the standalone stack the same offline-capable path.

## Update to latest

```bash
docker pull decolua/9router:latest
docker rm -f 9router
# re-run the quick start command
```

---

# 🛠 For Developers

## Build image locally (test)

```bash
# The Dockerfile lives at the repo root — build from here (no app/ subdirectory)
docker build -t 9router .

docker run --rm -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  9router
```

The same image can be built and run through Compose (see
[Clean host / pull-failure fallback](#clean-host--pull-failure-fallback-local-build)):

```bash
docker compose -f docker-compose.yml -f docker-compose.local-build.yml up -d --build
```

## Publish (automatic via CI)

Push a git tag `v*` → GitHub Actions builds multi-platform (amd64+arm64) and pushes to:
- `ghcr.io/decolua/9router:v{version}` + `:latest`
- `decolua/9router:v{version}` + `:latest`

```bash
# Use scripts/release.js (recommended)
node scripts/release.js "Release title" "Notes"

# Or manually
git tag v0.4.x && git push origin v0.4.x
```

Workflow: `app/.github/workflows/docker-publish.yml`
