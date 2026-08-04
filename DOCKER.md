# Docker

Run 9Router in a container. Published image: [`decolua/9router`](https://hub.docker.com/r/decolua/9router) — multi-platform `linux/amd64` + `linux/arm64`.

---

# 👤 For Users

## Quick start

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  --name 9router \
  decolua/9router:latest
```

App listens on port `20128`. Open: http://localhost:20128

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

## MITM proxy & `/etc/hosts`

The MITM proxy feature redirects traffic from certain CLI/IDE tools (Antigravity, GitHub Copilot, Kiro, …) to 9Router by mapping their API hostnames to `127.0.0.1` in your host's `/etc/hosts`. To make this work from inside the container, you need to mount `/etc/hosts` from the host.

Two modes are supported, with different security trade-offs.

### Mode 1 — Manual hosts management (recommended) 🔒

Mount `/etc/hosts` **read-only**. The container can read entries but cannot modify the host file.

````bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -v "/etc/hosts:/etc/hosts:ro" \
  -e DATA_DIR=/app/data \
  --name 9router \
  decolua/9router:latest
````

The in-app DNS toggle on the **MITM Proxy** page cannot rewrite `/etc/hosts` in this mode. Instead, the UI displays the exact entries to add. Append them on your host manually, for example:

````text
127.0.0.1 daily-cloudcode-pa.googleapis.com
127.0.0.1 cloudcode-pa.googleapis.com
# … plus any other entries shown in the UI for the tools you use
````

No elevated access is granted to the container; the host's `/etc/hosts` cannot be altered unexpectedly. One-time manual edit per tool.

### Mode 2 — Automatic hosts management ⚠️

Mount `/etc/hosts` **read-write**. The in-app DNS toggle adds and removes entries automatically when you enable/disable a tool.

````bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -v "/etc/hosts:/etc/hosts" \
  -e DATA_DIR=/app/data \
  --name 9router \
  decolua/9router:latest
````

> ⚠️ **Security note:** this gives the container write access to your host's `/etc/hosts`. Only use it if you trust the image and accept the trade-off. Not recommended for shared or multi-user machines.

### Which mode should I pick?

| Use case                                  | Recommended mode |
| ----------------------------------------- | ---------------- |
| Personal dev machine, security-conscious  | Mode 1 (`:ro`)   |
| Quick local experimentation               | Mode 2 (rw)      |
| Shared / production-ish host              | Mode 1 (`:ro`)   |
| CI / ephemeral environments               | Mode 1 (`:ro`)   |

If you don't need the MITM feature at all, simply omit the `/etc/hosts` mount — 9Router still works as a regular router/proxy for the providers you configure.

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
docker pull decolua/9router:latest
docker rm -f 9router
# re-run the quick start command
```

---

# 🛠 For Developers

## Build image locally (test)

```bash
cd app && docker build -t 9router .

docker run --rm -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  9router
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
